# RED-TEAM A — Demand + Distribution

Adversarial brief against "Agent-Readable System of Record for Software Work." All dates accessed 2026-09-06.

---

## Evidence table

| ID | Claim | Source | Date |
|----|-------|--------|------|
| E-A1 | GitHub code-search file counts, run live via `gh api search/code`: `AGENTS.md` **944,128**; `CLAUDE.md` **776,192**; `PROGRESS.md` **155,648**; `HANDOFF.md` **118,016**; `SESSION.md` **55,552**; `next-session.md` **912**; `wave-state.md` **7** | GitHub code search API (authenticated) | 2026-09-06 |
| E-A2 | "Providing context files does not generally improve task success rates, while increasing inference cost by over 20% on average." LLM-generated context files: marginally *negative* on success (−3%). Human-written: +4% success but up to +19% cost. Holds across LLMs and agents. Repository overviews specifically found unhelpful. | Gloaguen, Mündler, Müller, Raychev, Vechev (ETH Zurich), *Evaluating AGENTS.md*, arXiv:2602.11988 | v1 2026-02-12, v2 2026-06-23 |
| E-A3 | AGENTS.md presence → **28.64%** lower median runtime, **16.58%** less output-token consumption, comparable completion, over 124 PRs / 10 repos | Lulla, Mohsenimofidi, Galster, Zhang, Baltes, Treude, arXiv:2601.20404 | 2026-01-28, rev 2026-03-30 |
| E-A4 | "Context rot": applying an existing README/wiki consistency checker to a statistically representative sample of **356 repositories** finds stale code-element references in **23.0%** of them | Treude & Baltes, arXiv:2606.09090 | 2026-06-09 |
| E-A5 | `claude-mem` — "Captures everything your agent does during sessions, compresses it with AI, and injects relevant context back into future sessions. Works with Claude Code, OpenClaw, Codex, Gemini, Hermes, Copilot, OpenCode + More." **93,333 stars**, Apache-2.0, 324 open issues, **18,841 npm downloads/week** (73,623/30d) | github.com/thedotmack/claude-mem (GitHub API); api.npmjs.org | 2026-09-06 |
| E-A6 | Claude Code ships **Auto Memory on by default** since v2.1.59 (Feb 2026): Claude writes its own MEMORY.md as you work. Anthropic also shipped a native API memory tool (`/memories` filesystem interface) and a managed agent runtime with memory built in | augmentcode.com/learn/claude-mem-persistent-memory-claude-code; caucasusbusinessjournal.com/news/claude-memory-apis-developer-guide-2026 | 2026-09-06 |
| E-A7 | MCP long tail: **median packaged server = 1,663 weekly downloads**. Top 3 servers capture **92.5%** of all attributable download volume; top 10 take 97.8%. Only 44 of 163 registry-ranked servers have measurable downloads at all | zplatform.ai/best-ai-tools/best-mcp-servers/ (data pull 2026-08-07) | 2026-09-06 |
| E-A8 | Unblocked (closest adjacent: "contextual knowledge platform for engineering teams," integrates GitHub/Slack/Confluence/Jira/Linear). Founded 2021, **$30M raised** over 2 rounds, **34 employees as of 2026-06-30** | tracxn.com/d/companies/unblocked; techcrunch.com/2025/05/06/unblocked-raises-20-million-... | 2026-09-06 |
| E-A9 | Swimm (code documentation, "docs that stay current with every release"). **$33.3M raised**, **56 employees as of 2026-06-30**, ~5 years post-Series A | tracxn.com/d/companies/swimm; prnewswire 2021-11-08 | 2026-09-06 |
| E-A10 | Glean: **$300M ARR** (crossed late May 2026), $7.2B valuation. **>85% of customers use it across five or more departments** — horizontal, not an eng-team purchase; competes head-to-head with Microsoft 365 Copilot for CIO budget | techcrunch.com/2026/05/28/gleans-top-line-crosses-300m-...; futurumgroup.com | 2026-09-06 |
| E-A11 | Nearly half of engineering leaders allocate **1–3% of total engineering budget** to AI tools (n=50 budget holders, Oct 2025). Separate poll (n=275): **38.4% spend $101–500/dev/yr**, 10.5% spend $501–1,000, 10.5% spend >$1,000 | getdx.com/blog/how-are-engineering-leaders-approaching-2026-ai-tooling-budget/ | 2026-09-06 |
| E-A12 | Gartner sizes the entire **engineering intelligence market at ~$400M**, growing >40%/yr | cited in getdx.com (above) / uplevelteam.com buyer's guide | 2026-09-06 |
| E-A13 | Practical parallel-agent limit: "**3–5 is the sweet spot**… Don't run more agents than you can meaningfully review." "The bottleneck is no longer generation. It's verification." "One file, one owner: never let two agents edit the same file." | addyosmani.com/blog/code-agent-orchestra/ | posted 2026-03-26 |
| E-A14 | **96%** of developers do not fully trust AI-generated code without manual intervention; **38%** say reviewing AI-generated PRs takes more effort than human-written; only 48% consistently review before committing. LinearB 2026 benchmarks: AI PRs wait **4.6x longer** for review and are rejected more | Sonar *State of Code* Developer Survey 2026 (sonarsource.com/state-of-code-developer-survey-report.pdf); thenewstack.io/agentic-ai-verification-impact/ | 2026-09-06 |
| E-A15 | JetBrains Developer Ecosystem Survey 2026 (n>15,000 professional devs, fielded May–Jul 2026): 90% use AI coding agents weekly, 68% daily; Claude Code 39%, Copilot 21%, Codex 16%. **Contains no data on parallel/concurrent agent counts, delegation share, or autonomy level** | blog.jetbrains.com/research/2026/08/ai-coding-agent-adoption-2026/ | 2026-09-06 |
| E-A16 | Anthropic 2026 Agentic Coding Trends Report: developers use AI in ~60% of work but can "fully delegate" only **0–20%** of tasks | resources.anthropic.com/2026-agentic-coding-trends-report | 2026-09-06 |
| E-A17 | Competing free memory layers already at scale: `mem0ai` **132,146 npm downloads/week**, 64,780 GitHub stars; `@modelcontextprotocol/server-memory` **73,646/week`; `coleam00/claude-memory-compiler` (hooks → Agent SDK extracts decisions → LLM compiles knowledge articles) 1,287 stars | api.npmjs.org; GitHub API | 2026-09-06 |

---

## Failure modes

### FM-A1 — "The markdown already ate the win"

**Mechanism.** The proposal's headline measurable benefit is context-recovery time and token cost at session start (§10, §18). That win has already been captured by plain files, and it has been measured: AGENTS.md alone buys 28.64% lower median runtime and 16.58% fewer output tokens (E-A3). The delta a database can claim is therefore not "the whole handoff cost" — it is the residual after the file has done its work, on top of a substrate with literally zero install cost, zero network dependency, zero auth model, and free versioning/diff/review/rollback via git. Worse, the strongest study in the literature finds the marginal return on *more* context is already negative: context files as a class do not improve success rates and add >20% inference cost (E-A2). The operator's own experiment (§18: cold agent vs informed agent) is likely to reproduce E-A2's result, not contradict it, because the informed agent pays token cost for context whose relevance is unproven.

**Leading indicator.** The first head-to-head experiment shows the informed agent completing tasks at parity or slightly worse, with higher token spend — and the operator finds himself arguing that the *quality* of the retrieved context is the variable rather than the *existence* of a record. Second indicator: pilot users keep the CLAUDE.md and treat the new system as additive rather than replacing anything.

**Evidence.** E-A2, E-A3, E-A1.

---

### FM-A2 — "The 100-agent org is a projection, and the ceiling is human review bandwidth"

**Mechanism.** The entire thesis is load-bearing on 10 humans × 100–200 agents (§1). At 3–5 concurrent agents per human — the number practitioners actually converge on, for the stated reason that verification, not generation, is the bottleneck (E-A13) — a 10-human org runs 30–50 agents, and those agents are supervised by a named human who was in the room. That is precisely the regime where a handoff *file* and a standup work. The proposal's coordination value only switches on above the number of agents a human can review, but the number of agents a human can review is what caps the agent count in the first place. This is not a delay in reaching the 100-agent world; it is a structural argument that the 100-agent world requires a *different* unlock (autonomous verification) which, if it arrives, is a bigger product than this one and probably subsumes it. Corroborating: the ceiling on delegation is 0–20% of tasks fully delegated (E-A16), and the strongest survey in the field (n>15,000) does not report concurrent agent counts at all (E-A15) — the metric is not yet interesting enough for anyone to measure.

**Leading indicator.** Interviews with target orgs produce a modal answer of "2–4 agents, one engineer, one repo" and an inability to name a case where two agents' work actually collided in a way a person didn't catch. Also: the operator cannot find a single org to point at that runs >20 concurrent agents against one codebase.

**Evidence.** E-A13, E-A15, E-A16. See Negative results for the search that found no per-org agent counts.

---

### FM-A3 — "You are vendor #4 into a commodity that is already free and cross-harness"

**Mechanism.** §17's "smallest plausible MVP" — session observer → LLM extraction → structured record → simple store → MCP/agent API + inspection UI — describes `claude-mem` almost line for line, which already exists, is Apache-2.0, has 93,333 stars, ships 18,841 npm installs/week, and already spans Claude Code, Codex, Gemini, Copilot and OpenCode (E-A5). That last property is the proposal's *differentiator* (§6: "if the org switches Claude → Codex, the knowledge remains") and it is already table stakes in a free tool. `mem0` does 132k/week (E-A17). `@modelcontextprotocol/server-memory` does 73k/week. `coleam00/claude-memory-compiler` specifically extracts "key decisions and lessons" into structured cross-referenced articles. And beneath all of them, Claude Code turned Auto Memory on by default in Feb 2026, so the baseline user gets *something* without choosing anything (E-A6). A paid system of record must beat free-and-installed, not beat nothing.

**Leading indicator.** Every discovery call opens with "how is this different from claude-mem / mem0?" and the answer requires three sentences about provenance and org-level scope that the prospect does not visibly care about. Second indicator: the operator's own agentwaves gets compared to claude-mem in a GitHub issue.

**Evidence.** E-A5, E-A6, E-A17.

---

### FM-A4 — "There is no budget line, and the one that exists is spoken for"

**Mechanism.** Engineering leaders put 1–3% of total eng budget into AI tools, and the modal per-dev spend is $101–500/yr (E-A11) — a pool already consumed by Claude Code/Copilot/Cursor seats, which is where the demonstrable output is. "Organizational engineering state" is not a line item; it is a *category Gartner sizes at $400M total* (E-A12), i.e. the entire adjacent market is smaller than a single mid-cap software company. The two proof points either side of this are instructive. Unblocked sells nearly this exact pitch — contextual knowledge from code + Slack + Confluence + Jira + Linear — and after 5 years and $30M is a 34-person company (E-A8); Swimm, 56 people on $33.3M (E-A9). Meanwhile the company that *did* find a buyer for organizational knowledge, Glean at $300M ARR, found them by not selling to engineering at all: >85% of its customers deploy across five or more departments and it is bought against Microsoft Copilot by a CIO (E-A10). The evidence says the eng-team-scoped knowledge product is a $30M-and-stall shape, and the check-signer for org knowledge sits outside engineering — a buyer a solo operator cannot reach and whose sales cycle he cannot fund.

**Leading indicator.** Pilots convert to enthusiastic free usage and zero paid conversions; or the first paying customer's champion turns out to be a platform/DevEx team whose own budget is under review. Also: pricing conversations keep landing at "$10–20/dev/month" — under the $500/dev/yr floor, i.e. a rounding error the buyer won't run procurement for.

**Evidence.** E-A11, E-A12, E-A8, E-A9, E-A10.

---

### FM-A5 — "The install path requires everything and the median MCP server reaches nobody"

**Mechanism.** A *system of record* is only a system of record if it is complete. Partial coverage produces a record that is silently wrong, which is worse than no record (an agent that queries and gets nothing back at least knows it doesn't know). Completeness here means: installed in every harness (Claude Code, Codex, Cursor, OpenCode), in every repo, on every developer machine, plus session-level write access — i.e. read access to raw agent transcripts containing credentials, customer data and unreviewed code, which triggers a security review at exactly the orgs large enough to have 100 agents (§19 flags this; it is a distribution problem, not just a security one). Against that install cost, the realistic channels are MCP registry listing and the Claude Code plugin marketplace, and the MCP channel's honest distribution is a **median of 1,663 weekly downloads**, with the top 3 servers taking 92.5% of all volume (E-A7). That is not a channel; it is a lottery whose winners are Chrome DevTools, AWS and Azure — vendors distributing their own platform. A solo operator with no audience lands in the 1,663 bucket, and 1,663 weekly `npx` invocations is not 1,663 orgs adopting a system of record.

**Leading indicator.** MCP listing published; installs plateau in the low hundreds/week within 6 weeks and are dominated by one-shot evaluators (installs ≫ week-2 retained sessions). Second indicator: the first enterprise pilot stalls in a security review over transcript egress and never restarts.

**Evidence.** E-A7, E-A5 (for what a *successful* free entrant in this exact niche looks like).

---

### FM-A6 — "Nobody will act on an LLM-extracted decision, so the record must be reviewed, which re-imposes the cost it removed"

**Mechanism.** §8 is the proposal's crown jewel: distinguishing "agent thinks X" from "the organization has decided X," with a human approver. But the approval step is a human reading and signing an LLM's summary of a session — and 96% of developers do not fully trust AI-generated code without manual intervention, 38% say reviewing AI output costs *more* effort than reviewing a human's, and AI-authored PRs already sit 4.6x longer waiting for review (E-A14). The system therefore adds a new queue of AI-generated artifacts to a review pipeline that is measurably the bottleneck (E-A13). If humans *don't* review, the record fills with unverified claims and its authority evaporates — which is exactly the failure the record was built to prevent. If humans *do* review, the operator has invented documentation-writing-as-a-chore, which is the thing every wiki died of. And the decay is measurable: 23.0% of a representative 356-repo sample already carry stale code references in their AI configuration artifacts after months, not years (E-A4). A richer, more granular record rots faster, not slower, because it makes more specific claims per unit of code.

**Leading indicator.** In the first pilot, the ratio of `propose_decision` calls to human approvals falls below ~1:5 within three weeks, and someone reports the agent citing a decision that was reversed. Second indicator: users start reading the record's raw provenance links instead of its extracted summary — i.e. they've routed around the value proposition.

**Evidence.** E-A14, E-A4, E-A13.

---

### FM-A7 — "Cold start is worse than a wiki's, and the operator's own conventions prove the ceiling"

**Mechanism.** A wiki cold-starts badly but at least accrues value from any single writer. This record is worse on two axes: (a) its value is explicitly *cross-agent and cross-session* (§10, §11), so a solo adopter gets close to nothing until a second agent picks up a thread that a first agent dropped — a coincidence that happens rarely at 3–5 agents; (b) it is org-scoped and non-portable, so nothing carries between customers, and there is no Stack-Overflow-style public corpus to seed from. Sharpest available evidence: the operator has already run this experiment twice at zero price. `agentwaves` publishes a convention whose signature file is `wave-state.md` — **7 repositories on GitHub**; `next-session.md` — **912** (E-A1). Set against `AGENTS.md` at 944,128 and `HANDOFF.md` at 118,016, the read is unambiguous: the *format* has ~1M adopters, and a *specific discipline layered on the format* has single digits. What propagates is a filename other people's tools already read; what does not propagate is a system somebody has to buy into.

**Leading indicator.** `wave-state.md` count does not move materially over the next quarter despite the operator publishing. Second indicator: pilot orgs' records reach 30–50 entries and then flatline as the novelty of `record_discovery` wears off — the classic wiki curve.

**Evidence.** E-A1, plus Negative results (no quantitative wiki-abandonment study located).

---

## What would change my mind

- **FM-A1.** A replication of §18 showing the informed agent beating the cold agent on *task success* (not just tokens) by >10pp, on tasks the model has not seen, with the file-based baseline (CLAUDE.md + newest handoff) as control rather than "no context." That directly contradicts E-A2.
- **FM-A2.** Any citable org running >20 concurrent agents against one codebase, with a named incident where two agents' work collided in a way no human caught. One well-documented case would reopen the whole thesis.
- **FM-A3.** Evidence that `claude-mem`/`mem0` users churn *because* the record is agent-scoped rather than org-scoped — e.g. issue threads asking for cross-developer shared memory, or a claude-mem fork adding multi-user state. (Its 324 open issues are the place to look; I did not read them.)
- **FM-A4.** A signed contract, at any price, where the buyer is an eng leader and the line item is context/state rather than seats. Or: evidence that Unblocked's revenue per employee is high despite headcount of 34 — the employee-count proxy is weak and I'd retract on real ARR.
- **FM-A5.** An MCP server or Claude Code plugin from a non-platform-vendor that reached >50k weekly retained (not one-shot) installs. That would prove the channel works for an outsider.
- **FM-A6.** A study showing developers trust structured, provenance-linked LLM extractions materially more than free-text AI summaries. The provenance mechanism (§8) is the one genuinely novel idea here and it is *untested*; if it moves trust, FM-A6 weakens sharply.
- **FM-A7.** `wave-state.md` crossing ~1,000 repos on organic adoption, or any third party independently reinventing the operator's specific handoff schema.

---

## Negative results

Reported honestly; each is itself a finding.

1. **No public data on agents-per-org or concurrent agent counts.** Queries: "how many coding agents run concurrently per engineering team survey 2026 average number of agents per developer"; "'parallel agents' developers running multiple coding agents at once percentage 2026 DX report"; "Anthropic 2026 agentic coding trends report agent teams predictions number of agents per engineer". The largest survey in the field (JetBrains, n>15,000, May–Jul 2026) measures adoption and tool share but **not** concurrency, delegation share, or autonomy (E-A15). The only numbers available are practitioner heuristics (3–5, E-A13) and vendor forecast language ("agent teams," "hours or days"). **The 100–200-agent org is currently unevidenced in public data — nobody has measured it because nobody has one.**

2. **No quantitative study on internal-wiki abandonment rates.** Query: "internal wiki Confluence abandoned outdated documentation percentage stale study". Everything returned was qualitative ("your wiki is a graveyard"). The closest quantitative proxy is E-A4 (23.0% of repos with stale references), which is about code-adjacent config, not wikis. I decline to assert a wiki death rate.

3. **No evidence Swimm or Unblocked has shut down or been acquired.** Both appear to be operating. My FM-A4 argument rests on *headcount stagnation as a proxy for market size*, not on failure — a weaker claim, flagged as such.

4. **Sonar's 96% figure is cited via secondary sources** (The New Stack, Hyrax) pointing at sonarsource.com/state-of-code-developer-survey-report.pdf; I did not fetch the PDF to verify methodology or sample size.

5. **Claude Code plugin marketplace install counts are not published per-plugin.** Secondary sources claim "hundreds of thousands" for top plugins and ~200 plugins in the official marketplace; I could not verify either against a primary source, so FM-A5 rests on the MCP registry data (E-A7), which is measured.

6. **Question 7 — "who is the actual first user?" — I could not answer.** I could not identify a buyer segment concrete enough to contact 20 of this week. The proposal's stated target (10 humans + 100–200 agents) does not demonstrably exist (Negative result 1). The nearest *real* segments are (a) platform/DevEx teams at 200–2,000-engineer companies, who buy tooling but whose 2026 mandate is consolidation, not vendor addition, and (b) AI-native dev-tool startups running heavy agent workflows on themselves — but these are the population most likely to have built the file-based version already, and they don't pay. **The absence of a nameable first buyer, after this much searching, is the single strongest finding in this report.** It is materially harder than "adoption could be slow": the operator can enumerate the pain in detail and cannot enumerate one person other than himself who has it.
