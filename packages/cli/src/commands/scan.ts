/**
 * `workledger scan [--repo <path>] [--json]` — docs/contracts/p3/cli.md §`workledger scan`.
 *
 * The orphan sweep. A session whose harness died never gets a `SessionEnd`, so its row stays
 * `open` and its ledger file says a session is still running that has not existed for hours.
 * This is what closes that gap, and the only evidence it uses is a `stat`: "Reads mtimes only"
 * — never a byte of a transcript, and never a process table, because neither survives a reboot
 * and both would make the sweep depend on machine state the ledger cannot reconstruct.
 *
 * The budget is 500 open sessions under 200 ms (plans/feature-p3-data-flow.md §Budgets), which
 * is what makes the same function safe to run opportunistically from `hook SessionStart`.
 */
import { statSync } from "node:fs";
import process from "node:process";

import { loadConfig } from "../config.js";
import { EXIT_NOT_ENABLED, EXIT_OK } from "../exit-codes.js";
import { findRepoRoot, isEnabled, readTextFile, sessionFile, writeFileAtomic } from "../ledger-fs.js";
import { enqueueJob } from "../jobs/queue.js";
import type { IndexDb, SessionRow } from "../index/db.js";

/** Options commander parses for `scan`. */
export interface ScanOptions {
  repo?: string;
  json?: boolean;
}

/** One session the sweep marked crashed. */
export interface ScanOrphan {
  ulid: string;
  /** Why it was called crashed: the transcript is gone, or it stopped growing. */
  reason: "transcript-missing" | "stale";
  /** Whole minutes since the transcript was last written; `null` when there is no file. */
  idleMinutes: number | null;
  /** The repair job queued for it, or `null` when one was already open. */
  jobId: string | null;
}

/** What one sweep did. */
export interface ScanResult {
  repo: string;
  /** Open sessions the sweep looked at. */
  examined: number;
  orphans: ScanOrphan[];
  /** Repair jobs this sweep created — never counts one that was already queued. */
  queued: number;
}

/** Everything the sweep touches outside itself. */
export interface ScanIo {
  db: IndexDb;
  root: string;
  now: () => Date;
  newId: () => string;
  /** Cap on how many sessions one sweep examines; the opportunistic caller passes 20. */
  limit?: number | undefined;
  /**
   * A session to leave alone — the one whose `SessionStart` triggered an opportunistic sweep.
   * It is by definition alive, and it is the session least likely to have a transcript on disk
   * yet, so it is also the one a naive sweep would call crashed first.
   */
  skipUlid?: string | undefined;
  /** Wall-clock budget; the opportunistic caller passes 200 ms. Checked between sessions. */
  budgetMs?: number | undefined;
}

/** Millisecond mtime of a file, or `undefined` when it cannot be stat'ed. */
function mtimeMs(file: string | null): number | undefined {
  if (file === null || file === "") return undefined;
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Whole minutes since an ISO instant, or `undefined` when it cannot be read. */
function minutesSince(iso: string | null, now: Date): number | undefined {
  if (iso === null) return undefined;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? undefined : (now.getTime() - at) / 60_000;
}

/**
 * Whether one open session is an orphan, and why.
 *
 * The contract's rule verbatim: "if the transcript file is missing or its mtime is older than
 * `config.orphan_minutes` (default 30) and `turns_since_checkpoint > 0` or no checkpoint exists".
 * The second clause is what keeps the sweep off a session that is merely idle *and* fully
 * described — there is nothing for a repair to recover from a session whose every turn is
 * already in the ledger.
 *
 * "Missing" is held to the same clock as "stale", measured against the index row's `updated_at`
 * because a file that is not there has no mtime of its own. Without that, a session would be
 * declared crashed during its own `SessionStart`: the hook records the transcript path the
 * harness reports, and the harness has not written the file yet. The e2e found exactly that.
 */
export function classifyOrphan(
  session: SessionRow,
  options: { now: Date; orphanMinutes: number; checkpointCount: number },
): ScanOrphan | undefined {
  if (options.checkpointCount > 0 && session.turns_since_checkpoint <= 0) return undefined;

  const mtime = mtimeMs(session.transcript_path);
  if (mtime === undefined) {
    const age = minutesSince(session.updated_at, options.now);
    if (age !== undefined && age < options.orphanMinutes) return undefined;
    return { ulid: session.ulid, reason: "transcript-missing", idleMinutes: null, jobId: null };
  }
  const idleMinutes = (options.now.getTime() - mtime) / 60_000;
  if (idleMinutes < options.orphanMinutes) return undefined;
  return {
    ulid: session.ulid,
    reason: "stale",
    idleMinutes: Math.floor(idleMinutes),
    jobId: null,
  };
}

/**
 * Sweep one repo.
 *
 * Order matters: the frontmatter is written *before* the job is queued, so a crash between the
 * two leaves a session correctly marked `crashed` with no job — which the next sweep queues —
 * rather than a job pointing at a session that still claims to be open.
 */
export async function runScan(io: ScanIo): Promise<ScanResult> {
  const { db, root } = io;
  const config = loadConfig(root);
  const started = Date.now();
  const open = db.listOpenSessions(root);
  const budget = io.budgetMs;
  const limit = io.limit ?? open.length;

  const result: ScanResult = { repo: root, examined: 0, orphans: [], queued: 0 };
  const { parseFrontmatter, stringifyFrontmatter } = await import("@workledger/core/frontmatter");

  for (const session of open) {
    if (session.ulid === io.skipUlid) continue;
    if (result.examined >= limit) break;
    // Between sessions rather than inside one: a half-marked session — frontmatter written, row
    // not updated — is the one state this sweep must never leave behind.
    if (budget !== undefined && Date.now() - started >= budget) break;
    result.examined += 1;

    const orphan = classifyOrphan(session, {
      now: io.now(),
      orphanMinutes: config.orphan_minutes,
      checkpointCount: db.countCheckpoints(session.ulid),
    });
    if (orphan === undefined) continue;

    const nowIso = io.now().toISOString();
    const file = sessionFile(root, session.ulid);
    const text = readTextFile(file);
    if (text !== undefined) {
      try {
        const parsed = parseFrontmatter(text);
        parsed.data["status"] = "crashed";
        parsed.data["end_reason"] = "crashed";
        parsed.data["needs_repair"] = true;
        parsed.data["ended"] ??= nowIso;
        writeFileAtomic(file, stringifyFrontmatter(parsed.data, parsed.body));
      } catch {
        // An unparseable ledger file is `doctor`'s problem. The index row is still moved: an
        // open row for a dead session would be swept again on every tick forever.
      }
    }
    db.updateSession(session.ulid, { status: "crashed", updated_at: nowIso });

    const { job, created } = enqueueJob(db, {
      kind: "repair",
      sessionUlid: session.ulid,
      repoPath: root,
      newId: io.newId,
      now: io.now(),
    });
    if (created) result.queued += 1;
    result.orphans.push({ ...orphan, jobId: job.id });
  }

  return result;
}

/** The contracted stdout line. */
export function scanLine(result: ScanResult): string {
  const jobs = result.queued === 1 ? "job" : "jobs";
  return `scan: ${result.orphans.length} orphaned, ${result.queued} repair ${jobs} queued`;
}

/** @returns the process exit code. */
export async function scanCommand(options: ScanOptions): Promise<number> {
  const from = options.repo ?? process.cwd();
  const root = findRepoRoot(from);
  if (root === undefined || !isEnabled(root)) {
    process.stderr.write(`workledger: ${from} is not an enabled repo; run \`workledger init\` first\n`);
    return EXIT_NOT_ENABLED;
  }

  const { newSessionId } = await import("@workledger/core/ids");
  const { openIndex } = await import("../index/db.js");
  const home = process.env["WORKLEDGER_HOME"]?.trim();
  const db = openIndex(home ? { home } : {});
  try {
    const result = await runScan({ db, root, now: () => new Date(), newId: newSessionId });
    process.stdout.write(
      options.json === true ? `${JSON.stringify(result)}\n` : `${scanLine(result)}\n`,
    );
    return EXIT_OK;
  } finally {
    db.close();
  }
}
