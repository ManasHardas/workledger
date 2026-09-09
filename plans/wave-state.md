# Wave State

> **Purpose:** authoritative current state of the project. Updated by PM at session-close; read by Orchestrator at session-start. Eliminates session-amnesia about phase / wave / required activities.

> **Convention:** if you're starting a session, read THIS FILE FIRST (after fetch+reset), then `.orchestrator/agents/orchestrator.md` §Session-start ritual.

---

## Current state — 2026-09-09 (session 0 status: design complete, no build sessions yet)

**Phase:** P1 — CLI core (per `plans/feature-p1-cli-core.md`)

**Wave:** Wave -1 complete (ideation gate green on `plans/ideation-workledger.md`; verdict was superseded by the operator's 2026-09-08 pivot, recorded in `docs/decision-log.md` DL-2; the gate artifact still satisfies the greenfield check). **Next: Wave 0.**

**Last session:** S0 (design; no dispatches, no PRs). Repo initialized, spec and plans committed on `main`.

**Carry-over slots:** none

**Open blockers (must resolve before next required activity):**
- None at file-write time.

**Next required activities (in order):**
1. ⏳ Wave 0 step 0: run `.orchestrator/scripts/check-ideation-gate.sh --file "$PWD/plans/ideation-workledger.md"` (absolute path; the script resolves its root from its own location).
2. ⏳ Wave 0 step 2: dispatch PM-Designer for the phase-spec sanity check against the design spec.
3. ⏳ Wave 0 steps 3–8: land the "contract freeze — P1" PR with the five artifacts listed in the phase spec (zod + JSON Schema, CLI contract, hook contract quoted from live docs, data-flow doc, cleanup note); create `[P1] Phase tracking — CLI core`.
4. ⏳ Wave 0.5: dispatch Infra and Backend in parallel (no Frontend in P1) with the dispatch list in the phase spec; file issues; resolve `Depends on:`.
5. ⏳ Wave 1: slots per `plans/p1-implementation-plan.md`, serial for first-of-class (no priors).

**Operating mode:** ACTIVE (new phase boundary; first-of-class everything; no `velocity.json` entries).

**Throughput mode:** serial fallback (no class anchors yet).

---

## Recent session history (rolling window of last 5 sessions)

| Session | Phase / Wave | Mode | PRs | Notes |
|---|---|---|---|---|
| S0 | P1 / design | n/a | 0 | Spec, decision log, roadmap, phase spec, implementation plan, agentwaves vendored |

---

## Maintenance protocol

**At session-close (PM responsibility):**
1. Update `## Current state` block to reflect post-session reality.
2. Move the just-closed session into `## Recent session history` (drop oldest if window > 5).
3. Update `**Carry-over slots**` if any slots were T-A/T-D/T-G dropped.
4. Update `**Next required activities**` for the next session.
5. Commit alongside `velocity.json` + `capacity-log.md` updates in the session-close chore PR.

**At session-start (orchestrator responsibility):**
1. Read this file FIRST (after fetch+reset).
2. Cross-reference with `.orchestrator/agents/orchestrator.md` §Session-start ritual.
3. Decide operating mode (ACTIVE vs DEGRADED) per the encoded rules.
4. If carry-over slots exist, dispatch them as first slots of the new session.
