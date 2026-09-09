# Clause #3 — Test-file-in-initial-commit (PERMANENT)

## Body (paste verbatim into dispatch briefs)

> The **initial commit** of this PR MUST include a test file (e.g., `packages/<pkg>/test//test_<scope>.py`) covering ≥70% of new lines (matches CI diff-cover gate at `--fail-under=70`). Reviewers will treat a missing test file as a Blocker. **Do not stage code-only commits before the test file exists.**

## When this clause applies

Backend implementation dispatches on these classes:
- `service-module` (new or rewritten module under `packages/core/src/`)
- `endpoint-chained-on-service-module` (new endpoint that introduces routes + consumes service modules)
- `worker-stages` (new worker entry point + stage logic)

Suspended only after QA agent is dispatched in Wave 2 (then `packages/<pkg>/test/` formally transfers to QA per `agents/backend.md` scope fence).

## Why permanent

Real-project calibration: PRs that omit the test file in the initial commit incur a ~70-100k token "split-and-resume" tax — implementer marks ready, CI diff-cover gate fails, implementer rewrites with tests. Front-loading saves that tax (validated savings band 70-100k per PR across 10+ PRs).

When the dispatch brief explicitly states this clause, build agents reliably front-load tests in the initial commit. When it's omitted, ~50% of PRs incur the post-mark-ready split-and-resume.

## Doesn't apply to

- Frontend PRs — frontend tests are QA-agent-scope per `agents/frontend.md`.
- Pure-infra PRs (Docker, CI, scripts) — no application test files.
- Pure-documentation PRs — no test files.
- Migration body PRs (orchestrator-territory Wave 0) — alembic migrations don't strictly require tests, though a migration round-trip test (upgrade-then-downgrade-then-upgrade) is welcome.

## Tracking in PR body

Build agents include this confirmation in the PR description's "Dispatch-template clauses honored" section:

```markdown
- **Clause #3 (test-file-in-initial-commit):** ✅ initial commit `<sha>` includes
  `packages/<pkg>/test//test_<scope>.py` (<N> tests, <X>% diff-cover). Front-loaded.
```
