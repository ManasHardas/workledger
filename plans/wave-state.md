# Wave State

> **Purpose:** authoritative current state of the project. Updated by PM at session-close; read by Orchestrator at session-start. Eliminates session-amnesia about phase / wave / required activities.

> **Convention:** if you're starting a session, read THIS FILE FIRST (after fetch+reset), then `.orchestrator/agents/orchestrator.md` §Session-start ritual.

---

## Current state — 2026-09-09 (post-S1)

**Phase:** P1 — CLI core (per `plans/feature-p1-cli-core.md`)

**Wave:** Wave 1 (build loop), 8 of 12 slots merged. Wave 0 (contract freeze, PR #1) and Wave 0.5 (issues #3–#14) complete. Two contract amendments on `main` (PR #15; amendment 2 at `1e9c2b3`).

**Last session:** S1 closed at the chore-close commit on `main` after PR #23 (last build merge `3d2eb52`, PR #22). 8 build PRs merged: #16 #17 #18 #19 #20 #21 #22 #23. Stopped by **T-D** (two fix-cycle iterations on slot 5, PR #20) per the plan's watchdog rule; budget was not exhausted.

**Carry-over slots:** none dropped. Not yet started: slot 8 (#11 checkpoint), slot 9 (#12 hook), slot 10 (#13 init/doctor/brief/config), slot 12 (#14 dogfood), plus follow-up #25 (Infra, pack-time manifest).

**Open blockers (must resolve before next required activity):**
- None at file-write time. #11's dependencies (#5 #6 #7 #8 #10 #4) are all merged.

**Next required activities (in order):**
1. ⏳ Wave 1 slot 8: dispatch Backend on #11 (`workledger checkpoint`), full trio review. Pre-rendered brief in `plans/next-session.md`.
2. ⏳ Wave 1 slot 9: #12 (hook + Claude Code adapter), full trio; must honor the three budget comments on the issue (lazy `better-sqlite3`, no core import on the allow path, deep-specifier imports).
3. ⏳ Wave 1 slot 10: #13; full trio. Then #25 (Infra, CR-only) and slot 12 (#14, CR-only).
4. ⏳ Wave 2 QA planning pass, then Wave 3 docs + tag `p1-shipped`, Wave 3.5 dogfood (three real sessions here and in `dome_workspace`).

**Operating mode:** ACTIVE (first-of-class slots remain: checkpoint, hook, init).

**Throughput mode:** serial for the three remaining first-of-class CLI slots (#11 → #12 → #13 have a real dependency chain anyway); #25 may run in parallel with #11 (Infra, disjoint files).

**Watchdog record (S1):** T-A never tripped. T-G fired on every slot (bootstrap anchors were 3–5× too low; see `capacity-log.md`). T-D fired on slot 5. T-X handled by pre-creating the command registry in slot 7 and by appending exports at the end of `packages/core/src/index.ts`. T-Y: one straggler (#7 not auto-closed because PR #22's body was clobbered); closed by hand.

---

## Recent session history (rolling window of last 5 sessions)

| Session | Phase / Wave | Mode | PRs | Notes |
|---|---|---|---|---|
| S0 | P1 / design | n/a | 0 | Spec, decision log, roadmap, phase spec, implementation plan, agentwaves vendored |
| S1 | P1 / Wave 0 → 0.5 → 1 | ACTIVE, serial | 10 (#1 freeze, #15 amendment, 8 builds) | 8/12 slots merged; T-D on slot 5; anchors recalibrated |

---

## Maintenance protocol

**At session-close (PM responsibility):**
1. Update `## Current state` block to reflect post-session reality.
2. Move the just-closed session into `## Recent session history` (drop oldest if window > 5).
3. Update `**Carry-over slots**` if any slots were T-A/T-D/T-G dropped.
4. Update `**Next required activities**` for the next session.
5. Commit alongside `velocity.json` + `capacity-log.md` updates in the session-close chore commit.

**At session-start (orchestrator responsibility):**
1. Read this file FIRST (after fetch+reset).
2. Cross-reference with `.orchestrator/agents/orchestrator.md` §Session-start ritual.
3. Decide operating mode (ACTIVE vs DEGRADED) per the encoded rules.
4. If carry-over slots exist, dispatch them as first slots of the new session.
