# <Phase / Sub-phase> Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: orchestrator-driven dispatch — see `agents/orchestrator.md`. This project's "agentic worker" is a specialist agent dispatched per slot via the Agent tool, not a single human engineer. Each slot brief is self-contained for handoff. Steps use checkbox (`- [ ]`) syntax for orchestrator tracking.

**Goal:** <one-sentence goal>.

**Architecture:** <2-3 sentences>.

**Tech Stack:** <key technologies>.

---

## File Structure

| Slot | File | Action | Purpose |
|---|---|---|---|
| 1 | `<path>` | Create / Modify | <what changes> |
| 2 | ... | ... | ... |

---

## Slot 1 — <issue #N> <title>

**Class:** <orchestrator-territory | endpoint-chained-on-service-module first-of-class | sibling-cache-warm | etc.>.

**Reviewer composition:** <CR-only | CR + SRE | CR + SRE + Security | CR + PM-D-only> per Clause #6 <rule>.

**Anchor estimate:** <X-Yk slot total>.

**Files:**
- Create: `<path>`
- Modify: `<path>:<line-range>`
- Test: `<test-path>`

- [ ] **Step 1: <action>**

```python
# code or command
```

- [ ] **Step 2: <action>**

...

---

## Slot 2 — ...

(repeat structure)

---

## Watchdogs

| Trigger | Threshold | Action |
|---|---|---|
| **T-A** (cumulative budget) | cum > <X>k post-slot-N reviewers | Defer remaining tails |
| **T-G** (slot anchor drift) | any slot >1.3× anchor | ADVISORY — orchestrator escalates |
| **T-D** (fix-cycle) | second fix-cycle iteration on any slot | Stop after that slot's eventual clean merge |

---

## Stop conditions

Stop after slot <N> clean-merge + chore commit (capacity-log + velocity entries + wave-state update).

---

## Self-review

- [ ] **Spec coverage:** every spec section has a corresponding task.
- [ ] **Placeholder scan:** no TBD/TODO/FIXME.
- [ ] **Type consistency:** types used in later tasks match earlier tasks.
- [ ] **Sibling-cache-warm chain:** slot order maximizes reviewer cache compounding.
