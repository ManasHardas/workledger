# RESEARCH: Third-party incumbents, near-substitutes, and dead prior attempts

Lens: does the proposed "agent-readable system of record for organizational engineering state" already exist?
All access dates: **2026-09-06** unless noted. GitHub star/push figures were pulled from the GitHub REST API
(`api.github.com/repos/...`) on 2026-09-06, not from page summaries.

**Method note / limitation:** general web search on these terms is heavily polluted by AI-generated SEO
aggregator sites (developersdigest, weavai, agentmarketcap, ecorpit, niteagent, etc.). I have only used those
for lead generation and have marked as **secondary** anything I could not confirm on a vendor's own page, a
GitHub API response, or a named-publication article. My WebSearch budget (200 calls) was exhausted before I
could close two items — flagged in Negative Results.

---

## Evidence table

| ID | Claim | URL | Accessed | Type |
|---|---|---|---|---|
| E-T1 | Mem0 pricing: Hobby free / Starter $19-mo / Pro $249-mo / Enterprise custom; positioned as agent memory infra; **no** mention of teams, org memory, provenance, or coding agents on pricing page | https://mem0.ai/pricing | 2026-09-06 | primary |
| E-T2 | mem0ai/mem0: 64,780 stars, pushed 2026-09-04. "The Memory Layer for AI Agents" | api.github.com/repos/mem0ai/mem0 | 2026-09-06 | primary |
| E-T3 | Zep pricing: Free 10k credits / Flex $125-mo / Flex Plus $375-mo / Enterprise. "Production agent memory". No coding-agent specialization; no memory-change audit trail beyond API log retention | https://www.getzep.com/pricing | 2026-09-06 | primary |
| E-T4 | getzep/graphiti: 30,634 stars, pushed 2026-09-06. "Build Real-Time Knowledge Graphs for AI Agents". getzep/zep: 4,890 stars | api.github.com | 2026-09-06 | primary |
| E-T5 | Letta pricing: Free (3 agents, BYOK) / Personal Pro $20-mo / API $20-mo base + $0.10 per active agent + $0.00015-sec tool exec / **Teams Pro $20 per seat** (shared agents + permissions) / Enterprise | https://docs.letta.com/letta-code/pricing (redirect from letta.com/pricing) | 2026-09-06 | primary |
| E-T6 | letta-ai/letta: 24,631 stars, pushed 2026-08-23. "Platform for stateful agents" | api.github.com | 2026-09-06 | primary |
| E-T7 | topoteretes/cognee: 30,518 stars, pushed 2026-09-06. Apache-2.0. Has a "Company Brain" framing (team docs, tickets, code, collective decisions) + Claude Code/MCP integration | https://github.com/topoteretes/cognee | 2026-09-06 | primary |
| E-T8 | plastic-labs/honcho: 7,039 stars, pushed 2026-09-05, AGPL-3.0. Peer-centric user/agent modeling; ships plugins for Claude Code, Cursor, OpenCode | https://github.com/plastic-labs/honcho | 2026-09-06 | primary |
| E-T9 | supermemoryai/supermemory: 29,241 stars, pushed 2026-09-02. Sells enterprise API + dev plugins + **personal** app. No pricing on homepage | https://supermemory.ai/ , api.github.com | 2026-09-06 | primary |
| E-T10 | langchain-ai/langmem: 1,646 stars, pushed 2026-09-04. Library, not a product | api.github.com | 2026-09-06 | primary |
| E-T11 | **Entire** (entire.io) raised **$60M seed at $300M valuation, 2026-02-10**, largest dev-tool seed round; led by Felicis; Madrona, M12, Basis Set, Harry Stebbings, Jerry Yang, Olivier Pomel | https://techcrunch.com/2026/02/10/former-github-ceo-raises-record-60m-dev-tool-seed-round-at-300m-valuation/ | 2026-09-06 | primary |
| E-T12 | Entire founded by **Thomas Dohmke (former GitHub CEO)** — *not* Heptio founders. Craig McLuckie went to Stacklok (2023, $17.5M A) | https://entire.io/news/former-github-ceo-thomas-dohmke-raises-60-million-seed-round ; https://www.geekwire.com/2023/heptio-founder-leads-stacklok-a-new-software-supply-chain-startup-that-raised-17-5m/ | 2026-09-06 | primary |
| E-T13 | Entire product: **Checkpoints**, MIT-licensed open-source CLI, captures transcript/prompts/files/token usage/tool calls alongside each commit. Supports Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor. Explicitly names "better handoffs — resume work without replaying prompts" and "Git preserves what changed, but nothing about why" | https://entire.io/blog/hello-entire-world ; https://entire.io/ | 2026-09-06 | primary |
| E-T14 | Entire's stated 3-part platform: git-compatible database + **semantic reasoning layer for multi-agent coordination** + AI-native SDLC. The semantic/coordination layer is **announced, not shipped** | https://entire.io/blog/hello-entire-world | 2026-09-06 | primary |
| E-T15 | Entire has **no public pricing** — entire.io/pricing returns a login page only | https://entire.io/pricing | 2026-09-06 | negative |
| E-T16 | **Beads** (gastownhall/beads, formerly steveyegge/beads): **26,946 stars**, pushed 2026-09-05, created 2025-10-12, MIT. "Beads — A memory upgrade for your coding agent". Dolt-backed graph issue tracker; team-shared via git sync; hash IDs for multi-agent merge | api.github.com/repos/gastownhall/beads ; https://github.com/steveyegge/beads | 2026-09-06 | primary |
| E-T17 | Beads has a Rust port with independent traction: Dicklesworthstone/beads_rust 1,083 stars, created 2026-01-18 | api.github.com | 2026-09-06 | primary |
| E-T18 | **claude-mem** (thedotmack/claude-mem): **93,333 stars**, created 2025-08-31, pushed 2026-09-06. Session capture → AI compression → re-injection. Per-developer install; optional cloud sync (cmem.ai) | api.github.com ; https://github.com/thedotmack/claude-mem | 2026-09-06 | primary |
| E-T19 | ruvnet/ruflo (formerly claude-flow): **70,877 stars**, pushed 2026-09-05. "The original agent meta-harness… multi-player swarms" | api.github.com | 2026-09-06 | primary |
| E-T20 | MrLesk/Backlog.md: 6,651 stars, pushed 2026-09-03. "managing project collaboration between humans and AI Agents in a git ecosystem" | api.github.com | 2026-09-06 | primary |
| E-T21 | **Google Cloud Open Knowledge Format (OKF)**: v0.1 published June 2026 by Sam McVeety and Amir Hormati; v0.2 spec now in GoogleCloudPlatform/open-knowledge-format (311 stars, created 2026-08-11) | https://raw.githubusercontent.com/GoogleCloudPlatform/open-knowledge-format/main/SPEC.md ; api.github.com | 2026-09-06 | primary |
| E-T22 | **OKF v0.2 makes provenance, trust, lifecycle and attestation first-class.** Spec defines: Provenance, Credibility signal, **Actor** (`<producer>/<version>` for agents, `human:<id>` for people, `process:<id>`), **Trust tier** (unverified / machine-confirmed / human-reviewed), Attested Computation, Receipt, Attester. Motivation quotes: "a knowledge corpus is… continuously written and maintained by agents"; questions it answers are provenance, trust, freshness, lifecycle, attestation | SPEC.md §1, §2, §5, §7, §10 (URL above) | 2026-09-06 | primary |
| E-T23 | GoogleCloudPlatform/knowledge-catalog: 9,080 stars, created 2026-05-04, pushed 2026-09-05 | api.github.com | 2026-09-06 | primary |
| E-T24 | **OpenAI Symphony**: openai/symphony, **27,056 stars**, created 2026-02-26, pushed 2026-08-19. A SPEC.md for orchestrating autonomous coding agents; uses the **issue tracker (GitHub Issues/PRs/project boards) as the shared coordination state**; per-issue isolated clones. OpenAI positions it as a reference implementation, not a product | api.github.com ; https://www.infoq.com/news/2026/05/openai-symphony-agents/ | 2026-09-06 | primary |
| E-T25 | **Unblocked** pricing (live): Code Review **$19/user/mo** annual ($23 monthly); **Platform $29/user/mo** annual ($35 monthly); Enterprise custom; 21-day trial, no free tier | https://getunblocked.com/pricing/ | 2026-09-06 | primary |
| E-T26 | Unblocked positions as "context layer for agentic software development" — ingests code, conversations, issues, docs, product analytics, production signals into a knowledge graph; ships an MCP server for Cursor/Claude Code/Copilot; SSO+SCIM (team buyer) | https://getunblocked.com/ | 2026-09-06 | primary |
| E-T27 | **Dosu** pricing: Free $0 (200 credits, no private repos) / **Pro $16-mo** ($192-yr, 4,000 credits) / Enterprise custom / Maintainers Pro custom. Positioning is auto-generated & self-updating docs; MCP server lets "coding agents automatically contribute docs as they work". **No** decision/provenance language on the pricing page | https://dosu.dev/pricing | 2026-09-06 | primary |
| E-T28 | **Tessl** now sells: Tessl Platform (skills governance/security scanning), Tessl **Registry** (3,000+ skills), Tessl Agent, Tessl Code Review. Pricing: **Free (1,000 credits) / Team $100-mo (5,000 credits) / Enterprise custom**. The pricing page contains **no mention of "spec registry" or spec-driven development** | https://tessl.io/ ; https://tessl.io/pricing | 2026-09-06 | primary |
| E-T29 | Tessl raised **$125M** (Index, Accel, GV, boldstart); founded 2024 by Guy Podjarny (Snyk founder). In 2025 it **paused Tessl Framework development and removed Framework functionality from its rebuilt CLI** to focus on registry + agent integrations | https://tessl.io/blog/announcing-our-series-a-for-ai-native-software-development ; https://www.linkedin.com/posts/guypo_excited-to-share-tessl-raised-125m-to-build-activity-7262758282845470720-uIDJ | 2026-09-06 | primary (funding) / secondary (framework pause) |
| E-T30 | **New Relic CodeStream** — the "discussion/knowledge attached to code" product — in-IDE extension **end of life 2026-11-05**; users redirected to New Relic AI MCP Server | https://docs.newrelic.com/docs/codestream/start-here/what-is-codestream/ | 2026-09-06 | secondary (surfaced via search of New Relic docs) |
| E-T31 | **Swimm** — originally "documentation coupled to code" for dev teams — now sells **mainframe modernization / application understanding** services to enterprises | https://swimm.io/enterprise ; https://swimm.io/services/mainframe-modernization | 2026-09-06 | primary |
| E-T32 | **Sourcegraph Cody Free/Pro terminated July 2025**; Cody is enterprise-only; Sourcegraph steered individuals to **Amp** | secondary aggregators only (costbench, weavai) | 2026-09-06 | secondary |
| E-T33 | **Augment Code** sunset Next Edit and Completions (planned 2026-03-31), citing usage decline as devs shift to agentic workflows; refocused on **Intent** (multi-agent orchestration). Company still operating | https://www.augmentcode.com/changelog/planned-march-31-sunset-for-next-edit-and-completions | 2026-09-06 | primary |
| E-T34 | **Stack Overflow for Teams** survives, rebranded **Stack Internal**; still shipping (releases Jan–Apr 2026) | https://stackoverflow.co/internal/pricing/ ; https://stackoverflow.blog/2025/08/19/strengthening-the-core-stack-overflow-for-teams-2025-6/ | 2026-09-06 | primary/secondary |
| E-T35 | **adr-tools** (npryce): 5,669 stars, **last push 2024-04-25** — dormant. **log4brains** (thomvaill): 1,581 stars, **last push 2024-12-17** — dormant | api.github.com | 2026-09-06 | primary |
| E-T36 | **Sentra** (Dynamis Labs Inc.) — "unified memory layer for your company", 200+ tool connectors, three layers: factual ("what is true, where it came from, and when it changed"), action (commitments/blockers), interaction (who said what, decision context). **Bi-temporal**: "Every fact carries when it was true and when it stopped being true. Old facts are invalidated, not deleted." REST + MCP. Backed by **a16z Speedrun and Together Fund**. General org memory, not engineering-specific. **No public pricing** | https://www.sentra.app/ | 2026-09-06 | primary |
| E-T37 | **Claude Code memory is individual-only.** Anthropic merged memory across Claude chat and Cowork on 2026-08-25 but **explicitly excluded Claude Code**, with nothing to share about its future | https://techcrunch.com/2026/08/25/claude-cowork-finally-remembers-what-you-told-the-app-in-chat/ ; https://www.theregister.com/ai-and-ml/2026/08/25/claude-and-cowork-now-share-what-they-know-about-you/5292412 | 2026-09-06 | primary |
| E-T38 | Open feature request **anthropics/claude-code#38536 "Shared Team Memory for Claude Code"**, opened 2026-03-25, still **open**, 27 comments, 12 reactions (10 👍, 2 🚀). Body: "Claude Code's memory system is individual-only… none of that context transfers at the agent level… the single biggest efficiency bottleneck for teams adopting Claude Code seriously" | api.github.com/repos/anthropics/claude-code/issues/38536 | 2026-09-06 | primary |
| E-T39 | Cursor: team **rules** are org-managed (Team/Enterprise dashboard) but **memories are per-project and per-member**, not a shared asset | https://forum.cursor.com/t/new-team-rules-feature/135970 ; https://forum.cursor.com/t/rules-vs-memories-and-global-vs-project/137149 | 2026-09-06 | secondary |
| E-T40 | HN: "Agent memory as a file format" (calpaterson.com/memoryfields.html), **191 points, 35 comments, 2026-08-31**. Top comments favor lo-fi markdown wikis; one: "Sadly none of it represents a complete solution at this time" | https://news.ycombinator.com/item?id=49508317 (via hn.algolia.com API) | 2026-09-06 | primary |
| E-T41 | HN: "OKF Agent Memory – Git-native persistent memory for AI coding agents", **73 points, 12 comments, 2026-09-05**. Author's framing of the two failed extremes: "(1) Ad-hoc flat files (CLAUDE.md, AGENTS.md, .cursorrules) that inevitably balloon into 20k-token monoliths… (2) Vector databases…" Repo okf-memory/okf-agent-memory hit 298 stars in ~1 day | https://news.ycombinator.com/item?id=49581240 ; api.github.com | 2026-09-06 | primary |
| E-T42 | HN: "Context Rot: How increasing input tokens impacts LLM performance", **260 points, 59 comments, 2025-07-14** — the canonical thread | https://news.ycombinator.com/item?id=44564248 | 2026-09-06 | primary |
| E-T43 | HN: "Ask HN: How do you keep system context from rotting over time?" 35 points, 12 comments, 2026-01-20. Answers are process/human answers, not product answers ("More humans. Seriously. Keep more humans in the loop."). No vendor named: "I'm not sure I've seen any good vendors" | https://news.ycombinator.com/item?id=46693985 | 2026-09-06 | primary |
| E-T44 | Handoff-specific HN posts all have **near-zero traction**: "AHP: Agent Handoff Protocol" 5pts (2026-08-13); "Sol — validated computational artifact for human-agent handoffs" 2pts (2026-07-14); "Ctxbin — deterministic CLI for reliable AI agent handoffs" 1pt (2026-01-31); "Universal Memory Protocol" 41pts (2026-06-06) | hn.algolia.com search API | 2026-09-06 | primary/negative |
| E-T45 | **Stack Overflow Developer Survey 2026 results are NOT published.** Survey opened 2026-06-23, collection phase. 2025 survey: 52% of devs not using agents or only simpler AI tools; 38% no plans to adopt; 66% cite "AI solutions that are almost right, but not quite" as biggest frustration | https://stackoverflow.blog/2026/06/23/the-2026-developer-survey-is-now-open-for-human-developers-only/ ; https://survey.stackoverflow.co/2025/ | 2026-09-06 | primary/negative |
| E-T46 | DORA 2026 report: AI is an "amplifier" of existing org conditions; **"the cognitive load of oversight scales with the number of agents"**; AI-generated code waits 4.6x longer for first review | https://www.infoq.com/news/2026/05/dora-roi-ai-assisted-dev-report/ | 2026-09-06 | secondary |
| E-T47 | arXiv 2608.00122, "Shared Organizational Memory for Enterprise Coding Agents: System Design and Deployment Snapshot" (Dhanyamraju, Raghav), submitted **2026-07-31**. Production deployment: capture task-adjacent experience with contributor approval → curate into reusable Q&A memories → security/privacy filter → retrieve for future agents. **Effects "remain under evaluation" — no headline numbers** | https://arxiv.org/abs/2608.00122 | 2026-09-06 | primary/negative |
| E-T48 | Greptile ~$30/seat/mo with 50 reviews + $1/extra review; DeepWiki free for public repos | secondary aggregators (kodus, howworks) — I did not reach greptile.com/pricing directly | 2026-09-06 | secondary |
| E-T49 | Glean: no public list price; ~$50–75/user/mo, ~100-seat minimum, ~$60k/yr ACV floor; FlexCredits metering | secondary aggregators (vendr, coworker.ai) | 2026-09-06 | secondary |

---

## Incumbent table

| Product | What it does | Personal vs shared | Provenance / authority? | Pricing | Alive? | Source |
|---|---|---|---|---|---|---|
| **Entire (Checkpoints)** | Captures full agent session (transcript, prompts, files, tokens, tool calls) as versioned data attached to each git commit; multi-agent CLI | **Team-shared** (rides git) | Partial — commit↔session traceability, not decisions/approvals | No public pricing; CLI MIT open source | Yes, $60M seed Feb 2026 | E-T11–15 |
| **Beads (bd)** | Dolt-backed distributed graph issue tracker for coding agents; dependency graph, atomic claim, git sync | **Team-shared** | No — task state, not claims/authority | Free, MIT | Yes, 26.9k★, pushed 2026-09-05 | E-T16 |
| **OpenAI Symphony** | SPEC.md for orchestrating fleets of coding agents; **issue tracker = shared state**; per-issue isolated clones | Team-shared | No | Free spec/ref impl | Yes, 27.1k★ | E-T24 |
| **OKF (Google Cloud)** | Open spec: knowledge as directory of markdown + YAML frontmatter; v0.2 adds provenance, trust tiers, actors, attestation | Format — org-shareable by construction | **Yes, explicitly** — Provenance, Actor (`human:`/agent/`process:`), Trust tier (unverified/machine-confirmed/human-reviewed), Attested Computation | Free spec (Apache-2.0) | Yes, v0.2, Aug 2026 | E-T21–23 |
| **claude-mem** | Session capture → compress → re-inject for Claude Code and others | **Per-developer** (optional cloud sync) | No | Free, Apache-2.0 | Yes, 93.3k★ | E-T18 |
| **Sentra (Dynamis Labs)** | Company-wide memory graph from 200+ connectors; factual/action/interaction layers; bi-temporal; REST+MCP | **Shared org** | **Yes** — source of every fact, valid-from/valid-to, supersession | No public pricing | Yes, a16z Speedrun + Together Fund | E-T36 |
| **mem0** | Agent memory API, graph memory | Per end-user; "unlimited end users" | No | Free / $19 / $249 / custom | Yes, 64.8k★ | E-T1–2 |
| **Zep / Graphiti** | Temporal knowledge graph memory for agents | Per-user, team-deployed | Temporal edges; no authority model | Free / $125 / $375 / custom | Yes, 30.6k★ (graphiti) | E-T3–4 |
| **Letta** | Stateful agent runtime; **Teams Pro adds shared agents + permissions** | Both | No | Free / $20 / $20 seat / custom | Yes, 24.6k★ | E-T5–6 |
| **Cognee** | Open-source memory platform; "Company Brain" framing; Claude Code + MCP | Both | No formal authority model | Apache-2.0 | Yes, 30.5k★ | E-T7 |
| **Honcho** | Peer-centric (human & agent) modeling; plugins for Claude Code, Cursor, OpenCode | Both | No | AGPL-3.0 | Yes, 7.0k★ | E-T8 |
| **Supermemory** | Memory API + dev plugins + personal app | Both | No | Not on homepage | Yes, 29.2k★ | E-T9 |
| **Unblocked** | Knowledge graph over code + Slack + issues + docs + prod signals; answers cross-source questions; MCP server | **Team** (SSO/SCIM) | Links answers to sources; no decision approval model | **$19 / $29 per user/mo** annual; Enterprise custom | Yes | E-T25–26 |
| **Dosu** | Auto-generated, self-updating docs; MCP so agents contribute docs | Team | No | Free / **$16-mo Pro** / Enterprise | Yes | E-T27 |
| **Tessl** | Skills registry + governance + agent code review | Org/workspace | Skill evals, not engineering decisions | Free / **$100-mo Team** / Enterprise | Yes, $125M raised | E-T28–29 |
| **Glean** | Enterprise search/assistant across all company tools | Org | No | No public list; ~$50–75/seat, ~100-seat min | Yes | E-T49 |
| **Greptile / DeepWiki / CodeRabbit** | PR review; auto-wiki of a repo | Team / public | No | Greptile ~$30/seat; DeepWiki free public | Yes | E-T48 |
| **Stack Internal (SO for Teams)** | Internal Q&A knowledge base | Org | Voting/accepted answers = weak authority model | Public pricing page | Yes, rebranded | E-T34 |

---

## Dead / pivoted attempts and why

1. **Tessl Framework (2024–2025) → skills registry.** Raised **$125M** on "specs become the source of truth,
   code becomes an artifact." Paused Framework development and stripped it from the rebuilt CLI, pivoting to a
   registry + governance + code-review business. (E-T29) *Killed by:* the market wouldn't move its source of
   truth off code onto specs; the sellable adjacent problem was governing agent sprawl, not authoring specs.
   **This is the single most expensive precedent for the proposal's "specification / decision as durable
   primitive" thesis.**

2. **New Relic CodeStream.** The purest prior expression of "discussion and rationale attached to code."
   Acquired into New Relic, then in-IDE extension EOL **2026-11-05**, superseded by an MCP server. (E-T30)
   *Killed by:* it was a discussion layer nobody's workflow required; observability paid, rationale didn't.

3. **Swimm.** Started as "documentation coupled to code, auto-updated with the diff" for dev teams. Now sells
   mainframe modernization / application-understanding engagements to enterprises. (E-T31) *Killed by:*
   documentation freshness was not a budget line; legacy-code comprehension was.

4. **Sourcegraph Cody Free/Pro** terminated July 2025 → enterprise-only; individuals routed to Amp. (E-T32,
   secondary) *Killed by:* context/code-intelligence as a standalone layer got absorbed into the agent.

5. **Augment Code's Next Edit + Completions**, sunset planned 2026-03-31, explicitly because usage declined as
   developers moved to agentic workflows; company refocused on **Intent**, multi-agent orchestration. (E-T33)
   *Signal:* even a well-funded "context engine" company concluded the value migrated to orchestration.

6. **ADR tooling never became a business.** `adr-tools` (5,669★) last push **2024-04-25**; `log4brains`
   (1,581★) last push **2024-12-17**. Both dormant. (E-T35) I could not find *any* venture-backed or SaaS
   product built on architecture decision records that is currently trading. ADRs survive as a **practice with
   free CLI tooling**, never as a product. That is a 10-year negative result on "decision records as a
   business."

7. **Survivor, not a death, but instructive:** Stack Overflow for Teams did not die — it rebranded to Stack
   Internal and still ships (E-T34). Internal knowledge bases as a category are a real but low-growth business
   sold to enablement/platform budgets, not engineering-outcome budgets.

---

## Revealed demand signals (with numbers)

**Strong (agent state/memory as a category):**
- claude-mem: **93,333 stars** in ~12 months (created 2025-08-31). (E-T18)
- ruflo (ex claude-flow): **70,877 stars**. (E-T19)
- Beads: **26,946 stars** in ~11 months, plus a Rust reimplementation at 1,083 stars. (E-T16–17)
- OpenAI Symphony: **27,056 stars** in ~6 months. (E-T24)
- mem0 64,780★ / Graphiti 30,634★ / Cognee 30,518★ / Supermemory 29,241★ / Letta 24,631★. (E-T2,4,6,7,9)
- okf-agent-memory: **298 stars within ~24 hours** of launch (created 2026-09-05). (E-T41)
- Entire: **$60M seed at $300M valuation pre-product-GA** — the largest dev-tool seed ever — on precisely the
  premise "Git preserves what changed, but nothing about why." (E-T11, E-T13)

**Moderate (the specific pain, articulated):**
- anthropics/claude-code#38536, open since 2026-03-25, 27 comments: "individual-only… the single biggest
  efficiency bottleneck for teams adopting Claude Code seriously." But only **12 reactions** — vocal, not
  broad. (E-T38)
- HN "Agent memory as a file format": 191 points / 35 comments, 2026-08-31; consensus is *lo-fi markdown wikis
  are good enough* and "none of it represents a complete solution." (E-T40)
- HN "Context Rot" (2025-07-14): 260 points / 59 comments — still the canonical thread. (E-T42)
- DORA 2026: "the cognitive load of oversight scales with the number of agents"; AI-generated code waits 4.6x
  longer for first review. (E-T46, secondary)

**Weak / actively negative (the proposal's own wedge):**
- Every HN post specifically about **agent handoff** is dead on arrival: AHP: Agent Handoff Protocol **5
  points**; Sol **2 points**; Ctxbin **1 point**; "minimal beads-like issue tracker for AI agents" **2
  points**. (E-T44) Handoff-as-a-product has been attempted repeatedly in 2026 and generates no interest,
  while memory-as-infrastructure generates tens of thousands of stars. That asymmetry is the most important
  demand datum in this report and it cuts against Wedge A.
- HN "Ask HN: How do you keep system context from rotting over time?" — the top answers are process and human
  answers, and one commenter says outright "I'm not sure I've seen any good vendors." (E-T43)

**Survey data: none found.** Stack Overflow's 2026 Developer Survey is still in collection (opened
2026-06-23); no results published. (E-T45) I found no DORA, JetBrains, or SO survey question specifically
about agent context handoff or shared agent memory. The only academic deployment paper (arXiv 2608.00122,
2026-07-31) explicitly states its effects "remain under evaluation" and reports **no headline numbers**.
(E-T47) **There is no survey or benchmark number quantifying context-recovery cost between agent sessions.**

---

## Direct answers

### (a) The closest existing product, and how it differs

**Entire (entire.io)** is the closest, and it is close enough to be treated as a direct competitor rather than
an adjacency. Same founder-level thesis ("Git preserves what changed, but nothing about why"), same input
(agent sessions across Claude Code / Codex / Gemini / Copilot / Cursor), same stated destination (a "semantic
reasoning layer" for multi-agent coordination and "shared memory that allows agents to coordinate"), same
named use case ("better handoffs — resume work without replaying prompts"). $60M seed, ex-GitHub CEO,
2026-02-10. (E-T11–14)

**How it differs — and this is the whole opening.** Entire's shipped artifact is *transcript archival keyed to
commits*. The proposal §7 explicitly rejects that: "Not transcript archival… Raw agent activity → Observation
→ Claim/Fact → Discovery / Decision / Specification." Entire's semantic layer is announced, not shipped
(E-T14), and its unit of record is the **commit**, which means work that produced no commit — a rejected
approach, an investigation, a dead end, an approved-but-unimplemented decision — has no home. That is exactly
the content the proposal claims is most valuable. Entire is also git-anchored by design, which caps it at
repository scope; the proposal's Work/Decision/Ownership graph spans repos, Slack, Linear and humans.

Two other close things, each closer on one axis and further on another:

- **Sentra** (E-T36) already implements the proposal's §8 almost exactly — factual memory with source,
  bi-temporal validity, supersession-not-deletion, REST + MCP, org-wide — but it is **general business
  memory** (sales, finance, legal, ops), not an engineering work graph. No Work, Specification, Agent Session,
  or Artifact entities. A generalist selling to the CIO, not an engineering system of record.
- **Google's OKF v0.2** (E-T21–22) already standardizes the proposal's §8 vocabulary — provenance, Actor
  (`human:<id>` vs agent vs process), trust tiers of unverified / machine-confirmed / human-reviewed,
  attestation. It is a **file format, not a service**: no ingestion, no extraction, no retrieval, no UI, no
  cross-repo graph. But it means the schema layer of the proposal is being commoditized in public by a
  hyperscaler, in the open, on Apache-2.0, while the proposal is still a thesis.

### (b) The gap nobody visibly serves

Assembling everything: nobody today sells **an engineering-specific, agent-populated, org-scoped state layer
where a claim has an authority status and a named human approver.**

Decomposed, each piece exists and each piece has an owner:
- Session capture keyed to code → **Entire, claude-mem** (E-T13, E-T18)
- Task/dependency graph agents read and write → **Beads, Backlog.md, Symphony** (E-T16, E-T20, E-T24)
- Cross-source "why does this code exist" answers → **Unblocked at $29/user/mo** (E-T25–26)
- Bi-temporal fact graph with source and supersession → **Sentra** (E-T36)
- Provenance/trust/authority vocabulary → **OKF v0.2** (E-T22)
- Generic agent memory API → **mem0 / Zep / Letta / Cognee** (E-T1–7)

The unserved intersection is narrow and specific: **the transition from "an agent claims X" to "the
organization has decided X, approved by a named human, superseding decision Y, with the rejected alternatives
and their reasons retained"** — §8, §9 and §12's Decision entity. Unblocked answers "why" by retrieving the
Slack thread where humans argued; it does not hold a decision record with an approver and a status. OKF
defines `human-reviewed` as a trust tier but ships no workflow to produce one. Nobody sells the approval
event.

The second unserved thing is **negative knowledge**: rejected approaches and their rejection reasons. Every
system indexed here records what happened. None deliberately records what was tried and abandoned, which is
what makes an agent repeat work six months later.

### (c) Does the gap stay open for a structural reason, or close on contact?

**Mostly it closes on contact, with one durable exception.**

**Closes fast — do not defend these:**
- *Session capture and handoff.* Entire has $60M, an ex-GitHub CEO, an MIT CLI already shipped, and the same
  roadmap (E-T11–14). Meanwhile handoff-as-a-standalone-product has been launched at least four times on HN in
  2026 and drew 1, 2, 5 and 5 points (E-T44). This is simultaneously the most contested and the least
  demanded position on the board. **Wedge A (agent handoff, §16A) is the worst available wedge, not the
  best.**
- *The schema.* OKF v0.2 already gave away, free and Apache-licensed, the exact provenance/trust/actor
  vocabulary of §8 (E-T22). Any proprietary schema will be compared to it and asked why it isn't OKF.
- *The retrieval layer.* Six well-funded companies and six 25k+-star OSS projects sell agent memory retrieval
  (E-T1–T9). Undifferentiable.
- *Vendor absorption.* OpenAI's answer to multi-agent coordination is already public and is "**use the issue
  tracker as shared state**" (E-T24). GitHub Issues + Symphony + a git-attached transcript covers a large
  fraction of §10 and §16D at zero marginal cost.

**Stays open for a structural reason (one, and it's real):**
Every incumbent's economics push it *away* from human approval workflow. Memory vendors are metered on
ingestion and retrieval calls (E-T1, E-T3) — an approval event is one low-volume write, worth nothing to them,
and gating writes on human review directly reduces their metered volume. Entire monetizes agent-generated
volume attached to commits; a decision that blocks a commit is anti-revenue. OKF is a format and Google has no
incentive to build the workflow. And the one thing an LLM cannot manufacture — **a named accountable human
who approved this** — is precisely what makes §8/§9 valuable and what no amount of extraction quality
substitutes for.

There is also a genuine structural reason it has stayed *empty*: the 10-year track record says humans will not
maintain decision records (E-T35: both leading ADR tools dormant since 2024; no ADR SaaS ever survived). The
argument that it's different now is that agents, not humans, do the writing and humans only approve — which
is exactly the model arXiv 2608.00122 deployed in production and explicitly **has not yet shown works**
(E-T47). So the honest position is: the gap is open because the demand is unproven, not because the
engineering is hard. Nobody is squatting on it because nobody has evidence it pays.

**Practical read:** if this is built, Wedge C (decision/provenance, §16C) — the one the proposal ranks third —
is the only defensible one, and the only sane way to build it is *on top of OKF v0.2 rather than beside it*,
consuming Entire/Beads/Symphony as inputs rather than competing with them for the capture layer.

---

## Negative results (queries run that found nothing)

- **"Heptio founders / Craig McLuckie + Entire.io"** — the task premise is wrong. Entire is Thomas Dohmke
  (ex-GitHub CEO). McLuckie founded Stacklok (2023, $17.5M A), unrelated. (E-T12)
- **"architecture decision records SaaS product startup shut down 'decision records' business 2024 2025"** —
  found no ADR product company, alive or dead. ADRs exist only as a documented practice (Fowler, adr.github.io,
  ThoughtWorks Radar "Adopt") plus two dormant OSS CLIs. No business ever existed to kill.
- **"Stack Overflow Developer Survey 2026 AI agents context memory results"** — **no 2026 results exist yet**;
  survey opened 2026-06-23, still collecting. (E-T45)
- **"DORA report 2026 AI agents findings context"** — DORA 2026 discusses agent oversight cognitive load and
  review latency but I found **no DORA question about agent context handoff or shared agent memory**.
- **"JetBrains State of Developer Ecosystem 2026 AI agents context survey"** — **not run**; WebSearch budget
  (200/200) exhausted. Unresolved.
- **"product 'agent proposed decision' human approval provenance engineering record MCP startup"** — **not
  run**; budget exhausted. This is the one search that could still surface a stealth direct competitor and it
  should be re-run.
- **Entire pricing** — entire.io/pricing serves a login page only. **No public pricing.** (E-T15)
- **Supermemory pricing** — not on homepage; not separately fetched.
- **Sentra pricing** — not disclosed on site. **No public pricing.** (E-T36)
- **Tessl "spec registry"** — the phrase appears in 2024–2025 press about the company but appears **nowhere**
  on tessl.io or tessl.io/pricing as of 2026-09-06. Treat "Tessl spec registry" as a discontinued positioning.
  (E-T28)
- **Multica** — surfaced only in aggregator listings as a Conductor alternative; I could not reach a primary
  product page. Unverified.
- **Greptile and Glean pricing** — I have only aggregator figures (E-T48, E-T49), not their own pricing pages.
  Treat as secondary.
- **Sourcegraph Cody Free/Pro termination** — only aggregator sources reached (E-T32). Directionally
  corroborated by Sourcegraph's public push to Amp, but not confirmed on sourcegraph.com.
