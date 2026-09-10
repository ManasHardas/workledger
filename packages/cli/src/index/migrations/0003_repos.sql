-- 0003_repos — the enabled-repo list, P8 Wave 0 (docs/contracts/p8/daemon-and-api.md §CLI:
-- "without --repo: machine mode over every enabled repo in the index").
--
-- Before this the set of repos the index knew was the distinct `repo_path` of its sessions,
-- which is wrong for exactly the case P8 is built around: a repo that `workledger init` (or the
-- onboarding wizard) has just enabled and that no hook has touched yet must still appear on the
-- home page. So `init` records the repo here, and every session insert keeps the row in step.
--
-- Like every other table here this is cache, not truth: `.workledger/` existing in the repo is
-- what "enabled" means, and both `serve` and `doctor` still filter on that. A row whose
-- directory is gone is skipped, not reported. `enabled` is kept for the day a repo can be
-- hidden from home without deleting its ledger; nothing writes 0 yet.

CREATE TABLE repos (
  path TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Repos enabled by P1–P5 already have sessions; seed the table from them so nothing has to be
-- re-run (plans/feature-p8-onboarding-home.md §Migration).
INSERT INTO repos (path, enabled, added_at, updated_at)
  SELECT repo_path, 1, MIN(updated_at), MAX(updated_at) FROM sessions GROUP BY repo_path;
