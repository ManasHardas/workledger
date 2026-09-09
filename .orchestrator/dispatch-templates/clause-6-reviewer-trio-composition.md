# Clause #6 — Reviewer-trio composition (PERMANENT)

## Body (paste appropriate row verbatim into dispatch brief)

Pick the matching row based on the PR's class, and paste it into the dispatch brief's "Dispatch-template clauses" section.

### Default-keep / default-prune rules

| PR class | Reviewers | Dispatch shape | Rationale |
|---|---|---|---|
| **CR + SRE + Security (FULL TRIO)** | All three | Parallel (3 separate dispatches) | auth-pathway-first-of-class; endpoint-chained-on-service-module first-of-class with new HTTP attack surface; auth-pathway-proper modify-existing-module |
| **CR + SRE (Security pruned per sibling-shape rule)** | CR + SRE | Parallel (2 separate dispatches) | narrow-fix on auth-pathway sibling to a recently-merged PR with no new auth surface |
| **CR + SRE (Security pruned per first-of-class-by-no-auth-surface rule)** | CR + SRE | Parallel (2 separate dispatches) | first-of-class OR sibling-cache-warm service-module / extension / worker-stages on a path with no auth/PII/credential storage — qualifies even when consuming auth-surface services read-only |
| **CR+SRE COMBINED single-pass (sibling-cache-warm only)** | CR + SRE in ONE dispatch | Single dispatch w/ combined brief | sibling-cache-warm (NOT first-of-class) where the convention is established and reviewers are mostly verifying it propagated correctly. Combines CR + SRE perspectives in one agent's review prompt; saves one round-trip. Do NOT use on first-of-class — depth-of-read matters there. |
| **CR + PM-Designer (SRE + Security DOUBLE-pruned for pure-FE-route)** | CR + PM-Designer | Parallel (2 separate dispatches) | frontend feature-page or middleware/routing PR with no infra/persistence touch and no auth credential surface (FE only forwards cookies through; auth happens server-side) |
| **CR-only** | CR alone | Single dispatch | tail-dispatch / thin-infra / CI-YAML / orchestrator-territory pure-DDL alembic |

## How to apply

In the build-agent dispatch brief, include a "Clause #6 — Reviewer composition" section like:

```markdown
## Clause #6 — Reviewer-trio composition (PERMANENT)

This is `<class>` <descriptor>. Per Clause #6 <rule-name>, **<which reviewers
prune>**. Reviewer pair/trio: **<list>**. Note this in your PR description's
"Dispatch-template clauses honored" section.
```

Example for a `worker-stages first-of-class non-auth-pathway` PR:

```markdown
## Clause #6 — Reviewer-trio composition (PERMANENT)

This is `worker-stages` first-of-class with **no auth/PII/credential-storage
surface**. Per Clause #6 first-of-class-by-no-auth-surface rule, **Security
is pruned**. Reviewer pair: **CR + SRE only**.
```

## Why permanent

Real-project calibration: dispatching the wrong reviewer composition either over-burns budget (reviewing auth-pathway code with full trio when the PR is sibling-shape and Security has nothing new to find) or under-reviews novel surfaces (running CR-only on an endpoint-chained PR with new HTTP attack surface and missing IDOR / 404-leak issues).

The bifurcation rules above were validated across 7+ sessions with zero escaped Security findings on Security-pruned slots; they encode when each reviewer's depth pays vs doesn't.

## Multiplier application order

When estimating slot rollups for budget planning:

1. Apply **auth-pathway +30% multiplier** to SRE and Security baselines BEFORE summing (auth code is read deeper).
2. Apply **first-of-class novel-surface uplift** (~+25-35k over baseline; ~1.5-1.7× multiplier; applies to CR + SRE regardless of pathway) if the PR is first-of-class.
3. Apply **sibling-cache-warm partial discount** (~10-20% off first-of-class; not full 30-50% — convention propagation discount on REVIEWERS is partial).

## Tracking in PR body

Build agents include this confirmation in the PR description:

```markdown
- **Clause #6 (<rule>):** ✅ <reviewer composition> per <rationale>.
```

Example:

```markdown
- **Clause #6 (Security pruned per first-of-class-by-no-auth-surface rule):** ✅
  Reviewer pair = CR + SRE only. Worker-stages with no auth/PII/credential
  surface; consumes services read-only.
```
