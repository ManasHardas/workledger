# Clause #9 — CI workflow hygiene (MANDATORY)

Every `.github/workflows/*.yml` file MUST include four hygiene rules. Every new workflow MUST include them at creation; every existing workflow MUST be updated at first touch. The Infra agent owns enforcement.

This clause is mandatory in EVERY project — it doesn't need `AW_CI_QUOTA_CONSTRAINED=1`. The reactive `ci-quota-constrained-mode.md` clause is the recovery path AFTER the budget has been hit; this clause is the prevention.

## The four mandatory rules

### Rule 1 — `paths-ignore` for non-build paths

Every workflow's `on.pull_request` AND `on.push` blocks MUST exclude docs / plans / orchestrator files. These paths change frequently (SHD regens, chore-close commits, README edits) but never affect build correctness.

```yaml
on:
  pull_request:
    paths-ignore:
      - 'plans/**'
      - '**/*.md'
      - '.orchestrator/**'
      - 'docs/**'
      - 'LICENSE'
  push:
    branches: [main]
    paths-ignore:
      - 'plans/**'
      - '**/*.md'
      - '.orchestrator/**'
      - 'docs/**'
      - 'LICENSE'
```

**Customize per project:** if a workflow exists specifically to validate docs (link-check, markdown-lint), it inverts the rule — `paths:` instead of `paths-ignore:`. Don't apply this clause to such workflows.

**Why mandatory:** every `chore: SXX SESSION-CLOSE` commit re-runs every workflow on a docs-only push. Over a 20-session window with 7 workflows × ~5 min each, that's ~700 wasted CI minutes. SHD regens add the same wasted runs.

### Rule 2 — `concurrency.cancel-in-progress: true`

Every workflow MUST declare a concurrency group that cancels in-progress runs when a new push arrives on the same ref.

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**Why mandatory:** during iterative review (push fix → review → push another fix), the prior run becomes irrelevant the moment a new commit lands. Cancelling it reclaims minutes that would have completed for nothing. Routine; no downside.

### Rule 3 — Draft-PR gate for heavy workflows

Workflows whose typical run cost is > 3 minutes (e2e, integration, image builds, load/smoke tests, large matrix builds) MUST gate themselves on the PR being `ready_for_review`:

```yaml
jobs:
  <job-name>:
    if: github.event_name != 'pull_request' || github.event.pull_request.draft == false
    runs-on: ubuntu-latest
```

Cheap workflows (lint, typecheck, unit tests under ~3 min, codegen-check) do NOT need this gate — fast signal during draft iteration is valuable and the marginal cost is low.

**Why mandatory:** draft PRs typically iterate 5-15 times before `gh pr ready`. Every push triggers full CI on every workflow. A 5-minute e2e workflow × 10 iterations = 50 minutes burned on a single PR that hasn't been reviewed once. The cheap signals still run; the expensive ones wait until the PR is ready.

### Rule 4 — Restrict heavy workflows from `push: branches: [main]`

Heavy workflows that ALREADY ran on the PR before merge MUST NOT re-run on the squash-merge commit landing on main. Keep a cheap canary (lint OR typecheck OR unit) on the main-push event to catch direct-to-main commits (which are rare and forbidden under most project policies anyway); drop the heavy ones.

```yaml
# Heavy workflow: PR-only
on:
  pull_request:
    paths-ignore: ...

# Cheap canary: PR + main-push
on:
  pull_request:
    paths-ignore: ...
  push:
    branches: [main]
    paths-ignore: ...
```

**Why mandatory:** the squash-merge commit on main has the exact same diff as the PR head that was just verified. Re-running e2e + integration + k6 + build on it is redundant. The cheap canary (~1-2 min) catches the rare direct-to-main commit; the rest of the suite is satisfied by the PR's own green CI.

**Customize per project:** if your project allows direct-to-main commits as a regular workflow (e.g. for dev-tooling phases), keep the main-push trigger on more workflows. Most projects under the agentwaves protocol forbid direct-to-main per orchestrator §Dogfood discipline — so this rule applies cleanly.

## Body (paste verbatim into infra-agent dispatch briefs)

> **Clause #9 — CI workflow hygiene (MANDATORY).** If this PR touches `.github/workflows/*.yml`, every workflow you modify MUST include:
>
> 1. `paths-ignore` for `plans/**`, `**/*.md`, `.orchestrator/**`, `docs/**`, `LICENSE` on both `pull_request` and `push` triggers (unless the workflow exists specifically to validate docs).
> 2. `concurrency` block with `group: ${{ github.workflow }}-${{ github.ref }}` and `cancel-in-progress: true`.
> 3. Draft-PR gate (`if: github.event_name != 'pull_request' || github.event.pull_request.draft == false`) on jobs whose typical run cost is > 3 minutes.
> 4. Restrict heavy workflows to `pull_request` only — drop `push: branches: [main]` for jobs that already ran on the PR. Keep a cheap canary (lint or typecheck or unit) on main-push.
>
> If you're touching a workflow that lacks these (legacy), add them in the same PR. If you're not touching workflows, don't open a separate hygiene PR — file an issue for the next infra slot.

## Verification checklist

Before `gh pr ready` on any infra PR that touches workflow files:

```bash
# Confirm paths-ignore present
grep -lE "paths-ignore" .github/workflows/*.yml

# Confirm concurrency present
grep -lE "cancel-in-progress: true" .github/workflows/*.yml

# Manually check heavy workflows (e2e, integration, load, build) have draft-gate
grep -l "pull_request.draft == false" .github/workflows/*.yml
```

If a workflow file modified in the PR lacks any of these, the PR is incomplete — add them before marking ready.

## Why permanent

Two retrospective sources combined into this clause:

1. **The CI-minutes-exhaustion retro.** A project on the GitHub free tier (3000 Actions minutes/month for the personal account) hit 100% quota mid-session via a single multi-iteration ci-fix PR (4 iterations × 7 workflows × ~5 min average = ~140 min) plus accumulated SHD-regen + chore-close runs across the month. The block manifested as opaque "all workflows failing in <10s" with the cryptic `"The job was not started because recent account payments have failed or your spending limit needs to be increased"` annotation. Two of the four mandatory rules above (paths-ignore + main-push restriction) would have averted ~60-80% of the burn that led to the exhaustion.

2. **The session-close-rollup-drift retro.** Several sessions worth of `chore: SXX SESSION-CLOSE` commits each re-ran the full CI suite despite touching only `plans/**`. The drift surfaced when the same project also surfaced the CI-minute exhaustion — both rooted in the same omission (no `paths-ignore` on the docs paths).

Both retrospectives produced the same conclusion: CI workflow hygiene must be a permanent clause, not an optional reactive mode. The reactive `ci-quota-constrained-mode.md` clause is the recovery once the budget is hit; this clause is the prevention.

## Relationship to `ci-quota-constrained-mode.md`

With this clause active in every project, the reactive mode should rarely fire. If it does, the project SHOULD also audit its workflows against this clause — recurring `AW_CI_QUOTA_CONSTRAINED=1` activation is a signal that one of the four rules is being violated somewhere.

## Tracking in PR body

Build agents working on workflow files confirm in the "Dispatch-template clauses honored" section:

```markdown
- **Clause #9 — CI workflow hygiene:** ✅ paths-ignore + concurrency + draft-gate + main-push scope verified on all touched workflows.
```
