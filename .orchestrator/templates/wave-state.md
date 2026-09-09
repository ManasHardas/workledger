# Wave State

> **Purpose:** authoritative current state of the project. Updated by PM at session-close; read by Orchestrator at session-start. Eliminates session-amnesia about phase / wave / required activities.

> **Convention:** if you're starting a session, read THIS FILE FIRST (after fetch+reset), then `agents/orchestrator.md` §Session-start ritual.

---

## Current state — YYYY-MM-DD (session N status)

**Phase:** P<N> — <phase name> (per `plans/feature-p<N>-<slug>.md`)

**Wave:** <Wave 0 | Wave 0.5 | Wave 1 | Wave 2 | Wave 3>

**Last session:** S<N-1> closed at `<sha>` (chore PR #<TBD>). <one-line summary>

**Carry-over slots:**
- (or "none" if no slots dropped from prior session)

**Open blockers (must resolve before next required activity):**
- (or "None at file-write time.")

**Next required activities (in order):**
1. ⏳ <activity 1>
2. ⏳ <activity 2>
...

**Operating mode:** <ACTIVE | DEGRADED> (per `agents/orchestrator.md` §Session-start ritual rules)

---

## Recent session history (rolling window of last 5 sessions)

| Session | Phase / Wave | Mode | PRs | Notes |
|---|---|---|---|---|
| S<N-4> | ... | ... | ... | ... |
| S<N-3> | ... | ... | ... | ... |
| S<N-2> | ... | ... | ... | ... |
| S<N-1> | ... | ... | ... | ... |

---

## Maintenance protocol

**At session-close (PM responsibility):**
1. Update `## Current state` block to reflect post-session reality.
2. Move the just-closed session into `## Recent session history` (drop oldest if window > 5).
3. Update `**Carry-over slots**` if any slots were T-A/T-D/T-G dropped.
4. Update `**Next required activities**` for the next session (read `agents/orchestrator.md` §Wave sequence + current phase tracking issue).
5. Commit alongside `velocity.json` + `capacity-log.md` updates in the session-close chore PR.

**At session-start (orchestrator responsibility):**
1. Read this file FIRST (after fetch+reset).
2. Cross-reference with `agents/orchestrator.md` §Session-start ritual.
3. Decide operating mode (ACTIVE vs DEGRADED) per the encoded rules.
4. If carry-over slots exist, dispatch them as first slots of the new session.
