# agentwaves

A discipline framework for orchestrating **dispatched specialist agents** through **wave-cadence** phases in Claude Code (or any agent harness with a comparable dispatch primitive).

agentwaves answers a different question from most Claude Code skill collections: **how do you keep multi-agent dispatch coherent across a multi-month, multi-phase, multi-session production roadmap?** It models the *lifecycle* — phases, waves, session handoffs, budget watchdogs, calibration — not just a single feature workflow.

---

## The wave cadence

```
Wave -1   — Adversarial ideation         (greenfield only — once per project)
Wave 0    — Contract Freeze              (orchestrator alone)
Wave 0.5  — Issue Planning               (Backend + Frontend + Infra in parallel)
Wave 1    — Build (loop)                 (specialist agents per filed issue)
Wave 2    — QA                           (QA agent: planning pass + build loop)
Wave 3    — Phase close                  (Docs agent + tag + roadmap update)
Wave 3.5  — Dogfood pass                 (real-data end-to-end exercise)
```

Wave 0 + Wave 0.5 produce the **filed-issue ready-set** that drives Wave 1 build dispatch. The orchestrator never synthesizes dispatch briefs from memory; every Wave 1 dispatch references a filed GitHub issue. This is the discipline-failure mode the framework most aggressively defends against.

Wave -1 runs once, on greenfield projects only, and hard-gates Wave 0. Everything from Wave 0 onward optimizes for building the *specified* thing correctly — nothing downstream asks whether it is worth building, which makes a well-run protocol perfectly capable of shipping the wrong product for eight phases. See [Clause #11](dispatch-templates/clause-11-adversarial-ideation.md).

Full operating manual: [`agents/orchestrator.md`](agents/orchestrator.md).

---

## What's in the box

| Path | What it contains |
|---|---|
| [`agents/`](agents/) | 11 specialist role docs: orchestrator, PM, PM-Designer, Code Review, Security, SRE, Backend, Frontend, Infra, QA, Docs |
| [`dispatch-templates/`](dispatch-templates/README.md) | Permanent + conditional dispatch-brief clauses (test-file-in-initial-commit, reviewer-trio composition, verification environment, close-keyword convention, CI-quota-constrained mode) |
| [`templates/`](templates/) | Starter files for `wave-state.md`, `capacity-log.md`, `velocity.json`, `phase-spec.md`, `next-session.md` (SHD), `runbook.md`, `ideation-brief.md` |
| [`scripts/`](scripts/README.md) | Session-start checklist printer, session-close checklist printer, the session-close guardrails enforcement script (17 invariants), and the Wave -1 ideation gate |
| [`CLAUDE.md.snippet`](CLAUDE.md.snippet) | Paste into your project's `CLAUDE.md` to auto-load operating-mode rules into every conversation |

### Key sub-documents

- [Clause #11 — Adversarial ideation gate](dispatch-templates/clause-11-adversarial-ideation.md) — Wave -1; ask before assuming, research before assuming, show data don't tell, argue both sides, name kill criteria, and search the space rather than only the specification. Hard-gates Wave 0 on greenfield projects
- [Session Handoff Document protocol](agents/pm.md#session-handoff-document-shd-protocol--plansnext-sessionmd) — cross-session memory in one file; ~65-95k saved per session-start
- [Operating modes: ACTIVE vs DEGRADED](agents/orchestrator.md#session-start-ritual-permanent-clause) — when full PM discipline is required vs. when PM-skip is safe
- [Coordination watchdogs T-M / T-X / T-Y](agents/pm.md#coordination-watchdogs-t-m--t-x--t-y) — module-drift / parallel-lane-overlap / post-merge-issue-closure
- [Budget watchdogs T-A / T-G / T-D](agents/pm.md#budget-watchdogs-t-a--t-g--t-d) — cumulative-budget / slot-anchor-drift / fix-cycle-stop
- [Environment variables](#environment-variables) — `AW_*` for protocol-wide knobs, `GUARDRAIL_*` for guardrails-script knobs

---

## How agentwaves compares

agentwaves sits in a different layer from the other major Claude Code frameworks. They're not mutually exclusive — agentwaves coexists with Superpowers (e.g. using `superpowers:brainstorming` for pre-Wave-0 ideation) and is orthogonal to GSD's context-engineering and gstack's role-governance.

| Dimension | **agentwaves** | **[Superpowers](https://github.com/obra/superpowers)** | **[GSD (Get Shit Done)](https://github.com/gsd-build/get-shit-done)** | **[gstack](https://github.com/gstack-build)** |
|---|---|---|---|---|
| **What it constrains** | Dispatch sequencing of specialist agents through phase-cadence waves | The development process within a feature (mandatory phase gates) | The execution environment (fresh context per task) | Decision-making perspective (which role you're acting as) |
| **Primary problem solved** | Coherence of multi-agent dispatch across a multi-session, multi-phase roadmap | Lack of methodology / ad-hoc development | Context-window degradation ("context rot") on large work | Unclear decision authority for solo founder-engineers |
| **Core abstraction** | Phase + wave + filed-issue + specialist-agent dispatch | Composable skills with mandatory triggers | Atomic tasks each receiving a fresh 200k context | Role-bound slash commands (CEO, EM, designer, QA, …) |
| **Workflow shape** | Wave 0 → 0.5 → 1 → 2 → 3 → 3.5, per phase, per session | Brainstorm → Spec → Plan → TDD → Subagent Dev → Review → Finalize | Plan → Execute (parallel waves) → Verify → Ship | Think → Plan → Build → Review → Ship |
| **Multi-agent dispatch model** | 11 named specialist roles with explicit scope fences; orchestrator-led with parallel-within-wave + sequential-across-waves | Subagent-driven-development skill; agents invoked per phase | Atomic tasks dispatched to fresh subagents | Role-skills invoked sequentially; no parallel dispatch primitive |
| **Cross-session state** | `wave-state.md` (authoritative) + `next-session.md` (SHD cache) + `velocity.json` + `capacity-log.md` | None built-in; per-session | `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `CONTEXT.md`, `.planning/config.json` | None built-in; relies on git + role-output chaining |
| **Budget / token discipline** | T-A/T-G/T-D budget watchdogs + T-M/T-X/T-Y coordination watchdogs + per-class velocity model with Bayesian update | None (process-focused, not budget-focused) | Avoids the problem structurally via fresh contexts | None explicit |
| **Quality gates** | Dispatch-template clauses: test-file-in-initial-commit, reviewer-trio composition (5 default-keep / default-prune rules), verification environment HARD CONSTRAINT, close-keyword convention | Mandatory TDD (RED-GREEN-REFACTOR; deletes code written before tests) | Manual verify phase | `/review` and `/ship` skills at end of pipeline |
| **Session-close enforcement** | `scripts/check-session-close-guardrails.sh` — 17 invariants enforced as BLOCKER (exit 1) or WARN (exit 2) | n/a | n/a | n/a |
| **Operating modes** | ACTIVE (full PM discipline) vs DEGRADED (PM-skip; allowed only when ALL narrow-fix conditions hold) | n/a | n/a | n/a |
| **Calibration** | `velocity.json` per-class observations → Bayesian update of priors over time | n/a | n/a | n/a |
| **Project lifecycle target** | Multi-month, multi-phase production roadmap (8+ phases, 50+ PRs typical) | Single feature / single bugfix | Single complex project that exceeds one context window | Solo founder-engineer wearing multiple hats |
| **Installation** | Copy/submodule the repo into your project; paste `CLAUDE.md.snippet` | `/plugin install superpowers@claude-plugins-official` | `npx get-shit-done-cc@latest` | Slash-command skills installed individually |
| **Composability with the others** | Coexists with Superpowers (use its brainstorming/TDD skills inside Wave 1); orthogonal to GSD/gstack | Composable; agentwaves uses it for pre-Wave-0 ideation | Composable | Composable |
| **What it deliberately is NOT** | A code generator; a within-session methodology; a single-implementer pattern | A multi-session roadmap framework; a budget tracker | A multi-agent dispatch system | A multi-session roadmap framework |

**Short version:** Superpowers gives you discipline *within* a feature. GSD gives you clean *context* per atomic task. gstack gives you a *role* to think from. agentwaves gives you the *dispatch + lifecycle scaffolding* to coordinate many specialist agents across many sessions toward a shipped product.

If you're solo and shipping a single feature, Superpowers is the right tool. If your project keeps blowing through context windows, GSD is the right tool. If you're a founder doing both eng and product, gstack is the right tool. If you're running a multi-phase roadmap with parallel specialist-agent dispatch and you need cross-session memory + budget discipline + reviewer-trio calibration, that's what agentwaves was extracted to solve.

---

## Adoption

Three steps:

1. **Clone or submodule** the repo into your project as `.orchestrator/` (or any path you prefer).
2. **Customize placeholders** in `agents/*.md` for your stack (search for `<api-routes-dir>`, `<frontend-app-dir>`, `<migrations-versions-dir>`, etc.).
3. **Paste [`CLAUDE.md.snippet`](CLAUDE.md.snippet)** into your project's `CLAUDE.md` to auto-load operating-mode rules into every Claude Code session.

Then in a fresh Claude Code conversation in your project's directory:

> Read `.orchestrator/agents/orchestrator.md`. We're starting Phase 1 of `<project>`. I'll be the user; you're the Orchestrator. Run the Session-start ritual.

---

## Environment variables

| Variable | Prefix | Default | Effect |
|---|---|---|---|
| `AW_CI_QUOTA_CONSTRAINED` | `AW_*` (protocol-wide) | unset | When `1`, activates the [CI-quota-constrained mode](dispatch-templates/ci-quota-constrained-mode.md) (skip-CI-on-every-commit + admin-merge + label-gate expensive jobs). **Reactive recovery; rarely needed if [Clause #9 — CI workflow hygiene](dispatch-templates/clause-9-ci-workflow-hygiene.md) is applied to every workflow as the mandatory prevention.** |
| `GUARDRAIL_CC_SESSION_GATE` | `GUARDRAIL_*` (guardrails-script) | `99999` (off) | Minimum session number from which the `cc_session_id` invariant is enforced |
| `GUARDRAIL_MAIN_CI_GATE` | `GUARDRAIL_*` (guardrails-script) | `99999` (off / WARN-only) | Minimum session number from which check #18 (main CI green at session-close) escalates from WARN to BLOCKER. The check fetches `origin/main`'s check-runs via `gh api`; sub-10s failures are auto-classified as INFO (likely billing-block, not a real red) |

`AW_*` is for cross-protocol knobs; `GUARDRAIL_*` is for guardrails-script-specific gates. Add new knobs to whichever scope they belong to.

---

## Provenance

agentwaves was extracted from a real production project that ran enough phases, sessions, and PRs through the wave-cadence pattern for the failure modes to surface, retrospect, and harden into rules.

What that looks like in concrete terms:

- The **operating-mode rule** (ACTIVE vs DEGRADED) exists because PM-skip was wrongly applied to a session introducing new contract surfaces; the orchestrator-synthesized dispatch brief conflated already-shipped endpoints with future ones, the reviewer agents fired multiple Blockers, and a substantial fix-cycle tax was paid in tokens that should have been spent on feature work. The retro produced the rule; the rule was promoted to a permanent clause in both the orchestrator role doc and the auto-loaded `CLAUDE.md` snippet.
- The **session-close guardrails script** exists because 8 of its 17 invariants drifted silently across a multi-phase stretch. Velocity-log rollups stopped happening, SHDs grew stale, working trees shipped with uncommitted state — none of which surface in normal development because agents follow stale memory and the spec keeps living in the doc unaltered. The script makes that drift impossible to miss at close-time.
- The **reviewer-trio composition matrix** exists because dispatching the wrong reviewer set either over-burns budget (full trio on a narrow-fix sibling) or escapes Blockers (CR-only on an endpoint with new HTTP attack surface). The default-keep / default-prune bifurcations were calibrated across many sessions of paired observation, with zero escaped Security findings on Security-pruned slots in the validation window.
- The **SHD protocol** (`plans/next-session.md`) exists because the legacy session-start ritual — re-derive priors at session-start, dispatch PM for capacity planning, then dispatch the first real slot — was paying 100-140k tokens per session-start for context the prior session already knew. Pre-rendering the playbook at session-close cut that overhead to 5-15k.
- The **coordination watchdogs T-M / T-X / T-Y** exist because plan-template references silently went stale, parallel-lane file overlaps silently produced merge conflicts, and post-merge auto-close silently fired on wrong issues. Each was caught and made into a pre-dispatch / post-merge ritual after the failure was named.

Every clause in `dispatch-templates/` traces back to a specific recurring failure mode with a measured token cost. The framework is not aspirational; it is the residue of mistakes that hurt enough to encode.

Names, paths, session numbers, and project-specific examples have been genericized for cross-project reuse. The discipline itself is what's portable.

---

## License

MIT. See [LICENSE](LICENSE).
