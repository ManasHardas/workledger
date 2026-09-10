# Wave State

> **Purpose:** authoritative current state of the project. Updated by PM at session-close; read by Orchestrator at session-start. Eliminates session-amnesia about phase / wave / required activities.

> **Convention:** if you're starting a session, read THIS FILE FIRST (after fetch+reset), then `.orchestrator/agents/orchestrator.md` §Session-start ritual.

---

## Current state — 2026-09-09 (post-S2)

**Phase:** P7. Wave 0 merged (#74: token sync, Code Connect skeletons, Lighthouse script). Wave 1 blocked on the operator's Figma file, node ids, and variables export. Tags: `p1-shipped` … `p5-shipped` (version 0.3.0). P6 deferred by the operator.

**Wave:** P7 Wave 1, blocked on inputs. Lean mode (Clause #12) throughout; Clause #13 exists in agentwaves but is not in force here by operator decision.

**Last session:** S2 closed after PR #74: 25 build PRs merged (P1 close, P2, P3, P4, P5, P7 Wave 0), five tags, version 0.3.0.

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
| S2 | P1 close → P2 → P3 → P4 → P5 → P7 Wave 0 | ACTIVE, lean | 25 | Five phases shipped; ~6.4M implementer + 1.8M reviewer tokens; 8 fix-cycles across 25 PRs |

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
