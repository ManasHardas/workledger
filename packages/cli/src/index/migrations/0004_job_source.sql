-- 0004_job_source — who queued a job, P8 Wave 1 (docs/contracts/p8/daemon-and-api.md
-- §Onboarding endpoints).
--
-- `GET /api/onboarding/status` reports the progress of the backfill the wizard started and
-- nothing else: a repair `scan` queued for a crashed session an hour later must not move the
-- wizard's progress bar. Nothing in the P3 column set distinguishes the two — both are ordinary
-- `repair` / `extract` rows — so this records the *origin* of a row. `NULL` is every row queued
-- before this migration and every row queued by a P3 command; `onboarding` is the wizard's.
--
-- Cache, not truth, like the rest of the table: a lost index costs the wizard its progress
-- figure, and the ledger still says which sessions were digested.

ALTER TABLE jobs ADD COLUMN source TEXT;

-- The status query groups the wizard's rows by lifecycle state.
CREATE INDEX jobs_by_source_status ON jobs (source, status);
