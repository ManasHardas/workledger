# Changelog

## Unreleased — P8 Onboarding and home

Built on main; `p8-shipped` and `v0.4.0` follow the operator's walkthrough from a fresh state.

- `workledger` with no arguments (`workledger open`) starts one daemon per machine (port 7419 or a free one, URL and pid in `~/.workledger/serve.json`), prints the URL, opens Home, and reuses a running daemon on the next call; `workledger stop` stops it. The server serves every enabled repo the index knows: `/api/repos`, a `repo` parameter on every P2/P3 endpoint, `repo` on SSE events, machine-wide aggregates; `serve --repo` remains for debugging and points at `open` (#83).
- `/api/onboarding/*` (discover, history counts for 7/30/90 days, init, backfill plan, run) backed by the CLI's own functions, and `workledger onboard [--json]` for parity; `init` only ever touches a repo the operator selected, and it refuses relative and non-git paths (#84, #90).
- Web Home: one card per tracked repo with sessions in the last 7 days, open backlog, blockers and questions, last hook time, and health; `/#/r/<id>/` routes with a repo switcher; machine-wide Needs you and Jobs with the repo per row; Add projects opens the wizard (#86). Home re-reads when the daemon emits `repos.changed` after an init, no reload needed (#96).
- Onboarding wizard at `/#/onboarding`, opened automatically when the daemon starts with zero enabled repos: projects (known repos pre-checked when suggested, other `.git` repos under `~/Projects`, Add folder keeps the default roots, only git repos are tickable), history, method (resume, else an extraction estimate that can be denied), running with live progress while Home stays usable, done with the per-repo summary and the Codex trust steps (#93).
- Discovery descends into a root that is itself a repo, never enters nested repos, drops candidates under the OS temp dir, and marks `suggested` (#90). Codex sessions appear in onboarding history, plan, and backfill (resumed with `codex exec resume`; excluded from extraction with an `unsupported.codex` count); `codex exec resume` argv fixed (#92).
- Next and Health fit a 375 px viewport (#91).
- Install: `.github/workflows/release.yml` on `v*` tags builds, packs, publishes to npm (skipped with a printed command when `NPM_TOKEN` is absent), attaches the tarball to a GitHub release, and updates the Homebrew tap formula (skipped when `TAP_TOKEN` is absent); README install section for `npm install -g workledger` and `brew tap ManasHardas/workledger && brew install workledger` (#82).
- Proven end to end: a fresh `HOME` with two temp repos and fixture transcripts runs `workledger`, drives the wizard through backfill with a stub `claude`, and Home shows both repos (#95).
- Headless backfill records checkpoints again (#97 → #98): `workledger checkpoint --payload '<json>'` and `--payload-file <path>` beside stdin, instruction v3 prescribing the single-quoted argument with a no-quote/no-backslash string rule (Claude Code's headless permission matcher denies heredocs and heredoc-fed pipes even under `Bash(workledger checkpoint*)`), the payload cap raised 4,096 → 16,384 bytes, the resume timeout 300 → 600 s with a per-session `600 + 120 s/MB` (cap 1,800 s) budget for backfills, the resumed session's output kept in `~/.workledger/logs/<job>.log` and served by `GET /api/jobs/:id/log` as a collapsible Log on the Jobs card, and a retry from the Jobs view that actually runs the job (#98).
- Instruction v3 states every per-field cap the schema enforces (goal ≤ 400 chars; text, why and reason ≤ 300; notes text ≤ 500; ≤ 20 files per done item; ≤ 10 `blocked_by`; ≤ 12 items per section; ≤ 16,384 bytes total); the caps are named constants in `packages/core` and a test fails if the prompt and the schema drift apart (#102).
- The daemon exits within 3 s of `SIGTERM`: open SSE streams are closed, in-flight headless resumes are killed by process group and their jobs recorded `failed`, queued jobs stay queued, `serve.json` is removed; `workledger stop` escalates to `SIGKILL` after 5 s (#103).
- Backfill and repair survive the operator's Claude usage limit: a resume that prints "You've hit your session limit · resets 1am (…)" is recognized, the job is requeued with a `retry_after` at the named reset (up to three waits, then failed with `error_code`), a worker with nothing else to do sleeps until the reset and finishes it, and the Jobs card and wizard say "Waiting for your Claude usage window to reset at <local time>"; at most 2 jobs run machine-wide (#104).

## 0.3.0 — P5 Team (2026-09-09)

- `auto_commit: false | on_checkpoint | on_session_end`: one commit touching only `.workledger/`, never a push, skipped during merge/rebase/cherry-pick, never changes a hook's exit code.
- `private_paths`: repo-relative globs that make a session private (boundary record only, never blocked).
- `.workledger/identities.yaml`: email to name mapping used by `brief`, `backlog show|list`, the UI (Next, Needs you), and `GET /api/identities`.
- `workledger init --teammate`: onboarding for a clone that already carries the hooks; `scan --all` and `doctor` cover every enabled repo on the machine.
- `.workledger/README.md` documents the clone path and conflict handling.

## 0.2.0 — P3 Recovery and backfill, P4 Codex and Cursor (2026-09-09)

- `workledger scan`: orphaned sessions (transcript idle past `orphan_minutes`) become `crashed` with a queued repair; runs opportunistically at SessionStart and every 5 minutes under `serve`.
- `workledger repair <ulid>`: headless resume of the harness session asking for a checkpoint since the last one (`trigger: repair`); detached process-group kill on timeout; `--extract` falls back to an API model over the transcript slice only with explicit consent and a printed cost estimate; the API key is read from the environment per request and never stored.
- `workledger backfill --since 7d|14d|30d|all`: metadata-only enumeration of the harness store, an estimate table, `--dry-run`, consent, resumable job queue with concurrency, `source: backfill` sessions.
- `workledger jobs`: list, cancel, retry; the server exposes jobs, `job.changed` over SSE, and a per-checkpoint transcript excerpt endpoint (turns with tool counts, cached locally, never in the repo).
- Web: Jobs view with scan, repair, and backfill actions behind the consent dialog; provenance excerpt viewer in session detail.
- Harnesses: Codex (`.codex/hooks.json`, `codex exec resume` for repair) and Cursor (`.cursor/hooks.json`, `followup_message` block, `user_email` as author, repair by extraction only); `workledger hook … --harness`, `init` and `doctor` cover all three.
- Proven end to end: a Claude Code session killed at its first tool call is marked crashed by `scan` and repaired by resume; three fixture sessions backfill and are skipped on re-run; a Codex session records a checkpoint from the block instruction.

## 0.1.0 — P2 Local UI (2026-09-09)

- `workledger serve`: local Hono server on loopback with a file watcher and server-sent events,
  serving the bundled web app (97 KB gzipped) from the same binary; REST per `docs/contracts/p2/api.md`.
- `workledger backlog accept|start|done|restore|discard|edit|assign|rank|merge|show|list` and
  `workledger note resolve`: every edit is a history entry by the git user; the server's POSTs call the
  same functions and produce byte-identical files.
- `packages/api-client`: the `LedgerSource` interface and `LocalServerSource` (isomorphic, SSE with
  backoff); `packages/tokens`: design tokens as the single source for the Tailwind preset.
- `apps/web`: Ledger (cards, filters, search, session detail with `[cp n]` provenance), Next (grouped
  backlog with inline edit, status actions, assign, priority, drag rank, merge, agent-proposed marker),
  Needs you (open blockers and questions with resolve), Health, keyboard help; hash routing, PWA, no
  external assets; mobile-first.
- End-to-end: Playwright over `serve` proves accept and rename from the UI land in the ledger and a
  second tab converges within 2 s.

## 0.0.1 — P1 CLI core (2026-09-09)

First working release, Claude Code only.

- `workledger init`: creates `.workledger/` and installs the three project-level hooks
  (`SessionStart`, `Stop`, `SessionEnd`) into `.claude/settings.json` additively, with a diff,
  a `.bak`, and a no-op when the binary is absent.
- `workledger hook`: exact session boundaries; the Stop hook asks the agent to checkpoint when
  2 MB of transcript, 20 minutes, or 15 turns have passed (block = exit 2 with the instruction),
  never twice for an ignored block, one retry for a rejected payload; `stop_hook_active` always
  allows; private sessions; fail-open on any error; allow path ~73 ms p95 including Node startup.
- `workledger checkpoint`: validates the agent's payload against the frozen contract, secret-scans
  it and the rendered text (40 linear-time patterns, findings never carry values), stamps
  provenance (`[cp n]`, transcript offset, cumulative turns), renders the session file and the
  backlog items, writes atomically, records failed attempts for the retry rule.
- `workledger brief`: deterministic session-start context (open backlog, last done, open blockers
  and questions) under a token cap; injected by `SessionStart`.
- `workledger doctor`: harness, store, hook, config, and index health.
- Ledger format frozen in `docs/contracts/p1/`; the zod schemas export it byte for byte.
- Published package is one bundled file with `better-sqlite3` as its only dependency.

Known limits: Claude Code only; no UI; no crash repair or backfill; `SessionEnd` in `claude -p`
mode reports `end_reason: unknown`.
