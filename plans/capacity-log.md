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

## Session 2 — 2026-09-09 (same conversation as S1, continued; P1 close through P5 ship)

**Stage 2 PM:** ACTIVE, orchestrator inline. Lean mode (Clause #12) from the operator's directive; Clause #13 (prototype mode) written into agentwaves but explicitly NOT applied here by the operator.

**Waves executed:** P1 Wave 1 slots 8–10 and 12, Wave 2, Wave 3 (tag), Wave 3.5 (three live sessions). P2 Wave 0 → 3 (tag). P3 Wave 0 → 3 (tag). P4 Wave 0 → 3 (tag). P5 Wave 0 → 3 (tag). P7 Wave 0 started.

**Build PRs merged:** 24 (#26 #27 #28 #29 #30 #42–#51 #60 #61 #65–#71). Direct commits for contracts, amendments, changelogs, version bumps, and two flaky-test fixes.

**Activities completed:** everything in CHANGELOG 0.0.1 → 0.3.0. Real end-to-end proofs: Claude runs the checkpoint from the block instruction; a killed session is scanned and repaired by resume; three fixture sessions backfill; a Codex session checkpoints; UI edits land in files and propagate over SSE.

**Issues filed:** P2 #31–#41, P3 #52–#57, P4 #58–#59, P5 #62–#64, P7 #72–#73 (all five-line, filed directly).

**Discipline holds:**
- T-D: never fired in S2 (no PR needed a third round).
- T-G: lean-mode anchors held within ~1.5× on most slots; first-of-class CLI slots ran 0.4–0.6M implementer tokens.
- T-X: worktree-per-PR with file fences; conflicts on shared files (`index.ts`, `config.ts`, `repair.ts`, `vitest.config.ts`) resolved by union on rebase, once by a builder round-trip.
- T-Y: two stragglers (#7, #39) closed by hand; one PR body clobbered via a shared `/tmp` path (rule added).
- Orchestrator errors recorded: removed a worktree from inside it (twice); reported a merge as done when `gh pr merge` had refused (once; tag moved, issue reopened, rule added: check PR state before tagging).
- HARD CONSTRAINT: every PR stated host verification.

**Calibration findings:**
- Lean mode cut per-slot cost roughly 3× versus S1's full trio: one reviewer, one fix-cycle, merge on green.
- Reviews still found a real defect on most PRs (PII, silent data loss, blank page, wrong id minter, orphaned grandchildren, acceptEdits bypass, key-leak paths); the protocol is correctness-first and the operator chose to keep it.
- Parallelism of 3–6 builds on disjoint packages worked; the serial chains were `checkpoint → hook → init` and `server GET → POST → UI`.
- Timing tests must be relative to a same-run baseline and have CI-specific ceilings; absolute budgets flake under load.
- Shared `/tmp` filenames between concurrent agents and in-worktree cwd for cleanup are the two recurring process defects; both are now rules in CLAUDE.md.

**S3 forecast:** P7 Wave 1 (~2 frontend PRs) once the operator supplies the Figma file and node ids; P6 (~3 PRs) only if un-deferred.

## Session 3 — 2026-09-09 (P8 Onboarding and home, Wave 0 → 2)

**Stage 2 PM:** ACTIVE, orchestrator inline. Lean mode (Clause #12); Clause #13 not in force.

**Waves executed:** P8 Wave 0 (spec, contract, tracking #75; amendments 1–4 as direct commits or inside PRs), Wave 0.5 (issues #76–#81 filed five-line; #85 #87 #88 #89 #94 filed for defects found in flight), Wave 1 (eight build PRs), Wave 2 (QA e2e #95 plus the integration fix #96). Wave 3 (tag) deferred to the operator's walkthrough.

**Build PRs merged:** 10 (#82 #83 #84 #86 #90 #91 #92 #93 #95 #96), plus 4 in the addendum below (#98 #102 #103 #104). Direct commits for the spec, the contract and its amendments 1–2, the roadmap, and the S3 handoff.

**Activities completed:** everything in the CHANGELOG Unreleased section: one daemon per machine (`workledger` = `open`, `stop`, `~/.workledger/serve.json`), multi-repo server with a `repo` parameter and aggregates, `/api/onboarding/*` and `workledger onboard`, Home with a repo switcher and machine-wide Needs you and Jobs, the onboarding wizard (projects, history, method, running, done), Codex sessions in onboarding, release workflow with npm publish dry-run and Homebrew tap, README install. Proven end to end by #95: a fresh HOME with two repos runs the wizard through backfill with a stub `claude`.

**Issues filed:** #75 (tracking), #76–#81, #85, #87, #88, #89, #94 (all five-line, filed directly). None open at close besides the tracking issues #72 and #75.

**Discipline holds:**
- T-A held: never tripped (≈2.12M implementer + ≈1.11M reviewer across the session).
- T-G held: every slot within ~1.5× of the S2 lean anchors; the two backend first-of-class slots (#83 daemon, #84 onboarding ops) ran 350–370k implementer and 160–260k reviewer.
- T-D held: three PRs needed one fix-cycle (#84, #90, #93); none needed a second.
- T-X held: worktree-per-PR on disjoint packages; #90 and #92 both touched onboarding ops and rebased cleanly.
- T-Y held: every PR closed its issue via `Closes #N`; #91 closed two.
- Orchestrator errors: none recorded. One orchestrator-requested fix on #90 before its review round.
- HARD CONSTRAINT: every PR stated host verification (Node ≥ 22 + pnpm ≥ 10); no Docker.

**Calibration findings:**
- Defects found by review or smoke, all fixed before merge: init accepted relative and non-git paths with no Origin check (#84); discovery treated a root with `.git` as a leaf and leaked temp-dir candidates (#87 → #90); non-TTY `onboard` initialized without consent (#90); the wizard's Add folder dropped the default roots and non-git candidates were tickable (#93); Home stale after init (#94 → #96). Four of five sit on the "never touch a repo the operator did not select" boundary, now a hard rule in `CLAUDE.md`.
- Reviewer cost on first-of-class backend slots (160–260k) approaches the implementer cost; on sibling and fix slots it is 85–175k. Orchestrator verification without a review round worked for the thin infra slot (#82) and a narrow frontend fix (#91) at ~90k each.
- The operator's walkthrough as the ship gate (spec §Acceptance) is a new pattern: the tag is not the last merge but the operator's verdict; defects become five-line issues in the same phase.
- Secrets are an operator dependency, not an agent one: the release workflow degrades cleanly without `NPM_TOKEN` and `TAP_TOKEN` and prints the manual commands.

**S4 forecast:** walkthrough verdict → version 0.4.0, CHANGELOG, tags `v0.4.0` and `p8-shipped`, close #75 (orchestrator direct, ~20k); defect fixes at ~230–310k per backend fix and ~90–430k per frontend fix depending on breadth; P7 Wave 1 (~2 frontend PRs, ~450k each) only if the Figma inputs exist. P6 stays deferred.

**S3 addendum — 2026-09-10 (after the operator's walkthrough, same conversation):**
- The walkthrough happened: the fresh-state wizard ran, but every backfill job failed. Four more lean PRs merged the same session, all backend, 0 fix-cycles: #98 (#97, headless checkpoint: `--payload` argv forms, 16 KB cap, instruction v3, scaled timeouts, job logs; 267k / 106k), #102 (#101, instruction caps line; 71k / 0, orchestrator-verified), #103 (#99, daemon SIGTERM shutdown and stop escalation; 138k / 99k), #104 (#100, usage-limit detection, machine-wide concurrency cap 2, automatic retry after the reset; 277k / 118k). Contract p8 amendments 5–6.
- Addendum totals: ≈0.75M implementer + ≈0.32M reviewer. Session totals now ≈2.87M implementer + ≈1.43M reviewer across 14 build PRs; 3 fix-cycles across 14 PRs. T-A, T-G, T-D all still held.
- Root causes, for the record: Claude Code's headless permission matcher denies a heredoc-fed stdin even for an allowed command (DL-18); the 4 KB payload cap and 300 s timeout were too small for 100-turn sessions; the second round of failures was the operator's Claude subscription usage limit ("resets 1am"), which the product now detects and waits out.
- Outcome: all five real backfill jobs on the operator's machine succeeded. P8 is built and proven on the operator's machine; the tag still waits for the operator's verdict.
- Calibration: the stub `claude` in the QA e2e (#95) could not surface any of these three defects (permission matcher, payload size, usage limit); only a real harness on a real transcript does. Backend fix slots after a walkthrough ran 70–280k implementer, 0–120k reviewer, 0 fix-cycles, within the S3 lean anchors.

**S3 addendum 2 — 2026-09-10 (workspace-root sessions and the All window, same conversation):**
- The operator asked for two things after the fixed backfill: sessions started from a workspace folder (`~/Projects/dome_workspace`, not a repo) must count for the card repos they touch, and the backfill window must go back without limit. Contract amendments 8 and 9 as direct commits; four more lean PRs merged: #106 (#105 part A, backend: attribution by touched paths with a streaming transcript scanner and a `transcript_touches` cache, sessions keyed by (harness, session id, repo), `checkpoint --repo`, `since: all`; 406k / 135k, 0 fix-cycles, one orchestrator-requested fix before the review round), #107 (#105 part B, backend+frontend: `init --workspace`, the workspace Stop hook resolving touched repos, `discover.workspaces`, the wizard's folder section and the All card; 387k / 175k, 0), #112 (#109, frontend: already-tracked repos selectable for backfill; 128k / 102k, 0), #111 (#110, backend: a transcript counts for a repo with a write or five references of which one is a path-tool input or a `cd`, cross-repo sessions need a write, workspaces regardless of git ancestors; 153k / 137k, 1 fix-cycle).
- Addendum 2 totals: ≈1.07M implementer + ≈0.55M reviewer. Session totals now ≈3.94M implementer + ≈1.98M reviewer across 18 build PRs; 4 fix-cycles across 18 PRs. T-G and T-D held on every slot; T-A's 3.5M line was passed inside the two operator-directed addenda (the session was reopened each time with a full budget), recorded here rather than claimed as held.
- Root cause, for the record: Claude Code stores a transcript under the slug of the directory the session was started in; the operator works from `~/Projects/dome_workspace` across card repos, so a card repo showed 0 transcripts and its live session loaded no hooks (DL-19).
- Incident, for the record: a worktree build migrated the operator's real index (a pre-rebase `0006_workspaces`), so main's `serve` failed with "table workspaces already exists"; repaired from a backup by dropping the table and resetting `schema_version` to 5; #108 filed for migration robustness; CLAUDE.md rule added (5c5c6f8): every agent run uses `WORKLEDGER_HOME=$(mktemp -d)/home`.
- Calibration: the two first-of-class slots (#106 transcript scanner and index rekey, #107 workspace hook and wizard) ran 390–410k implementer and 135–175k reviewer, above the S3 backend first-of-class anchor (350–370k) by ~10%; the rule fix (#111) took the only fix-cycle of the addenda. Attribution rules are the kind of change a real transcript disproves in minutes (the build session itself was attributed to a card repo by the first rule); read-only `onboard --json` proofs against the operator's own store, with a temp `WORKLEDGER_HOME`, caught it before merge.
- Outcome: P8 built, backfill proven, workspace-root attribution shipped; the tag still waits for the operator's verdict. Open P8 issues: #108 (migration robustness), #113 (live-session guard for backfill) — the next builds.

**S3 addendum 3 — 2026-09-10 (context repos and the human-gist ledger, same conversation):**
- The operator's direction after addendum 2: "It is almost immaterial in which dir the session is started except the fact that the session transcripts are stored there… the first task of an extraction job is to figure out what repo is this session about and where to file the workledger extract" (DL-20), plus six UX points — projects before non-repo folders on Home, no Open/All tabs, "I want a gist of things that were completed in this session not the full details! the full details are for other agents, the readable gists are for humans!", shorter and split remaining items, discovery notes are for agents, and a Memory section. Contract amendments 10, 11 and 12 as direct commits; five more lean PRs merged: #115 (#114, backend: a backfilled session is resumed in the directory its transcript was recorded in, `session-not-found` mapped to a clear error; 134k / 74k, 0 fix-cycles), #120 (#116, backend: sessions carry `startDir` and `contextRepos`, one content inference shared by discovery, backfill and the Stop hook, migration 0009, `about`/`startedIn` on the API; 109k / 103k, 0), #122 (#117, backend: `done[].detail`, `memory[]`, tighter caps, instruction v4 asking for human gists; 424k / 113k, 0 review fix-cycles plus one rebase), #123 (#119, frontend+backend: Home groups projects then folders with sessions, `GET /api/workspaces`, ledger without the Open/All tabs; 438k / 259k, 1 fix-cycle), #126 (#118, frontend+backend: session view gists with a detail drawer, notes split, Memory section, server projects detail and memory; 304k / 99k, 0).
- Addendum 3 totals: ≈1.41M implementer + ≈0.65M reviewer. Session totals now ≈5.35M implementer + ≈2.63M reviewer across 23 build PRs; 5 fix-cycles across 23 PRs. T-G held on every slot except #123 (frontend page-level anchor 430–530k; it ran 697k combined with its one fix-cycle); T-D held. T-A's 3.5M line was passed inside the operator-directed addenda, as in addendum 2 — recorded, not claimed as held.
- Issue hygiene: #121 was filed and closed as superseded by #120, and its PR #124 closed unmerged. Open P8 issues at close: #125 (one repair job per context repo), #113 (live-session guard for backfill), #108 (migration robustness) — the next builds.
- Incident, for the record: main was red for a while because two tests pinned this repo's live dogfood ledger contents; #120 and #122 repaired them to derive their expected values instead. Dogfooding means the fixture moves under the test — assert on shape, never on today's ledger text.
- Model switch, for the record: the orchestrator hit a Fable usage limit mid-session and the session resumed on Opus 5 (1M context); in-flight builds continued from their existing worktrees with no rework, so the switch cost no slot time. Token figures either side of the switch are from the same accounting.
- Calibration: the payload/instruction slot (#122, 424k) and the Home grouping slot (#123, 438k) both ran at first-of-class cost even though neither introduced a new subsystem — a schema plus prompt change and a UI regrouping that also moved an endpoint each behave like first-of-class. The two thin slots (#115, #120) ran 109–134k implementer with reviewer cost nearly matching the implementer's (74–103k), the pattern lean mode predicts for narrow backend fixes.
