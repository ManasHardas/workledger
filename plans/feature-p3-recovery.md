# Phase 3 — Recovery and backfill

**Status:** Frozen pending Wave 0 (lean mode). **Tag:** `p3-shipped`.

**Strategic context.** P1 records live sessions; P2 shows them. P3 closes the two gaps the design
spec lists as "later": sessions that end without a fresh checkpoint (crash, kill, compaction) and
history from before install. Both use the same mechanism, a headless resume of the session asking
for a digest (design D4, D5, spec §5.5–§6). Transcript extraction by an API model is the opt-in
fallback with cost shown first. P3 also ships the provenance excerpt viewer the P2 panel promised
and a Jobs view. Design spec §5.5, §5.6, §6, §8 (Jobs, provenance panel).

## Sub-phase split

| Sub-phase | Scope | Sessions |
|---|---|---|
| P3a orphan scan + repair | `workledger scan`, `repair <ulid>` by headless resume, index `crashed`/`repaired`, hook-time opportunistic scan | 1 |
| P3b backfill + extraction fallback | `workledger backfill` with lookback, job queue, concurrency, resumability, extraction with consent | 1 |
| P3c UI | Jobs view (SSE progress), provenance excerpt viewer over the local cache, repair/backfill buttons | 1 |

## Wave 0 artifacts (direct commit)

`docs/contracts/p3/cli.md` (scan, repair, backfill, extract; exit codes; job state), `docs/contracts/p3/api.md`
(jobs endpoints, excerpt endpoint, SSE `job.changed`), `plans/feature-p3-data-flow.md`.

## Architecture

```
hook SessionStart / serve tick ──▶ orphan scan: open sessions whose transcript mtime is older than
                                   config.orphan_minutes → status crashed, job queued (repair)
workledger repair <ulid> ────────▶ adapter.resume(harness_session_id, cwd) headless with tools
                                   restricted to `workledger checkpoint*`; instruction "checkpoint
                                   since n"; on success status repaired, trigger repair
workledger backfill ─────────────▶ enumerate harness store metadata → lookback filter → jobs(repair,
                                   source backfill) with concurrency N, resumable via ~/.workledger/jobs.sqlite
extraction fallback ─────────────▶ transcript slice from last offset → filter records → API model →
                                   CheckpointPayload → `workledger checkpoint --trigger extract`; only on
                                   explicit consent, cost estimate printed first
provenance excerpt ──────────────▶ GET /api/sessions/:ulid/excerpt?cp=n reads [offset(n-1), offset(n)) of the
                                   transcript from the local cache path, renders user/assistant turns,
                                   collapses tool noise; never leaves the machine, never enters the repo
```

## Data model

Index gains `jobs` (id ULID, kind repair|backfill|extract|scan, session_ulid, status queued|running|
done|failed|cancelled, attempts, started_at, finished_at, error, cost_estimate_usd, log_path). Session
frontmatter: `status` gains use of `crashed` and `repaired` (already in the enum); checkpoints
`trigger` uses `repair`, `backfill`, `extract` (already reserved). `~/.workledger/cache/<harness>/<id>/`
holds excerpt renderings keyed by checkpoint.

## CLI surface

```
workledger scan [--repo]                    → marks orphans crashed, queues repairs; prints counts; exit 0
workledger repair <ulid> [--extract]        → resume-based digest; --extract uses the API model after consent
workledger backfill [--repo] [--since 7d|14d|30d|all] [--concurrency 2] [--dry-run] [--yes]
                                            → lists sessions and estimate, asks unless --yes, runs the queue
workledger jobs [--json] [--cancel <id>]    → queue state
```

Adapters gain `resumeHeadless(sessionId, { cwd, instruction, allowedTools, timeoutMs })` returning
`{ exitCode, stdout, stderr }`; Claude Code: `claude -p --resume <id> --permission-mode acceptEdits
--allowedTools "Bash(workledger checkpoint*)"`. Extraction: Anthropic API via `fetch`, model from
config (`extract.model`, default a small model), transcript filtered to user/assistant/tool-result
records, chunked, output validated as a CheckpointPayload; API key from `ANTHROPIC_API_KEY` only;
never stored.

## Wave 0.5 dispatch list

Backend (5): jobs table + queue runner in the CLI (in-process, resumable); `scan` + orphan detection at
SessionStart and `serve` tick; `repair` via headless resume + Claude Code adapter `resumeHeadless`;
`backfill` with store enumeration, lookback, estimate, concurrency; extraction fallback with consent
and cost. Server (1): jobs endpoints + SSE `job.changed` + excerpt endpoint reading the local
transcript. Frontend (2): Jobs view (progress, cancel, retry) + repair/backfill actions; provenance
excerpt viewer in the session detail. QA (1): e2e — kill a headless session mid-turn, run scan and
repair, assert the checkpoint lands; backfill three fixture sessions.

## Acceptance

- [ ] A session killed before its first checkpoint is marked `crashed` by `scan` and gets a checkpoint from `repair` with `trigger: repair`.
- [ ] `backfill --since 7d --dry-run` lists this machine's sessions with a count and time estimate; `backfill --yes` produces `source: backfill` sessions with ≥1 checkpoint each; a cancelled run resumes without redoing finished sessions.
- [ ] Extraction never runs without an explicit `--extract`/UI consent and prints a cost estimate first; the API key is never written anywhere.
- [ ] The provenance panel shows the transcript span for a checkpoint from the local cache; the repo contains no transcript content (fixture scan stays clean).
- [ ] Jobs view updates live; tests and coverage gate green.

## Out of scope
Cursor/Codex resume (P4); team sync of jobs (P5); cardFS (P6).
