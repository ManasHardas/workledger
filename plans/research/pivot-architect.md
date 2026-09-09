# PIVOT ARCHITECT — candidates scored on identical terms

Runs last, after the adversarial and generative waves. Every material claim carries an E-id from this
session's reports. "Not established" is used where it is true. No new web research was run.

---

## 0. Criteria and weights

Weighted against the **operator's** constraints (solo, no employees, no funding, no SOC 2, no sales
team, GitHub at low traction, one small-team relationship, an unmeasured YouTube channel).

| # | Criterion | Wt | Why |
|---|---|---|---|
| C1 | **Distribution concreteness** — 20 named humans reachable this month with assets he holds | 20% | RT-A's strongest finding was the *absence of a nameable buyer*. E-C44: 95% of deals go to a Day-One-shortlist vendor. For a solo operator this binds harder than product quality. |
| C2 | **Structural defensibility** — stays open vs. closes on contact | 15% | FM-B5/FM-C2: six of seven incumbents already shipped a working subset. Absorbable ⇒ worthless. |
| C3 | **Revealed spend** — money already moving for this exact job | 15% | demand-archaeology looked only for committed money/labor. Where it found none (E-D11: 1,715 HN job posts, zero context-maintenance roles), enthusiasm ≠ demand. |
| C4 | **Time to first dollar** | 12% | Stated goal: "make money from it." Per brief, needing SOC 2 first scores poorly (E-C44: $20k–$150k, ~a year). |
| C5 | **Dogfoodable by first user this month** | 12% | FM-A7 is a first-party null: agentwaves is **not used in his own primary workspace** (steelman §0). What he won't run himself is dead. |
| C6 | **Build weeks** (fewer = higher) | 10% | Solo; ALT-0 alone needs 11 integrations (§15) against a surface that churned 12 Claude Code versions in a 2-month local archive (E-B6). |
| C7 | **Kill-test cheapness** (<1 week, data on disk) | 10% | The steelman's kill test replays three dated, costed violations already on disk. |
| C8 | **Unit-economics shape** | 6% | FM-C1. Low weight: it discriminates almost solely against ALT-0. |

---

## 1. Scores (1–5) with cited justification

**ALT-0 — the specification unchanged.**
C1 **1** — median packaged MCP server = 1,663 weekly downloads, top 3 take 92.5% (E-A7); operator's own artifact of this thesis at 3★/0 forks (E-C21); no buyer identified (RT-A neg. 6).
C2 **1** — Anthropic ships Memory Stores (E-C28/E-N4) *and* the extraction pipeline as Dreams, 1–100 transcripts in (E-N30); Amp shipped handoff 2025-10-23 (E-C32); Warp is cross-harness + team-scoped + provenance-carrying (E-N31/32); Entire has $60M and the same roadmap (E-T11–14).
C3 **2** — adjacent retrieval sells (Unblocked, 14 logos, $19–29/seat, E-D1/D3); the state layer itself has no price — cmem Team Cloud lists $333/seat with **no visible buyer** (E-D4).
C4 **1** — the only segment with money is 100–350-engineer orgs (E-D1), behind SOC 2/SSO and a 10.1-month median cycle (E-C44).
C5 **1** — input is an undocumented schema, 9 undocumented record types over 12 versions locally (E-B6); OpenAI states the transcript format "isn't a stable interface" (E-B2).
C6 **1** — 11 integrations; dogfooding alone runs $43–215/dev-month before a customer (E-C5 × E-C1).
C7 **2** — §18 is defined but expensive; RT-C says run the markdown-control arm first, which is a smaller candidate.
C8 **1** — $42.90–85.80/dev/mo COGS vs $16–40 seats (E-C5, E-C13–C17); worsens as the thesis comes true (FM-C1).

**ALT-1 — Decision enforcement** (git-native `decisions/` schema + PreToolUse/pre-commit/CI blocking + blocked-attempt capture + citation verifier).
C1 **3** — audience identifiable (E-G12: #2544, 45 reactions, open 14 months; ≈112 hand-built decision/ADR hooks, E-G28) and the framing performs (E-G30 "git-native" 74 pts/309 stars in a day; E-G29 "write-gated" 67 pts). But the operator ran the publish-an-OSS-convention experiment twice with a measured null: `wave-state.md` in 7 repos against `AGENTS.md` at 944,128 (E-A1, E-C21).
C2 **5** — strongest on the board. Incumbent closed the ask three times `not_planned`/inactivity (E-G13, E-G15, E-G17) — it cannot ship "we block our model from violating your rule" without self-indictment. Enforcement lives at PreToolUse exit-2/CI, outside the model. Memory vendors metered on write volume ⇒ blocking is anti-revenue (E-G22). E-G33: zero products.
C3 **2** — the weak leg. `adr-tools` 5,669★, no commit since 2020; the only agent-native ADR project has 12★ (E-C27). Nearest real money, MintMCP's 40+ paying customers (E-D8), buys *prevention*, not adherence.
C4 **3** — OSS-first needs no compliance gate; the paid surface is unidentified.
C5 **5** — the first user already produces the primitive by hand: 6/8 ADRs with a named decision owner, ADR-0007 supersedes ADR-0004, "Alternatives rejected", "rejected on evidence" (steelman FOR-2); 199 instances of "never" (FOR-4).
C6 **4** — two hooks, a markdown+YAML schema, a verifier. Not 5: E-G14's own limit — hooks "cannot prevent the model from generating wrong intent," so per-decision predicates are the unsolved part.
C7 **5** — replay three dated violations on disk: the `--help` paid backfill ($1.40–2.70, 2026-08-03), `_loads_json(raw) or {}` re-introducing the bug its docstring prevents (08-10), the rep-identity repeat a week later (steelman §3).
C8 **5** — zero COGS, local, no transcript egress (FM-B7 inapplicable).

**ALT-2 — steel-man minimal shape** (decisions dir + regenerated index + verify; no enforcement, no business).
C1 **1** — none by construction. C2 **2** — steelman §4: "there is no product here, there is a **chore**." C3 **1**, C4 **1** — no dollar. C5 **5** — runnable this week over 107,529 words on disk (steelman §0). C6 **5**, C7 **5** — same kill test, cheaper. C8 **5**.

**ALT-3 — Governance/audit gate for compliance buyers.**
C1 **2** — buyer exists, unreachable: no SOC 2, no SSO, no sales team, against a 95%-shortlist category (E-C44).
C2 **2** — MintMCP doubled 6→12 FTE in six weeks (E-D8); GitHub's enterprise agent control plane with audit logs is GA (E-C33); Vanta is better positioned and merely waitlisted (E-D19).
C3 **5** — highest revealed spend in the session: 40+ paying customers in six months, named (Braze, Coursera, Stability AI), with a hiring response (E-D8).
C4 **1** — disqualified by the brief's own rule (E-C44). C5 **1** — Dome has no compliance requirement. C6 **2** — identity, hosted store, RBAC, retention. C7 **2** — resolves in quarters. C8 **3**.

**ALT-4 — Productized service** (install decisions/handoff/hook discipline for the CTO-bottleneck segment; OSS as wedge).
C1 **5** — most concrete in the session: **58 employers publicly stated within six months that they run Claude Code daily, each post carrying an apply link or founder email** (E-D12); demand-archaeology names 20 and drafts the opener. The archetype buyer has a name, title, price and first-person reason — Alec Robins, CTO/co-founder of Rally, *"it wasn't worth our time to cobble that together internally"*, worth "five to ten hours a week" (E-D2). YouTube is a services funnel by nature (size **not established**).
C2 **2** — none structurally; Anthropic is funding 30,000 Accenture consultants into the same channel (E-D22).
C3 **4** — published rates $100–300/hr with **CLAUDE.md authoring as a named line item**, 3-day audits to 6-month embeds (E-D20); live Upwork/Fiverr listings (E-D21, prices 403-blocked). Not 5: E-D20 is one vendor's own marketing and volume is unretrieved.
C4 **5** — weeks; no compliance gate, no procurement. The only candidate where the first dollar is plausibly inside 60 days.
C5 **4** — the deliverable *is* his practice (20 handoffs, 38 memory files, 8 ADRs, steelman §0). Not 5: the ADR practice **stopped 2026-08-04** while cheaper artifacts continued (FOR-2/§4) — selling a discipline he abandoned is a live risk.
C6 **5** — 0–2 weeks; a repo template and a checklist. C7 **5** — send 20 emails; one week; free.
C8 **2** — labour, not leverage. E-C43: SourceHut's platform earned $132,226 against $367,810 of consulting — product was 26% of revenue after five years.

**ALT-5 — The Dome tracker.**
C1 **3** — one customer who **already specified it in writing**: "a workspace folder of engineering items (project/epic/task/bug/**decision**/idea, ids DOME-N, own git repo)… kept in sync by an agent-agnostic 'session onlooker'" (steelman FOR-6, 2026-09-05). Complete at n=1, absent at n=2.
C2 **2** — Beads 26,950★ ships the git-native agent issue graph (E-G25/E-T16); Backlog.md 6,651★ (E-T20); Linear free holds 250 issues (E-D24).
C3 **2** — demand-archaeology segment 4: 1–5-engineer teams are "a design partner pool, **not a revenue segment**."
C4 **2** — "via the Dome relationship" is equity/goodwill, not a product dollar. C5 **5**. C6 **4**. C7 **4** — a month, not a week. C8 **4**.

**ALT-6 — Public adherence benchmark.**
C1 **4** — the one candidate where YouTube+HN are the *right* channel: both best-performing launches in the category led with a constraint claim (E-G29, E-G30) and E-G12's 45 reactions is a pre-assembled audience. Size **not established**.
C2 **3** — vendors won't publish a benchmark indicting their own model (same logic as E-G13/G15/G17), but anyone can fork one.
C3 **1** — nobody pays for benchmarks; "monetized via leads" is ALT-4 with extra steps. C4 **2**. C5 **4** — ground truth on disk. C6 **3**. C7 **4**. C8 **3** — evals cost inference at list (E-C1).

**ALT-7 (mine) — Context staleness verifier**: a CI check + pre-commit hook that fails when a CLAUDE.md / AGENTS.md / ADR cites a path, symbol or command absent at HEAD. Distinct: different job (**freshness**, not memory or enforcement), different artifact (a linter), different channel (Actions/pre-commit, not MCP).
C1 **4** — real channels over a real installed base: 944,128 `AGENTS.md` and 776,192 `CLAUDE.md` files (E-A1) vs the MCP registry's median 1,663/week (E-A7). Single-player, zero-config, no auth, no egress.
C2 **2** — Copilot already does exactly this first-party: facts stored with cited code locations, verified in real time against the current branch, 28-day decay (E-N17/E-B9); Cursor staff state the principle publicly (E-G31).
C3 **2** — measured problem — stale code-element references in **23.0% of a representative 356-repo sample** (E-A4), staleness ranked #2/#3 in the Cursor forum's breakage list (E-G31) — but nobody found paying; Dosu at $16/mo is the nearest price point (E-T27).
C4 **2** — linters are free by convention. C5 **5** — first-party, dated: `MEMORY.md` last written 2026-08-29 with **7 of 37 files orphaned** including the founder's own definition of the company; "ADR-0004's deploy token has still not been rotated" carried verbatim across 3 handoffs (FOR-5, FM-B3).
C6 **5** — smallest build on the board. C7 **5** — hours, over `dome_workspace`. C8 **5**.

---

## 2. Ranked table

| # | Candidate | Buyer (specifically) | Job it does | Build (wks) | Distribution answer | Score | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **ALT-4** Productized service | CTO/technical co-founder, 15–80-person Series A/B, personally the context bottleneck (E-D2 archetype) | Installs decisions/handoff/hook discipline so the CTO stops being the routing table | 0–2 | **Yes, named**: 20 of the 58 employers in E-D12, this week; YouTube as funnel | **4.10** | **GO — as revenue and discovery vehicle, not the destination** |
| 2 | **ALT-1** Decision enforcement | Same CTO, plus the ≈112 operators already hand-building decision hooks (E-G28) | Makes the approved decision the one the agent is *not permitted* to violate; logs the blocked attempt as negative knowledge | 3–5 | Partial: real audience (E-G12, E-G30) via a channel twice measured null *for this operator* (E-A1, E-C21) | **3.81** | **GO — the product, carried by ALT-4's channel** |
| 3 | **ALT-7** Staleness verifier | Any team with a CLAUDE.md/AGENTS.md in CI | Fails the build when the agent's instructions describe a repo that no longer exists | 1–2 | Yes: Actions/pre-commit over ~1.7M context files (E-A1) | **3.54** | **BUILD INSIDE ALT-1** — the only cheap answer to FM-B3 |
| 4 | **ALT-5** Dome tracker | The Dome founder (one person, already asked, 2026-09-05) | Mobile-first issues+decisions for one small team | 2–4 | Yes at n=1, none at n=2 | **3.08** | Conditional — a favour and a dogfood, not a business |
| 5 | **ALT-6** Adherence benchmark | Nobody pays; vendors/consulting leads | Proves the violation rate is real and non-zero | 3–6 | Publishing, not distribution; channel size **not established** | **3.00** | Marketing artifact for ALT-1/ALT-4 |
| 6 | **ALT-2** Minimal steel-man shape | The operator | Makes his own decisions reachable and verified | 1–2 | **None (by construction)** | **2.67** | Do it as week 1 of ALT-1 |
| 7 | **ALT-3** Governance/audit gate | Security/compliance leadership | "Which human approved what an agent did" | 8–16 | **None reachable by this operator** | **2.27** | NO-GO — right money, wrong operator |
| 8 | **ALT-0** The specification | Not established after a full session of searching | Org-wide agent-readable system of record | 26+ | **None** | **1.25** | NO-GO |

**Sensitivity, stated honestly.** ALT-4 and ALT-1 differ by 0.29 on weights I chose; at C2=20%/C3=10% they land 4.00 vs 3.96 — a tie. They are not substitutes: **ALT-4 is the distribution answer ALT-1 lacks; ALT-1 is the compounding asset ALT-4 lacks.** Read the ranking as "run ALT-4 to fund and source ALT-1," with E-C43 as the standing warning that services eat product.

---

## 3. Why the winner beats the specification

**No buyer.** After a full adversarial and generative wave the only person established to have the pain is the operator (RT-A neg. 6). ALT-4 starts from 58 named employers who publicly stated they run Claude Code daily (E-D12) and one named CTO with a stated purchase logic and a measured return (E-D2).

**The residual is smaller than the architecture.** Anthropic ships the storage (E-C28/E-N4/E-N6) *and* the extraction pipeline (E-N30). What survives E-C28/C32/C33/C34/C35/C36 is three things: a named human approver, a status lifecycle, retained rejected alternatives (FM-C2) — unclaimed per two independent passes (research-native (b)#1; research-thirdparty (b)#2). **ALT-1 is what you get when you keep the residual and discard the architecture.**

**The economics run backwards** — $42.90–85.80/dev/month COGS against $16–40 seats (E-C5, E-C13–C17), worsening as the thesis comes true (FM-C1). ALT-1 and ALT-4 are near-zero marginal cost.

---

## 4. RESHAPE or different product?

**ALT-4 is a different business** — it sells the practice as labour, which is what Swimm did after failing at software: *"From Software as a Service to Service as Software"* (E-C39/E-T31).

**ALT-1 is a genuine RESHAPE of ALT-0, not a costume one.** It keeps one entity from §12 (Decision) and §8's approval semantics, and changes the load-bearing verb from **remember** to **block**. That change is what moves the objections: FM-C3 killed the *record* (markdown already writes it for free — the operator wrote 107,529 words of it) but cannot touch the *hook*, because a markdown file cannot refuse a tool call. Three of four load-bearing failure modes move; one does not.

---

## 5. FM survival, specifically

**FM-A4 (no budget line).** ALT-4 **survives** — services are an expense approval, not procurement; rates are published with CLAUDE.md authoring as a deliverable (E-D20) and the channel is funded at $100M (E-D22). ALT-1 **does not survive as stated**: zero products in the category (E-G33), the only agent-native ADR project at 12★ (E-C27), 1,715 HN job posts with zero context-maintenance roles (E-D11); the nearest money (E-D8) buys prevention, not adherence. **This is ALT-1's largest hole and it is unresolved** — and precisely why ALT-1 must ride ALT-4's invoice rather than seek its own.

**FM-B3 (staleness).** ALT-1 **survives, uniquely.** The primitive is immune by construction: a standing prohibition ("never push without asking"; 199 "never"s, FOR-4) does not decay when a file is deleted. For claims that *do* decay, the verifier runs Copilot's design (E-N17/E-B9) locally, where the repo is already in hand — the one place it is cheap. ALT-7 is that component, which is why it belongs inside ALT-1. ALT-4 inherits it as the client's month-3 renewal risk.

**FM-B5/FM-C2 (platform absorption).** ALT-1 **survives on the enforcement half**: a harness vendor cannot ship "we mechanically block our model from violating your written rule" — the ask *is* the bug report, closed `not_planned` three times (E-G13/G15/G17) — and enforcement lives at PreToolUse exit-2 and CI, outside the model. On the record half, auto memory "skips anything it can derive from the codebase" (E-N2) and no shipped store carries proposer-vs-approver, status, or rejected alternatives (E-C28, E-N15–19, E-N31/32). **Standing counter, from the steelman itself:** if Anthropic documents `CLAUDE_MEMORY_STORES` (E-N10/E-C29 — in the v2.1.172 changelog, absent from all four relevant doc pages) **with a status and approver field**, the record residual goes to zero and only the hook survives. ALT-4 survives — absorption changes an engagement's content, not the need for one.

**FM-C3 (markdown is the free substitute).** ALT-1 **survives on enforcement, concedes the record.** Markdown *did* write it and *did* fail: the consumer-key rule replicated into 20 files, "never touch" into 13, "release branch only" into 7 — violated anyway three times on record, including a paid backfill costing $1.40–2.70 on 2026-08-03 (FOR-4). Writing the decision is not the bottleneck; keeping it reachable and enforced is. ALT-4 **survives by inversion** — the service *sells* markdown-in-git as the deliverable; FM-C3 is the pitch. **ALT-0 fails all four**; the steelman concedes FM-A4, FM-B3, FM-C3 and half of FM-B5/C2 in its own text.

---

## 6. Evidence each alternative is not already served

- **ALT-0 — served, in pieces, by better-resourced parties.** Memory Stores + Dreams (E-C28, E-N30); Warp Agent Memory (E-N31/32); Copilot Memory with citations + JIT re-validation (E-N15–19); Entire, $60M, same roadmap (E-T11–14); SAP built nearly the whole thing internally, effects "remain under evaluation" (E-D18).
- **ALT-1 — not served.** Repo search: "architecture decision record enforcement lint" → **0 repos**; "ADR compliance check pull request" → **0 repos**; "decision drift detection codebase" → 1 repo, 0 stars (E-G33). The ≈112 in-repo hooks with decision/ADR/spec names all enforce *generic safety* (`rm -rf`, push-to-main, editing tests); **none enforces a project-specific recorded decision** (E-G28 + GAP-1).
- **ALT-2 — served by free equivalents**: `basic-memory` 3,869★ (E-C23), OKF Agent Memory 309 stars in a day (E-G30).
- **ALT-3 — served.** MintMCP 40+ paying customers (E-D8); GitHub enterprise agent control plane GA (E-C33); Vanta waitlisted (E-D19).
- **ALT-4 — served but unconsolidated.** A market at $100–300/hr (E-D20) with live listings (E-D21, volume **not established**, 403-blocked) and a $100M channel behind it (E-D22). No incumbent found at the 15–80-person tier.
- **ALT-5 — served except the packaging.** Beads 26,950★ (E-G25/E-T16), Backlog.md (E-T20), Linear free (E-D24). The mobile-first Dome card is unserved only because it is a single-customer requirement.
- **ALT-6 — not served.** RT-B's negative result: no benchmark covers "extract durable decisions from a 200k-token tool-use trajectory, including reversals.
- **ALT-7 — partly served, partly not established.** Copilot verifies its own citations against the current branch (E-N17/E-B9), Copilot-only and repo-scoped; Dosu sells self-updating docs at $16/mo (E-T27). **Not established — searched X:** no search in this session looked for a standalone harness-agnostic context-file staleness linter; E-G33 covers ADR enforcement, not context-file linting. Run that search before committing.

---

## 7. Which candidates have NO distribution answer

- **ALT-0: none.** MCP's honest median is 1,663 weekly downloads with the top 3 at 92.5% (E-A7); the operator's own OSS expression of this thesis is 3★/0 forks (E-C21) and its signature file appears in 7 repositories (E-A1); no buyer but him was found. No channel, no list, no buyer.
- **ALT-2: none, by construction.** Personal tooling; the steelman says so.
- **ALT-3: none *this operator can reach*.** The money is the most real on the board (E-D8) and sits behind SOC 2 ($20k–$150k, ~a year), SSO, and a Day-One shortlist winning 95% of deals (E-C44). He has none of the three.
- **ALT-6: a publishing answer, not a distribution answer.** Constraint-led HN launches convert to stars, not revenue (E-G29, E-G30); the YouTube audience size is **not established**; nobody pays for benchmarks.
- **ALT-5: an answer for one customer and none for a second.**
- Only **ALT-4** (58 named employers with contact routes, E-D12) and **ALT-7** (Actions/pre-commit over ~1.7M context files, E-A1) have channels that survive contact.

---

## 8. What would have to be true for ALT-0 to win

Six falsifiable conditions; **five are outside the operator's control, which is itself the verdict.**

1. **A buyer names the budget line unprompted** — a CTO from E-D12 saying "this comes out of X" where X exists (RT-C #3). Today's honest answer is "we'd create one," against E-C44's 95%-shortlist finding.
2. **Extraction below ~$5/dev/month at acceptable quality** — a filter discarding >95% of the 34.3M-token corpus before the LLM, recall measured against hand-labeled decisions (E-C5, RT-C #1). *Half-met by the wrong design:* write-at-source measures $2.09–10.44/dev/month (FOR-3), and write-at-source is exactly what ALT-0's "session observer → LLM extraction" is not.
3. **A stable, versioned observation contract** from one harness (RT-B #1). Today: 12 versions and 9 undocumented record types in one 2-month local archive (E-B6); OpenAI states in writing the format "isn't a stable interface" (E-B2).
4. **The §18 experiment with a markdown-handoff control arm, won by a wide margin.** Within ~80% and FM-C3 stands: a template, not a product (RT-C #2).
5. **Anthropic does not document `CLAUDE_MEMORY_STORES` with a status/approver field** (E-N10, E-C29). If it does, the FM-C2 residual is zero.
6. **Telemetry contradicting E-C30** — a named org at 10:100, or median concurrency above ~5, against 67.4% of Codex org users running no concurrency at all.

If (1) and (2) both land, ALT-0 becomes arguable. Neither has landed, and (1) was searched for by three agents without success.

---

## 9. Recommendation

**Do ALT-2 this week** — it is week 1 of ALT-1 and it settles the kill test on data already on disk: replay the `--help` backfill, the `_loads_json` regression and the rep-identity repeat against a mechanically generated decision index. If the index does not prevent them, stop. **Then build ALT-1 with ALT-7's verifier inside it**, because enforcement is the only position the incumbent has structurally declined three times (E-G13/G15/G17) and nobody sells (E-G33). **Run ALT-4 in parallel as channel and revenue**, opening with the twenty named companies from E-D12 and the line demand-archaeology already wrote — *"you said publicly that Claude Code does substantial implementation work; what happens when a session ends?"* — then ask, in the same call, which recorded decision an agent has violated. That one question is simultaneously the discovery interview for ALT-1 and the qualification call for ALT-4. **Do not build ALT-0**; do not build ALT-3 until someone else has bought SOC 2 for you. The indicator to watch against yourself is the steelman's: the ADR practice stopped on 2026-08-04 and has not resumed. If it has not by the time ALT-1 is buildable, the operator is the counter-example to his own product.
