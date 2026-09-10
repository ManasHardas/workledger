-- 0007_workspaces — workspace-root sessions, P8 amendment 8 (#105).
--
-- A session started in a folder that holds repos but is not one itself (`~/Projects/dome_workspace`
-- with the card repos under it) loads no repo's hook file and was invisible live. `workledger init
-- --workspace <dir>` now writes the hook files into such a folder and records it here; a hook fired
-- from it resolves the repos the transcript touched and records the session against each of them.
--
-- `workspaces`   the folders `init --workspace` enabled. Cache, like every table here: the hook
--                files in the folder are what "enabled" means, and `doctor` reports both.
-- `workspace`    on `sessions`: 1 for the row a workspace session opens before any repo is known
--                (its `repo_path` is the workspace). A checkpoint never lands on such a row; the
--                Stop hook opens one ordinary row per touched repo beside it, sharing the harness
--                session id — the wider key `0006_session_repo_key` introduced.
-- `scan_offset`  how far into the transcript the touched-path scanner has read for this row, so
--                each Stop scans only the bytes since the last one.
-- `scan_counts`  JSON `{ "<root>": { "references": n, "writes": n } }` accumulated so far.

CREATE TABLE workspaces (
  path TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

ALTER TABLE sessions ADD COLUMN workspace INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN scan_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN scan_counts TEXT;
