/**
 * `workledger repair <ulid> [--extract] [--yes] [--timeout <s>] [--force]` —
 * docs/contracts/p3/cli.md §`workledger repair`.
 *
 * Steps 1–3 (the resume path) live here; step 4, the extraction fallback, lives under
 * `src/extract/` and is reached from here with a dynamic import so the resume path never loads
 * a transcript parser it does not use.
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
import { adapterFor } from "../adapters/registry.js";
import { API_KEY_ENV } from "../extract/api.js";
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
  /** Reconstruct the digest from the transcript instead of resuming (contract step 4). */
  extract?: boolean;
  /** Skip the extraction spend prompt. Consumed by the `--extract` path. */
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
  /** Mints job ids: a bare ULID. */
  newId: () => string;
  /**
   * Mints the `WL-<ulid>` of a `new: true` Remaining item — `--extract` only, and never
   * {@link RepairIo.newId}, which is a *job* id and would fail the backlog-id rule. The resume
   * path needs none of this: the resumed agent runs its own `workledger checkpoint` process,
   * which mints its own.
   */
  newBacklogId?: (() => string) | undefined;
  /**
   * Ask the operator a yes/no question. Only the `--extract` path asks one — the spend prompt —
   * and `--yes` replaces this with a function that never prompts.
   */
  confirm?: (question: string) => Promise<boolean>;
  /** `ANTHROPIC_API_KEY`, read per call. `--extract` only; never stored anywhere. */
  apiKey?: () => string | undefined;
  /** Injected so the extraction test can drive the whole path without a network. */
  fetchImpl?: typeof globalThis.fetch;
  /** Overrides `WORKLEDGER_HOME` for the checkpoint the extraction writes through. */
  home?: string | undefined;
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
export async function markRepaired(root: string, ulid: string, nowIso: string): Promise<void> {
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

/** What {@link resumeSession} needs: the index, the repo, the harness, and a clock. */
export interface ResumeSessionIo {
  db: IndexDb;
  root: string;
  adapter: HarnessAdapter;
  now: () => Date;
}

/** The rest of what one resume attempt needs. */
export interface ResumeSessionOptions {
  /** Why the session is being repaired, as one clause — goes into the instruction. */
  reason: string;
  /** Open `WL-` ids the resumed agent may reference. Passed in so a batch reads them once. */
  openIds: readonly string[];
  timeoutS: number;
}

/**
 * The adapter that can resume `session`: the one its `harness` column names, not the caller's.
 *
 * P4 made this a real branch. `repair` is handed one adapter for the process, but the row it is
 * repairing remembers which harness recorded it — and only that harness knows the id. Resuming a
 * Cursor conversation with `claude --resume` would spend a session finding out that Claude Code
 * has never heard of it; worse, Cursor has no verified headless resume at all, so the right answer
 * is `cursorAdapter`'s refusal and its `--extract` fallback
 * (docs/contracts/p4/hooks-cursor.md §Repair and backfill).
 *
 * `fallback` wins when the harness matches it — that is what keeps an injected test adapter, and
 * any future adapter this build does not know, reachable.
 */
export function adapterForSession(session: SessionRow, fallback: HarnessAdapter): HarnessAdapter {
  if (session.harness === fallback.harness) return fallback;
  return adapterFor(session.harness) ?? fallback;
}

/**
 * Resume one session and see whether a checkpoint came out of it — contract step 2, as a job
 * handler.
 *
 * Exported because `backfill` runs exactly this for every session it enumerates
 * (docs/contracts/p3/cli.md §`workledger backfill` step 4: "queue a `repair` job (resume path)").
 * Sharing the function rather than the shape is what keeps the two commands' notion of "repaired"
 * from drifting: the `pending_trigger` write, the checkpoint-count comparison that decides the
 * outcome, and the frontmatter update are all here, once.
 *
 * Never throws. The runner records a throw as a failure, but the states this can leave behind —
 * a `pending_trigger` on a session whose checkpoint never landed above all — are cleaned up in
 * the `finally` rather than left to it.
 */
export async function resumeSession(
  session: SessionRow,
  options: ResumeSessionOptions,
  io: ResumeSessionIo,
): Promise<JobResult> {
  const { db, root } = io;
  const ulid = session.ulid;
  const adapter = adapterForSession(session, io.adapter);
  const resume = adapter.resumeHeadless?.bind(adapter);
  if (resume === undefined) {
    return {
      ok: false,
      error: adapter.noResumeMessage ?? `${adapter.harness} cannot resume a session headlessly`,
    };
  }

  const before = db.countCheckpoints(ulid);
  const instruction = repairInstruction({
    sessionId: ulid,
    openIds: options.openIds,
    sinceCheckpoint: before,
    reason: options.reason,
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
      timeoutMs: options.timeoutS * 1000,
    });

    // The outcome is measured by what landed in the ledger, not by the harness's exit code: a
    // session that exits 0 without running the checkpoint has repaired nothing.
    if (db.countCheckpoints(ulid) > before) {
      await markRepaired(root, ulid, io.now().toISOString());
      db.updateSession(ulid, { status: "repaired", updated_at: io.now().toISOString() });
      return { ok: true };
    }
    return { ok: false, error: failureReason(result, options.timeoutS) };
  } finally {
    // Whatever happened, the next checkpoint in this session is an ordinary one. `checkpoint`
    // clears the column itself when it consumes it; this is the path where it never did.
    if (db.getSessionByUlid(ulid)?.pending_trigger !== null) {
      db.updateSession(ulid, { pending_trigger: null, updated_at: io.now().toISOString() });
    }
  }
}

/**
 * The whole command, with its environment injected.
 *
 * @returns the process exit code: `0`, `1` for a session that may not be repaired, `5` when the
 * job did not produce a checkpoint, `6` when the extraction spend was refused.
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
    // Step 4 of the contract, in its own module: an operator reaches for `--extract` because the
    // resume already failed, so this path never resumes again — it reads the transcript itself.
    // Imported dynamically so the resume path never loads the parser or the API client.
    const { runExtract } = await import("../extract/run.js");
    return await runExtract(session, { yes: options.yes === true }, io);
  }

  const adapter = adapterForSession(session, io.adapter);
  if (adapter.resumeHeadless === undefined) {
    io.stderr(`repair: ${adapter.noResumeMessage ?? `${adapter.harness} cannot resume a session headlessly`}`);
    io.stderr(`run \`workledger repair ${ulid} --extract\` to reconstruct the digest instead`);
    return EXIT_JOB_FAILED;
  }

  const timeoutS = options.timeout ?? DEFAULT_TIMEOUT_S;
  const openIds = await listOpenBacklogIds(root);
  let reason = "";

  const handler = async (): Promise<JobResult> => {
    const result = await resumeSession(
      session,
      { reason: eligible.reason, openIds, timeoutS },
      io,
    );
    if (!result.ok) reason = result.error ?? "";
    return result;
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

  const { newBacklogId, newSessionId } = await import("@workledger/core/ids");
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
      newBacklogId,
      confirm: terminalConfirm,
      // Read per call, from the environment only (cli.md step 4). Never cached in a variable
      // that outlives the request and never written anywhere.
      apiKey: () => process.env[API_KEY_ENV]?.trim() || undefined,
      home,
    });
  } finally {
    db.close();
  }
}

/**
 * The spend prompt, on stderr so a `--json` consumer's stdout stays parseable.
 *
 * Imported lazily for the same reason every other body in the CLI is: `readline/promises` is
 * module-init cost that a `repair` without `--extract` should never pay.
 */
async function terminalConfirm(question: string): Promise<boolean> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
