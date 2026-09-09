# P1 — CLI core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: orchestrator-driven dispatch — see `.orchestrator/agents/orchestrator.md`. This project's "agentic worker" is a specialist agent dispatched per slot via the Agent tool, not a single human engineer. Each slot brief is self-contained for handoff. Steps use checkbox (`- [ ]`) syntax for orchestrator tracking.

**Goal:** A developer runs `workledger init` in a repo, works in Claude Code as usual, and the repo's `.workledger/` fills with checkpoint-bound session digests and a proposed backlog, with no UI.

**Architecture:** Pure-TypeScript `packages/core` (schema, validation, rendering, brief, secret scan) with all side effects in `packages/cli` (index, files, hook I/O, Claude Code adapter). Hooks fail open and stay under 100 ms on the allow path; the only model involved is the session's own agent, which runs `workledger checkpoint`.

**Tech Stack:** TypeScript 5.9, Node 22 LTS, pnpm 10 workspaces, zod, gray-matter, ulid, better-sqlite3, vitest with coverage, eslint. No Docker. Phase spec: `plans/feature-p1-cli-core.md`. Design: `docs/superpowers/specs/2026-09-09-workledger-design.md`.

**Issue numbers:** assigned at Wave 0.5 by the Infra and Backend agents from the dispatch list in the phase spec. Slot headings below carry the intended issue title; the orchestrator substitutes the filed number in each dispatch brief.

---

## File Structure

| Slot | File | Action | Purpose |
|---|---|---|---|
| 1 | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `eslint.config.js` | Create | Monorepo root |
| 1 | `packages/core/{package.json,tsconfig.json,src/index.ts}`, `packages/cli/{package.json,tsconfig.json,src/main.ts,bin/workledger}` | Create | Package skeletons; `npx workledger` resolves |
| 2 | `packages/core/src/schema.ts`, `scripts/export-json-schema.ts`, `docs/contracts/p1/*.schema.json` | Create | Contracts (zod truth, JSON Schema artifact) |
| 3 | `packages/core/src/ids.ts`, `packages/core/src/frontmatter.ts` | Create | ULIDs, `WL-` ids, frontmatter round trip |
| 4 | `packages/core/src/render/session.ts`, `packages/core/src/render/backlog.ts` | Create | Ledger rendering and history |
| 5 | `packages/core/src/secretscan.ts`, `packages/core/src/secretscan-patterns.ts` | Create | Secret detection |
| 6 | `packages/core/src/brief.ts`, `packages/core/src/tokens.ts` | Create | Deterministic brief with a token cap |
| 7 | `packages/cli/src/index/{db.ts,migrations/0001_init.sql,rebuild.ts}` | Create | Local SQLite index |
| 8 | `packages/cli/src/commands/checkpoint.ts`, `packages/cli/src/ledger-fs.ts` | Create | The validated write path |
| 9 | `packages/cli/src/adapters/{types.ts,claude-code.ts}`, `packages/cli/src/commands/hook.ts`, `packages/cli/src/instruction.ts` | Create | Hooks and the checkpoint instruction |
| 10 | `packages/cli/src/commands/{init.ts,doctor.ts}`, `packages/cli/src/settings-merge.ts`, `packages/cli/src/config.ts`, `packages/cli/src/commands/brief.ts` | Create | Onboarding and health |
| 11 | `.github/workflows/ci.yml`, `scripts/capture-fixtures.mjs`, `test/fixtures/**` | Create | CI and scrubbed fixtures |
| 12 | `.workledger/**`, `.claude/settings.json` (this repo), `README.md` | Create / Modify | Dogfood and docs |

Slots 2–6 are `packages/core` and disjoint by file; slots 7–10 are `packages/cli` and disjoint by file except `packages/cli/src/main.ts` (command registration), which each CLI slot appends one line to. T-X: serialize CLI slots or have slot 7 pre-create the command registry with stubs for 8–10.

---

## Slot 1 — Monorepo scaffold (Infra)

**Class:** thin-infra, orchestrator-territory-adjacent, first-of-class for this repo.

**Reviewer composition:** CR-only per Clause #6 thin-infra row.

**Anchor estimate:** bootstrap 40–80k slot total (no prior; record actuals in `velocity.json`).

**Files:**
- Create: root `package.json` (private, `packageManager: pnpm@10`), `pnpm-workspace.yaml` (`packages/*`, `apps/*`), `tsconfig.base.json` (strict, `moduleResolution: bundler`, ES2022), `vitest.workspace.ts`, `eslint.config.js`
- Create: `packages/core/package.json` (`type: module`, `exports`, no runtime deps beyond zod), `packages/core/src/index.ts`
- Create: `packages/cli/package.json` (`bin: { workledger: ./bin/workledger }`, deps: core, better-sqlite3, gray-matter, ulid, commander), `packages/cli/bin/workledger` (node shebang → `dist/main.js`), `packages/cli/src/main.ts` (commander program with `--version`)
- Test: `packages/core/test/smoke.test.ts`, `packages/cli/test/smoke.test.ts`

- [ ] **Step 1: Create the workspace and root config**
- [ ] **Step 2: Create both package skeletons with build (`tsc -b`) and a smoke test each**
- [ ] **Step 3: Verify `pnpm install && pnpm -r build && pnpm -r test` and `node packages/cli/bin/workledger --version` on the host**
- [ ] **Step 4: Verify `npx --yes ./packages/cli --version` resolves the bin**

---

## Slot 2 — Contracts: zod schemas and JSON Schema export (Backend)

**Class:** service-module first-of-class.

**Reviewer composition:** CR + SRE per Clause #6 first-of-class-by-no-auth-surface.

**Anchor estimate:** bootstrap 60–120k.

**Files:**
- Create: `packages/core/src/schema.ts` (CheckpointPayload, SessionFrontmatter, BacklogItem, Config, Actor, Checkpoint, NoteType enums; `verified` enum; `rel` enum)
- Create: `scripts/export-json-schema.ts` (zod → JSON Schema for the three payload/file contracts)
- Create: `docs/contracts/p1/{checkpoint-payload,session-frontmatter,backlog-item}.schema.json`
- Test: `packages/core/test/schema.test.ts` (valid fixtures pass; each rule in spec §4.4 has a failing case with the expected error path; size and item caps)

- [ ] **Step 1: Write failing tests from spec §4.4 rules**
- [ ] **Step 2: Implement schemas; keep error messages human-readable (they are printed to agents)**
- [ ] **Step 3: Export JSON Schema; commit the generated files; add a test that regeneration is a no-op**

---

## Slot 3 — Ids and frontmatter round trip (Backend)

**Class:** service-module sibling-shape to slot 2.

**Reviewer composition:** CR + SRE combined single-pass per Clause #6 sibling-cache-warm row.

**Anchor estimate:** bootstrap 40–80k.

**Files:**
- Create: `packages/core/src/ids.ts` (`newSessionId()`, `newBacklogId()` → `WL-` + ULID, monotonic within a process)
- Create: `packages/core/src/frontmatter.ts` (`parse(text) → { data, body }`, `stringify(data, body)`; preserves unknown fields and key order; `schema_version` required)
- Test: `packages/core/test/{ids,frontmatter}.test.ts`

- [ ] **Step 1: Tests: ULID shape, sortability, round trip with unknown keys and multiline bodies**
- [ ] **Step 2: Implement on `ulid` and `gray-matter`; no Node fs in this package**

---

## Slot 4 — Ledger rendering (Backend)

**Class:** service-module first-of-class (golden files).

**Reviewer composition:** CR + SRE.

**Anchor estimate:** bootstrap 80–140k.

**Files:**
- Create: `packages/core/src/render/session.ts` (`appendCheckpoint(sessionText, payload, stamp) → text`; Goal replace-or-set; Done/Remaining/Notes append with `[cp n]`; Remaining lines carry `→ WL-id (new|updates|closes)`)
- Create: `packages/core/src/render/backlog.ts` (`createItem`, `applyUpdate`, `close`, `edit` each returning new text plus a history entry; `done_by` on close)
- Test: `packages/core/test/render/*.test.ts` with golden files under `packages/core/test/golden/`

- [ ] **Step 1: Write golden inputs and expected outputs from spec §4.1 and §4.2 examples**
- [ ] **Step 2: Implement; render functions are pure (text in, text out)**
- [ ] **Step 3: Property test: append then parse yields the same checkpoint count and ids**

---

## Slot 5 — Secret scan (Backend)

**Class:** service-module first-of-class with credential-handling surface.

**Reviewer composition:** CR + SRE + Security (full trio) per Clause #6 credential-surface rule.

**Anchor estimate:** bootstrap 50–90k.

**Files:**
- Create: `packages/core/src/secretscan-patterns.ts` (vendored gitleaks-style regexes: AWS, GitHub, Slack, generic API key, private key blocks, JWT, Bearer; each with a name)
- Create: `packages/core/src/secretscan.ts` (`scan(value, path) → Finding[]` walking objects; findings carry `path` and `pattern`, never the matched text)
- Test: `packages/core/test/secretscan.test.ts` (planted secrets caught; commit hashes, ULIDs, and file paths not flagged)

- [ ] **Step 1: Tests with planted secrets and known false-positive shapes**
- [ ] **Step 2: Implement; assert in a test that no Finding ever contains the input substring**

---

## Slot 6 — Brief (Backend)

**Class:** service-module sibling-shape.

**Reviewer composition:** CR + SRE combined single-pass.

**Anchor estimate:** bootstrap 40–80k.

**Files:**
- Create: `packages/core/src/tokens.ts` (approximate token count: chars/4 with a documented margin; no tokenizer dependency)
- Create: `packages/core/src/brief.ts` (`buildBrief({ backlog, sessions, notes }, { maxTokens }) → string`; sections and drop order per spec §7; deterministic ordering by `rank`, then `updated`)
- Test: `packages/core/test/brief.test.ts` (byte-identical across runs; cap respected; drop order)

- [ ] **Step 1: Tests from spec §7**
- [ ] **Step 2: Implement**

---

## Slot 7 — Local index (Backend)

**Class:** service-module first-of-class (persistence).

**Reviewer composition:** CR + SRE.

**Anchor estimate:** bootstrap 60–110k.

**Files:**
- Create: `packages/cli/src/index/db.ts` (open `~/.workledger/index.sqlite`, WAL, migrations runner), `packages/cli/src/index/migrations/0001_init.sql` (tables from the phase spec), `packages/cli/src/index/rebuild.ts` (rebuild rows from a repo's `.workledger/sessions/`)
- Create: `packages/cli/src/main.ts` command registry stubs for `checkpoint`, `hook`, `init`, `doctor`, `brief` (T-X pre-extraction so slots 8–10 do not collide)
- Test: `packages/cli/test/index.test.ts` with a temp `HOME`

- [ ] **Step 1: Tests: migrate from empty, idempotent re-run, rebuild from three fixture sessions**
- [ ] **Step 2: Implement; all paths derive from `HOME`/`WORKLEDGER_HOME` so tests are hermetic**

---

## Slot 8 — `workledger checkpoint` (Backend)

**Class:** endpoint-chained-on-service-module first-of-class (consumes agent input, writes files).

**Reviewer composition:** CR + SRE + Security (full trio).

**Anchor estimate:** bootstrap 90–150k.

**Files:**
- Create: `packages/cli/src/ledger-fs.ts` (read/write session and backlog files atomically: write temp then rename; list open backlog ids)
- Create: `packages/cli/src/commands/checkpoint.ts` (resolve session from `WORKLEDGER_SESSION` or `--session`; read stdin; validate; scan; compute stamp from index and transcript size; render via core; write; update index; print ack; exit codes 0/1/3)
- Test: `packages/cli/test/checkpoint.test.ts` over `test/fixtures/payloads/*.json` (valid, each invalid class, planted secret) in a temp repo

- [ ] **Step 1: Tests first, including "unknown WL id lists the open ids on stderr"**
- [ ] **Step 2: Implement; the second secret scan runs on rendered text before write**
- [ ] **Step 3: Verify on the host by piping a fixture into the built CLI**

---

## Slot 9 — Claude Code adapter and `workledger hook` (Backend)

**Class:** endpoint-chained-on-service-module first-of-class with injection surface.

**Reviewer composition:** CR + SRE + Security (full trio).

**Anchor estimate:** bootstrap 100–160k.

**Files:**
- Create: `packages/cli/src/adapters/types.ts` (`HarnessAdapter`: `parseHookInput`, `denyStop(reason)`, `injectContext(text)`, `transcriptSize(path)`)
- Create: `packages/cli/src/adapters/claude-code.ts` (field names from `docs/contracts/p1/hooks-claude-code.md`)
- Create: `packages/cli/src/instruction.ts` (versioned checkpoint instruction text with the open-id list interpolated)
- Create: `packages/cli/src/commands/hook.ts` (SessionStart: create file + index row + set `WORKLEDGER_SESSION` via `additionalContext` note and index; Stop: thresholds and loop guard per the state machine; SessionEnd: close and `needs_repair`; fail-open wrapper; not-enabled-repo fast exit)
- Test: `packages/cli/test/hook.test.ts` (simulation over `test/fixtures/hooks/*.json`: allow, deny, never-twice, thresholds each, disabled env, non-enabled repo); `packages/cli/test/hook-timing.test.ts` (100 allow-path runs p95 < 100 ms)

- [ ] **Step 1: Tests from the phase spec's state machine, one case per transition**
- [ ] **Step 2: Implement; every exception path exits 0 with one stderr line**
- [ ] **Step 3: Verify on the host with a real Claude Code session in a temp repo: one checkpoint lands, the ack prints, `[cp 1]` offset is inside the transcript**

---

## Slot 10 — `init`, `doctor`, `brief` commands (Backend)

**Class:** endpoint-chained-on-service-module first-of-class (writes outside `.workledger/`).

**Reviewer composition:** CR + SRE + Security (full trio).

**Anchor estimate:** bootstrap 100–160k.

**Files:**
- Create: `packages/cli/src/config.ts` (load/merge `.workledger/config.yaml` with defaults; env overrides)
- Create: `packages/cli/src/settings-merge.ts` (additive merge of the hooks block into `.claude/settings.json`; diff; `.bak`; idempotent)
- Create: `packages/cli/src/commands/init.ts` (detect harness binaries and stores; list repos from `~/.claude/projects/*` metadata with counts and last activity; create `.workledger/`; write hooks; `--yes`)
- Create: `packages/cli/src/commands/doctor.ts`, `packages/cli/src/commands/brief.ts`
- Test: `packages/cli/test/{init,doctor,settings-merge}.test.ts` with temp `HOME` and temp repo; fixtures with an existing `settings.json` containing other hooks

- [ ] **Step 1: Tests: merge preserves foreign hooks; second `init` is a no-op; doctor exit codes**
- [ ] **Step 2: Implement; the diff is shown before any write unless `--yes`**
- [ ] **Step 3: Verify on the host by running `init` in a temp clone of this repo**

---

## Slot 11 — CI and fixture capture (Infra)

**Class:** CI-YAML thin-infra.

**Reviewer composition:** CR-only.

**Anchor estimate:** bootstrap 40–70k.

**Files:**
- Create: `.github/workflows/ci.yml` (Clause #9: path filters, concurrency cancel-in-progress, `pnpm install --frozen-lockfile`, lint, `tsc -b`, `vitest --coverage` with a 70% changed-lines gate)
- Create: `scripts/capture-fixtures.mjs` (copies N recent Claude Code transcripts and recorded hook payloads from this machine into `test/fixtures/`, redacting emails, tokens matching the secret patterns, and absolute home paths; keeps sizes)
- Create: `test/fixtures/{transcripts,hooks,payloads}/` initial set

- [ ] **Step 1: CI runs green on a no-op PR**
- [ ] **Step 2: Capture fixtures; verify the secret scan over the fixture directory reports zero findings**

---

## Slot 12 — Dogfood enablement (Backend, tail slot)

**Class:** tail-dispatch narrow-fix.

**Reviewer composition:** CR-only.

**Anchor estimate:** bootstrap 30–60k.

**Files:**
- Create: `.workledger/{config.yaml,README.md}` in this repo; hooks block in `.claude/settings.json`
- Modify: `README.md` (install and quick start)
- Manual (operator): run `workledger init` in `~/Projects/dome_workspace` (Dome identity repo; do not commit there from this session)

- [ ] **Step 1: Enable on this repo; record the first real checkpoint from a live session**
- [ ] **Step 2: Wave 3.5 dogfood pass: three real sessions here and three in dome_workspace; note payload quality findings as issues for P2**

---

## Wave 2 (QA) and Wave 3 (Docs)

QA agent: planning pass over acceptance criteria, then an end-to-end test that scripts a headless Claude Code session in a temp repo through init → checkpoint → session end and asserts the ledger files. Docs agent: `docs/contracts/p1/` finalized, `README.md`, and `CHANGELOG.md`; tag `p1-shipped`.

---

## Watchdogs

| Trigger | Threshold | Action |
|---|---|---|
| **T-A** (cumulative budget) | cum > 1.2M post-slot-N reviewers (bootstrap; no prior) | Defer remaining tails |
| **T-G** (slot anchor drift) | any slot >1.3× its bootstrap anchor | ADVISORY — orchestrator escalates; expect this to fire in P1 since anchors are guesses |
| **T-D** (fix-cycle) | second fix-cycle iteration on any slot | Stop after that slot's eventual clean merge |
| **T-X** (file overlap) | `packages/cli/src/main.ts` touched by slots 8–10 | Slot 7 pre-creates the registry with stubs |

---

## Stop conditions

Stop after slot N clean-merge + chore commit (capacity-log + velocity entries + wave-state update). Session 1 is expected to end after Wave 0 + Wave 0.5 + slots 1–2 at most.

---

## Self-review

- [x] **Spec coverage:** spec §3 (architecture) → slots 1, 7–9; §4 (data model, validation) → 2–4, 8; §5 (lifecycle) → 9; §7 (brief) → 6, 10; §10 (onboarding) → 10; §11 (security) → 5, 8, 10; §12 (errors) → 9; §13 (testing) → all slots and Wave 2; §14 (stack) → 1, 11. §6 (backfill), §8 (UI), §9 (team) are P3, P2, P5 by the roadmap.
- [x] **Placeholder scan:** no TBD/TODO/FIXME; issue numbers deliberately deferred to Wave 0.5.
- [x] **Type consistency:** `Stamp`, `CheckpointPayload`, `Finding`, `HarnessAdapter` named once and reused.
- [x] **Sibling-cache-warm chain:** core slots 2→3→4→6 share reviewers; 5 is isolated for Security; CLI slots 7→8→9→10 chain on the same package.
