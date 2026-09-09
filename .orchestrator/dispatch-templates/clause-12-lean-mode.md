# Clause #12 — Lean mode (PERMANENT, operator directive)

**Applies to:** every dispatch, every review, every issue, every report, in every wave.

**Adopted:** 2026-09-09, from the workledger P1 retrospective (S1). Operator's words: *"the
agentwaves protocol is creating too much bloat in issues and code. Stick to the work and do it
precisely. Don't go on sidequests."*

## What went wrong

In one session, 8 build PRs consumed ~6M tokens. The work itself was correct, but the protocol
multiplied it: three reviewers per credential-surface PR, each writing 300-word reviews plus
1,000-word issue bodies plus PR bodies with tables; six of eight PRs took a second review round;
reviewers ran their own fuzz corpora and filed follow-up issues; builders reported deviations in
prose longer than the diff. Bootstrap anchors were exceeded 3–5× on every slot, mostly by process,
not by code.

## The rules

1. **One reviewer per PR by default.** Code Review alone. Add Security only when the PR handles
   credentials, transcripts, or writes outside the ledger; add SRE only when the PR has a stated
   timing or concurrency budget. Never three reviewers on a PR under 500 changed lines.
2. **One fix-cycle, then merge or split.** Blockers get exactly one fix round. If the fix
   introduces new blockers, the orchestrator merges what is correct and files one issue for the
   rest. No third review round, ever.
3. **Reviews find blockers, not everything.** A review lists Blockers with file:line and one
   sentence each. Importants and Nits go in a single line each or not at all. No independent
   corpora, no timing tables, no re-derivations of the spec. A review is under 150 words.
4. **Issues are five lines.** Scope (2 lines), files (1 line), acceptance (2 lines, as commands).
   No class/reviewer tables, no clause boilerplate; the orchestrator's dispatch brief carries
   the clauses.
5. **Builder reports are under 100 words**: PR number, CI status, the one-line verification, and
   deviations only if they change a contract. No timing tables, no restated acceptance lists.
6. **No side quests.** A reviewer or builder who notices a problem outside the issue's scope
   writes one sentence in the PR and stops. They do not fix it, measure it, or file it; the
   orchestrator decides.
7. **No new process artifacts.** No new scripts, checks, templates, or follow-up issues unless
   the phase spec names them. A "hardening beyond the issue" is a side quest.
8. **Merge on green.** A PR with no Blockers, CI green, and the acceptance commands passing is
   merged by the orchestrator without a re-verification round.
9. **Batch the paperwork.** Velocity, wave-state, capacity-log, and tracking-issue updates are
   written once at session close, not per merge.
10. **Prefer the direct commit.** Contract amendments, chore-closes, and docs-only changes are
    committed to `main` by the orchestrator, not opened as PRs.

## Why permanent

The protocol's discipline (contracts, tests in the first commit, reviewers) is what made S1's
code correct. Lean mode keeps the discipline and removes the ceremony around it. A phase that
would take 10–20 sessions under full ceremony should take 4–5 under lean mode with the same
defect rate; if the defect rate rises, tighten rule 1, not the others.

## Body (paste into every dispatch brief)

> **Clause #12 — Lean mode (PERMANENT).** Do exactly the issue, nothing beside it. Report in
> under 100 words. Do not measure, fuzz, or file anything outside the issue's acceptance list;
> if you notice a problem elsewhere, write one sentence in the PR and stop. Reviewers: Blockers
> only, file:line, one sentence each, under 150 words total.
