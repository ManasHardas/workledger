# Wave State

> **Purpose:** authoritative current state of the project. Updated by PM at session-close; read by Orchestrator at session-start. Eliminates session-amnesia about phase / wave / required activities.

> **Convention:** if you're starting a session, read THIS FILE FIRST (after fetch+reset), then `.orchestrator/agents/orchestrator.md` §Session-start ritual.

---

## Current state — 2026-09-09 (post-S2, P1, P2, P4 shipped; P3 one PR from done)

**Phase:** P3 finishing (#56 Jobs UI in flight; #53 #54 #55 #57 merged) and P5 starting (#63 in flight). Tags: `p1-shipped`, `p2-shipped`, `p4-shipped` (PR #67). P6 deferred by the operator; P7 blocked on Figma inputs.

**Wave:** P3 Wave 1 last slot (#56); P5 Wave 1 first slot (#63). Lean mode (Clause #12) throughout; Clause #13 exists in agentwaves but is not in force here by operator decision.

**Last session:** S2 (same conversation as S1, continued under Clause #12 lean mode): merged #26 #27 #28 #29 #30, amendment 3, dogfood on this repo (three live sessions), CHANGELOG, tag.

**Carry-over slots:** none.

**Open blockers:** None at file-write time. `dome_workspace` enablement is operator-manual.

**Next required activities (in order):**
1. ⏳ P2 Wave 1: server + api-client + backlog-ops (Backend, parallel with the Frontend scaffold), then the web views, then `serve` packaging (Infra).
2. ⏳ P2 Wave 2 (one QA e2e over `serve`), Wave 3 tag `p2-shipped`.
3. ⏳ P3 finish (#54 #56 #57), P4 (#59), P5 (#63 #64), then P7 when Figma inputs exist. P6 deferred by the operator.

**Operating mode:** ACTIVE, Clause #12 lean (one reviewer per PR, one fix-cycle, merge on green).

**Throughput mode:** parallel on disjoint packages.

---

## Recent session history (rolling window of last 5 sessions)

| Session | Phase / Wave | Mode | PRs | Notes |
|---|---|---|---|---|
| S0 | P1 / design | n/a | 0 | Spec, decision log, roadmap, phase spec, implementation plan, agentwaves vendored |
| S1 | P1 / Wave 0 → 0.5 → 1 | ACTIVE, serial | 10 (#1 freeze, #15 amendment, 8 builds) | 8/12 slots merged; T-D on slot 5; anchors recalibrated |
| S2 | P1 / Wave 1 → 3.5, P2 / Wave 0 | ACTIVE, lean | 5 (#26 #27 #28 #29 #30) | P1 shipped; lean mode cut per-slot cost ~3×; bytes default fixed from e2e |

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
