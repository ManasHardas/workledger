# Capacity log

> **Purpose:** session-by-session ledger. Each session's PM dispatches an entry at session-close summarizing what landed, calibration findings, watchdog outcomes, and S<N+1> forecast.

> **Convention:** newest sessions at the bottom. PM appends; orchestrator reads (along with `velocity.json`) at session-start to compute Bayesian-updated priors.

---

## Session 1 — YYYY-MM-DD (initial session)

**Stage 2 PM:** ACTIVE / DEGRADED.

**Wave executed:** <Wave 0 | Wave 0.5 | Wave 1 | Wave 2 | Wave 3>.

**Build PRs merged:** N (or 0 if planning session).

**Activities completed:**
- <activity 1>
- ...

**Issues filed:** <count>.

**Discipline holds:**
- T-A held / not held: <details>
- T-G held / not held: <details>
- T-D held / not held: <details>
- Mid-session re-consults: <count>
- HARD CONSTRAINT: <consecutive sessions clean>

**Calibration findings:**
1. <finding 1>
2. <finding 2>

**Cumulative dispatched:** <X>k of <Y>k ceiling = <Z>%.

**Stage-2 PM Nth consecutive validation session.**

**Forecast S<N+1>:**
- Slot 1: ...
- Slot 2: ...
- Watchdog triggers: ...
