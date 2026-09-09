# Clause #11 — Adversarial ideation gate (PERMANENT, greenfield only)

**Applies to:** the pre-Wave-0 ideation session for a **new project** — the session that decides what
the product is, before P1 has a phase spec. Not phase-boundary ideation (that keeps the lighter
PM/Designer sanity-check in `agents/pm-designer.md` §Phase sanity check).

**Enforcement:** hard gate. Wave 0 contract-freeze MUST NOT begin until
`scripts/check-ideation-gate.sh` exits 0. No bypass — same policy as the session-close guardrails.

---

## The five rules

### Rule 1 — Question-first. Never assume without asking.

Every input you don't have, you **ask the operator for**. You do not pick the convenient
interpretation and proceed. You do not infer intent from an adjacent statement. You do not
"reasonably assume" a target user, a price point, a distribution channel, a constraint, or a
success criterion.

Every assumption that survives the session goes in the **assumption register** with one of exactly
three dispositions:

| Disposition | Meaning | Required |
|---|---|---|
| `ASKED` | operator answered it | the answer, quoted |
| `RESEARCHED` | resolved by evidence, not opinion | a citation (§Rule 3) |
| `UNVERIFIED` | still an assumption | a falsifiable kill-criterion attached (§Rule 5) |

An assumption with no disposition is a gate failure. There is no fourth category and no
"self-evident" exemption.

Ask in batches, early, and ask more than feels polite. The failure mode this rule targets is not
rudeness — it's an ideation session that produces a confident plan resting on six unexamined
guesses, each individually plausible, jointly fatal.

### Rule 2 — Research before assuming.

Ordering is mandatory: **research → ask → assume**, never the reverse. Before you ask the operator a
question the public record can answer, go answer it. Before you log an `UNVERIFIED` assumption,
confirm it is genuinely unresearchable within the session's budget — not merely unresearched.

Minimum research surface before the gate opens:
- Does this already exist? Name the incumbents and near-substitutes, or state that a search was run
  and found none (with the queries used).
- What happened to prior attempts at the same idea? Dead products are the cheapest available data.
- What do the platform/API/regulatory dependencies actually permit? Read the terms, not a summary of
  them.

### Rule 3 — Show data, don't tell.

Every material claim carries a citation or a number with provenance. A claim is material if the
plan changes when it's false.

Banned, and treated as a gate failure:
- Unsourced market sizing ("this is a $X billion market").
- Unsourced demand claims ("users want", "people struggle with", "there's clearly a need").
- A number without a link, a date, and a method.
- A competitor summary written from memory rather than from their live pricing/docs page.

Prefer primary sources: the actual pricing page, the actual API docs, the actual filing, the actual
changelog. Cite secondary sources as secondary. Where no data exists, **say so explicitly** — "no
public data found; this is unverified" is a legitimate and valuable finding. Fabricating or
estimating a figure to fill the gap is the failure this rule exists to prevent.

### Rule 4 — Argue both sides, with symmetric rigor.

**The case against comes first and must be genuinely adversarial.** Minimum five distinct failure
modes, drawn from at least four of these categories:

| Category | The question it answers |
|---|---|
| Demand | Does anyone actually want this enough to change behavior? |
| Distribution | How does it reach users, and what does that cost? |
| Technical | What makes this hard or impossible to build well? |
| Economic | Do the unit economics survive contact with real costs? |
| Competitive | What does an incumbent do the week after this works? |
| Dependency / regulatory | What third party or rule can end this unilaterally? |
| Operator | Does the person building this have the time, skills, and access it requires? |

Each failure mode needs a **concrete mechanism** and a **leading indicator** — the observable signal
that this failure is starting to happen. Generic risk-listing ("it might not scale", "adoption could
be slow") is not a failure mode and does not count toward the five.

**The case for gets the same rigor** — it is not a token counterweight appended to soften the
critique. Minimum three reasons this works, each with its own evidence and its own mechanism. An
honest ideation session can and should conclude that a critiqued idea is still worth building.

The output is a comparison, not a verdict looking for support.

### Rule 5 — Falsifiable kill criteria, then a verdict.

Name the conditions under which this project should be **stopped**, in advance, while stopping is
still cheap. Each kill criterion must be falsifiable and observable — a threshold, a date, a
measurable signal. "If users don't like it" is not a kill criterion. "If fewer than 5 of the first
30 people we show it to complete the core flow unprompted, stop" is.

Every `UNVERIFIED` assumption from Rule 1 must map to at least one kill criterion.

Close with a verdict — `GO`, `NO-GO`, or `RESHAPE` (with what changes) — and the single strongest
argument against your own verdict.

### Rule 6 — Search the space, not only the specification.

The first five rules interrogate the idea you were handed. **None of them asks whether a better idea
sits beside it.** A session that concludes "this plan fails" without having looked at what else the
same operator, the same skills, and the same already-paid-for research could build has done half the
job — and the half it skipped is the one that produces a project rather than a verdict.

So, before the verdict: **name and score at least three genuinely distinct alternatives, with the
specification itself scored among them on identical terms.** Distinct means a different buyer or a
different job — not the same product with a feature toggled. Score against the operator's real
constraints: their time, their money, their skills, their distribution. Not an idealised founder's.

Two opposite failure modes this rule exists to catch:

- **The costume verdict.** `RESHAPE` is the verdict an advocate reaches by default, because it
  preserves whatever survived and discards whatever was refuted, and it therefore feels like analysis
  while functioning as permission. A reshape that leaves the load-bearing objections untouched is a
  `NO-GO` wearing a costume. Scoring alternatives is what exposes it — if the reshaped specification
  ranks below three alternatives on the operator's own constraints, the reshape was cosmetic.
- **The pivot reflex.** An agent asked to find a better idea will always find one. Scoring the
  incumbent specification on identical terms is what stops *different* being mistaken for *better*,
  and it is why the specification must appear in the table rather than beside it.

**Rule 3 binds an alternative exactly as hard as it binds the specification.** An unsourced claim
that some adjacent market is underserved is a gate failure, not a pivot. "This space looks empty"
without a search that would have found the incumbents is the single most likely way this rule gets
abused.

---

## Body (paste verbatim into pre-Wave-0 discovery/critique dispatch briefs)

> **Clause #11 — Adversarial ideation (PERMANENT).** This is a greenfield ideation dispatch. You are
> being asked to stress-test an idea, not to validate it.
>
> 1. **Never assume without asking.** Any input you lack, ask the operator for. Do not infer it, do
>    not pick the convenient reading, do not proceed on "reasonable assumption." Every surviving
>    assumption must be labelled `ASKED` (quote the answer), `RESEARCHED` (cite the source), or
>    `UNVERIFIED` (attach a kill-criterion). No fourth category.
> 2. **Research before assuming.** If the public record can answer it, go answer it before you ask
>    or assume. Read primary sources — the actual pricing page, API docs, terms, filing.
> 3. **Show data, don't tell.** Every material claim carries a citation or a number with a link, a
>    date, and a method. Unsourced market sizing and unsourced demand claims are rejected outright.
>    "No public data found" is a legitimate finding; an invented estimate is not.
> 4. **Be extremely critical first.** Produce at least five distinct, specific failure modes across
>    at least four categories (demand / distribution / technical / economic / competitive /
>    dependency-regulatory / operator). Each needs a concrete mechanism and a leading indicator.
>    Generic risk-listing does not count. Then argue the other side with equal rigor: at least three
>    reasons this works, each with evidence and a mechanism.
> 5. **Falsifiable kill criteria.** Name in advance the observable thresholds at which this should
>    be stopped. Each unverified assumption maps to at least one. Close with `GO` / `NO-GO` /
>    `RESHAPE` and the strongest argument against your own verdict.
> 6. **Search the space, not only the specification.** Before the verdict, name and score at least
>    three genuinely distinct alternatives — a different buyer or a different job, not a feature
>    toggle — with the specification itself scored among them on identical terms, against the
>    operator's real constraints. Rule 3 binds an alternative as hard as it binds the specification;
>    an unsourced "this space looks empty" is a gate failure, not a pivot.
>
> Write your findings into `plans/ideation-<slug>.md` using the structure in
> `templates/ideation-brief.md`. `scripts/check-ideation-gate.sh` must exit 0 before Wave 0 begins.

---

## Dispatch shape

The orchestrator does not run this alone — a single voice arguing with itself converges too fast.
Dispatch in parallel (single message, multiple `Agent` tool_use blocks, per Clause #10's mechanics):

| Agent | Lens | Brief |
|---|---|---|
| Research | Prior art, incumbents, dependencies | Rule 2's minimum research surface. Returns citations, not opinions. |
| Red-team A | Demand + distribution | Why does nobody want this, and how does it fail to reach them? |
| Red-team B | Technical + dependency/regulatory | What makes this unbuildable, or killable by a third party? |
| Red-team C | Economic + competitive + operator | Where do the unit economics break, who crushes it, can this operator ship it? |
| Steel-man | The case for | Strongest honest case, same evidentiary standard. Dispatched *after* the red teams return, and must engage their findings rather than ignore them. |

**Then a second wave, for Rule 6.** The five lenses above are all pointed at the specification — four
attack it, one defends it. None is pointed at the market. Dispatch these in parallel after the
steel-man returns:

| Agent | Lens | Brief |
|---|---|---|
| Demand archaeologist | Revealed preference | Not market research — money people are *already spending* to get this outcome. Freelance-marketplace gig prices and completed-order counts, productized-service listings, paid add-on install counts, job postings, "I'll pay someone to…" threads. Must return a buyer segment named concretely enough to contact twenty of them this week. |
| Gap scout | Unserved need | What do users of the incumbents visibly want that nobody sells? Mine 1–3 star reviews, upvoted feature requests left open for years, issues closed as *not planned*, and the workarounds people build by hand. **A recurring workaround is a product.** Separate gaps that stay open for a *structural* reason — the incumbent cannot close them without cannibalising itself — from gaps that close the moment someone builds them. |
| Pivot architect | Candidate shapes | Generate 5–7 distinct candidates and score them against the operator's real constraints. **The specification itself is a mandatory candidate, scored identically.** Must state plainly which candidates have no distribution answer rather than letting them hide behind product cleverness. |

**Sequencing matters and it is not negotiable.** The generative wave runs *after* the adversarial
wave, so it inherits what is already known to be broken and does not re-propose it. Its findings then
go **back** to the steel-man or the pivot architect for a re-score — an alternative surfaced after the
scoring is done has not actually been scored. Expect the verdict to move; if it never moves, the
generative wave was decorative.

The orchestrator synthesizes into `plans/ideation-<slug>.md`, takes the operator's answers to the
open questions, and runs the gate. Red-team agents that return nothing are a signal to re-dispatch
with a sharper brief, not a clean bill of health. **A pivot architect that always recommends pivoting
is as useless as a steel-man that always recommends `GO`** — check that the incumbent specification
was genuinely scored rather than listed.

---

## Why permanent

**Provenance note — this clause differs from the others in this directory.** Clauses #3, #6, #9, and
#10 are retro-derived: each traces to a specific observed failure with a measured token cost. Clause
#11 is an **operator directive, adopted 2026-08-24**, and is forward-looking. It has no incident
behind it yet and carries no measured savings band. That is stated plainly rather than dressed up in
a fabricated retrospective — inventing provenance would violate the clause's own Rule 3.

The reasoning it encodes: agentwaves is a framework for executing a roadmap with high discipline.
Everything downstream of Wave 0 — contract freeze, issue decomposition, reviewer trios, guardrails —
optimizes for building the specified thing correctly. **None of it checks whether the specified
thing is worth building.** A protocol this good at execution is exactly the protocol that will
efficiently ship the wrong product for eight phases. The ideation gate is the only place that class
of error is cheap to catch, and the cost asymmetry is extreme: a session of adversarial questioning
against months of misdirected build capacity.

The clause also exists because the default failure mode of an eager agent is agreement. Asked to
brainstorm, an assistant reaches for enthusiasm and plausible-sounding support. Rules 1 and 4 exist
to make that behavior a gate failure rather than a pleasant conversation.

Revisit after the first two projects gate through it — if it produces ritual compliance rather than
real findings, tighten the specificity requirements rather than loosening the gate.

### Amendment 1 — Rule 6 and the generative wave (2026-08-26)

**This part is retro-derived, and here is the incident.** The first project to run this gate
(`dashero`, S1) dispatched the five lenses exactly as specified. They worked: the research agent
found that the platform owner had shipped the product's core mechanic twelve days earlier, that the
project's name was a registered trademark in its own software class, and that a major publisher had
built and silently archived the identical specification eight years prior. The red teams established
that the build was roughly 3x the available time and that every enumerated channel summed to about
four paying customers against a target of forty. The steel-man, dispatched last and correctly, closed
by arguing that its own `RESHAPE` verdict was *"a NO-GO wearing a costume"* because it left both
load-bearing objections untouched.

That is the gate working. **And it was still only half a session.**

Every one of those six agents was pointed at the specification. The operator observed this and asked
for the missing lens. Three further agents were dispatched with generative briefs under the same
evidentiary rules, and they produced the findings that actually changed the verdict: revealed
willingness-to-pay in an adjacent segment priced per client rather than per artifact, a recurring
unmet need evidenced across *unrelated* verticals, and a candidate ranking in which **the original
specification placed last of eight** on the operator's own constraints. None of this required
loosening Rule 3 — the generative agents cited primary sources and reported negative results exactly
as the adversarial ones did.

The lesson is narrow and worth stating precisely: **the clause was well-designed for deciding whether
an idea is good, and had no mechanism for finding a better one.** Rules 1 through 5 make a session
rigorous. Rule 6 makes it useful. A gate that can only return "no" wastes the research it just paid
for, because the incumbents, the pricing, the dependency surface and the buyer segments are all
already on the table by the time the verdict is written.

Two guardrails came out of the same session and are encoded above. The generative wave must run
*after* the adversarial one, or it re-proposes things already known to be broken. And its findings
must be fed back for a re-score, because on that project the pivot architect's initial recommendation
was falsified by demand data that arrived from a sibling agent an hour later — its own service pricing
sat *below* the market anchor, which it discovered only when the anchor was handed to it.

**No measured savings band.** As with the original clause, none is claimed.

---

## Doesn't apply to

- Phase-boundary ideation on an existing project (use `agents/pm-designer.md` §Phase sanity check).
- Wave 1 build dispatches, reviewer dispatches, QA, docs — every other dispatch surface.
- Projects where the operator explicitly declares the idea already validated **and** records that
  declaration in the ideation brief's verdict section with their reasoning. The gate still runs; the
  operator's declaration is the evidence.

## Tracking

The orchestrator confirms in the Wave 0 contract-freeze PR body:

```markdown
- **Clause #11 (adversarial ideation gate):** ✅ `plans/ideation-<slug>.md` complete;
  `scripts/check-ideation-gate.sh` exit 0. Verdict: <GO | RESHAPE>. <N> failure modes logged,
  <M> unverified assumptions each mapped to a kill criterion, <K> alternatives scored
  (specification ranked <R> of <K>).
```

If the specification did not rank first among the scored alternatives, say so in the PR body and say
why Wave 0 is proceeding on it anyway. That sentence is the whole point of Rule 6 — it is cheap to
write when the answer is good and uncomfortable when it is not.
