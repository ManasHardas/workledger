# STEEL-MAN — the strongest honest case, after the red teams

All first-party measurements taken 2026-09-06 on the operator's machine, read-only. Nothing under
`dome_workspace/keys/` was opened. Token figures use the brief's 1.3 tokens/word convention.

---

## 0. First-party measurement (method + numbers)

**Corpus.** 20 handoffs (2026-07-24 → 2026-09-04), 23,969 words. 38 memory files, 16,454 words.
`CLAUDE.md` 1,454 words. 8 ADRs in `dome-data-module/docs/design/`, 16,405 words. 10 spec/plan
pairs under `docs/superpowers/` across 6 repos, 49,247 words. **Total durable-knowledge corpus:
107,529 words ≈ 139,788 tokens.**

**Overlap between consecutive handoffs** (normalised 5-gram shingles, `/tmp/.../overlap.py`):
mean **4.3%** with the immediately prior handoff, mean **4.5%** with *all* prior handoffs combined.
The newest handoff (`2026-09-04_1300`, 792 words) shares **0.0%** with its predecessor. Verbatim
repeated logical blocks (≥8 words) across handoffs: **14**, the top one ("ask before any use of the
consumer key… reads and probes included") in **5** files.

**Read cost at session start.** `CLAUDE.md` instructs: newest handoff first, then "skim
`.claude/memory/`". Literal path (CLAUDE.md + newest handoff + `MEMORY.md` index) = **2,929 words ≈
3,808 tokens**. CLAUDE.md + newest handoff + *all* memory = 18,700 words ≈ 24,310 tokens. Full
recovery (CLAUDE.md + all handoffs + all memory) = 41,877 words ≈ 54,440 tokens.
**The documented entry point reaches 2.7% of the 107,529-word corpus.**

**Memory typing.** Only **14 of 38** files carry frontmatter with `type:`; observed values are
`project` (8), `reference` (3), `feedback` (3) — the harness's own taxonomy. **Zero files are typed
as a decision.** By content (my reading of titles/first headings, not frontmatter): ~12
rules/prohibitions, ~16 discoveries/facts, ~9 reference.

**Index decay.** `MEMORY.md` last written 2026-08-29. **7 of 37** memory files are absent from it —
including `what-dome-is.md` (written 2026-09-02), the founder's own definition of the company, and
`card-release-mechanics.md`, which covers a CLAUDE.md hard limit. Both are unreachable from the
documented session-start path.

**Re-litigation markers** (handoffs + memory + CLAUDE.md, 41,877 words): `never` **199**, `again`
47, `do not` 40, `already` 39, `deleted` 16, `twice` 10. Rule replication: the consumer-key rule
appears in **20 files**; "never touch [GitHub]" in **13**; "release branch only" in **7**.

**Named instances of a decision violated or re-learned** (verbatim):
- `2026-08-10_0200_handoff.md:171` — "**The same swallow, twice, in one codebase.** `geocode_places`
  ended `_loads_json(raw) or {}` … which is verbatim the bug `_loads_json`'s own docstring says it
  was written to prevent. **A lesson can be learned, documented, and then undone at a call site.**"
- `card-identity-is-the-iuid.md:47` — "## **The same bug again, one week later**: a rep is their
  ACCOUNT".
- `CLAUDE.md` — "`--help` is not a safe probe. (**Cost $1.40–2.70 on 2026-08-03** when it was
  treated as one.)" → produced a new hard limit *and* a new memory file after the fact.
- `CLAUDE.md` / `card-release-mechanics.md:19` — "A local `deploy.py` was written and run against
  the deploy API on 2026-07-27; it was **deleted for exactly this reason**."
- `CLAUDE.md` — "four modules used to [recompute paths], and **two disagreed** about what
  'workspace' meant."
- `2026-08-14_0930_handoff.md:105` — "The probe settled it on 2026-08-12. **The gate should have
  come off then.**"
- Carried-forward open item: "ADR-0004's deploy token has still not been rotated" repeats verbatim
  across **3** handoffs (08-10, 08-10, 08-14).

**Agent fan-out.** `~/.claude/projects/-Users-manashardas-Projects-dome-workspace/`: 14 retained
top-level session transcripts, **108 subagent transcripts**, three sessions at **33 / 36 / 38**
subagents each.

**Decision hygiene already practised.** 6 of 8 ADRs carry `**Decision owners:** Manas Hardas
(product/eng), with design assistance`. ADR-0007: "**Supersedes the open items of:** ADR-0004".
ADR-0003 "considered, deferred… Revisit when the preconditions in §5 hold". ADR-0002 §8
"Alternatives rejected"; ADR-0005 §4.1 "Local OCR — **rejected on evidence**", §4.3 rejected. The
newest handoff has a section titled "**Decisions taken by the founder this session**" with three
statuses: accepted / approved / "Not yet agreed". **ADR cadence: 8 ADRs 2026-07-24 → 2026-08-04,
then none for 33 days** while handoffs continued to 09-04.

**agentwaves is not used here.** No `wave-state.md`, `next-session.md` or `capacity-log.md` exists
anywhere in `dome_workspace`. The operator abandoned his own published protocol in his own primary
project.

---

## 1. Engagement with each failure mode

**FM-A1 (markdown ate the win) — PARTIALLY REBUTTED.** E-A2's ">20% inference cost" is about
repository overviews and context files as a class; the measured payload here is 3,808 tokens =
**1.9%** of a 200k-token session. But the residual claim is not "more context wins" — it is that the
newest handoff *carries almost no state*: 4.3% mean overlap with its predecessor, 0.0% for the
newest. CLAUDE.md calls it "the source of truth"; measurement says it is a delta. Conceded: the
handoff is LLM-written, which is E-A2's worst-performing class, and this argues for a better file
before it argues for a database.

**FM-A2 (100-agent org is a projection) — PARTIALLY REBUTTED.** Measured: one human already directs
38 agent sessions inside a single work session (108 subagent transcripts / 4 parents). But those
subagents report back *in-context* to a live parent, so the collision problem A2 describes does not
arise. FM-A2 stands against §1's framing and against Wedge D; it does not touch the longitudinal
pain the operator actually named.

**FM-A3 (vendor #4 into a free commodity) — CONCEDED** for storage, extraction and retrieval
(E-A5 claude-mem 93k★, E-A17 mem0 132k npm/wk, E-A6 auto memory on by default). Not conceded for
the decision-with-named-approver primitive, which research-native (b)#1 says **no vendor models**.

**FM-A4 (no budget line) — CONCEDED.** No first-party evidence bears on it. Implies: this is not a
company yet.

**FM-A5 (install path / MCP long tail) — CONCEDED.** Implies v0 must require zero distribution.

**FM-A6 (nobody acts on LLM-extracted decisions) — PARTIALLY REBUTTED, then partly conceded back.**
The human approval step is *already happening unprompted, without a product*: 6 ADRs with a named
decision owner, an explicit supersession, and a handoff section of founder decisions with three
statuses. But the decay is also in the data: **the ADR practice stopped 2026-08-04, 33 days ago**,
while the cheaper handoff artefact continued. FM-A6's leading indicator has already fired here.

**FM-A7 (cold start; the operator's conventions prove the ceiling) — CONCEDED and strengthened.**
New evidence against my own side: agentwaves is not used in `dome_workspace` at all. Implies: do not
build a protocol; build only what survived contact with the primary project — timestamped handoffs,
a memory directory, ADRs.

**FM-B1 (private, churning transcript schema) — REBUTTED for the surviving shape.** The 20 handoffs
and 38 memory files were produced with **zero transcript parsing**: the agent that lived the session
wrote them before it ended. No parser, no schema, no decay rate. Conceded for the proposal's §17
"session observer" design, which is unbuildable at this rate of churn (E-B6, E-B2).

**FM-B2 (extraction cost per session) — REBUTTED, with arithmetic.** Measured durable *output* per
session: 1,558 tokens (handoff) + 1,070 tokens (memory) = **2,627 tokens**. Write-at-source cost:
**$0.013 (Haiku) / $0.026 (Sonnet 5) / $0.066 (Opus 5)** per session against E-B18/E-C1 output
rates, versus $0.215 / $0.43 / $1.075 for the 200k-token re-read model. At 159 sessions/dev/month
(E-C5): **$2.09–$10.44/dev/month vs $34–$68**. Caveat: the input is free only because the writing
session already holds it; a crashed or compacted session yields nothing.

**FM-B3 (nothing invalidates a claim when code changes) — CONCEDED. This is the strongest technical
objection and it is corroborated first-party**: "ADR-0004's deploy token has still not been rotated"
carried unchanged across 3 handoffs; ADR-0006 status "Accepted, **unbuilt**"; the index stale within
4 days. Implication: cite-and-verify (E-B9/E-N17) is mandatory, and anything without it must be
scoped to claims that do not decay with a `git push` — prohibitions, approvals, rejected
alternatives, product facts.

**FM-B4 (retrieved-but-wrong is worse than nothing) — PARTIALLY REBUTTED.** The measured
session-start payload is *pointed at*, not retrieved: CLAUDE.md → newest handoff → index. No
embeddings, no cosine ranking, so no distractor injection channel. E-B13's finding indicts the
vector-retrieval design, which the surviving shape must not build. Conceded: 2.7% reachability means
the pointed-at path underserves, and widening it re-opens B4.

**FM-B5 (platform absorption) — CONCEDED** for storage and extraction (E-N4/E-N30/E-C28 Memory
Stores + Dreams; E-B8 `teamMemorySync`). Not conceded for the approval schema: E-N1 says auto memory
is machine-local, E-N2 says it "skips anything it can derive from the codebase", and none of the
shipped stores carries proposer-vs-approver, status, or rejected alternatives.

**FM-B6 (cross-agent presence) — CONCEDED entirely.** Do not build Wedge D. The operator explicitly
did **not** select "parallel agents colliding" as a pain.

**FM-B7 (transcript egress) — CONCEDED for cloud extraction; REBUTTED for the surviving shape.**
Write-at-source emits a human-reviewed markdown file into a repo the operator already controls; no
transcript leaves the machine. The workspace already has a `keys/` directory governed by a standing
"never commit or print these" rule.

**FM-B8 ("Agent #847" doesn't survive compaction) — CONCEDED**, first-party: 108 subagent
transcripts, three parents at 33–38, and **not one session id appears anywhere in the handoff or
memory corpus**. The durable actors in the operator's own records are the *human* ("Decision owners:
Manas Hardas") and the *artefact*. Drop agent identity from the thesis.

**FM-C1 (inverse operating leverage) — PARTIALLY REBUTTED.** FM-B2's arithmetic puts COGS at
$2–$10/dev/month, which clears 60–85% GM against a $16–29 seat (E-C13, E-C17). But the structural
point survives: at 36× subagent fan-out, cost per billable human still diverges if every agent
writes. The mitigation — only the parent session writes durable output — is a design constraint,
not a refutation.

**FM-C2 (incumbents did not wait) — CONCEDED as to shipping.** The residual after E-C28/E-C32/E-C33/
E-C34/E-C35/E-C36 is genuinely small: a named human approver, a status lifecycle, and retained
rejected alternatives. That is what is left, and it is all that is left.

**FM-C3 (markdown in git is the free substitute, and the operator already wrote it) — CONCEDED, and
this is the decisive concession.** 107,529 words of durable knowledge exist with no product. But the
same measurement names what markdown does *not* do, specifically: 2.7% reachability; 7 of 37 files
orphaned from the index including the company's own definition; one rule replicated into 20 files
and violated anyway at a measured cost of $1.40–2.70; 199 instances of "never" as the remedy. On
ADRs specifically, FM-C3 calls 15 years a negative result — but this operator wrote 8 ADRs in 11
days with status, owner, supersession and rejected alternatives. **Both halves are true. Writing the
decision is not the bottleneck; keeping it reachable and enforced is.**

**FM-C4 (category confusion) — CONCEDED.** Do not sell an "underlying state layer."

**FM-C5 (assets a solo operator cannot supply) — CONCEDED.** v0 must need no auth, no hosting, no
SOC 2, no registry listing.

**FM-C6 (the org does not exist yet) — PARTIALLY REBUTTED on the metric, CONCEDED on the substance.**
E-C30 measures *user-managed concurrent* agents; measured here is *delegated* fan-out at 33–38 per
session, which E-C30 does not count. But the pain the operator named is longitudinal — "re-briefing
a new session", "decisions forgotten or violated" — not concurrency. FM-C6 correctly kills §1's
framing without touching the pain.

---

## 2. The case for

**FOR-1 — The handoff is a delta, not a state, and the entry point knows only the delta.**
*Mechanism:* a per-session file is written as "what changed", so state does not accumulate in it; a
reader following "the newest is always the source of truth" gets a diff with no base.
*Evidence:* mean consecutive 5-gram overlap **4.3%**; newest handoff **0.0%**; documented entry path
reaches **2.7%** of 107,529 words (first-party, this report). *Survives:* FM-A1 (this is not "more
context", it is a missing base), FM-B4 (a pointer problem, not a retrieval-quality problem).

**FOR-2 — The unserved primitive is already being produced by hand, by the first user, at the
standard the research says nobody ships.** *Mechanism:* the operator, unprompted, writes decisions
with a named human owner, a status, supersession, and rejected alternatives with reasons.
*Evidence:* 6/8 ADRs with `Decision owners: Manas Hardas`; ADR-0007 "Supersedes the open items of
ADR-0004"; ADR-0002 §8 "Alternatives rejected"; ADR-0005 §4.1 "rejected on evidence"; ADR-0003
"deferred… revisit when the preconditions in §5 hold"; newest handoff "Decisions taken by the founder
this session" (accepted / approved / "Not yet agreed"). Cross-referenced against research-native (b)
#1 ("no vendor models proposer vs approver") and research-thirdparty (b)#2 ("rejected alternatives
appear in **no** shipped schema anywhere"). *Survives:* FM-A6 on the writing side, FM-C2 (this is the
residual), FM-C3's ADR-graveyard argument on the writing side.

**FOR-3 — Write-at-source collapses the cost objection, and the proof is 20 files on disk.**
*Mechanism:* the agent that lived the session writes the durable record before it dies; no second
LLM ever reads a transcript. *Evidence:* 2,627 measured output tokens/session → $0.013–$0.066/session
→ **$2.09–$10.44/dev/month**, against E-C1/E-B18 list rates; red-team C's own falsification bar #1
was "<$5/dev/month at acceptable quality." *Survives:* FM-B2, FM-C1 (partly), FM-B1 (no parser),
FM-B7 (no egress).

**FOR-4 — Replication is the operator's actual remedy for "decisions violated", and it is measurably
failing.** *Mechanism:* a rule copied into N files has N places to drift and no authoritative one.
*Evidence:* consumer-key rule in **20 files**, "never touch" in 13, "release branch only" in 7, 199
instances of "never", 14 verbatim duplicated blocks across handoffs — and it still failed three
times on record: the `--help` paid backfill ($1.40–2.70, 2026-08-03), `_loads_json(raw) or {}`
re-introducing "verbatim the bug its own docstring says it was written to prevent", and "the same bug
again, one week later" on rep identity. *Survives:* FM-C3 (this **is** markdown failing, measured),
FM-B5 (E-N2: auto memory "skips anything it can derive from the codebase" — these are not derivable),
FM-B3 (a prohibition does not go stale when a file is deleted).

**FOR-5 — The index decays faster than the corpus, and that is a write-time invariant, not a
product.** *Evidence:* `MEMORY.md` last written 2026-08-29; 7 of 37 files absent from it, including
`what-dome-is.md` (2026-09-02) — the founder's definition of the company — and
`card-release-mechanics.md`, which covers a hard limit. *Survives:* FM-A1/FM-C3 — this is not wiki
rot or context quality; a mechanically generated index cannot go stale.

**FOR-6 — The first user has already scoped the product, narrower than the proposal.** Newest
handoff, "Parked for a separate session (2026-09-05)": "a workspace folder of engineering items
(project/epic/task/bug/**decision**/idea, ids DOME-N, own git repo)… kept in sync by an
agent-agnostic 'session onlooker'". Files in a git repo with ids — not a hosted graph.
*Survives:* FM-A5, FM-C4, FM-C5 (no distribution, no budget line, no compliance).

---

## 3. The shape that survives

**Primitive: the Decision** — a durable record with `id`, `status` (proposed / approved / superseded
/ deferred), a **named human approver**, evidence paths, rejected alternatives with reasons, and
`supersedes`. Its degenerate case is the **standing prohibition** (the 199 "never"s). Not Work, not
Session, not Claim, not a graph. Chosen because it is the only primitive that is (a) already produced
by hand by the first user, (b) shipped by nobody, and (c) immune to FM-B3 — "never push without
asking" does not go stale when a file is deleted.

**First user: the operator and the Dome team, in `dome_workspace`, this month.** Not a buyer, not a
segment. Goal-alignment note: the operator said "I want to eventually make money from it"; this shape
defers that question entirely and buys the only thing that can precede it — evidence at n=1 that the
primitive removes a named, dated, costed failure.

**Wedge: §16C (decision/provenance), not §16A (handoff).** Handoff is the worst position on the
board: E-T44 (four HN handoff launches at 1/2/5/5 points), E-C32 (Amp shipped it 2025-10-23, free),
E-T11-14 (Entire, $60M, ex-GitHub CEO, same roadmap). Research-thirdparty (c) reached the same
conclusion independently.

**Build (all of it):** a `decisions/` directory in the workspace repo, markdown + YAML frontmatter;
a `SessionEnd` hook that writes new decisions **in-context** and refuses to close if one lacks an
approver; a `SessionStart` hook that injects a **mechanically regenerated** index of open and
authoritative decisions only; and one command, `decisions verify`, that checks every cited path or
symbol still exists at HEAD (E-B9's design, done locally where the repo is already in hand — the only
cheap answer to FM-B3).

**Deliberately NOT built:** transcript ingestion or a session observer (FM-B1, B2, B7); any cloud,
auth, MCP server or hosting (FM-A5, C5, B7); vector retrieval or semantic search (FM-B4); agent
identity (FM-B8); cross-agent presence or concurrency (FM-B6, A2); a handoff product (FM-C3, E-T44,
E-C32); Work/Spec/Session/Claim entities — specs already exist under `docs/superpowers/` and git
holds the artefacts; cross-vendor ingestion (E-C24, E-C36 — that position is taken); any human UI,
pricing, or company (FM-A4, C4).

**What this gives up relative to the original proposal:** everything above the file. Org scope,
cross-vendor ingestion, the extraction pipeline, the knowledge graph, retrieval, coordination, the
full accountability *chain* (it keeps only the approval *event*), and the business. It is not a
system of record; it is two hooks, a schema, and a verifier. It concedes that "system of record" is
untestable at n=1 and that the only question answerable this month is: *does a mechanically generated,
verified index of approved decisions prevent the specific violations already on record?*

**The kill test, runnable this week on data already on disk.** The violations are dated and costed
(`--help` backfill 08-03; `_loads_json` regression 08-10; rep-identity repeat one week apart). Replay
each with (a) today's path — CLAUDE.md + newest handoff — and (b) CLAUDE.md + the generated decision
index. If (b) does not prevent them, stop. This is red-team C's arm-3 proposal, with the advantage
that the ground truth already exists.

---

## 4. Strongest argument against my own case

Every failure I measured is **hygiene, not capability**. The index is stale because nobody
regenerated it. The rule is in 20 files because nobody deduplicated it. The ADRs stopped because
attention moved to Shopify. Each is fixed by a 50-line script — which means the honest reading is
that there is no product here, there is a **chore**, and the operator has now demonstrated three
times that he will not sustain a chore that needs attention: agentwaves at 3 stars (E-C21),
`wave-state.md` at 7 repos (E-A1), and — the one I found myself — **agentwaves not used in his own
primary workspace at all**. Worse, the abandonment is selective in exactly the wrong direction: the
cheap artefact (handoffs) ran to 2026-09-04; the **high-value primitive (ADRs) stopped 33 days ago**.
The thing I am proposing to build is the thing his own data shows decays first. Add FM-B5/C2: if
Anthropic documents `CLAUDE_MEMORY_STORES` with a status field, the residual is zero.

---

## 5. Negative results

1. **The redundancy hypothesis is false.** I expected heavy repetition across handoffs and measured
   4.3% mean 5-gram overlap. "The operator repeats himself expensively" is not supported and I
   dropped it. The finding inverted into FOR-1, which is a weaker claim.
2. **The proposal's taxonomy is not in use by its author.** Only 14/38 memory files carry a `type:`;
   the values are the harness's (`project`/`reference`/`feedback`). **Zero files are typed as a
   decision, discovery, claim, or specification.** My content classification (~12 rules, ~16
   discoveries, ~9 reference) is my reading of titles, not verified.
3. **I could not establish a session→handoff ratio.** `~/.claude/projects/…dome-workspace/` retains
   only 14 top-level transcripts (Aug 7 – Sep 6) plus 108 subagent files; older ones are pruned. So
   "most sessions produce no handoff" is *not* established — only that 20 handoffs cover 42 calendar
   days / 15 distinct working days.
4. **No first-party evidence bears on FM-A4 (budget), FM-A5 (channel), FM-C4 (category) or FM-C5
   (compliance/distribution).** Those four are unrebutted and I did not attempt to rebut them.
5. **Extraction quality is unmeasured on both sides.** My write-at-source claim rests on n=20
   human-supervised handoffs I read but did not score for faithfulness. Red-team B's negative result
   stands: no benchmark exists for decision extraction from agent trajectories.
6. **The ADR gap is unexplained.** 8 ADRs 07-24 → 08-04, then none for 33 days, while 10 spec/plan
   pairs (49,247 words, latest 09-04) continued across 6 repos with no index. Whether that is
   abandonment or an absence of architectural decisions in the period, I cannot determine — and it is
   the single measurement that would most change the verdict either way.
7. **Two claims I checked and could not use.** The `dome-workspace` project directories reported 0
   transcripts under a per-directory listing and 108+14 under a recursive one; I report the recursive
   figure but flag the inconsistency. And I did not verify whether the 20 files matching the
   consumer-key rule all state it as a *prohibition* rather than merely mentioning the key.
