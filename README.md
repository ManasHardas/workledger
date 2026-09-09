# workledger

A local observer for coding-agent work. The agent that ran a session writes a short structured
digest at checkpoints (what was done, what remains, what it learned, what it needs from a human),
the ledger lives in the repo under `.workledger/`, and a small local UI is where humans review
sessions and edit what comes next. Everything carries provenance and is shared with a team through
git.

Status: P1 in progress — the CLI skeleton builds and publishes; the commands land next.

- Spec: `docs/superpowers/specs/2026-09-09-workledger-design.md`
- Decision log: `docs/decision-log.md`
- Discovery research (2026-09-06, superseded direction but valid evidence): `plans/`

## Install

Requires **Node ≥ 22**. Nothing else — the published package is a single bundled file with no
runtime dependencies.

```bash
# run it without installing
npx workledger --version

# or install it on your PATH (once published to npm)
pnpm add -g workledger
```

The npm package is named `workledger` and installs one binary, `workledger`.

## Development

Requires Node ≥ 22 and pnpm ≥ 10 (this repo is developed on Node 25 + pnpm 11). No Docker.

```bash
pnpm install            # frozen in CI: pnpm install --frozen-lockfile
pnpm -r build           # tsc -b for types, then esbuild bundles the CLI into packages/cli/dist
pnpm test               # vitest, all packages
pnpm test:coverage      # vitest with the v8 coverage report in coverage/
pnpm lint               # eslint
```

Repo tooling lives in `scripts/`, and every script answers `--help`:

| Script | What it does |
|---|---|
| `node scripts/coverage-gate.mjs` | Fails when < 70% of the lines this branch changed under `packages/**/src/**` are covered. Reads `coverage/lcov.info`, so run `pnpm test:coverage` first. Reports instead of failing on a push to `main`. |
| `node scripts/check-pack.mjs` | Packs `workledger` and asserts the tarball is exactly `bin/`, `dist/`, `package.json` (+ `README.md`/`LICENSE` when present) with no runtime dependencies. |
| `node scripts/capture-fixtures.mjs` | Copies the most recent Claude Code transcripts from `~/.claude/projects/` into `test/fixtures/`, scrubbing emails, home paths and secrets *before* writing, and synthesizes the `SessionStart` / `Stop` / `SessionEnd` hook payloads. |
| `node scripts/check-fixtures.mjs` | Re-scans `test/fixtures/` with the same patterns and fails on any finding. Runs in CI. |
| `node scripts/version.mjs 0.0.2` | Bumps `packages/core` and `packages/cli` in lockstep (also `pnpm run version 0.0.2`). |
| `node scripts/bundle-cli.mjs` | The esbuild step of the CLI build; inlines `@workledger/core` so the published package has no `workspace:*` dependency. |

CI (`.github/workflows/ci.yml`) runs lint, build, tests, the coverage gate and the fixture scan on
every PR and on pushes to `main`; the publish dry-run is PR-only and waits for the PR to leave
draft.
