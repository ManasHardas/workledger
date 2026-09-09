# Ideation brief — <project name>

> **Gate artifact for Clause #11.** Copy to `plans/ideation-<slug>.md` and fill. Wave 0 contract
> freeze cannot begin until `scripts/check-ideation-gate.sh` exits 0 against this file.
>
> **The section headings and the `Q-` / `FM-` / `FOR-` / `KC-` id prefixes are load-bearing** — the
> gate script greps for them. Rename them and the gate stops working.
>
> Delete every `<placeholder>` and every `TBD` before running the gate; the placeholder scan is a
> BLOCKER check.

**Session:** S<N> · **Date:** YYYY-MM-DD · **Operator:** <name>
**One-line thesis:** <what this is, in one sentence a stranger would understand>

---

## Open questions

Every question put to the operator, with their answer quoted. Unanswered questions block the gate.
Ask more than feels polite — see Clause #11 Rule 1.

- **Q-1:** <question>
  **A:** <operator's answer, quoted>
- **Q-2:** <question>
  **A:** <operator's answer, quoted>
- **Q-3:** ...

## Assumption register

Every assumption the plan rests on. Exactly one disposition each — `ASKED`, `RESEARCHED`, or
`UNVERIFIED`. An `UNVERIFIED` row with no kill-criterion reference is a gate failure.

| # | Assumption | Disposition | Evidence / answer | Kill criterion |
|---|---|---|---|---|
| A-1 | <assumption> | RESEARCHED | <link + date> | — |
| A-2 | <assumption> | ASKED | Q-2 | — |
| A-3 | <assumption> | UNVERIFIED | no public data found; queries run: <list> | KC-2 |

## Evidence

Primary sources first. Every row needs a link, a date accessed, and what it establishes. Minimum
three. "No data found" rows are legitimate — record the queries you ran.

| # | Claim it supports | Source | Date | Type |
|---|---|---|---|---|
| E-1 | <claim> | <url> | YYYY-MM-DD | primary |
| E-2 | <claim> | <url> | YYYY-MM-DD | secondary |
| E-3 | <claim> | searched `<queries>` — no public data found | YYYY-MM-DD | negative |

### Prior art / incumbents

| Product | What it does | Pricing | Still alive? | Source |
|---|---|---|---|---|
| <name> | <what> | <price> | <yes / dead YYYY> | <url> |

### Dependency + regulatory surface

What third parties or rules can unilaterally end this. Read the actual terms, not a summary.

- <dependency> — <what its terms actually permit> (<url>, accessed YYYY-MM-DD)

---

## The case against

Minimum **five** failure modes across at least **four** categories: demand, distribution, technical,
economic, competitive, dependency/regulatory, operator. Each needs a concrete mechanism and a
leading indicator. Generic risk-listing does not count.

### FM-1 — <one-line failure mode> · *<category>*
**Mechanism:** <the specific causal chain by which this kills the project>
**Leading indicator:** <the observable signal that this is starting to happen>
**Evidence:** <E-n, or "none — this is a reasoned argument, not an evidenced one">

### FM-2 — <one-line failure mode> · *<category>*
**Mechanism:** ...
**Leading indicator:** ...
**Evidence:** ...

### FM-3 · FM-4 · FM-5 — ...

## The case for

Minimum **three**, same evidentiary standard as the case against. This is not a counterweight
appended to soften the critique — each needs a mechanism and evidence. Written *after* the case
against, and must engage with it rather than talk past it.

### FOR-1 — <one-line reason this works>
**Mechanism:** <why this actually produces value, specifically>
**Evidence:** <E-n>
**Which failure mode it survives:** <FM-n, and why>

### FOR-2 · FOR-3 — ...

---

## Kill criteria

Falsifiable and observable — a threshold, a date, a measurable signal. Named now, while stopping is
cheap. Every `UNVERIFIED` assumption maps to at least one.

### KC-1 — <name>
**Stop if:** <observable threshold, with a number and a deadline>
**Covers:** <A-n, FM-n>
**Check by:** YYYY-MM-DD

### KC-2 — ...

---

## Alternatives considered

Clause #11 Rule 6. Minimum **three** genuinely distinct alternatives — a different buyer or a
different job, not the same product with a feature toggled — **plus the specification itself, scored
on identical terms.** Score against the operator's real constraints, not an idealised founder's.

Rule 3 binds an alternative as hard as it binds the specification. An unsourced "this space looks
empty" is a gate failure.

| # | Candidate | Buyer (specifically) | Job it does | Build (weeks) | Distribution answer | Score | Verdict |
|---|---|---|---|---|---|---|---|
| ALT-0 | <the specification, unchanged> | <who> | <what> | <n> | <channel, or "none — say so"> | <n> | <one line> |
| ALT-1 | <candidate> | <who> | <what> | <n> | <channel, or "none"> | <n> | <one line> |
| ALT-2 | <candidate> | <who> | <what> | <n> | <channel, or "none"> | <n> | <one line> |
| ALT-3 | <candidate> | <who> | <what> | <n> | <channel, or "none"> | <n> | <one line> |

**Scoring criteria used:** <state them, and state which were weighted and why>

**Why the winner beats the specification (or does not):** <2-4 sentences. If the specification ranked
first, say what would have had to be true for it to lose.>

**Evidence that each alternative is not already served:** <E-n per candidate, or an explicit "not
established — searched <queries>, found nothing" per Rule 3>

---

## Verdict

**Decision:** `GO` | `NO-GO` | `RESHAPE`

**Reasoning:** <2-4 sentences>

**If RESHAPE — what changes:** <the specific change to scope, audience, or mechanism>

**Strongest argument against this verdict:** <state it at full strength; do not straw-man it>

**Cheapest next test:** <the smallest, fastest thing that would move the verdict>

---

## Handoff to Wave 0

- **P1 scope this implies:** <one paragraph>
- **Out of scope for P1, deliberately:** <list>
- **Stack decision + rationale:** <what, and why — this unblocks the placeholder fill in `agents/*.md`>
- **Open questions deferred to a later phase:** <list, or "none">
