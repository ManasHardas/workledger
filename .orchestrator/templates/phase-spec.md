# Phase N — <Phase Name>

**Status:** <Approved YYYY-MM-DD | Brainstorm in progress | Frozen pending Wave 0>.

**Tag at phase close:** `p<N>-shipped`.

**Strategic context.** <2-4 sentences on what this phase ships and why; reference any wedge / value-prop / strategic doc>.

---

## Sub-phase split (if applicable)

| Sub-phase | Scope | Sessions (estimate) |
|---|---|---|
| **P<N>-backlog** (optional) | <Tier-1 backlog blockers needed before P<N>a build> | 1 |
| **P<N>a <name>** | <core build scope> | 3-4 |
| **P<N>b <name>** (optional) | <followup polish / advanced features> | 2-3 |

Total estimate: **<X-Y sessions for full phase**.

---

## Wave 0 — Contract freeze (orchestrator alone)

Five artifacts in one PR (orchestrator self-merges per role):

1. **API spec** (`<api-spec-path>`) — endpoints listed in §API surface below.
2. **Migration** (`packages/server/src/index/migrations//<ts>_p<N>_<slug>.py`) — schemas in §Data model.
3. **Codegen output** — regenerate `packages/api-client/src/generated/` from updated API spec.
4. **Data-flow doc** (`plans/feature-p<N>-data-flow.md`) — worker stage spec, retry assumptions, idempotency keys, quota budgets.
5. **Algorithm-doc / cleanup** (if applicable) — update or rewrite any algorithm docs first per algorithm-doc-first rule. Delete any dead code superseded by this phase.

Phase tracking issue: `[P<N>] Phase tracking — <phase name>`.

---

## Architecture / pipeline

```
<ascii-art pipeline diagram>
```

<2-3 paragraphs on the architecture decisions>

---

## Data model

```sql
-- New tables this phase introduces
CREATE TABLE <table_name> (
  id UUID PRIMARY KEY,
  ...
);
```

---

## API surface

```yaml
POST /<resource>/{id}/<action>
  body: <RequestSchema>
  responses:
    200 <ResponseSchema>
    404 if not found or wrong owner

GET /<resource>/{id}
  ...
```

Reviewer trio per Clause #6 — see `dispatch-templates/clause-6-reviewer-trio-composition.md` for default-keep / default-prune row.

---

## FE flow + state machine (if applicable)

```
state: empty
  │ user action
  ▼
state: ...
```

---

## Wave 0.5 dispatch list

Backend agent decomposes into ~N issues:

1. <issue title> — <one-line>
2. ...

Frontend agent decomposes into ~N issues:

1. ...

Infra agent: <minimal | N issues>.

---

## Wave 1 sub-decimal ordering (use when phase has >~15 issues)

For phases that decompose into many issues, group Wave 1 work into sub-waves with decimal ordering. Each sub-wave is a serializable batch with its own contract-amendment and conflict-resolution checkpoints. The benefit: Orchestrator and PM can plan per-sub-wave, file `Depends on:` cleanly across sub-wave boundaries, and surface T-X overlap concerns at the sub-wave level rather than the whole-phase level.

Suggested decomposition (adapt per phase):

| Sub-wave | Scope | Notes |
|---|---|---|
| **1.0** | Critical-path data model + entry endpoints | Establishes the surface every later sub-wave builds on. |
| **1.1** | Worker stages 1–N | Sequential by data-flow dependency. |
| **1.2** | API surface (read + write endpoints) | Frontend lanes block on this. |
| **1.5** | Mid-phase contract amendment (if needed) | Lift shared helpers, regenerate codegen, re-dispatch downstream. |
| **1.6** | Frontend feature pages | After API is live + frontend lanes unblock. |
| **4.1** | Polish, edge-case handling | Optional; for large phases. |
| **4.3** | Performance / observability tuning | Optional; deferrable to follow-up phase. |

Sub-decimals are advisory ordering hints, not rigid gates — Orchestrator may reshuffle as new dependencies surface during Wave 0.5. Document the actual ordering used in `plans/wave-state.md` at each session-close.

For small phases (≤~15 issues) skip this section — flat Wave 1 ordering is sufficient.

---

## Acceptance criteria (phase tracking issue)

- [ ] <criterion 1>
- [ ] <criterion 2>
- ...
- [ ] HARD CONSTRAINT honored across all PRs.
- [ ] Clause #3 honored on every backend PR.

---

## Out of scope

- <explicit deferred items>
- <next-phase items>

---

## Risks + escape hatches

| Risk | Mitigation |
|---|---|
| <risk 1> | <mitigation> |
