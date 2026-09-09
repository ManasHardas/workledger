# CI-quota-constrained operating sub-mode (OPTIONAL, env-var-gated)

**Activation:** set `AW_CI_QUOTA_CONSTRAINED=1` in your shell environment, or declare it explicitly in the session-start brief. When inactive (the default), this clause is ignored.

## When to activate

Activate this mode when ANY of:

- Your GitHub Actions minutes / billing budget is constrained and you can't afford a full CI run per push.
- You're on a free-tier plan and have hit the monthly minutes ceiling.
- Your CI workflow has expensive jobs (E2E browser tests, large-image builds, GPU-bound integration tests) that don't need to run on every commit.
- You're rapid-iterating on a doc-only or planning-only branch where CI signal adds no value.

If none apply, do not activate — full per-push CI is the default discipline.

## Body (paste verbatim into dispatch briefs when active)

> **CI-quota-constrained mode is ACTIVE for this session** (`AW_CI_QUOTA_CONSTRAINED=1`).
>
> 1. **Append `[skip ci]` to every commit message** during the dispatch — both implementation commits and review-finding-fix commits. Use the standard commit-message format with `[skip ci]` as a trailing token on the subject line or in the body.
> 2. **Mark PRs `--admin` on merge** if you have admin rights and CI is intentionally skipped on the merge commit. Otherwise: trigger the CI workflow manually once on the final commit before merge (`gh workflow run ci.yml --ref <branch>`) and merge after it goes green.
> 3. **For expensive CI jobs (E2E, large-image builds), use a label-gate.** Add a workflow conditional like `if: contains(github.event.pull_request.labels.*.name, 'run-e2e')` so the job runs only when the PR carries the gate label. Apply the label explicitly when you need the signal.
> 4. **Declare the mode in the chore-close commit body** so the next session can see CI-quota-constrained operation was intentional:
>     ```
>     CI-quota-constrained mode: ACTIVE (AW_CI_QUOTA_CONSTRAINED=1)
>     ```
>
> When the budget constraint lifts, unset `AW_CI_QUOTA_CONSTRAINED` and resume per-push CI.

## Durable mitigation — the mandatory clause

The durable mitigation is now the **mandatory** `clause-9-ci-workflow-hygiene.md` clause. Every project under the agentwaves protocol MUST apply its four rules to every workflow:

1. `paths-ignore` for docs / plans / orchestrator paths on both `pull_request` and `push` triggers.
2. `concurrency` block with `cancel-in-progress: true`.
3. Draft-PR gate on jobs whose typical run cost is > 3 min.
4. Heavy workflows are `pull_request`-only; only a cheap canary (lint OR typecheck OR unit) runs on the `main`-push event.

Plus the prior recommendations that remain advisory rather than mandatory (they vary by project):

- **Cache aggressively.** Most CI minute burn on repeat runs comes from cold-state setup (dependency install, image build). Cache the install + intermediate builds.
- **Label-gate ultra-expensive jobs.** For jobs that even the draft-PR gate doesn't relieve (e.g. multi-hour matrix builds, GPU-bound tests), add a `if: contains(github.event.pull_request.labels.*.name, 'run-<job>')` gate so the job only runs when explicitly requested via PR label.

With clause #9 applied, recurring `AW_CI_QUOTA_CONSTRAINED=1` activation is unexpected — if it happens, audit your workflows against clause #9 to find the gap.

## Why permanent (when active)

Without `[skip ci]`-on-every-commit, draft PRs that go through 5–10 review-iteration commits burn 5–10× the CI minutes of a single final-commit run. For projects on a constrained billing plan, this rapidly exhausts the monthly budget mid-session and produces a CI-blocked-on-billing state that surfaces as opaque "all workflows failing in <10s" — a class of environment-failure with no clear signal from the workflow logs themselves.

## Tracking in PR body

When this mode is active, build agents confirm in the "Dispatch-template clauses honored" section:

```markdown
- **CI-quota-constrained mode:** ✅ `[skip ci]` on all commits; manual workflow trigger on final commit before merge; label-gated E2E.
```
