# workledger

A local observer for coding-agent work. The agent that ran a session writes a short structured
digest at checkpoints (what was done, what remains, what it learned, what it needs from a human),
the ledger lives in the repo under `.workledger/`, and a small local UI is where humans review
sessions and edit what comes next. Everything carries provenance and is shared with a team through
git.

Status: P1 (CLI core) is functionally complete and dogfooding on this repo: `init`, `hook`, `checkpoint`, `brief`, `doctor` for Claude Code. UI (P2), recovery and backfill (P3), Cursor and Codex (P4) follow.

- Spec: `docs/superpowers/specs/2026-09-09-workledger-design.md`
- Decision log: `docs/decision-log.md`
- Discovery research (2026-09-06, superseded direction but valid evidence): `plans/`

## Install

Requires **Node ≥ 22**. The published package is a single bundled file whose only runtime
dependency is `better-sqlite3`. The npm package is named `workledger` and installs one binary,
`workledger`.

```bash
# npm
npm install -g workledger

# Homebrew (installs the GitHub release tarball under Homebrew's own node)
brew tap ManasHardas/workledger && brew install workledger

# or run it without installing
npx workledger --version
```

Then run `workledger` to open the home page.

Both this repo and the tap ([ManasHardas/homebrew-workledger](https://github.com/ManasHardas/homebrew-workledger))
are public, so no token is needed; if either is ever made private, set `HOMEBREW_GITHUB_API_TOKEN`
to a GitHub token that can read the release asset before `brew install`.

Releases: pushing a `v*` tag runs `.github/workflows/release.yml` — build, test, pack, `npm publish`
(skipped with a message when the `NPM_TOKEN` secret is absent), a GitHub release with the tarball
attached, and an update of the tap formula (skipped with the manual command printed when the
`TAP_TOKEN` secret is absent).

## Quick start

```bash
cd your-repo
npx workledger init          # creates .workledger/ and the three Claude Code hooks
claude                       # work as usual; every ~15 turns the hook asks the agent to checkpoint
workledger brief             # what the next session will be told
workledger doctor            # hooks, store, config, index health
```

What you get in the repo: `.workledger/sessions/<ulid>.md` (goal, done, remaining, notes per
checkpoint, with `[cp n]` provenance) and `.workledger/backlog/WL-<ulid>.md` (one file per proposed
or accepted item). Commit them. Nothing leaves the machine; every write is secret-scanned.

## Development

Requires Node ≥ 22 and pnpm ≥ 10 (this repo is developed on Node 25 + pnpm 11). No Docker.

```bash
pnpm install            # frozen in CI: pnpm install --frozen-lockfile
pnpm -r build           # tsc -b for types, then esbuild bundles the CLI into packages/cli/dist
pnpm test               # vitest, all packages
pnpm test:coverage      # vitest with the v8 coverage report in coverage/
pnpm lint               # eslint
pnpm contracts          # regenerate docs/contracts/p1/*.schema.json (must be a no-op)
```

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
