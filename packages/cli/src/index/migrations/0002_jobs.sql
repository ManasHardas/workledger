-- 0002_jobs — the job queue and the pending-trigger column, P3 Wave 0.
--
-- Column set is verbatim from docs/contracts/p3/cli.md §Jobs: "Persisted in
-- `~/.workledger/index.sqlite` table `jobs` (id ULID, kind, session_ulid, repo_path, status
-- queued|running|done|failed|cancelled, attempts int, started_at, finished_at, error,
-- cost_estimate_usd, log_path)". `created_at` and `heartbeat_at` are added on top of that list
-- because the contract's own semantics need them: "newest first" needs a creation order that
-- survives a re-queue, and "a job interrupted by process exit is queued again on the next run"
-- needs a liveness signal a dead process stops refreshing (plans/feature-p3-data-flow.md,
-- 60 s).
--
-- Like every other table here this is cache, not truth: the ledger under `.workledger/` records
-- what a repair *did* (a checkpoint block, `status: repaired`), and a lost index costs at most a
-- re-queued job.

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  session_ulid TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  heartbeat_at TEXT,
  error TEXT,
  cost_estimate_usd REAL,
  log_path TEXT
);

-- "unique on (kind, session_ulid) while not done" (plans/feature-p3-data-flow.md §Orphans).
-- A partial index rather than a table constraint: a session that has been repaired once may be
-- repaired again after a later crash, so the pair has to be free once the job reaches `done`.
-- `failed` and `cancelled` are deliberately *inside* the index — a second `scan` must re-use the
-- failed job (which `jobs --retry` re-queues) instead of queueing a duplicate beside it.
CREATE UNIQUE INDEX jobs_active_per_session ON jobs (kind, session_ulid) WHERE status <> 'done';

-- `scan` and `jobs` both list by repo; `claim` takes the oldest queued job.
CREATE INDEX jobs_by_repo_status ON jobs (repo_path, status, created_at);

-- The trigger the *next* checkpoint in this session must stamp, set by the job runner before it
-- spawns the harness and consumed by the first checkpoint that lands
-- (plans/feature-p3-data-flow.md §Repair by resume). It lives on the session row rather than on
-- the resumed process's command line so the resumed agent's `workledger checkpoint --session
-- <ulid>` is the same command a live session runs.
ALTER TABLE sessions ADD COLUMN pending_trigger TEXT;
