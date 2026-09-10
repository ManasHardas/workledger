/**
 * `workledger backfill [--repo] [--since] [--concurrency] [--dry-run] [--yes] [--extract-fallback]`
 * — docs/contracts/p3/cli.md §`workledger backfill`.
 *
 * The retroactive half of the product. `init` starts observing a repo from the moment it runs, so
 * every session that happened before it is invisible: the transcripts are still on disk under the
 * harness's own store, and nothing in the ledger knows they exist. This command enumerates them,
 * opens a session row per transcript, and runs each one through the same repair-by-resume path a
 * crashed session takes — so a repo that adopts workledger on a Tuesday can still have a digest
 * for the previous fortnight.
 *
 * Two rules shape the enumeration, both from plans/feature-p3-data-flow.md §Backfill:
 *
 * - **Metadata, and tool inputs only.** A file's name, its `stat`, the first record's `cwd` and
 *   `timestamp`, and — since P8 amendment 10 — the paths its tool inputs name, counted through
 *   the index cache by `src/onboarding/touched.ts` to decide which repo the session is about.
 *   Nothing that is read is written anywhere but the session row and the touch cache.
 * - **Resumable.** Every unit of work is a `jobs` row, so a cancelled or killed run is resumed by
 *   running the command again: sessions already in the index are skipped, `done` jobs are never
 *   re-claimed, and a job a dead process left `running` is re-queued by the runner.
 */
import { closeSync, openSync, readSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { claudeCodeAdapter } from "../adapters/claude-code.js";
import { SINCE_WINDOWS, loadConfig } from "../config.js";
import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { DEFAULT_TIMEOUT_S, resumeSession } from "./repair.js";
import { MAX_USAGE_WAITS, enqueueJob } from "../jobs/queue.js";
import { jobLogDir, runJobs } from "../jobs/runner.js";
import { findRepoRoot, isEnabled, listOpenBacklogIds, sessionFile, writeFileAtomic } from "../ledger-fs.js";
import { projectSlug } from "../onboarding/session-cwd.js";
import { statSize } from "../adapters/types.js";
import type { Harness } from "@workledger/core/schema";
import type { ExtractIo } from "../extract/run.js";
import type { HarnessAdapter } from "../adapters/types.js";
import type { IndexDb } from "../index/db.js";
import type { JobResult } from "../jobs/runner.js";
import type { JobRow } from "../jobs/queue.js";
import type { ContextRepo } from "../onboarding/touched.js";

/** Options commander parses for `backfill`. */
export interface BackfillOptions {
  repo?: string;
  /** `7d`, `14d`, `30d` or `all`. Defaults to `config.backfill.since`. */
  since?: string;
  concurrency?: number;
  dryRun?: boolean;
  yes?: boolean;
  /** Queue an `extract` job when a session's resume fails, instead of leaving it undigested. */
  extractFallback?: boolean;
}

/** Where Claude Code keeps its transcripts, relative to the home directory. */
export const CLAUDE_STORE = path.join(".claude", "projects");

/** How much of a transcript is read to find its first record. One record is far below this. */
const FIRST_RECORD_BYTES = 64 * 1024;

/**
 * One transcript in the harness store, described by its metadata alone.
 *
 * `harnessSessionId` comes from the filename because that is what the harness names the file
 * after, and it is the id `resumeHeadless` will be given — the same id a live `SessionStart`
 * would have recorded, which is what lets a resumed backfilled session reuse the row rather than
 * fork a second one (plans/feature-p3-data-flow.md §Backfill).
 */
export interface StoreSession {
  harnessSessionId: string;
  file: string;
  bytes: number;
  mtimeMs: number;
  /** The first record's `timestamp`, or `null` when it carries none. */
  startedIso: string | null;
  /**
   * Where the session was started: the first record that carries a `cwd`, else the project slug
   * inverted against the filesystem. `null` only when neither says. Recorded on the row as
   * `start_dir` so the resume spawns there (#114); never what decides where the session is
   * filed (amendment 10).
   */
  cwd: string | null;
  /**
   * What the session is about — `inferContext`'s context repos, best first — when the
   * attribution has run (`src/onboarding/attribution.ts`); recorded on the row as
   * `context_repos` and in the frontmatter as `about`.
   */
  context?: ContextRepo[] | undefined;
}

// `projectSlug` lives in `../onboarding/session-cwd.ts` with the slug inversion; re-exported so
// every P3 caller keeps its import path.
export { projectSlug };

/**
 * The leading `FIRST_RECORD_BYTES` of a file, read with one bounded positioned read — never the
 * whole file. `undefined` when the file cannot be opened or read.
 */
function readLeadingText(file: string): string | undefined {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.allocUnsafe(FIRST_RECORD_BYTES);
    const read = readSync(fd, buffer, 0, FIRST_RECORD_BYTES, 0);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/**
 * The first line of a transcript, from {@link readLeadingText}. Shared with the Codex store
 * enumeration in `src/onboarding/stores.ts`, whose first record is a `session_meta` with the
 * same two facts one level down.
 */
export function readFirstLine(file: string): string | undefined {
  const text = readLeadingText(file);
  if (text === undefined) return undefined;
  const newline = text.indexOf("\n");
  return newline < 0 ? text : text.slice(0, newline);
}

/**
 * The `cwd` and `timestamp` of a Claude Code transcript's first records: each fact from the
 * first leading record that carries it.
 *
 * Not the first line alone (#114): a transcript now opens with `last-prompt`, `mode` and
 * `permission-mode` records that carry neither, and the first `user` record — the one that says
 * where the session was started — comes after them. Reading only line one recorded no cwd for
 * every such session, and the resume then ran in the repo root instead of where the harness
 * would find the session.
 *
 * A bounded positioned read rather than `readFileSync`: a store holds sessions of every size, and
 * enumerating a repo's history must not depend on being able to hold its largest transcript in
 * memory. A file whose leading lines do not parse yields nothing and is treated as belonging to
 * this repo — the slug already said so, and refusing to back it up over an unreadable first line
 * would silently drop a session.
 */
export function firstRecord(file: string): { cwd: string | null; startedIso: string | null } {
  const text = readLeadingText(file);
  let cwd: string | null = null;
  let startedIso: string | null = null;
  if (text === undefined) return { cwd, startedIso };
  for (const line of text.split("\n")) {
    if (cwd !== null && startedIso !== null) break;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // A line the buffer cut short, or one that is not a record: neither ends the search.
      continue;
    }
    if (cwd === null && typeof parsed["cwd"] === "string") cwd = parsed["cwd"];
    const at = parsed["timestamp"];
    if (startedIso === null && typeof at === "string" && !Number.isNaN(Date.parse(at))) startedIso = at;
  }
  return { cwd, startedIso };
}

/**
 * Days in each `--since` window; `all` has none.
 *
 * `90d` is not a `--since` value (`SINCE_WINDOWS` still ends at `30d`); it is the widest window
 * the onboarding wizard offers (docs/contracts/p8/daemon-and-api.md §Onboarding endpoints), and
 * `src/onboarding/` reaches it through {@link filterSince} rather than re-implementing the cut.
 */
const SINCE_DAYS: Record<string, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 };

/**
 * Drop sessions older than the window, measured on file mtime (cli.md step 2).
 *
 * mtime rather than the first record's timestamp: the window exists to bound how much an operator
 * is about to spend, and what that costs is a function of when a session last *wrote*, not when it
 * started. A month-long session that was active yesterday is inside a 7-day window.
 */
export function filterSince(
  sessions: readonly StoreSession[],
  since: string,
  now: Date,
): StoreSession[] {
  const days = SINCE_DAYS[since];
  if (days === undefined) return [...sessions];
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return sessions.filter((session) => session.mtimeMs >= cutoff);
}

/** What the enumeration found, split into what this run would do and what it would not. */
export interface BackfillPlan {
  /** Sessions in the window that the index has never seen. */
  fresh: StoreSession[];
  /** Sessions in the window the index already has a row for. */
  skipped: StoreSession[];
  totalBytes: number;
  /** mtime of the oldest fresh session, as ISO; `null` when there are none. */
  oldest: string | null;
  /** Whole seconds the fresh sessions are expected to take at this concurrency. */
  estimateSeconds: number;
}

/** Build the plan: window filter, then the index check cli.md step 1 calls "not already in the index". */
export function planBackfill(
  sessions: readonly StoreSession[],
  options: {
    db: IndexDb;
    harness: string;
    /** The repo the plan is for: a session already indexed *for this repo* is `skipped`. */
    repoPath: string;
    since: string;
    now: Date;
    concurrency: number;
    secondsPerSession: number;
  },
): BackfillPlan {
  const inWindow = filterSince(sessions, options.since, options.now);
  const fresh: StoreSession[] = [];
  const skipped: StoreSession[] = [];
  for (const session of inWindow) {
    const existing = options.db.getSessionByHarnessId(options.harness, session.harnessSessionId, options.repoPath);
    (existing === undefined ? fresh : skipped).push(session);
  }
  const totalBytes = fresh.reduce((sum, session) => sum + session.bytes, 0);
  const oldestMtime = fresh.reduce<number | null>(
    (min, session) => (min === null || session.mtimeMs < min ? session.mtimeMs : min),
    null,
  );
  return {
    fresh,
    skipped,
    totalBytes,
    oldest: oldestMtime === null ? null : new Date(oldestMtime).toISOString(),
    estimateSeconds: Math.ceil((fresh.length * options.secondsPerSession) / options.concurrency),
  };
}

/** `95s`, `4m 15s` — the estimate in the units an operator waits in. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** The table cli.md step 2 asks for: count, total bytes, oldest, and the estimate. */
export function planLines(plan: BackfillPlan, concurrency: number): string[] {
  return [
    `sessions   ${plan.fresh.length}`,
    `bytes      ${plan.totalBytes}`,
    `oldest     ${plan.oldest ?? "-"}`,
    `estimate   ~${formatDuration(plan.estimateSeconds)} at concurrency ${concurrency}`,
    `skipped    ${plan.skipped.length} (already indexed)`,
  ];
}

/** Everything the command touches outside itself. */
export interface BackfillIo {
  db: IndexDb;
  /** The enabled repo root. */
  root: string;
  adapter: HarnessAdapter;
  /** Where the harness store is looked for. Defaults to the process home directory. */
  homeDir: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now: () => Date;
  /** Mints job ids and session ulids: bare ULIDs. */
  newId: () => string;
  /**
   * Mints the `WL-<ulid>` of a `new: true` Remaining item, for the `--extract-fallback` path
   * only. Never {@link BackfillIo.newId}, which is a job id and would fail the backlog-id rule.
   */
  newBacklogId?: (() => string) | undefined;
  /** Ask the operator a yes/no question; absent means "never prompt". */
  confirm?: ((question: string) => Promise<boolean>) | undefined;
  /** Seconds before a resumed session is killed; per session from {@link backfillTimeoutS} when absent. */
  timeoutS?: number | undefined;
  /** `ANTHROPIC_API_KEY`, read per call — only the `--extract-fallback` path uses it. */
  apiKey?: (() => string | undefined) | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
  /** Overrides `WORKLEDGER_HOME` for the checkpoints written through this run. */
  home?: string | undefined;
  /** Stops the runner claiming — a daemon shutting down (#99). Absent means "never". */
  signal?: AbortSignal | undefined;
}

/**
 * Open the ledger file and index row for one store session — the `SessionStart`-equivalent of
 * cli.md step 4.
 *
 * The row is created `ended` with `needs_repair`, not `open`: the session is over, and an `open`
 * row would be swept by the very next `scan` and marked crashed for a session that never crashed.
 * `needs_repair` is the honest description — there is work here and no digest of it — and it is
 * also what makes the row eligible for `workledger repair` afterwards without `--force`.
 *
 * @returns the new session's ulid.
 */
export async function createBackfilledSession(
  session: StoreSession,
  io: BackfillIo,
): Promise<string> {
  const [{ newSessionId }, { SCHEMA_VERSION }, { createSessionText }, { gitInfo }] =
    await Promise.all([
      import("@workledger/core/ids"),
      import("@workledger/core/schema"),
      import("@workledger/core/render/session"),
      import("../git-info.js"),
    ]);

  const ulid = newSessionId();
  const git = gitInfo(io.root, io.homeDir);
  const startedIso = session.startedIso ?? new Date(session.mtimeMs).toISOString();
  const endedIso = new Date(session.mtimeMs).toISOString();

  writeFileAtomic(
    sessionFile(io.root, ulid),
    createSessionText({
      schema_version: SCHEMA_VERSION,
      id: ulid,
      harness: io.adapter.harness as Harness,
      harness_session_id: session.harnessSessionId,
      repo: git.repo,
      branch: git.branch,
      author: git.author,
      started: startedIso,
      ended: endedIso,
      // Not `crashed`: nothing is known about how it ended, and claiming a crash would put a
      // fact in the ledger that the store's metadata does not support.
      end_reason: "unknown",
      status: "ended",
      private: false,
      // The provenance this whole command exists to record.
      source: "backfill",
      model: null,
      needs_repair: true,
      checkpoint_failures: 0,
      checkpoints: [],
      // Where it started and what it is about (amendment 10): the two facts a session view shows.
      ...(session.cwd === null ? {} : { started_in: session.cwd }),
      ...(session.context === undefined ? {} : { about: session.context.map((context) => context.root) }),
    }),
  );

  const nowIso = io.now().toISOString();
  io.db.insertSession({
    ulid,
    repo_path: io.root,
    harness: io.adapter.harness,
    harness_session_id: session.harnessSessionId,
    status: "ended",
    transcript_path: session.file,
    // Where the harness session started — the resume spawns there (#114) — and what it is
    // about, which is why this row is in this repo at all (amendment 10).
    start_dir: session.cwd,
    context_repos: session.context === undefined ? null : JSON.stringify(session.context),
    // Zero rather than the file size: an extraction fallback measures its span from here, and a
    // backfilled session has never been described, so the span is the whole transcript.
    last_offset: 0,
    last_checkpoint_at: startedIso,
    updated_at: nowIso,
  });
  return ulid;
}

/** How one session's backfill ended. */
export type SessionOutcome = "done" | "failed";

/**
 * The whole command, with its environment injected.
 *
 * @returns the process exit code: `0`, or `1` for an unusable `--since`.
 */
export async function runBackfill(options: BackfillOptions, io: BackfillIo): Promise<number> {
  const config = loadConfig(io.root);
  const since = options.since ?? config.backfill.since;
  if (!(SINCE_WINDOWS as readonly string[]).includes(since)) {
    io.stderr(`backfill: --since must be one of ${SINCE_WINDOWS.join(", ")}; got ${since}`);
    return EXIT_USAGE;
  }
  const concurrency = options.concurrency ?? config.backfill.concurrency;

  // Every transcript the inference says is about this repo, wherever it started (amendment 10).
  const { attributeTranscripts } = await import("../onboarding/attribution.js");
  const about = (await attributeTranscripts(io.homeDir, [io.root], io.db)).get(io.root);
  const plan = planBackfill(about?.claude ?? [], {
    db: io.db,
    harness: io.adapter.harness,
    repoPath: io.root,
    since,
    now: io.now(),
    concurrency,
    secondsPerSession: config.backfill.seconds_per_session,
  });

  for (const line of planLines(plan, concurrency)) io.stdout(line);

  if (options.dryRun === true) return EXIT_OK;

  // A resumable run has work to do even with nothing fresh: a previous invocation may have been
  // killed with jobs still queued. Both halves are checked before anything is asked or created.
  const outstanding = countOutstandingJobs(io.db, io.root);
  if (plan.fresh.length === 0 && outstanding === 0) {
    io.stdout(summaryLine(0, 0, plan.skipped.length));
    return EXIT_OK;
  }

  if (options.yes !== true && plan.fresh.length > 0) {
    const question =
      `Digest ${plan.fresh.length} session(s) by resuming them` +
      (options.extractFallback === true
        ? `, and reconstruct any that will not resume by calling ${config.extract.model}` +
          " (billed to your Anthropic API key)"
        : "") +
      `? This takes about ${formatDuration(plan.estimateSeconds)}.`;
    const granted = io.confirm === undefined ? false : await io.confirm(question);
    if (!granted) {
      io.stderr("backfill: cancelled; nothing was recorded");
      return EXIT_OK;
    }
  }

  const ulids: string[] = [];
  for (const session of plan.fresh) {
    const ulid = await createBackfilledSession(session, io);
    ulids.push(ulid);
    enqueueJob(io.db, {
      kind: "repair",
      sessionUlid: ulid,
      repoPath: io.root,
      newId: io.newId,
      now: io.now(),
    });
  }

  const { done, failed } = await drainBackfillJobs(options, io, concurrency);
  io.stdout(summaryLine(done, failed, plan.skipped.length));
  return EXIT_OK;
}

/**
 * Run every queued backfill job for `io.root` — cli.md step 4, on its own.
 *
 * Split out of {@link runBackfill} so the onboarding wizard (`src/onboarding/backfill.ts`),
 * which queues its jobs from an HTTP request and drains them afterwards, runs the same handler
 * with the same extraction fallback as `workledger backfill` rather than a second one. The
 * outcome is counted per *session*: a resume that failed and whose extraction then succeeded is
 * one `done`, not one of each.
 */
export async function drainBackfillJobs(
  options: Pick<BackfillOptions, "extractFallback">,
  io: BackfillIo,
  concurrency: number,
): Promise<{ done: number; failed: number }> {
  const outcomes = new Map<string, SessionOutcome>();
  await runJobs(io.db, {
    repoPath: io.root,
    kinds: options.extractFallback === true ? ["repair", "extract"] : ["repair"],
    concurrency,
    now: io.now,
    progress: io.stderr,
    handler: (job) => runOneJob(job, options, io, outcomes),
    logDir: jobLogDir(io.home),
    signal: io.signal,
  });

  let done = 0;
  let failed = 0;
  for (const outcome of outcomes.values()) {
    if (outcome === "done") done += 1;
    else failed += 1;
  }
  return { done, failed };
}

/** Jobs this repo still has to run — queued or claimed by a process that may be gone. */
function countOutstandingJobs(db: IndexDb, repoPath: string): number {
  const row = db.connection
    .prepare<[string], { count: number }>(
      "SELECT COUNT(*) AS count FROM jobs WHERE repo_path = ? AND status IN ('queued', 'running')",
    )
    .get(repoPath);
  return row?.count ?? 0;
}

/**
 * How long a backfilled session's resume may run — p3/cli.md §backfill, amended 2026-09-10 (#97):
 * `min(1800, 600 + 120 × ceil(transcript bytes / 1e6))`. A resumed harness re-reads its whole
 * transcript before it can describe it, so the budget grows with the file rather than being the
 * one number `repair` uses for a session that just crashed.
 */
export function backfillTimeoutS(transcriptBytes: number): number {
  return Math.min(1800, DEFAULT_TIMEOUT_S + 120 * Math.ceil(transcriptBytes / 1e6));
}

/** The contracted stdout line (cli.md step 5). */
export function summaryLine(done: number, failed: number, skipped: number): string {
  return `backfill: ${done} digested, ${failed} failed, ${skipped} skipped (already indexed)`;
}

/**
 * Run one queued job, whichever kind it is.
 *
 * The extract fallback is applied here rather than at the top level because it is a property of
 * *one session's* resume failing, not of the batch: the repair job is still recorded as failed —
 * it did fail — and the session is only counted as failed once its extraction has failed too.
 */
async function runOneJob(
  job: JobRow,
  options: Pick<BackfillOptions, "extractFallback">,
  io: BackfillIo,
  outcomes: Map<string, SessionOutcome>,
): Promise<JobResult> {
  const session = io.db.getSessionByUlid(job.session_ulid);
  if (session === undefined) {
    return { ok: false, error: `session ${job.session_ulid} is no longer in the index` };
  }

  if (job.kind === "extract") {
    const { estimateFor, extractCheckpoint } = await import("../extract/run.js");
    const estimate = estimateFor(session, io.root);
    if ("error" in estimate) {
      outcomes.set(session.ulid, "failed");
      return { ok: false, error: estimate.error };
    }
    const outcome = await extractCheckpoint(session, estimate, extractIo(io));
    outcomes.set(session.ulid, outcome.ok ? "done" : "failed");
    return outcome;
  }

  const result = await resumeSession(
    session,
    {
      reason: "was recorded before workledger was watching",
      openIds: await listOpenBacklogIds(io.root),
      timeoutS: io.timeoutS ?? backfillTimeoutS(statSize(session.transcript_path ?? undefined) ?? 0),
    },
    io,
  );
  if (result.ok) {
    outcomes.set(session.ulid, "done");
    return result;
  }

  // The harness's usage window, not this session (#100): the runner puts the job back for the
  // reset, so the session's outcome is not decided here and no extraction is spent on a
  // condition that clears by itself — until the row has waited its last time.
  if (result.code !== undefined && job.retry_waits < MAX_USAGE_WAITS) return result;

  if (options.extractFallback !== true) {
    outcomes.set(session.ulid, "failed");
    return result;
  }

  // "with `--extract-fallback`, a resume failure queues an `extract` job instead of failing"
  // (cli.md step 4). The extract job is queued before this handler returns, so the same runner
  // pass claims it — the session's outcome is decided by that job, not by this one.
  //
  // The pessimistic outcome is recorded *before* the enqueue, never after: at a concurrency
  // above one another worker can claim the extract job the moment it exists, and a `failed`
  // written afterwards would overwrite the `done` that job had already recorded.
  outcomes.set(session.ulid, "failed");
  enqueueJob(io.db, {
    kind: "extract",
    sessionUlid: session.ulid,
    repoPath: io.root,
    newId: io.newId,
    now: io.now(),
  });
  io.stderr(`job ${job.id}: resume failed (${result.error ?? "unknown"}); queued an extract job`);
  return { ok: false, error: `${result.error ?? "resume failed"}; queued an extract job` };
}

/** The extraction's view of this run's environment. */
function extractIo(io: BackfillIo): ExtractIo {
  return {
    db: io.db,
    root: io.root,
    stdout: io.stdout,
    stderr: io.stderr,
    now: io.now,
    newId: io.newId,
    newBacklogId: io.newBacklogId,
    apiKey: io.apiKey,
    fetchImpl: io.fetchImpl,
    home: io.home,
  };
}

/** @returns the process exit code. */
export async function backfillCommand(options: BackfillOptions): Promise<number> {
  const from = options.repo ?? process.cwd();
  const root = findRepoRoot(from);
  if (root === undefined || !isEnabled(root)) {
    process.stderr.write(`workledger: ${from} is not an enabled repo; run \`workledger init\` first\n`);
    return EXIT_NOT_ENABLED;
  }

  const { newBacklogId, newSessionId } = await import("@workledger/core/ids");
  const { openIndex } = await import("../index/db.js");
  const { API_KEY_ENV } = await import("../extract/api.js");
  const home = process.env["WORKLEDGER_HOME"]?.trim();
  const db = openIndex(home ? { home } : {});
  try {
    return await runBackfill(options, {
      db,
      root,
      adapter: claudeCodeAdapter,
      homeDir: os.homedir(),
      stdout: (line) => void process.stdout.write(`${line}\n`),
      stderr: (line) => void process.stderr.write(`${line}\n`),
      now: () => new Date(),
      newId: newSessionId,
      newBacklogId,
      confirm: async (question: string) => {
        const readline = await import("node:readline/promises");
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
        try {
          return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
        } finally {
          rl.close();
        }
      },
      apiKey: () => process.env[API_KEY_ENV]?.trim() || undefined,
      home,
    });
  } finally {
    db.close();
  }
}
