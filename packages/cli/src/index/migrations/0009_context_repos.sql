-- 0009_context_repos — start directory versus context repos, P8 amendment 10 / DL-20 (#116).
--
-- Two facts about every session. `start_dir` is where the harness was launched: it decides where
-- the transcript is stored and where a headless resume must run, and nothing else — it was `cwd`
-- since 0006 (#114 filled it for every backfilled row) and is renamed to say what it is.
-- `context_repos` is what the session is *about*, inferred from its transcript's tool inputs
-- (`src/onboarding/touched.ts` `inferContext`): a JSON array of `{ root, writes, pathInputs,
-- references, fallback? }`, best first, recorded by the Stop hook at its first block, by the
-- backfill when it opens the row, and by every repair job as its first step. It decides where
-- checkpoints are filed; `start_dir` never does. `NULL` is a row nothing has inferred yet.
--
-- `scan_offset` and `scan_counts` (0007) now serve every session, not only workspace-started
-- ones: the Stop hook of a repo-started session scans the same way.

ALTER TABLE sessions RENAME COLUMN cwd TO start_dir;
ALTER TABLE sessions ADD COLUMN context_repos TEXT;
