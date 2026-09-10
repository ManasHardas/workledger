# P3 CLI contract — scan, repair, backfill, jobs (frozen 2026-09-09)

Shared: exit `0` ok · `1` usage/validation · `4` not an enabled repo · `5` job failed (repair/backfill
non-zero outcome) · `6` consent refused (extraction). All long operations write progress lines to
stderr and a final summary line to stdout; `--json` switches stdout to one JSON object.

## Jobs

Persisted in `~/.workledger/index.sqlite` table `jobs` (id ULID, kind, session_ulid, repo_path, status
queued|running|done|failed|cancelled, attempts int, started_at, finished_at, error, cost_estimate_usd,
log_path). A job runner runs in the invoking process (`backfill`, `repair`) or inside `serve`; at most
`--concurrency` (default 2) running at once; a job interrupted by process exit is `queued` again on the
next run with `attempts` incremented; after 3 attempts it is `failed`. Amendment (2026-09-10, #97): the
runner writes a job's output — the resumed session's stdout and stderr, capped at 16 KB — to
`~/.workledger/logs/<job id>.log` on success and on failure and records the path in `log_path`;
`GET /api/jobs/:id/log` serves it (`docs/contracts/p8/daemon-and-api.md` amendment 5).

```
workledger jobs [--json] [--repo <path>]        list jobs for the repo (newest first)
workledger jobs --cancel <job-id>               queued → cancelled; running → best-effort kill, then cancelled
workledger jobs --retry <job-id>                failed|cancelled → queued
```

## `workledger scan [--repo <path>] [--json]`

For every session in the index with status `open` for this repo: if the transcript file is missing or
its mtime is older than `config.orphan_minutes` (default 30) and `turns_since_checkpoint > 0` or no
checkpoint exists, set status `crashed`, `end_reason: crashed`, `needs_repair: true`, write the
frontmatter atomically, and queue a `repair` job. Reads mtimes only. Also runs opportunistically inside
`hook SessionStart` (bounded to 200 ms, at most 20 sessions) and every 5 minutes inside `serve`.
Stdout: `scan: <n> orphaned, <m> repair job(s) queued`.

## `workledger repair <ulid> [--extract] [--yes] [--timeout <s>]`

1. Session must exist with status `crashed`, `ended` with `needs_repair`, or `open` with `--force`.
2. Resume path: `adapter.resumeHeadless(harness_session_id, { cwd: repo, instruction, allowedTools:
   ["Bash(workledger checkpoint*)"], timeoutMs: 600000 })` (amendment 2026-09-10, #97: was
   300000; `--timeout <s>` overrides). The instruction is the checkpoint
   instruction with "since checkpoint n" and `--session <ulid>`; the resumed agent runs `workledger
   checkpoint`, which stamps `trigger: repair`. On success: status `repaired`, `needs_repair: false`.
3. If resume fails (harness cannot resume, transcript missing, timeout) and `--extract` is not given:
   exit `5` with the reason and the exact `--extract` command to run.
4. Extraction path (`--extract`): print the estimate (`transcript bytes since offset`, model, USD at the
   configured rate), ask unless `--yes` (exit `6` on refusal); slice the transcript from the last
   checkpoint offset; keep user, assistant, and tool-result records; chunk at 100k tokens; call the API
   (`ANTHROPIC_API_KEY` from the environment only, never written to disk or the index); validate the
   returned payload with the P1 schema; write via `workledger checkpoint --trigger extract`; status
   `repaired`. The transcript text is never written anywhere but the API request.

## `workledger backfill [--repo <path>] [--since 7d|14d|30d|all] [--concurrency <n>] [--dry-run] [--yes] [--extract-fallback]`

1. Enumerate the harness store for sessions belonging to this repo (Claude Code: `~/.claude/projects/
   <slug>/*.jsonl`, `cwd` from the first record; metadata only) not already in the index.
2. Filter by `--since` (default `14d`) on file mtime. Print the table: count, total bytes, oldest, and
   the estimate `count × config.backfill.seconds_per_session (45) ÷ concurrency`.
3. `--dry-run` stops here (exit 0). Otherwise ask unless `--yes`.
4. For each session: create the session record with `source: backfill` and a `SessionStart`-equivalent
   row, queue a `repair` job (resume path); with `--extract-fallback`, a resume failure queues an
   `extract` job instead of failing. Runs the queue with `--concurrency`; progress on stderr; resumable.
   Amendment (2026-09-10, #97): each resume's timeout is per session,
   `min(1800, 600 + 120 × ceil(transcript bytes / 1e6))` seconds — the same rule for `workledger
   backfill` and the onboarding wizard's backfill.
5. Summary: `backfill: <done> digested, <failed> failed, <skipped> skipped (already indexed)`.

## Config additions (`.workledger/config.yaml`)

```yaml
backfill: { since: 14d, concurrency: 2, seconds_per_session: 45 }
extract:  { model: claude-haiku-4-5, usd_per_million_input: 1, usd_per_million_output: 5 }
```
