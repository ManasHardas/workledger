# P3 data flow

**Orphans.** `scan` reads index rows with status `open` and stats each transcript path. Crashed =
missing file, or mtime older than `orphan_minutes` with work since the last checkpoint. Only mtimes and
sizes are read. Frontmatter is rewritten atomically; a `repair` job is queued once per session (unique
on `(kind, session_ulid)` while not done).

**Repair by resume.** The adapter spawns the harness headless with the session id, `cwd` pinned to the
repo, tools restricted to the checkpoint command, and the instruction on the prompt. The resumed agent
already holds the transcript, so no parser is involved. `workledger checkpoint` inside that process
stamps `trigger: repair` (the index carries a `pending_trigger` set by the job runner before spawning).
Timeout kills the child and marks the job failed; the session stays `crashed`.

**Extraction fallback.** Only with consent. The transcript slice `[last_offset, size)` is parsed into
records; kept: `user`, `assistant` text, tool results (truncated to 2 KB each); dropped: everything
else. Chunks of ≤100k tokens are sent with a fixed system prompt that asks for a CheckpointPayload
JSON; the last chunk's payload is validated by the P1 schema (a failure exits 5 with the errors, no
retry loop) and written via `checkpoint --trigger extract`. Cost = input tokens × rate + a fixed 4k
output. The API key is read from the environment per request and never logged.

**Backfill.** Store enumeration is metadata only. Each backfilled session gets a session record
(`source: backfill`, `started` from the first record's timestamp, `harness_session_id` from the file
name) and a `repair` job. The runner is resumable: on start it re-queues `running` jobs from a dead
process (heartbeat older than 60 s) and skips `done`. `SessionStart` inside a resumed session reuses the
row by `(harness, harness_session_id)` (P1 data-flow §2), so a backfilled session never forks.

**Excerpts.** `GET /api/sessions/:ulid/excerpt?cp=n` reads bytes `[offset(n-1), offset(n))` from the
transcript (path from the index), parses records, renders user/assistant turns, counts tool calls, and
caches the rendering under `~/.workledger/cache/<ulid>/cp-<n>.json`. If the transcript is gone, 404 and
the UI shows "transcript no longer on this machine". Nothing from this path is ever written under the
repo.

**Budgets.** `scan` over 500 open sessions < 200 ms (mtimes only). Repair wall time is the harness's
(minutes). Excerpt render for a 2 MB span < 300 ms, cached thereafter.
