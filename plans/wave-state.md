# Wave State

> **Purpose:** authoritative current state of the project. Updated by PM at session-close; read by Orchestrator at session-start. Eliminates session-amnesia about phase / wave / required activities.

> **Convention:** if you're starting a session, read THIS FILE FIRST (after fetch+reset), then `.orchestrator/agents/orchestrator.md` §Session-start ritual.

---

## Current state — 2026-09-09 (post-S3)

**Phase:** P8 (Onboarding and home) built: all ten build PRs merged on main (#82 #83 #84 #86 #90 #91 #92 #93 #95 #96); contract `docs/contracts/p8/daemon-and-api.md` carries amendments 1–4. **Not yet tagged:** `p8-shipped` and `v0.4.0` wait for the operator's personal walkthrough from a fresh state (`WORKLEDGER_HOME=$(mktemp -d)/wl workledger`); version is still 0.3.0 and CHANGELOG has an Unreleased section. Tags: `p1-shipped` … `p5-shipped`. P7 Wave 0 merged (#74); P7 Wave 1 blocked on Figma inputs. P6 deferred by the operator.

**Wave:** P8 Wave 3 (ship gate) pending the operator's verdict; P7 Wave 1 blocked on inputs. Lean mode (Clause #12) throughout; Clause #13 not in force here by operator decision.

**Last session:** S3 closed after PR #96: 10 build PRs merged (P8 infra, two backend first-of-class, Home, wizard, three fixes, QA e2e, integration fix); ~2.12M implementer + ~1.11M reviewer tokens; 3 fix-cycles across 10 PRs; five defects found by review or smoke, all fixed before merge.

**Carry-over slots:** none.

**Open blockers:** the operator's walkthrough verdict gates the tag; npm publish and tap automation need the `NPM_TOKEN` and `TAP_TOKEN` repository secrets from the operator (the release workflow prints the manual command when either is absent); P7 Wave 1 needs the Figma file key, node ids, and variables export.

**Next required activities (in order):**
1. ⏳ Operator walkthrough of onboarding from a fresh state; each defect becomes a five-line issue in P8.
2. ⏳ After the verdict: bump `packages/cli` to 0.4.0, CHANGELOG 0.4.0, tag `v0.4.0` (release workflow) and `p8-shipped`, close #75 (orchestrator direct task).
3. ⏳ P8 defect fixes (one PR each, lean), then P7 Wave 1 when the Figma inputs exist. P6 deferred by the operator.

**Operating mode:** ACTIVE, Clause #12 lean (one reviewer per PR, one fix-cycle, merge on green).

**Throughput mode:** parallel on disjoint packages.

---

## Recent session history (rolling window of last 5 sessions)

| Session | Phase / Wave | Mode | PRs | Notes |
|---|---|---|---|---|
| S0 | P1 / design | n/a | 0 | Spec, decision log, roadmap, phase spec, implementation plan, agentwaves vendored |
| S1 | P1 / Wave 0 → 0.5 → 1 | ACTIVE, serial | 10 (#1 freeze, #15 amendment, 8 builds) | 8/12 slots merged; T-D on slot 5; anchors recalibrated |
| S2 | P1 close → P2 → P3 → P4 → P5 → P7 Wave 0 | ACTIVE, lean | 25 | Five phases shipped; ~6.4M implementer + 1.8M reviewer tokens; 8 fix-cycles across 25 PRs |
| S3 | P8 Wave 0 → 0.5 → 1 → 2 | ACTIVE, lean | 10 | P8 built, tag pending operator walkthrough; ~2.12M implementer + 1.11M reviewer tokens; 3 fix-cycles across 10 PRs |

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
