/**
 * The `jobs` table as an API — docs/contracts/p3/cli.md §Jobs.
 *
 * Every state transition a job can make lives here as one exported function, and each of the
 * ones that must not interleave runs inside the index's `BEGIN IMMEDIATE`. There is no in-memory
 * queue: two `workledger repair` processes and a `serve` tick all coordinate through this table,
 * which is why claiming is a conditional UPDATE rather than a select-then-update.
 *
 * The table is a cache like everything else in the index (CLAUDE.md). What a repair actually did
 * is in the ledger — a checkpoint block and `status: repaired` in the session frontmatter — so
 * losing this file costs a re-queued job and nothing else.
 */
import type { IndexDb } from "../index/db.js";

/** Job kinds. `extract` and `backfill` are queued by P3 slots that are not this one. */
export const JOB_KINDS = ["repair", "extract", "backfill"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Job lifecycle, verbatim from the contract. */
export const JOB_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** A `jobs` row. */
export interface JobRow {
  id: string;
  kind: string;
  session_ulid: string;
  repo_path: string;
  status: string;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** Refreshed by a running job's owner; a stale value is how a dead process is detected. */
  heartbeat_at: string | null;
  error: string | null;
  cost_estimate_usd: number | null;
  log_path: string | null;
  /**
   * Who queued the row: `onboarding` for the wizard's backfill
   * (docs/contracts/p8/daemon-and-api.md §Onboarding endpoints), `null` for every P3 command.
   */
  source: string | null;
}

/**
 * How many times a job may be *claimed* before the queue stops handing it out.
 *
 * "after 3 attempts it is `failed`" (cli.md §Jobs). The count is incremented on claim, not on
 * failure, because the case the rule exists for is a process that died without reporting
 * anything — there is nobody left to increment it afterwards.
 */
export const MAX_ATTEMPTS = 3;

/**
 * How long a `running` job may go without a heartbeat before another runner re-queues it
 * (plans/feature-p3-data-flow.md §Backfill: "heartbeat older than 60 s").
 */
export const DEAD_JOB_MS = 60_000;

/** How often a running job refreshes its heartbeat — comfortably inside {@link DEAD_JOB_MS}. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** What {@link enqueueJob} needs. */
export interface EnqueueInput {
  kind: JobKind;
  sessionUlid: string;
  repoPath: string;
  /** Mints the job id; a ULID, so `ORDER BY id` is creation order. */
  newId: () => string;
  now: Date;
  /** Recorded as {@link JobRow.source}; absent for the P3 commands. */
  source?: string | undefined;
}

const COLUMNS =
  "id, kind, session_ulid, repo_path, status, attempts, created_at, started_at, " +
  "finished_at, heartbeat_at, error, cost_estimate_usd, log_path, source";

/** Every job for one repo, newest first (cli.md: "list jobs for the repo (newest first)"). */
export function listJobs(db: IndexDb, repoPath: string): JobRow[] {
  return db.connection
    .prepare<[string], JobRow>(
      `SELECT ${COLUMNS} FROM jobs WHERE repo_path = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(repoPath);
}

/** One job by id, or `undefined`. */
export function getJob(db: IndexDb, id: string): JobRow | undefined {
  return db.connection.prepare<[string], JobRow>(`SELECT ${COLUMNS} FROM jobs WHERE id = ?`).get(id);
}

/** The live (not `done`) job for a `(kind, session_ulid)` pair, or `undefined`. */
export function findActiveJob(
  db: IndexDb,
  kind: JobKind,
  sessionUlid: string,
): JobRow | undefined {
  return db.connection
    .prepare<[string, string], JobRow>(
      `SELECT ${COLUMNS} FROM jobs WHERE kind = ? AND session_ulid = ? AND status <> 'done'`,
    )
    .get(kind, sessionUlid);
}

/**
 * Queue a job, or return the one that is already queued for this `(kind, session_ulid)`.
 *
 * Idempotent by construction: `jobs_active_per_session` is a partial unique index over every
 * status but `done`, so the second `scan` over the same crashed session gets the first scan's
 * job back rather than a duplicate. The check runs inside the same `BEGIN IMMEDIATE` as the
 * insert, so two concurrent scans cannot both pass it.
 *
 * @returns the row, and whether this call is what created it.
 */
export function enqueueJob(db: IndexDb, input: EnqueueInput): { job: JobRow; created: boolean } {
  return db.transaction(() => {
    const existing = findActiveJob(db, input.kind, input.sessionUlid);
    if (existing !== undefined) return { job: existing, created: false };

    const row: JobRow = {
      id: input.newId(),
      kind: input.kind,
      session_ulid: input.sessionUlid,
      repo_path: input.repoPath,
      status: "queued",
      attempts: 0,
      created_at: input.now.toISOString(),
      started_at: null,
      finished_at: null,
      heartbeat_at: null,
      error: null,
      cost_estimate_usd: null,
      log_path: null,
      source: input.source ?? null,
    };
    db.connection
      .prepare<JobRow>(
        `INSERT INTO jobs (${COLUMNS}) VALUES (@id, @kind, @session_ulid, @repo_path, @status, ` +
          "@attempts, @created_at, @started_at, @finished_at, @heartbeat_at, @error, " +
          "@cost_estimate_usd, @log_path, @source)",
      )
      .run(row);
    return { job: row, created: true };
  });
}

/**
 * Re-queue jobs a dead process left `running`, and fail the ones that have used up their
 * attempts.
 *
 * "a job interrupted by process exit is `queued` again on the next run with `attempts`
 * incremented; after 3 attempts it is `failed`" (cli.md §Jobs). The increment happens on claim,
 * so a job whose third claim died is already at {@link MAX_ATTEMPTS} here and is failed instead
 * of handed out a fourth time.
 *
 * @returns how many rows moved to `queued` and how many to `failed`.
 */
export function requeueDeadJobs(
  db: IndexDb,
  now: Date,
  staleMs: number = DEAD_JOB_MS,
): { requeued: number; failed: number } {
  const cutoff = new Date(now.getTime() - staleMs).toISOString();
  return db.transaction(() => {
    // A `running` row with no heartbeat at all is dead too: the claim writes one, so its absence
    // means the row predates this build or was written by hand.
    const dead = db.connection
      .prepare<[string], JobRow>(
        `SELECT ${COLUMNS} FROM jobs WHERE status = 'running' ` +
          "AND (heartbeat_at IS NULL OR heartbeat_at < ?)",
      )
      .all(cutoff);

    let requeued = 0;
    let failed = 0;
    for (const job of dead) {
      if (job.attempts >= MAX_ATTEMPTS) {
        db.connection
          .prepare<[string, string, string]>(
            "UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
          )
          .run(
            now.toISOString(),
            `abandoned by a dead runner after ${MAX_ATTEMPTS} attempt(s)`,
            job.id,
          );
        failed += 1;
        continue;
      }
      db.connection
        .prepare<[string]>(
          "UPDATE jobs SET status = 'queued', started_at = NULL, heartbeat_at = NULL WHERE id = ?",
        )
        .run(job.id);
      requeued += 1;
    }
    return { requeued, failed };
  });
}

/**
 * Claim the oldest queued job for a repo, moving it to `running` and incrementing `attempts`.
 *
 * The whole thing is one `BEGIN IMMEDIATE`, so the row two runners race for is handed to exactly
 * one of them: SQLite serializes the write transactions and the loser's `SELECT` re-runs against
 * the winner's committed state.
 *
 * @param options.kinds restrict the claim to these kinds; every kind when omitted.
 * @param options.sessionUlid restrict the claim to one session — `repair <ulid>` runs that
 * session's job and must not pick up the one a concurrent `scan` queued for another.
 * @returns the claimed row, or `undefined` when the queue is empty for this repo.
 */
export function claimJob(
  db: IndexDb,
  options: { repoPath: string; now: Date; kinds?: readonly JobKind[]; sessionUlid?: string },
): JobRow | undefined {
  const kinds = options.kinds;
  const at = options.now.toISOString();
  return db.transaction(() => {
    // Kinds are interpolated rather than bound because the list length varies; every value comes
    // from the `JobKind` union, never from user input.
    const filter =
      kinds === undefined
        ? ""
        : ` AND kind IN (${kinds.map((kind) => `'${kind}'`).join(", ")})`;
    const bySession = options.sessionUlid === undefined ? "" : " AND session_ulid = ?";
    const params: string[] =
      options.sessionUlid === undefined ? [options.repoPath] : [options.repoPath, options.sessionUlid];
    const next = db.connection
      .prepare<string[], JobRow>(
        `SELECT ${COLUMNS} FROM jobs WHERE repo_path = ? AND status = 'queued'${filter}${bySession} ` +
          "ORDER BY created_at, id LIMIT 1",
      )
      .get(...params);
    if (next === undefined) return undefined;

    db.connection
      .prepare<[string, string, string]>(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = ?, " +
          "heartbeat_at = ?, error = NULL WHERE id = ?",
      )
      .run(at, at, next.id);
    return { ...next, status: "running", attempts: next.attempts + 1, started_at: at, heartbeat_at: at };
  });
}

/** Refresh a running job's liveness signal. A no-op for a job that is no longer running. */
export function heartbeat(db: IndexDb, id: string, now: Date): void {
  db.connection
    .prepare<[string, string]>("UPDATE jobs SET heartbeat_at = ? WHERE id = ? AND status = 'running'")
    .run(now.toISOString(), id);
}

/** What a finished job records beyond its status. */
export interface JobOutcome {
  error?: string | undefined;
  costEstimateUsd?: number | undefined;
  logPath?: string | undefined;
}

/** `running` → `done`. */
export function completeJob(db: IndexDb, id: string, now: Date, outcome: JobOutcome = {}): void {
  db.connection
    .prepare<[string, string | null, number | null, string]>(
      "UPDATE jobs SET status = 'done', finished_at = ?, error = NULL, log_path = ?, " +
        "cost_estimate_usd = ? WHERE id = ?",
    )
    .run(now.toISOString(), outcome.logPath ?? null, outcome.costEstimateUsd ?? null, id);
}

/**
 * `running` → `failed`.
 *
 * A reported failure is terminal rather than automatically re-queued: the harness ran and said
 * no, and running it again unprompted would spend the same tokens on the same answer. The
 * automatic re-queue is for the *unreported* case only ({@link requeueDeadJobs}); an operator
 * asks for another go with `jobs --retry`.
 */
export function failJob(db: IndexDb, id: string, now: Date, outcome: JobOutcome = {}): void {
  db.connection
    .prepare<[string, string | null, string | null, string]>(
      "UPDATE jobs SET status = 'failed', finished_at = ?, error = ?, log_path = ? WHERE id = ?",
    )
    .run(now.toISOString(), outcome.error ?? null, outcome.logPath ?? null, id);
}

/** Why a cancel or retry could not be applied. */
export interface JobActionError {
  message: string;
}

/**
 * `queued` → `cancelled`; `running` → `cancelled`.
 *
 * cli.md says a running job is killed best-effort and then cancelled. The kill belongs to
 * whichever process owns the child, and it notices through the row: the runner re-reads the
 * status around each spawn, and a cancelled row means it never starts (or stops waiting on) the
 * harness. Marking the row is the part that is always available, so it is the part done here.
 */
export function cancelJob(db: IndexDb, id: string, now: Date): JobRow | JobActionError {
  return db.transaction(() => {
    const job = getJob(db, id);
    if (job === undefined) return { message: `no job ${id}` };
    if (job.status !== "queued" && job.status !== "running") {
      return { message: `job ${id} is ${job.status}; only a queued or running job can be cancelled` };
    }
    db.connection
      .prepare<[string, string]>(
        "UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?",
      )
      .run(now.toISOString(), id);
    return { ...job, status: "cancelled", finished_at: now.toISOString() };
  });
}

/**
 * `failed | cancelled` → `queued`.
 *
 * `attempts` is reset: an operator retry is a fresh start, and keeping the count would let a job
 * that had already been claimed three times be failed again by the first
 * {@link requeueDeadJobs} sweep without ever running.
 */
export function retryJob(db: IndexDb, id: string): JobRow | JobActionError {
  return db.transaction(() => {
    const job = getJob(db, id);
    if (job === undefined) return { message: `no job ${id}` };
    if (job.status !== "failed" && job.status !== "cancelled") {
      return { message: `job ${id} is ${job.status}; only a failed or cancelled job can be retried` };
    }
    db.connection
      .prepare<[string]>(
        "UPDATE jobs SET status = 'queued', attempts = 0, started_at = NULL, " +
          "finished_at = NULL, heartbeat_at = NULL, error = NULL WHERE id = ?",
      )
      .run(id);
    return { ...job, status: "queued", attempts: 0, started_at: null, finished_at: null, error: null };
  });
}
