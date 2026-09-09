-- 0001_init — the index cache, frozen at P1 Wave 0.
--
-- The ledger (`.workledger/`) is the only durable store; this database is a rebuildable cache
-- (plans/feature-p1-data-flow.md §1). Every table here can be reconstructed from session
-- frontmatter plus the transcript file sizes by packages/cli/src/index/rebuild.ts.
--
-- Column set is verbatim from plans/feature-p1-cli-core.md §Data model. Nothing is added here
-- without a contract amendment first.

CREATE TABLE sessions (
  ulid TEXT PRIMARY KEY, repo_path TEXT NOT NULL, harness TEXT NOT NULL,
  harness_session_id TEXT NOT NULL, transcript_path TEXT, status TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  last_offset INTEGER NOT NULL DEFAULT 0,
  turns_total INTEGER NOT NULL DEFAULT 0, turns_since_checkpoint INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_at TEXT,
  last_block_turn INTEGER, last_block_trigger TEXT, blocks_since_checkpoint INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT, last_attempt_exit INTEGER, last_attempt_errors TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (harness, harness_session_id)
);

CREATE TABLE checkpoints (
  session_ulid TEXT NOT NULL, n INTEGER NOT NULL, at TEXT NOT NULL,
  transcript_offset INTEGER NOT NULL, turns INTEGER NOT NULL, trigger TEXT NOT NULL,
  PRIMARY KEY (session_ulid, n)
);

CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
