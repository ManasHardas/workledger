# workledger

A local observer for coding-agent work. At checkpoints, the agent that ran a session writes a short
structured digest: what was done, what remains, what it learned, and what it needs from a human.
The ledger lives in each repo under `.workledger/` and is shared with a team through git. One local
app shows every project on the machine: what each session did, and what is waiting on a person.

Supported harnesses: **Claude Code**, **Codex** and **Cursor**.

## Status

| Phase | What it is | State |
|---|---|---|
| P1 CLI core | `init`, `hook`, `checkpoint`, `brief`, `doctor`, the ledger format and the local index | shipped (`p1-shipped`) |
| P2 Local UI | local server, web app, backlog and note editing | shipped (`p2-shipped`) |
| P3 Recovery and backfill | orphan `scan`, `repair` by resume or extraction, `backfill`, the job queue | shipped (`p3-shipped`) |
| P4 More harnesses | Codex and Cursor adapters | shipped (`p4-shipped`) |
| P5 Team | `auto_commit`, private sessions and paths, `identities.yaml`, teammate onboarding | shipped (`p5-shipped`, v0.3.0) |
| P8 Onboarding and home | one daemon per machine, Home over every project, the onboarding wizard, install path | built on main, not yet tagged |
| P9 Screens | the app rebuilt from the Figma designs | on main |
| P6 Dome card | a card target for the ledger | deferred |

This repo dogfoods itself: every session that works on workledger records its checkpoints in
`.workledger/` here.

## Install

Requires **Node ≥ 22**.

**From source (works today).**

```bash
git clone https://github.com/ManasHardas/workledger.git
cd workledger
pnpm install && pnpm build          # pnpm ≥ 10
ln -s "$PWD/packages/cli/bin/workledger" ~/.local/bin/workledger   # or anywhere on your PATH
```

**npm and Homebrew arrive with the first release.** The package is not published yet. Pushing a
`v*` tag runs `.github/workflows/release.yml`, which builds, tests and packs the CLI, publishes it
to npm, attaches the tarball to a GitHub release, and updates the Homebrew tap. The npm and tap
steps are skipped, with the manual command printed, when the `NPM_TOKEN` or `TAP_TOKEN` secret is
absent. Once released:

```bash
npm install -g workledger
# or
brew tap ManasHardas/workledger && brew install workledger
```

The published package is one bundled file whose only runtime dependency is `better-sqlite3`.

## Quick start

```bash
workledger          # starts the local app on http://127.0.0.1:7419 and opens it
```

The first time, with no project tracked, the app opens **Add projects**, a wizard that:

1. **Projects:** finds the repos your agents have worked in, plus other git repos under
   `~/Projects`. You tick the ones to track. `init` never touches a repo you did not select.
2. **History:** asks how far back to go: 7, 30 or 90 days, all of it, or none.
3. **Method:** asks how to digest past sessions. The default resumes each one headlessly and asks
   the agent for its digest. Extraction from the transcript is shown with its cost estimate and can
   be declined.
4. **Running:** runs the backfill with live progress while the rest of the app stays usable.
5. **Done:** summarises what happened per repo.

Then work as usual. The installed hooks ask the agent to record a checkpoint as the session grows
and when it stops; the agent runs `workledger checkpoint`, which validates and secret-scans the
payload before writing it. `workledger stop` stops the local app.

Per repo, from the terminal instead:

```bash
cd your-repo
workledger init      # creates .workledger/ and the harness hook files
workledger brief     # what the next session will be told
workledger doctor    # hooks, harness stores, config and index health
```

## The app

The screens follow the Figma designs in `docs/design/` (see `direction.md` and `figma.md`). The app
is one centred block: the nav on the left, the page in the middle and a details column on the
right. On a window wider than 1440 px it gains equal margins on both sides.

- **Home** — every project on the machine:
  - a flag when a tracked folder is really the parent of other projects
  - *Active this week*: sessions, open items and what needs you, per project
  - *Quiet*: projects with no sessions this week
  - the selected project's last activity, week and waiting items, and a "copy brief" button
  - below: the recovery queue and the folders sessions were started from
- **Ledger** — one project's sessions by day, each led by its goal, with status, span, checkpoint
  count, outcomes and what was left open. Search plus author, harness, status and date filters.
  The selected session's recap sits beside the list.
- **Sessions** — one session:
  - the goal
  - *What happened*: outcomes grouped by commit and checkpoint, never invented
  - *Left open*
  - notes and memory
  - the provenance column: every checkpoint's time, commit, turns and transcript byte span, with
    the transcript excerpt on demand. Opening an outcome shows its detail, files, commit and
    verification.
- **Review** — everything waiting on a person:
  - tabs: All, Blockers, Questions, Proposals, Decisions, Discoveries, each with a count
  - a project filter
  - answer a blocker or question in place; it is recorded as a decision note on its session
  - accept or discard what an agent proposed, and manage the rest of the backlog: rank, edit,
    assign, merge
- **Jobs** — repairs, backfills and extractions, colour-coded by status (queued amber, running
  green with a pulse, done green, failed red, cancelled grey), with In flight / Done / Failed /
  Cancelled tabs. Scan and backfill from a project's Jobs page; retry or cancel any job.
- **Health** — per harness: binary, version, store, last hook. Also index size and config problems.
- **Add projects** — the onboarding wizard, from the foot of the nav.

Keyboard: `j`/`k` move, `Enter` opens or answers, `a` accept, `x` discard (press twice), `e` edit,
`alt+↑/↓` re-rank, `/` search, `?` shows every shortcut. The app is hash-routed, works at 375 px,
bundles its fonts and fetches nothing from the network.

## What is in the repo

- `.workledger/sessions/<ulid>.md` — one file per session. The frontmatter has the harness,
  author, status, the repos it is about, and a timestamp, turn count, transcript offset and trigger
  per checkpoint. The body has Goal, Done, Remaining, Notes and Memory, and every line carries its
  `[cp n]` marker.
- `.workledger/backlog/WL-<ulid>.md` — one file per proposed or accepted item, with its provenance
  and edit history.
- `.workledger/config.yaml` — harnesses, checkpoint thresholds (bytes, minutes, turns), the brief's
  token budget, `orphan_minutes`, `auto_commit`, `private_paths`.
- `.workledger/identities.yaml` (optional) — maps author emails to display names.

Commit them. The index in `~/.workledger/` is only a cache and can be rebuilt with `workledger index
rebuild`. Transcripts never enter the repo; excerpts are read from the local machine on demand.

## Commands

| Command | What it does |
|---|---|
| `workledger` / `workledger open [--port n] [--no-browser]` | Start the local app (port 7419, else a free one), or reuse the running one, and open it |
| `workledger stop` | Stop the local app |
| `workledger onboard` | The wizard from the terminal: `--roots`, `--select`, `--since 7d\|30d\|90d\|all\|none`, `--method resume\|extract\|none`, `--json` |
| `workledger init` | Enable one repo; `--teammate` for a clone that already carries the hooks, `--workspace <dir>` for a non-git folder that holds tracked repos, `--harness` to force a hook file |
| `workledger checkpoint` | Record a checkpoint from `--payload '<json>'`, `--payload-file` or stdin; `--repo` targets another repo's ledger, `--dry-run` validates only |
| `workledger brief` | Print the brief a new session starts with (`--max-tokens`) |
| `workledger doctor` | Harness, hook, index and version health (`--json`) |
| `workledger scan` | Mark sessions whose harness died as crashed and queue their repairs |
| `workledger repair <ulid>` | Record a crashed session's missing digest by resuming it, or `--extract` from the transcript |
| `workledger backfill` | Digest sessions from before install (`--since`, `--dry-run`, `--extract-fallback`) |
| `workledger jobs` | List, `--cancel` or `--retry` jobs |
| `workledger backlog …` | `accept`, `start`, `done`, `discard`, `restore`, `edit`, `assign`, `rank`, `merge`, `show`, `list` |
| `workledger note resolve` | Answer a blocker or question with a decision note |
| `workledger serve` | Serve the app in the foreground (`--repo` for single-repo debugging) |
| `workledger index rebuild` | Rebuild the local index from every enabled repo's ledger |

Every command answers `--help`.

## Documentation

- Design spec: `docs/superpowers/specs/2026-09-09-workledger-design.md`
- Decision log: `docs/decision-log.md`
- API and CLI contracts: `docs/contracts/`
- Design direction and the Figma files: `docs/design/direction.md`, `docs/design/figma.md`
- Phases and plans: `plans/roadmap.md`, `plans/feature-*.md`
- Release notes: `CHANGELOG.md`

## Development

Requires Node ≥ 22 and pnpm ≥ 10 (this repo is developed on Node 25 + pnpm 11). No Docker.

```bash
pnpm install            # frozen in CI: pnpm install --frozen-lockfile
pnpm build              # the web app, then tsc -b and the esbuild CLI bundle (web assets included)
pnpm test               # vitest, all packages
pnpm test:coverage      # vitest with the v8 coverage report in coverage/
pnpm lint               # eslint
pnpm contracts          # regenerate docs/contracts/p1/*.schema.json (must be a no-op)
pnpm -F web dev         # the web app on the fixture ledger; VITE_API_BASE=<url> reads a running server
pnpm -F web test:e2e    # Playwright against a real server
```

Tests and local drives must use a throwaway home, `WORKLEDGER_HOME=$(mktemp -d)/home`, never your
real `~/.workledger`.

Layout:

| Path | What it holds |
|---|---|
| `packages/core` | The ledger schema, validation, rendering, the brief and the secret scan. Pure TypeScript: no Node APIs, no filesystem |
| `packages/cli` | The `workledger` binary, harness adapters, hooks, jobs, and the bundled server and web assets |
| `packages/server` | The local HTTP API, SSE and the index |
| `packages/api-client` | The `LedgerSource` contract the web app reads through |
| `packages/tokens` | Design tokens synced from Figma (`scripts/from-figma.mjs`), generating the CSS variables and the Tailwind preset |
| `apps/web` | The React app |

Repo tooling lives in `scripts/`, and every script answers `--help`:

| Script | What it does |
|---|---|
| `node scripts/coverage-gate.mjs` | Fails when < 70% of the lines this branch changed under `packages/**/src/**` are covered. Reads `coverage/lcov.info`, so run `pnpm test:coverage` first. Reports instead of failing on a push to `main`. |
| `node scripts/check-pack.mjs` | Packs `workledger` and asserts the tarball is exactly `bin/workledger`, `dist/main.js`, `package.json`, `README.md`, and that the declared runtime dependencies match `EXPECTED_RUNTIME_DEPS`. |
| `node scripts/capture-fixtures.mjs` | Copies the most recent Claude Code transcripts from `~/.claude/projects/` into `test/fixtures/`, scrubbing emails, home paths and secrets *before* writing, and synthesizes the `SessionStart` / `Stop` / `SessionEnd` hook payloads. |
| `node scripts/check-fixtures.mjs` | Re-scans every `test/fixtures` directory in the repo (discovered from `git ls-files`) with the same patterns and fails on any finding. Runs in CI. |
| `node scripts/version.mjs 0.0.2` | Bumps `packages/core` and `packages/cli` in lockstep (also `pnpm version:bump 0.0.2` — not `version`, which collides with npm's lifecycle hook). |
| `node scripts/bundle-cli.mjs` | The esbuild step of the CLI build; inlines `@workledger/core` so the published package has no `workspace:*` dependency. |

CI (`.github/workflows/ci.yml`) runs lint, build, tests, the coverage gate and the fixture scan on
every PR and on pushes to `main`; the publish dry-run is PR-only and waits for the PR to leave
draft.
