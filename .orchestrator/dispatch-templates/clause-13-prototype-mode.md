# Clause #13 — Prototype mode (PERMANENT, operator directive)

**Adopted:** 2026-09-09, from the workledger build. Operator's words: *"I am suspecting this
protocol in agentwaves is not suitable for quick prototyping and improving in iterations."* That
suspicion is correct. agentwaves is a correctness-first execution protocol; its reviews find real
defects on nearly every PR, and that is exactly why it is slow. Prototype mode is the other
gear: see it work, then iterate.

## When to use which

| Mode | Use when | Cost shape |
|---|---|---|
| Full protocol (Clauses #3, #6, #9) | Shipping to strangers; credential, money, or data-loss surfaces; a contract other teams consume | Every PR reviewed; fix-cycles; ~3× the build cost |
| Lean (Clause #12) | A specified system for a known user; you want defects caught before merge | One reviewer per PR, one fix-cycle; ~1.5× |
| **Prototype (this clause)** | A first working version to react to; a phase whose contract is already frozen; iteration on something already running | No review round; ~1× |

Prototype mode never applies to a credential surface (API keys, tokens, secrets scanning, anything
that writes outside the repo). Those keep a single Security review even in prototype mode.

## The rules

1. **One agent per sub-phase, end to end.** The brief names the contract, the acceptance
   commands, and the files; the agent builds, tests, and opens the PR. No planning agents, no
   issue decomposition below the sub-phase; one GitHub issue per sub-phase is enough.
2. **The orchestrator verifies, nobody reviews.** The orchestrator runs the acceptance commands
   against the real project (the dogfood repo, the real server, the real harness) and merges on
   green. A defect found this way goes into the next build's brief, not into a review thread.
3. **Contracts still freeze first.** A five-minute contract document beats an hour of drift. It is
   written by the orchestrator as a direct commit and amended the same way.
4. **Tests still land with the code** (Clause #3 stays), but the coverage gate is the only
   quality gate, and a flaky test is fixed or deleted in the same PR, never skipped.
5. **Merge on green, direct commits for everything that is not application code.**
6. **Iterate on the running thing.** After each merge the orchestrator uses the product for one
   real task and writes the next brief from what it saw. The dogfood loop is the review.
7. **Escalate back to Lean or Full for one PR** when the sub-phase touches a credential surface or a
   contract another consumer depends on; say so in the brief.

## Body (paste into prototype-mode dispatch briefs)

> **Clause #13 — Prototype mode.** Build this sub-phase end to end against the contract named
> below; no review will follow, the orchestrator verifies by running it. Tests in the same commit;
> the coverage gate is the only gate. Report in under 100 words: PR, CI, the one command that
> proves it works, and anything the contract got wrong.
