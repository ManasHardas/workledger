# Session N+1 Handoff

**Generated:** YYYY-MM-DD by PM at S<N> close.
**Stale-after:** any user direction change OR any unmerged PR appearing post-generation.

---

## User: paste this as your first session-start message

> Read plans/next-session.md and execute it. Budget: <full | half | tight | Xk>.

---

## Session N+1 quick-context

- **Phase:** P<N> — <name>
- **Wave:** <Wave 0 | Wave 0.5 | Wave 1 | Wave 2 | Wave 3>
- **Operating mode:** <ACTIVE | DEGRADED> (per `.orchestrator/agents/orchestrator.md` §Session-start ritual; rationale: <reason>)
- **Last SHA:** `<sha>`
- **Carry-over slots:** <list or "none">
- **Open blockers:** <list or "None at file-write time.">

---

## Active priors (compressed digest from velocity.json)

| Class | Anchor (slot total) | n | Notes |
|---|---|---|---|
| <class-1> | <Xk-Yk> | <n> | <calibration note> |
| <class-2> | <Xk-Yk> | <n> | <calibration note> |

(Top 8-10 active classes only. Full audit log in `plans/velocity.json`.)

---

## Pre-rendered slot 1 dispatch brief

```
[VERBATIM dispatch brief here — orchestrator can paste-dispatch this into the
Agent tool with zero synthesis. Should be 3-5k tokens. Include:

- Agent role reference: "Read your role at `agents/<role>.md` first"
- Working directory + branch state expectation
- Task: issue # + spec reference
- Pre-build digest from PM-Designer (if applicable)
- Branch + PR protocol
- Dispatch-template clauses (Clause #3, #6, HARD CONSTRAINT, close-keyword)
- Architecture / convention notes
- Out-of-scope guardrails
- Verification gates
- PR body template
- Return contract]
```

**Anchor for slot 1:** ~Xk slot total (impl Xk + reviewers Yk).

---

## Pre-rendered slot 2-N dispatch briefs (compressed)

- **Slot 2: #<N>** <title> (<agent-role>; class <X>; anchor <Yk slot total>; reviewer composition <Z>). <one-line context>.
- **Slot 3: #<N>** ...
- **Slot N (tail / drop candidate): #<N>** ... Drop if T-A trips post slot-(N-1) reviewers.

For full dispatch brief structure, orchestrator references `agents/<role>.md` + `dispatch-templates/*.md` at dispatch time.

---

## Watchdogs for this session

- **T-A:** cumulative > <X>k post-slot-(N-1) reviewers → defer remaining slots.
- **T-G:** any slot > 1.3× anchor → user-escalate (ADVISORY; do not auto-swap).
- **T-D:** second fix-cycle iteration on any slot → stop after that slot's eventual clean merge.

---

## Stop conditions

After slot <N> clean-merge + chore commit. Tag `<tag-name>` if applicable (only at phase close).

Session anchor: ~<X>k = <Y>% of ceiling. Within target.

---

## Session-close artifacts to update

PM at this session's close:

1. **`plans/velocity.json`** — append entries (one per merged PR + per agent-dispatch).
2. **`plans/capacity-log.md`** — append session entry.
3. **`plans/wave-state.md`** — update `## Current state` block; rotate rolling history.
4. **`plans/next-session.md`** — regenerate THIS file for S<N+2>.

Single chore PR. Self-merge per orchestrator role.

---

## User-override section

If your priorities at session-start differ from the pre-rendered plan above, paste your override AFTER your "Read plans/next-session.md and execute it" message. Examples:

- **"Override: skip slot 1 — push to next session."** (Orchestrator skips; carry-over preserved.)
- **"Override: reorder slots — do slot 3 first, then slot 1."** (Orchestrator reorders.)
- **"Override: dispatch slot N+1 in parallel with slot N."** (Orchestrator runs parallel.)
- **"Override: budget tight; only slot 1 + chore commit. Defer rest."** (Orchestrator stops early.)

Orchestrator applies overrides as delta on top of this playbook. If override is unclear, orchestrator asks for clarification before dispatching.
