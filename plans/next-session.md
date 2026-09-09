# Session 1 Handoff

**Generated:** 2026-09-09 by the design session (S0) at close. No PM was dispatched in S0; this SHD is hand-seeded.
**Stale-after:** any user direction change OR any merged PR appearing post-generation.

---

## User: paste this as your first session-start message

> Read `.orchestrator/agents/orchestrator.md`. We're starting Phase 1 of workledger. I'll be the user; you're the Orchestrator. Read `plans/next-session.md` and execute it. Budget: full.

---

## Session 1 quick-context

- **Phase:** P1 — CLI core (`plans/feature-p1-cli-core.md`)
- **Wave:** Wave 0 (contract freeze), then Wave 0.5, then Wave 1 slot 1 if budget allows (Clause #10 lever 2 is NOT yet authorized: no class anchors; treat the compression as a budget decision at the end of Wave 0.5, not a default)
- **Operating mode:** ACTIVE (new phase boundary, first-of-class everything, no priors)
- **Throughput mode:** serial fallback
- **Last SHA:** `main` at the commit that added this file (run `git log -1` after fetch+reset)
- **Carry-over slots:** none
- **Open blockers:** None at file-write time.
- **Project rules that override framework defaults:** see `CLAUDE.md` (personal remote only, always push, no Dome secrets, no Docker, TypeScript only).

---

## Active priors (compressed digest from velocity.json)

| Class | Anchor (slot total) | n | Notes |
|---|---|---|---|
| thin-infra | 40–80k (bootstrap) | 0 | guess; record actuals |
| service-module first-of-class | 60–140k (bootstrap) | 0 | guess |
| endpoint-chained-on-service-module first-of-class (CLI command) | 90–160k (bootstrap) | 0 | guess; full-trio review |
| wave-0.5-issue-planning per agent | 70–130k (framework typical) | 0 | from `.orchestrator/agents/pm.md` |

No entries in `plans/velocity.json`. Every slot in S1 is a calibration point.

---

## Pre-rendered slot 1 dispatch brief

Session 1's first dispatch is not a build slot; it is Wave 0 step 2, the PM-Designer phase-spec sanity check.

```
Read your role at `.orchestrator/agents/pm-designer.md` first.

Working directory: the repo root, `main`, clean after fetch+reset.

Task: Phase-spec sanity check for P1. Compare `plans/feature-p1-cli-core.md` against the design
spec `docs/superpowers/specs/2026-09-09-workledger-design.md` (§3–§7, §10–§14), the roadmap
`plans/roadmap.md`, and the decision log `docs/decision-log.md`. There is no UI in P1, so the
"user flow" under review is the developer's: `workledger init` → work in Claude Code → a
checkpoint deny fires → the agent runs `workledger checkpoint` → files appear → next session's
brief is injected.

Return: (1) blockers, each naming the spec section it contradicts; (2) gaps where the phase spec
under-specifies something a build agent would have to guess; (3) confirmation that the Wave 0.5
dispatch list covers the acceptance criteria; (4) nothing else. Do not propose new scope.

Out of scope: UI, backfill, other harnesses, Dome card. If a finding belongs to a later phase,
name the phase and stop.

Return contract: markdown with the three numbered sections; under 1,200 words.
```

**Anchor for slot 1:** ~40–70k (framework typical for a sanity check; no prior).

---

## Pre-rendered slot 2-N dispatch briefs (compressed)

- **Slot 2: Wave 0 contract freeze** (orchestrator alone; no dispatch). Five artifacts per the phase spec §Wave 0. Quote the Stop deny and SessionStart inject JSON from the live Claude Code hooks docs into `docs/contracts/p1/hooks-claude-code.md` with the date fetched. Self-merge. Create `[P1] Phase tracking — CLI core` with the acceptance-criteria checklist.
- **Slot 3: Wave 0.5** (Infra + Backend in parallel, one message, two Agent blocks; no Frontend). Each decomposes per the phase spec's dispatch list, files issues sized 1–3 days, comments the numbers on the tracking issue in execution order. Orchestrator then fills issue numbers into `plans/p1-implementation-plan.md` slot headings and resolves `Depends on:` (slot 7 before 8–10; slot 1 before everything).
- **Slot 4 (only if budget remains): implementation-plan slot 1** (Infra, monorepo scaffold, CR-only). Drop if T-A trips after Wave 0.5.

---

## Watchdogs for this session

- **T-A:** cumulative > 1.0M post-Wave-0.5 → do not start build slot 1; close the session.
- **T-G:** any dispatch > 1.3× its bootstrap anchor → user-escalate (ADVISORY; expected to fire, anchors are guesses).
- **T-D:** second fix-cycle iteration on any slot → stop after that slot's eventual clean merge.
- **T-M:** before Wave 0.5, grep the phase spec and implementation plan for paths and confirm they match `plans/agentwaves-stack-map.md`.

---

## Stop conditions

After Wave 0.5 issues are filed and cross-linked, plus the chore-close commit (capacity-log entry, velocity entries for the sanity check and the two planning dispatches, wave-state update, this file regenerated for S2). Tag nothing (tags only at phase close).

---

## Session-close artifacts to update

- `plans/wave-state.md` (current state → Wave 1 pending; history row for S1)
- `plans/velocity.json` (one entry per dispatch with `tokens_total` from each `<usage>` block)
- `plans/capacity-log.md` (S1 entry)
- `plans/next-session.md` (S2 SHD with the pre-rendered slot 1 build brief, which is implementation-plan slot 1 or 2 depending on what landed)
- Run `.orchestrator/scripts/check-session-close-guardrails.sh` before the chore commit; `GUARDRAIL_CC_SESSION_GATE` is off.

---

## User-override section

- Session budget: the operator declined to specify capacity for this project; assume a full window unless told otherwise at session start.
- Push policy: always push to `origin` (personal alias) without asking. Never push to any Dome remote from this repo.
