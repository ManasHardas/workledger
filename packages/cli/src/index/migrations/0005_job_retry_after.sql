-- 0005_job_retry_after — a job that must wait for the harness's usage window, P8 (#100).
--
-- On 2026-09-10 four onboarding repairs ran at once and every resumed `claude -p` exited 1 with
-- one line on stdout: "You've hit your session limit · resets 1am (America/Los_Angeles)". The
-- row said only "the resumed session exited 1", and an operator retry would have spent the same
-- answer again. Three columns turn that into a wait the runner honours:
--
-- `error_code`   a machine-readable reason beside the human `error` — `harness-usage-limit` is
--                the one value this migration is for; `NULL` for every other failure.
-- `retry_after`  ISO instant before which a `queued` row must not be claimed. Set when the
--                harness names its reset time, cleared by the claim that finally runs it.
-- `retry_waits`  how many times the row has been put back for a usage window; after three the
--                runner fails it for good rather than waiting a fourth night. `attempts` is left
--                alone: a wait is not an attempt.
--
-- Cache, not truth, like the rest of the table (CLAUDE.md): a lost index costs the wait, and the
-- ledger still says which sessions have a digest.

ALTER TABLE jobs ADD COLUMN error_code TEXT;
ALTER TABLE jobs ADD COLUMN retry_after TEXT;
ALTER TABLE jobs ADD COLUMN retry_waits INTEGER NOT NULL DEFAULT 0;
