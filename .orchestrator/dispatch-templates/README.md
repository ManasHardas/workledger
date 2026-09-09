# Dispatch-template clauses

Permanent clauses that orchestrator MUST include verbatim in every build-agent dispatch brief. Each clause was extracted from a real-project retrospective where omission produced a recurring failure mode.

| File | Clause | Failure mode it prevents |
|---|---|---|
| `clause-3-test-file-in-initial-commit.md` | Backend impl PRs MUST include test file in INITIAL commit covering ≥70% of new lines | Post-merge fix-cycle to add tests after diff-cover gate fails (~70-100k token tax per affected PR) |
| `clause-6-reviewer-trio-composition.md` | Default-keep / default-prune rules for which reviewers fire on which PR class | Over-reviewing (wasted tokens) on narrow fixes; under-reviewing (escaped Blockers) on novel surfaces |
| `hard-constraint-verification-environment.md` | Verify on host or `docker compose run --rm`; never `docker cp`/`docker exec` to mutate running containers | Image-built artifact mutations that don't survive image rebuild; verification-via-running-container that misses real bugs |
| `close-keyword-convention.md` | `Closes #N` on its own line; one per line for bundled PRs; no close-keywords in narrative prose; no spurious `(#N)` in PR titles | GitHub auto-close keyword fails to match bundled syntax (leaves issues stale-open) or fires *spuriously* on narrative `fixes #N` / title `(#N)` references |
| `ci-quota-constrained-mode.md` (env-var-gated) | When `AW_CI_QUOTA_CONSTRAINED=1`: `[skip ci]` on every commit + admin-merge + label-gate expensive jobs | Exhausting CI minutes mid-session via 5–10× CI runs per draft PR; opaque "all workflows failing in <10s" billing-blocked state |
| `clause-9-ci-workflow-hygiene.md` (MANDATORY) | Every `.github/workflows/*.yml` MUST include `paths-ignore` (docs/plans/orchestrator), `concurrency.cancel-in-progress`, draft-PR gate on heavy jobs, and main-push scope restricted to a cheap canary | CI-minute exhaustion from doc-only re-runs + cancellable iteration runs + draft-PR full-suite firing + redundant heavy main-push re-verification of the same diff |
| `clause-11-adversarial-ideation.md` (greenfield only, once per project) | Wave -1 ideation must ask before assuming, research before assuming, cite data rather than assert it, produce ≥5 specific failure modes across ≥4 categories plus ≥3 evidenced reasons it works, and name falsifiable kill criteria + a verdict. Hard-gates Wave 0 via `scripts/check-ideation-gate.sh` | Executing a well-disciplined roadmap toward a product nobody needed — the one error class no downstream wave can catch, since Wave 0 onward optimizes for building the *specified* thing correctly |
| `clause-10-throughput-maximization.md` (orchestrator-side, applied by default once anchors stable n≥3) | Apply 3 throughput levers by default: (1) parallel build dispatches via single message with multiple Agent tool_use blocks on disjoint T-X file-lock units, fan-out 3-4; (2) Wave-boundary compression — combine Wave 0 + 0 step 2 + 0.5 + first Wave 1 slots same session; (3) sibling-shape bundling of 2-3 issues per dispatch within class anchor | Wasted session-start ritual overhead (~150-200k/session) + unused budget headroom (700-900k/session) when running serial-by-default once anchors stable; calendar-time waste when phase-boundary splits across 3 sessions for no parallel-work benefit |

## Clause-application surfaces

Clauses split into two surfaces:

1. **Build-agent dispatch briefs (clauses #3, #6, HARD CONSTRAINT, close-keyword, #9).** Pasted verbatim into the prompt the orchestrator sends to a build agent. The build agent reads and acts on the clause body during its dispatch.
2. **Orchestrator-side dispatch shape (clause #10).** Consulted by the orchestrator at dispatch-decision time (which agents to dispatch, in what fan-out shape, in which session boundary). NOT pasted into the per-agent brief — these clauses govern the orchestrator's own behavior.
3. **Both (clause #11).** Its five-rule body is pasted verbatim into the Wave -1 red-team / research / steel-man briefs; its dispatch shape and hard-gate rules govern the orchestrator. Fires once per project, on greenfield only.

## How to compose into a dispatch brief

Inside the orchestrator's dispatch prompt template (`agents/orchestrator.md` §Wave 1 Agent dispatch template), insert each build-side clause's body verbatim. Don't paraphrase. The clauses are calibrated to what the build agent will read and act on; paraphrase risks losing the specificity that makes the clause useful.

Example dispatch-brief skeleton:

```
You are the **<role> agent**. Read your role at `agents/<role>.md` first.

[Project-specific context: working directory, branch state, current phase + wave]

# Task

Implement issue **#<N>** — `<issue title>`. Read full spec via `gh issue view <N>`.

[Phase-specific context: sibling PRs, conventions, frozen contracts]

# DISPATCH-TEMPLATE CLAUSES (mandatory)

[Clause #3 body — paste from clause-3-test-file-in-initial-commit.md]

[Clause #6 body — orchestrator picks default-keep/default-prune row appropriate to this PR's class]

[HARD CONSTRAINT body — paste from hard-constraint-verification-environment.md]

[Close-keyword body — paste from close-keyword-convention.md]

# Out-of-scope guardrails (DO NOT cross)

[Project-specific scope-fence reminders]

# Verification gates (must pass before `gh pr ready`)

[Project-specific test commands + diff-cover thresholds]

# Return contract

[What you want the agent to report back]
```
