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
- Sessions started from a workspace folder count for the repos they touch (#105 → #106): a transcript is attributed to every tracked or candidate repo with at least one write under its root or at least five references to it, not only to the directory the session was started in (Claude Code files the transcript under that directory's slug, so a repo worked on from `~/Projects/<workspace>` showed 0 transcripts). A streaming scanner reads tool inputs (`file_path`/`path`/`notebook_path`, Bash text with `cd` tracking, Codex `exec`/`shell`/`apply_patch`) and caches the tally per transcript in the index; sessions are keyed by (harness, session id, repo), `discover` reports `startedIn` and `touchedSessions`, backfill queues one job per (session, repo) and the resume names the target root; `workledger checkpoint --repo <path>` writes into that repo's ledger from any cwd. `since: all` in history (a fourth window), plan, run, `onboard --since all` and `backfill --since all` select every transcript regardless of age (#106).
- `workledger init --workspace <dir>` installs the three hook files into a non-git folder that holds tracked repos (no `.workledger/` there); a session started in that folder opens a workspace row at `SessionStart`, and its `Stop` hook scans the transcript since the last checkpoint and blocks with one `workledger checkpoint --session <ulid> --repo <root> --payload '…'` per touched repo, most-referenced first; `SessionEnd` closes every row. `discover` lists such folders as `workspaces` with `hooksInstalled`, `init` accepts `workspaces`, `onboard --workspaces`, and `doctor` reports each workspace's hook files. The wizard's projects step shows "Sessions were also started from these folders" with a pre-checked box per folder once a repo under it is selected, and the history step has a fifth card, All history (#105 → #107).
- The wizard lets an already-tracked repo be ticked for backfill: its badge stays, `init` never receives it (hook files untouched, the summary says "already tracked · Hooks unchanged"), and a tracked-only selection goes straight to the history step (#109 → #112).
- Attribution rule tightened (#110 → #111): a transcript counts for a repo with at least one write under the root, or at least five references of which one is a non-Bash path-tool input (Read/Edit/Write/Glob/Grep/NotebookEdit) or a Bash `cd` into the root; Bash text mentions alone never attribute. A session started inside repo X counts for a different repo Y only with a write under Y. A workspace folder is any session start directory with no `.git` of its own that holds a tracked or found repo, whatever its git ancestors hold (so `~/Projects/dome_workspace` under a `~/Projects` repo is one). The touch cache is rebuilt once (migration 0008) and workspace sessions rescan at the next Stop.
- A backfilled session is resumed in the directory its transcript was recorded in, not in the repo the checkpoint is filed against, so `claude --resume` finds it; a resume that still cannot find the session reports `session-not-found` instead of a raw harness error (#114 → #115).
- Every session carries a `startDir` (where the transcript lives and where a resume runs) and `contextRepos` (the repos the session is actually about, inferred from its content); the start directory's repo is only a fallback and a tiebreak. Discovery, backfill, and the live Stop hook all call the same inference, so a session started from a workspace folder, a sibling repo, or `~` files its extract in the right ledger; `discover` reports `startedIn` and the API reports what a session is `about` (migration 0009; amendment 10) (#116 → #120).
- Checkpoints separate the human summary from the agent evidence (#117 → #122): each `done` item is a short human gist with the full account in `done[].detail`, a `memory[]` section records durable facts about the project, per-field caps are tighter, and instruction v4 asks the session's agent for gists in the operator's words — "the full details are for other agents, the readable gists are for humans".
- Home groups tracked projects first and then the folders that sessions were started from, with each folder's sessions attributed to the projects they touched (`GET /api/workspaces`); the Ledger drops the Open/All tabs and shows one list (#119 → #123).
- Session view leads with the gists: each done item is one line, its detail, files, and commit open in a side drawer on demand, discovery notes are separated from the human-facing notes as agent-facing, and a Memory section shows the facts the session recorded (#118 → #126).

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
