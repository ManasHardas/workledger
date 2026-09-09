# Capacity log

> **Purpose:** session-by-session ledger. Each session's PM dispatches an entry at session-close summarizing what landed, calibration findings, watchdog outcomes, and S<N+1> forecast.

> **Convention:** newest sessions at the bottom. PM appends; orchestrator reads (along with `velocity.json`) at session-start to compute Bayesian-updated priors.

---

## Session 0 — 2026-09-06 to 2026-09-09 (design; no build dispatches)

**Stage 2 PM:** not dispatched (design session, not an orchestrator session).

**Wave executed:** Wave -1 (adversarial ideation, 9 agents, gate green) on 2026-09-06; design brainstorm and spec 2026-09-08 to 09-09 after the operator's pivot.

**Build PRs merged:** 0.

**Activities completed:**
- Ideation brief and research (`plans/ideation-workledger.md`, `plans/research/`).
- Design spec (`docs/superpowers/specs/2026-09-09-workledger-design.md`), decision log, roadmap.
- P1 phase spec and implementation plan; agentwaves vendored with placeholders substituted.
- Repo created and pushed to the personal remote.

**Issues filed:** 0 (Wave 0.5 is S1).

**Discipline holds:** not applicable (no dispatches).

**Calibration findings:**
- Wave -1 dispatch cost, for reference only (different dispatch shape from build slots): research agents 130–225k tokens each, red teams 93–232k, steel-man 190k, generative agents 135–145k, pivot architect 210k. Total for the gate roughly 1.6M. These are not class anchors.

**S1 forecast:** Wave 0 (orchestrator-direct) + PM-Designer sanity check (~40–70k) + Wave 0.5 with two planning agents (~70–130k each). Build slot 1 only if cumulative stays under 1.0M.

## Session 1 — 2026-09-09 (Wave 0 → Wave 0.5 → Wave 1)

**Stage 2 PM:** ACTIVE (the orchestrator performed the PM tick and close steps inline; no separate PM agent was dispatched).

**Wave executed:** Wave 0 (contract freeze PR #1 + PM-Designer sanity check), Wave 0.5 (Infra + Backend planning, 12 issues), Wave 1 slots 1–7 and 11.

**Build PRs merged:** 8 (#16 #17 #18 #19 #20 #21 #22 #23). Plus contract freeze #1, contract amendment #15, and amendment 2 as a direct commit.

**Activities completed:**
- Contracts: three JSON Schemas, CLI contract, Claude Code hook contract quoted from live docs, data-flow doc; two amendments (absent-CLI hook string, index columns, retry rule; x-body line forms, rebuild dedupe).
- `packages/core`: zod schemas with byte-identical JSON Schema export, ULIDs and frontmatter (browser-safe `yaml`), rendering with golden files and unparsed-line preservation, 40-pattern linear-time secret scanner with value-free findings and fail-closed walker, deterministic brief with a hard token cap.
- `packages/cli`: SQLite index with migrations shipped as data, rebuild with duplicate handling, async command registry (six commands), `better-sqlite3` as the sole runtime dependency, esbuild-bundled dependency-free `dist/main.js`.
- Infra: CI with path filters, concurrency, frozen lockfile, 70% changed-lines coverage gate, fixture scan, publish dry-run with pack file-list and consumer-install assertions; scrubbed fixtures (name-aware redaction).
- Tests: 552 passing at close; core lines ~99%.

**Issues filed:** 12 in Wave 0.5 (#3–#14) plus follow-up #25; #24 closed as duplicate.

**Discipline holds:**
- T-A held: never tripped (~6M total across the session against no fixed cap).
- T-G not held: fired on every slot; bootstrap anchors (40–160k) were 3–5× too low. Actuals recorded in `velocity.json` and digested in `next-session.md`.
- T-D fired: slot 5 (PR #20, secret scan) needed three review rounds (two fix-cycles: coverage gaps and key leak, then two regressions introduced by the fix). Session stopped after its clean merge and the other in-flight PRs landed.
- T-X held: command registry pre-created in slot 7; core exports appended at the end of `index.ts`; two parallel `packages/core` slots merged with trivial conflicts.
- T-Y: one straggler (#7) because PR #22's body was clobbered via a shared `/tmp` path; closed by hand; rule added to `CLAUDE.md`.
- Mid-session re-consults: 0 (the operator said "we have capacity"; no budget questions asked).
- HARD CONSTRAINT: 8 of 8 PRs stated host verification; no Docker exists.

**Calibration findings:**
- Fix-cycles are the dominant cost: 6 of 8 PRs needed a second round; implementer tokens roughly double per fix-cycle. Reviews are thorough and find real defects (contract regressions, PII in fixtures, silent data loss, entropy-gate false positives, rebuild aborts), so the rounds are buying correctness, not ceremony.
- The full trio on a credential-surface module cost ~1.1M for one slot; budget the three remaining CLI slots (all full trio) at ~1M each.
- Combined CR+SRE single-pass on sibling-shape slots cost ~100k per review round and found the same defect classes as separate reviewers; keep using it for sibling shapes.
- Parallelism worked at 2–4 concurrent builds with disjoint files; the only conflicts were `index.ts` export appends and root config files, all resolved by union.
- Import-cost measurements from three reviews converge: bare Node ~42 ms, `--version` ~53 ms, core barrel ~32 ms, index open ~10 ms; the hook slot has ~20 ms of headroom and must lazy-load everything.
- Two process defects found and encoded: shared `/tmp` scratch paths between concurrent agents; removing a worktree from inside it (orchestrator error, twice).

**S2 forecast:** #11 (~1M) + #25 (~300k) in parallel, then #12 (~1.2M), then #13 (~1M) if T-A (3.5M) holds; #14 and Wave 2 likely S3.
