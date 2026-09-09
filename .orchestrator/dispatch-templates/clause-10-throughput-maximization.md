# Clause #10 — Throughput maximization (PERMANENT)

## Body (the three throughput levers — apply by default)

The orchestrator MUST default to maximum throughput within T-X file-lock constraints. Serial dispatch is the safe default in *uncalibrated* projects; once class anchors are stable (n≥3 observations per class), the orchestrator should switch to throughput-maximized dispatch via the three levers below.

### Lever 1 — Parallel build dispatches (single message, multiple Agent tool calls)

**Rule:** When two or more build issues are ready (`todo` + dependencies `done`) AND their T-X file-lock units are disjoint, dispatch them **in parallel via a single orchestrator message containing multiple `Agent` tool_use blocks**. The harness runs them truly concurrently. Do NOT serialize disjoint issues across separate orchestrator messages.

**Disjointness test:**
- Different module paths (`apps/api/src/services/foo` ⊥ `apps/web/components/bar`) → parallel.
- Different Figma pages on the same file (`Component · Foundation` ⊥ `Component · Forms`) → parallel.
- Same module / same Figma page → serialize via `Depends on:` or extract shared helpers to a new module first.

**Recommended fan-out:** 3-4 parallel agents per session. Higher fan-out (5+) is mechanically fine but coordination overhead (merge ordering, worktree management, PR-ready review trio scheduling) starts to rise non-linearly past 4.

**Cost model:**
- Per-session token budget rises from ~700-900k (serial) to ~1.5-2M (4-way parallel) — well inside any modern model's full-budget envelope.
- Atomic-failure / socket-disconnect retry rate: ~5-10% per dispatched agent. With 4 in flight, expect 1-2 retries per session. Retries are cheap (~30k each) compared to throughput gain.
- Prompt-cache stays warm via same-conversation continuation.

### Lever 2 — Wave-boundary compression

**Rule:** Combine Wave 0 (orchestrator-direct contract-freeze) + Wave 0 step 2 (PM/Designer sanity-check) + Wave 0.5 (PM/Designer issue-planning) + first 1-2 Wave 1 build slots into **the same session** when the per-class anchor totals fit within a same-session budget envelope (~1.5M).

**Default for stable projects:** phase-boundary lands in one session. Splitting Wave 0 / Wave 0 step 2 / Wave 0.5 across three separate sessions wastes ~150-200k of session-start ritual overhead per session and burns 2-3 calendar days for no parallel-work benefit.

**Defer split-across-sessions for:** novel-class contract-freezes where the PM/Designer sanity-check may return OPTION B with substantive amendments (sibling to S26 SP-0 / S31 SP-1 patterns). In that case Wave 0 + 0 step 2 lands one session, amendments + Wave 0.5 + Wave 1 first slot lands next. n≥2 phase observations is the threshold for confidence that OPTION A return is likely.

### Lever 3 — Sibling-shape bundling

**Rule:** When 2-3 issues are sibling-shape (same Figma cluster page, same component family, same backend module surface) AND the bundled scope still fits within a single dispatch's class anchor (no T-G breach), bundle them into a single dispatch rather than separate slots.

**Pattern validated by:** SP-1 cluster wrap-up issues (kubera #304 / #306 / #308 / #311 / #315 / #318 — each issue bundled the cluster's tail components + cluster banner + full-page audit in one dispatch). Median anchor 150-180k — well within budget vs ~3 × 80-100k separate slots.

**Don't bundle:**
- Across T-X file-lock units (defeats lever 1 — keep them parallel instead).
- Across PR classes (mid-set + cluster-wrap-up + drift-remediation all need different reviewer compositions).
- When bundled scope projects past 1.3× of the largest class anchor (T-G breach risk).

## When to apply

Apply all three levers **by default** in any project where:
- `velocity.json` has n≥3 entries per dispatched class (anchors are stable).
- No active fix-cycle from prior session.
- User has authorized full budget envelope (or has signaled speed-preference explicitly).

Fall back to serial dispatch when:
- First-of-class novel surface (no anchor data — set baseline first via single dispatch).
- Active fix-cycle requiring focused root-cause read.
- User has explicitly requested cautious cadence.

## Why permanent

Real-project history: serial dispatch was the *cautious starting default* for new projects, intended to be the safe-first observation pattern. Once class anchors stabilize at n≥3, the cost-of-caution becomes pure waste — per-session token budget headroom (typically 700-900k of 1.5M ceiling) sits unused while delivery cadence stays at 4-6 slots/session.

Kubera SP-1 (S32-S36) shipped 22 build issues across 5 sessions serially. With levers 1+3, the same scope ships in ~2-3 sessions. With all three levers, phase boundaries also compress.

The user-side discipline this clause encodes:
- "Don't ask per session, ASSUME compression."
- "Default dispatch shape is parallel-batch, not serial."
- "When in doubt about T-X disjointness, dispatch parallel anyway and let merge-order sequencing handle it post-PR."

## How to apply

In the orchestrator's session-start ritual, after step 7 (operating mode decision), add a throughput-decision step:

```
8. **Throughput mode** — given (a) anchor stability (n≥3 per class), (b) no active fix-cycle, (c)
   authorized budget envelope, decide whether to apply Clause #10 levers (default YES once anchors
   stable; default NO for first-of-class novel surfaces). Declare in chore-close commit body.
```

In the dispatch flow, when ≥2 ready build issues exist:
- Default action: single orchestrator message with 1 `Agent` tool_use per issue.
- T-X check pre-dispatch: confirm file-lock units disjoint OR insert `Depends on:` serialization.
- Merge sequencing post-PR-ready: merge in dependency order; clean worktrees in a single batch at session-close.

## Tracking in chore-close commit body

Orchestrator notes throughput mode in the session-close commit body:

```markdown
- **Throughput mode:** Clause #10 (parallel-by-default) applied. N parallel build dispatches
  executed (M issues per dispatch median). Cumulative session budget ~Xk.
```

OR for a session that ran serial:

```markdown
- **Throughput mode:** Clause #10 not applied — first-of-class novel surface required baseline
  observation. Sessions N+1 will resume parallel-default once n≥3 anchors stable.
```

## Doesn't apply to

- Wave 0 contract-freeze (single-orchestrator authoring; no agent dispatch to parallelize).
- Wave 2 §0 QA planning pass (single QA dispatch by design).
- Wave 3 phase close (single Docs dispatch by design).
- Wave 3.5 dogfood pass (single user-driven exercise by design).

Lever 2 (Wave-boundary compression) applies to Wave 0 + 0 step 2 + 0.5 transitions specifically — not to within-wave dispatching.
