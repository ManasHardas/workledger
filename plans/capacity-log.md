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
