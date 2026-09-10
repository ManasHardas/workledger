-- 0006_session_repo_key — one harness session, several repos (docs/contracts/p8/daemon-and-api.md
-- amendment 8, #105).
--
-- A session started in a workspace folder (`~/Projects/dome_workspace`, not a repo) does its work
-- in the repos below it, and the ledger of each of those repos needs its own digest of that one
-- transcript. The P1 key `(harness, harness_session_id)` allowed exactly one row per harness
-- session, so the second repo's row could not exist. The key is now `(harness,
-- harness_session_id, repo_path)`: `checkpoint --repo <path>` resolves its row by that triple,
-- and the backfill opens one row — and one repair job — per (session, repo).
--
-- SQLite cannot alter a table constraint in place, so the table is rebuilt: the new table is
-- created, every row copied, the old table dropped and the new one renamed. Nothing is lost —
-- every existing row satisfies the wider key — and `checkpoints` and `jobs` refer to sessions by
-- ulid, which does not change.
--
-- `cwd` records where the harness session was started, which for a workspace-root session is not
-- `repo_path`: the resume has to spawn there for the harness to find its session, and the repair
-- instruction names the repo with `--repo` when the two differ. `NULL` is every row from before
-- this migration and every live session started inside its repo; both read as "the repo root".
--
-- `transcript_touches` caches what the touched-path scanner (`src/onboarding/touched.ts`) found in
-- one transcript for one candidate root, keyed by the file's mtime and size so an unchanged
-- transcript is never read twice. Cache, like everything here: dropping the table costs one
-- rescan.

CREATE TABLE sessions_v6 (
  ulid TEXT PRIMARY KEY, repo_path TEXT NOT NULL, harness TEXT NOT NULL,
  harness_session_id TEXT NOT NULL, transcript_path TEXT, status TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  last_offset INTEGER NOT NULL DEFAULT 0,
  turns_total INTEGER NOT NULL DEFAULT 0, turns_since_checkpoint INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_at TEXT,
  last_block_turn INTEGER, last_block_trigger TEXT, blocks_since_checkpoint INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT, last_attempt_exit INTEGER, last_attempt_errors TEXT,
  updated_at TEXT NOT NULL,
  pending_trigger TEXT,
  cwd TEXT,
  UNIQUE (harness, harness_session_id, repo_path)
);

INSERT INTO sessions_v6 (
  ulid, repo_path, harness, harness_session_id, transcript_path, status, private, last_offset,
  turns_total, turns_since_checkpoint, last_checkpoint_at, last_block_turn, last_block_trigger,
  blocks_since_checkpoint, last_attempt_at, last_attempt_exit, last_attempt_errors, updated_at,
  pending_trigger
)
  SELECT
    ulid, repo_path, harness, harness_session_id, transcript_path, status, private, last_offset,
    turns_total, turns_since_checkpoint, last_checkpoint_at, last_block_turn, last_block_trigger,
    blocks_since_checkpoint, last_attempt_at, last_attempt_exit, last_attempt_errors, updated_at,
    pending_trigger
  FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_v6 RENAME TO sessions;

CREATE TABLE transcript_touches (
  transcript_path TEXT NOT NULL,
  root TEXT NOT NULL,
  refs INTEGER NOT NULL,
  writes INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (transcript_path, root)
);
