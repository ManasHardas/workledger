# agentwaves stack map for workledger

The framework is vendored at `.orchestrator/` (see `.orchestrator/VENDORED.md` for the source
commit). Its role docs were written against a Python-API-plus-frontend project and use
placeholders; this file records how each resolves here, and the substitutions already applied.

## Substituted placeholders

| Placeholder | Resolves to | Note |
|---|---|---|
| `<api-routes-dir>` | `packages/server/src/routes/` | P2 onward; P1 has no HTTP surface |
| `<services-dir>` | `packages/core/src/` | Pure TypeScript domain: schema, validation, rendering, brief, secret scan |
| `<workers-dir>` | `packages/server/src/jobs/` | P3 onward: orphan scan, repair, backfill |
| `<models-file>` | `packages/core/src/schema.ts` | zod schemas; the ledger has no database models |
| `<config-file>` | `packages/cli/src/config.ts` | Reads `.workledger/config.yaml` and env |
| `<tests-dir>` | `packages/<pkg>/test/` | vitest; `<pkg>` is the package under change |
| `<test-fixtures-dir>` | `test/fixtures/` | Scrubbed real transcripts and hook payloads |
| `<frontend-app-dir>` | `apps/web/` | P2 onward |
| `<frontend-components-dir>` | `apps/web/src/components/` | shadcn/ui on `packages/tokens` |
| `<frontend-lib-dir>` | `apps/web/src/lib/` | |
| `<frontend-tests-dir>` | `apps/web/test/` | |
| `<migrations-versions-dir>` | `packages/server/src/index/migrations/` | SQLite index only; the ledger files carry a `schema_version` in frontmatter instead |
| `<api-codegen-output>` | `packages/api-client/src/generated/` | P2 onward; in P1 the generated artifact is the JSON Schema under `docs/contracts/p1/` |
| `<full-stack-up-command>` | `pnpm dev` | |
| `<runtime-version>` | Node ≥ 22 + pnpm ≥ 10 | |

## Role mapping

| agentwaves role | workledger scope |
|---|---|
| Backend | `packages/core`, `packages/cli`, `packages/server`, `packages/api-client`, harness adapters |
| Frontend | `apps/web`, `apps/card`, `packages/tokens` |
| Infra | monorepo scaffold, `pnpm` workspace config, CI workflows, npm packaging, `test/fixtures` capture scripts |
| QA | Wave 2 as written |
| Docs | Wave 3 as written; also `docs/contracts/` |
| PM, PM-Designer, Code Review, Security, SRE | as written |

## Clauses adapted

- **Clause #3 (test file in initial commit)**: test path is `packages/<pkg>/test/<scope>.test.ts`;
  the 70% gate is vitest coverage on changed files, wired by Infra in P1.
- **HARD CONSTRAINT (verification environment)**: this project has no Docker. The clause reduces to
  "verify on the host with Node ≥ 22 + pnpm ≥ 10 and state it in the PR". The docker prohibitions
  still apply if a container is ever introduced.
- **Clause #6 (reviewer trio)**: "auth pathway" here means anything that writes outside
  `.workledger/` (hook installation into `.claude/settings.json`), anything that injects text into
  an agent session, and anything that handles transcript content. Those take the full trio.
- **Clause #9 (CI hygiene)**: applies to `.github/workflows/*` in this repo only. The Dome card
  mirror's `release-build.yml` is owned by cards-ci and is out of scope.

## Unresolved placeholders

`<slug>`, `<role>`, `<sha>`, `<branch>`, `<issue>`, `<usage>`, `<threshold>`, `<pkg>` and similar
are per-dispatch values the orchestrator fills at dispatch time. They are intentionally left.

## Re-vendoring

```
rsync -a --exclude .git --exclude node_modules ../agentwaves/ .orchestrator/
# then re-run the sed block recorded in git history for this file's first commit
```
