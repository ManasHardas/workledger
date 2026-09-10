/**
 * `workledger repair <ulid> [--extract] [--yes] [--timeout <s>] [--force]` —
 * docs/contracts/p3/cli.md §`workledger repair`.
 *
 * The resume path only; the extraction fallback (step 4 of the contract) is #54 and is refused
 * here with the exit code the contract gives a failed job.
 *
 * What makes this cheap is that workledger never reads the transcript: the harness is asked to
 * resume the session it already holds and to run one `workledger checkpoint`, so the digest is
 * written by the agent that did the work rather than reconstructed from its output
 * (plans/feature-p3-data-flow.md §Repair by resume). Everything this file does around that is
 * bookkeeping — the job row, the `pending_trigger` that makes the resumed checkpoint stamp
 * `repair`, and the frontmatter that records the outcome.
 */
import process from "node:process";

import { claudeCodeAdapter } from "../adapters/claude-code.js";
import { EXIT_JOB_FAILED, EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { repairInstruction } from "../instruction.js";
import { enqueueJob } from "../jobs/queue.js";
import { runJobs } from "../jobs/runner.js";
import {
  findRepoRoot,
  isEnabled,
  listOpenBacklogIds,
  readTextFile,
  sessionFile,
  writeFileAtomic,
} from "../ledger-fs.js";
import type { HarnessAdapter } from "../adapters/types.js";
import type { IndexDb, SessionRow } from "../index/db.js";
import type { JobResult } from "../jobs/runner.js";

/** Options commander parses for `repair`. */
export interface RepairOptions {
  /** Reconstruct the digest from the transcript instead of resuming. Arrives with #54. */
  extract?: boolean;
  /** Skip the extraction spend prompt. Consumed by the `--extract` path (#54). */
  yes?: boolean;
  /** Seconds before the resumed harness is killed. */
  timeout?: number;
  /** Repair a session the index still calls `open`. */
  force?: boolean;
}

/** The contract's default: `timeoutMs: 300000`. */
export const DEFAULT_TIMEOUT_S = 300;

/**
 * The only tools the resumed session may use (cli.md step 2).
 *
 * A glob rather than a bare `Bash`: the resume exists to produce one digest, and a session that
 * could run arbitrary shell would be a second session's worth of unreviewed work spawned by a
 * maintenance command.
 */
export const REPAIR_ALLOWED_TOOLS: readonly string[] = ["Bash(workledger checkpoint*)"];

/** Everything the command touches outside itself. */
export interface RepairIo {
  db: IndexDb;
  /** The enabled repo root. */
  root: string;
  adapter: HarnessAdapter;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now: () => Date;
  newId: () => string;
}

/** Why a session may be repaired, or why it may not. */
export type RepairEligibility = { reason: string } | { error: string };

/**
 * Step 1: "Session must exist with status `crashed`, `ended` with `needs_repair`, or `open` with
 * `--force`."
 *
 * `needs_repair` lives in the ledger frontmatter, not in the index — the ledger is the source of
 * truth (CLAUDE.md) and `SessionEnd` writes the flag there. A session file that cannot be read
 * is treated as not carrying the flag rather than as an error: `--force` is the escape hatch.
 */
export function eligibility(
  session: SessionRow,
  frontmatter: Record<string, unknown> | undefined,
  force: boolean,
): RepairEligibility {
  if (session.status === "crashed") return { reason: "crashed" };
  if (session.status === "ended") {
    if (frontmatter?.["needs_repair"] === true) return { reason: "ended without a full digest" };
    if (force) return { reason: "ended" };
    return {
      error:
        `session ${session.ulid} is ended and not marked needs_repair; ` +
        "pass --force to repair it anyway",
    };
  }
  if (session.status === "open") {
    if (force) return { reason: "is still open" };
    return {
      error: `session ${session.ulid} is still open; pass --force to repair a live session`,
    };
  }
  return { error: `session ${session.ulid} is ${session.status}; nothing to repair` };
}

/** Read a session file's frontmatter mapping, or `undefined` when there is none to read. */
async function readFrontmatter(
  root: string,
  ulid: string,
): Promise<{ data: Record<string, unknown>; body: string } | undefined> {
  const text = readTextFile(sessionFile(root, ulid));
  if (text === undefined) return undefined;
  const { parseFrontmatter } = await import("@workledger/core/frontmatter");
  try {
    return parseFrontmatter(text);
  } catch {
    return undefined;
  }
}

/** Mark the session repaired in the ledger, atomically (cli.md: "status `repaired`"). */
async function markRepaired(root: string, ulid: string, nowIso: string): Promise<void> {
  const parsed = await readFrontmatter(root, ulid);
  if (parsed === undefined) return;
  const { stringifyFrontmatter } = await import("@workledger/core/frontmatter");
  parsed.data["status"] = "repaired";
  parsed.data["needs_repair"] = false;
  parsed.data["ended"] ??= nowIso;
  writeFileAtomic(sessionFile(root, ulid), stringifyFrontmatter(parsed.data, parsed.body));
}

/** One line describing why the resume did not produce a digest. */
function failureReason(
  result: { timedOut: boolean; exitCode: number | null; spawnError?: string | undefined },
  timeoutS: number,
): string {
  if (result.spawnError !== undefined) return `the harness could not be started (${result.spawnError})`;
  if (result.timedOut) return `the resumed session was killed after ${timeoutS}s`;
  if (result.exitCode !== 0) return `the resumed session exited ${String(result.exitCode)}`;
  return "the resumed session recorded no checkpoint";
}

/**
 * The whole command, with its environment injected.
 *
 * @returns the process exit code: `0`, `1` for a session that may not be repaired, `5` when the
 * job did not produce a checkpoint.
 */
export async function runRepair(
  ulid: string,
  options: RepairOptions,
  io: RepairIo,
): Promise<number> {
  const { db, root } = io;

  const session = db.getSessionByUlid(ulid);
  if (session === undefined) {
    io.stderr(`repair: no session ${ulid} in the index`);
    return EXIT_USAGE;
  }
  if (session.repo_path !== root) {
    io.stderr(`repair: session ${ulid} belongs to ${session.repo_path}, not ${root}`);
    return EXIT_USAGE;
  }

  const parsed = await readFrontmatter(root, ulid);
  const eligible = eligibility(session, parsed?.data, options.force === true);
  if ("error" in eligible) {
    io.stderr(`repair: ${eligible.error}`);
    return EXIT_USAGE;
  }

  if (options.extract === true) {
    // Step 4 of the contract. Refused rather than silently ignored: an operator who reached for
    // `--extract` did so because the resume already failed, and a command that quietly resumed
    // again would spend the same minutes on the same failure.
    io.stderr("repair: extraction arrives with #54");
    return EXIT_JOB_FAILED;
  }

  const resume = io.adapter.resumeHeadless?.bind(io.adapter);
  if (resume === undefined) {
    io.stderr(`repair: ${io.adapter.harness} cannot resume a session headlessly`);
    io.stderr(`run \`workledger repair ${ulid} --extract\` to reconstruct the digest instead`);
    return EXIT_JOB_FAILED;
  }

  const timeoutS = options.timeout ?? DEFAULT_TIMEOUT_S;
  const openIds = await listOpenBacklogIds(root);
  let reason = "";

  const handler = async (): Promise<JobResult> => {
    const before = db.countCheckpoints(ulid);
    const instruction = repairInstruction({
      sessionId: ulid,
      openIds,
      sinceCheckpoint: before,
      reason: eligible.reason,
    });

    // Set *before* the spawn: the resumed agent's checkpoint reads it off the session row, which
    // is what keeps `--session <ulid>` the only thing on its command line
    // (plans/feature-p3-data-flow.md §Repair by resume).
    db.updateSession(ulid, { pending_trigger: "repair", updated_at: io.now().toISOString() });
    try {
      const result = await resume(session.harness_session_id, {
        cwd: root,
        instruction,
        allowedTools: REPAIR_ALLOWED_TOOLS,
        timeoutMs: timeoutS * 1000,
      });

      // The outcome is measured by what landed in the ledger, not by the harness's exit code: a
      // session that exits 0 without running the checkpoint has repaired nothing.
      if (db.countCheckpoints(ulid) > before) {
        await markRepaired(root, ulid, io.now().toISOString());
        db.updateSession(ulid, { status: "repaired", updated_at: io.now().toISOString() });
        return { ok: true };
      }
      reason = failureReason(result, timeoutS);
      return { ok: false, error: reason };
    } finally {
      // Whatever happened, the next checkpoint in this session is an ordinary one. `checkpoint`
      // clears the column itself when it consumes it; this is the path where it never did.
      if (db.getSessionByUlid(ulid)?.pending_trigger !== null) {
        db.updateSession(ulid, { pending_trigger: null, updated_at: io.now().toISOString() });
      }
    }
  };

  enqueueJob(db, {
    kind: "repair",
    sessionUlid: ulid,
    repoPath: root,
    newId: io.newId,
    now: io.now(),
  });

  const summary = await runJobs(db, {
    repoPath: root,
    kinds: ["repair"],
    sessionUlid: ulid,
    concurrency: 1,
    limit: 1,
    now: io.now,
    handler,
    progress: io.stderr,
  });

  if (summary.done === 1) {
    io.stdout(`repair: session ${ulid} repaired`);
    return EXIT_OK;
  }
  io.stderr(`repair: session ${ulid} not repaired — ${reason || "no job was run"}`);
  io.stderr(`run \`workledger repair ${ulid} --extract\` to reconstruct the digest instead`);
  return EXIT_JOB_FAILED;
}

/** @returns the process exit code. */
export async function repairCommand(ulid: string, options: RepairOptions): Promise<number> {
  const root = findRepoRoot(process.cwd());
  if (root === undefined || !isEnabled(root)) {
    process.stderr.write(
      `workledger: ${process.cwd()} is not an enabled repo; run \`workledger init\` first\n`,
    );
    return EXIT_NOT_ENABLED;
  }

  const { newSessionId } = await import("@workledger/core/ids");
  const { openIndex } = await import("../index/db.js");
  const home = process.env["WORKLEDGER_HOME"]?.trim();
  const db = openIndex(home ? { home } : {});
  try {
    return await runRepair(ulid, options, {
      db,
      root,
      adapter: claudeCodeAdapter,
      stdout: (line) => void process.stdout.write(`${line}\n`),
      stderr: (line) => void process.stderr.write(`${line}\n`),
      now: () => new Date(),
      newId: newSessionId,
    });
  } finally {
    db.close();
  }
}
