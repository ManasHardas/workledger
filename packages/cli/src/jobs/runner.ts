/**
 * The job runner — docs/contracts/p3/cli.md §Jobs.
 *
 * "A job runner runs in the invoking process (`backfill`, `repair`) or inside `serve`; at most
 * `--concurrency` (default 2) running at once". There is no daemon and no worker pool: this is a
 * loop that claims rows from `jobs/queue.ts` and awaits a handler, which is what makes the same
 * code correct for a one-shot `repair` and for a `serve` tick.
 *
 * Resumability is entirely in the table. On start the runner re-queues whatever a dead process
 * left `running` (heartbeat older than 60 s) and, while a job runs, refreshes that heartbeat on
 * an interval — so the only thing a `kill -9` costs is one re-claimed attempt.
 *
 * Two things the table also carries since #100 (cli.md §Jobs, amended 2026-09-10): the
 * machine-wide cap — at most {@link MAX_RUNNING_MACHINE} jobs `running` across every runner,
 * checked inside the claim — and the usage-window wait: a job the harness refused because the
 * subscription window is spent goes back to `queued` with `retry_after`, and a worker with
 * nothing else to claim sleeps until then rather than returning, so the backfill that hit the
 * window is the one that finishes it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveHome } from "../index/db.js";
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_RUNNING_MACHINE,
  MAX_USAGE_WAITS,
  SESSION_NOT_FOUND_CODE,
  USAGE_LIMIT_CODE,
  claimJob,
  completeJob,
  deferJob,
  failJob,
  getJob,
  heartbeat,
  queueWait,
  requeueDeadJobs,
} from "./queue.js";
import type { JobKind, JobOutcome, JobRow } from "./queue.js";
import type { IndexDb } from "../index/db.js";

/** The default from cli.md §Jobs. */
export const DEFAULT_CONCURRENCY = 2;

/** How often a worker with nothing to claim asks the queue again while a slot is taken. */
export const DEFAULT_POLL_MS = 5_000;

/** What a handler says about the job it just ran. */
export interface JobResult extends JobOutcome {
  ok: boolean;
  /**
   * `harness-usage-limit` when the harness refused the job for its subscription window (#100).
   * With {@link JobResult.retryAfter} it turns a failure into a wait: the runner puts the row
   * back with that instant instead of failing it.
   */
  code?: typeof USAGE_LIMIT_CODE | typeof SESSION_NOT_FOUND_CODE | undefined;
  /** ISO instant the window resets; required for the wait, ignored without the code. */
  retryAfter?: string | undefined;
  /**
   * What the job printed — a resumed harness's interleaved stdout and stderr, already capped by
   * `spawn-resume.ts`. Written by the runner to `<logDir>/<job id>.log` and recorded as the
   * row's `log_path`, so a failure has a record beyond its one-line `error` (#97). Never inside
   * the repo: `logDir` is under `WORKLEDGER_HOME`.
   */
  output?: string | undefined;
}

/** `<WORKLEDGER_HOME>/logs` — where {@link RunJobsOptions.logDir} points in every command. */
export function jobLogDir(home?: string): string {
  return path.join(resolveHome(home), "logs");
}

/** Options for {@link runJobs}. */
export interface RunJobsOptions {
  /** Only this repo's jobs; the queue is per-repo everywhere in the contract. */
  repoPath: string;
  /** Restrict to these kinds. Every kind when omitted. */
  kinds?: readonly JobKind[];
  /** Restrict to one session's jobs — `repair <ulid>`. Every session when omitted. */
  sessionUlid?: string | undefined;
  /** At most this many jobs in flight in this process; the machine-wide cap applies on top. */
  concurrency?: number;
  /**
   * The machine-wide cap, {@link MAX_RUNNING_MACHINE} by default. Counted across every repo and
   * every runner through the table; tests raise it to exercise `concurrency` alone.
   */
  maxRunning?: number;
  /**
   * Sleep until a deferred job's `retry_after` rather than return while one is ahead. On by
   * default — the runner that met the usage window is the one that should finish the work.
   * A one-shot caller with its own clock passes `false` and comes back later.
   */
  waitForReset?: boolean;
  /** How often a worker re-asks the queue while it is waiting; tests pass a short one. */
  pollMs?: number;
  /** Stop after this many jobs have been run — `repair`'s "run exactly mine" case. */
  limit?: number;
  now: () => Date;
  /** Runs one job. Must not throw; a throw is recorded as a failure with its message. */
  handler: (job: JobRow) => Promise<JobResult>;
  /** Overrides the heartbeat cadence; tests pass a short one. */
  heartbeatMs?: number;
  /** One progress line on stderr, per cli.md ("progress lines to stderr"). */
  progress?: (line: string) => void;
  /** Where a job's {@link JobResult.output} is written; no log is kept when omitted. */
  logDir?: string | undefined;
  /**
   * Stop claiming once aborted. The jobs already in flight run to their outcome — the caller
   * that aborted also kills their harnesses (`abortResumes`), so that outcome is quick — and
   * everything still `queued` stays queued for the next process rather than being started by a
   * daemon that is on its way out (#99).
   */
  signal?: AbortSignal | undefined;
}

/** What one {@link runJobs} pass did. */
export interface RunJobsSummary {
  done: number;
  failed: number;
  /** Rows a dead process had left `running` and this pass put back on the queue. */
  requeued: number;
  /** Times a job was put back to wait for the harness's usage window (#100). */
  waiting: number;
}

/** The message of a thrown value, without a stack. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one job to completion, keeping its heartbeat fresh while the handler works.
 *
 * The row is re-read after the handler returns: `jobs --cancel` may have moved it to `cancelled`
 * while the harness was running, and overwriting that with `done` would lose the operator's
 * decision (cli.md: "running → best-effort kill, then cancelled").
 */
async function runOne(
  db: IndexDb,
  job: JobRow,
  options: RunJobsOptions,
): Promise<"done" | "failed" | "cancelled" | "waiting"> {
  const beat = setInterval(
    () => heartbeat(db, job.id, options.now()),
    options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS,
  );
  // A pending timer keeps Node alive; this one exists only for as long as the handler does.
  beat.unref?.();

  let result: JobResult;
  try {
    result = await options.handler(job);
  } catch (error) {
    // A handler that throws is a bug, not a job outcome — but a runner that propagates it would
    // leave the row `running` for the next process to re-queue and re-run the same bug.
    result = { ok: false, error: describe(error) };
  } finally {
    clearInterval(beat);
  }

  const current = getJob(db, job.id);
  if (current?.status === "cancelled") return "cancelled";

  const outcome = { ...result, logPath: result.logPath ?? writeLog(job.id, result.output, options) };
  const now = options.now();
  if (result.ok) {
    completeJob(db, job.id, now, outcome);
    return "done";
  }
  if (result.code === USAGE_LIMIT_CODE && result.retryAfter !== undefined) {
    // The harness's window, not the job's fault: wait for the reset instead of failing — up to
    // a point. `retry_waits` is the row's count *before* this one.
    if (job.retry_waits < MAX_USAGE_WAITS) {
      deferJob(db, job.id, { retryAfter: result.retryAfter, error: result.error, logPath: outcome.logPath });
      return "waiting";
    }
    failJob(db, job.id, now, {
      ...outcome,
      errorCode: USAGE_LIMIT_CODE,
      error: `${result.error ?? "the harness usage limit was hit"}; gave up after ${String(MAX_USAGE_WAITS)} waits`,
    });
    return "failed";
  }
  // Any other code names the failure for the Jobs card; `errorCode` is what the row stores.
  failJob(db, job.id, now, { ...outcome, errorCode: result.code });
  return "failed";
}

/**
 * A promise that settles after `ms` — or at once when `signal` aborts, so a worker waiting out
 * a usage window or a taken slot lets the daemon stop inside its grace period (#99). Never keeps
 * the process alive on its own.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", done);
      resolve();
    }, ms);
    timer.unref?.();
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Persist a job's output as `<logDir>/<id>.log` and return the path, or `undefined` when there
 * is nothing to write. A log that cannot be written is one progress line, not a failed job: the
 * outcome the handler reported is the job's, and losing its log must not change it.
 */
function writeLog(id: string, output: string | undefined, options: RunJobsOptions): string | undefined {
  if (output === undefined || options.logDir === undefined) return undefined;
  const file = path.join(options.logDir, `${id}.log`);
  try {
    mkdirSync(options.logDir, { recursive: true });
    writeFileSync(file, output, "utf8");
  } catch (error) {
    options.progress?.(`job ${id}: could not write ${file}: ${describe(error)}`);
    return undefined;
  }
  return file;
}

/**
 * Drain the queue for one repo, at most `concurrency` jobs at a time in this process and
 * {@link MAX_RUNNING_MACHINE} across the machine.
 *
 * Workers claim independently rather than sharing a pre-computed batch: a claim is a single
 * `BEGIN IMMEDIATE`, so N workers in this process and a `serve` tick in another all see the same
 * queue and no row is ever handed out twice. A worker whose claim comes back empty asks the
 * queue why: nothing left for it means it is done; a slot taken by another runner means it polls;
 * every match waiting on a usage window means it sleeps until the earliest reset (unless
 * `waitForReset` is off) and claims again. An abort (#99) ends the wait and the loop.
 */
export async function runJobs(db: IndexDb, options: RunJobsOptions): Promise<RunJobsSummary> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const maxRunning = options.maxRunning ?? MAX_RUNNING_MACHINE;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const { requeued } = requeueDeadJobs(db, options.now());
  const summary: RunJobsSummary = { done: 0, failed: 0, requeued, waiting: 0 };

  let started = 0;
  const limit = options.limit;
  const filter = () => ({
    repoPath: options.repoPath,
    now: options.now(),
    ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
    ...(options.sessionUlid === undefined ? {} : { sessionUlid: options.sessionUlid }),
  });

  const worker = async (): Promise<void> => {
    for (;;) {
      if (limit !== undefined && started >= limit) return;
      if (options.signal?.aborted) return;
      const job = claimJob(db, { ...filter(), maxRunning });
      if (job === undefined) {
        const wait = queueWait(db, filter());
        if (wait === undefined) return;
        if (wait.kind === "deferred" && options.waitForReset === false) return;
        const remaining = wait.kind === "busy" ? pollMs : Date.parse(wait.until) - options.now().getTime();
        await sleep(Math.max(1, Math.min(pollMs, remaining + 1)), options.signal);
        continue;
      }
      started += 1;

      options.progress?.(`job ${job.id}: ${job.kind} ${job.session_ulid} (attempt ${job.attempts})`);
      const outcome = await runOne(db, job, options);
      if (outcome === "done") summary.done += 1;
      else if (outcome === "failed") summary.failed += 1;
      else if (outcome === "waiting") {
        summary.waiting += 1;
        // A wait is not a run: the same worker picks the row up again after the reset, and a
        // `limit` of one (`repair <ulid>`) must still see it through.
        started -= 1;
        options.progress?.(
          `job ${job.id}: waiting for the harness usage window to reset at ${getJob(db, job.id)?.retry_after ?? "?"}`,
        );
        continue;
      }
      options.progress?.(`job ${job.id}: ${outcome}`);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return summary;
}
