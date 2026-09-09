# Ideation brief — workledger

> **Gate artifact for Clause #11** (agentwaves adversarial-ideation discipline). Produced by the first
> coding-agent session per proposal §24. Nothing in this document is a decision to build; the
> product direction is selected by the operator, not by this brief.
>
> Full evidence base (≈220 sourced rows across nine reports, all URLs accessed 2026-09-06) lives in
> `plans/research/`. This brief cites those reports' ids (E-A*, E-B*, E-C*, E-N*, E-T*, E-D*, E-G*)
> alongside its own consolidated table (E-1…). The original proposal is `plans/00-proposal.md`.

**Session:** S1 · **Date:** 2026-09-06 · **Operator:** Manas Hardas
**One-line thesis (as proposed):** An agent-independent, agent-readable system of record for what an
engineering organization knows, is building, has decided, and who is accountable, fed by observing
coding-agent sessions.
**One-line thesis (as it survives this session):** The decision a named human approved is the one the
coding agent is not permitted to violate, and the blocked attempt is recorded as what was tried and
rejected.

---

## Open questions

Put to the operator on 2026-09-06 via the harness's question tool; answers quoted verbatim.

- **Q-1:** What is this project for, in the version of it you'd be happy with a year from now?
  **A:** "i want to eventually make money from it"
- **Q-2:** Who is the first real user of a v0, the one whose workflow it must not break?
  **A:** "Me plus the Dome team"
- **Q-3:** Roughly how much of your time can this get, and for how long before you want a go/no-go?
  **A:** "this is not important, why are you asking me this" — treated as declined; capacity is
  scored as unconstrained and is not asked again.
- **Q-4:** Which of these has cost you the most hours in the last two months (multi-select: re-briefing
  a new session / decisions forgotten or violated / repeated investigations / parallel agents colliding)?
  **A:** "Re-briefing a new session, Decisions forgotten or violated" — the other two were not selected.

Questions deferred to the operator at the verdict (not blocking this brief): see §Verdict and
§Handoff. The most consequential is whether `workledger/` is the intended project home (assumed from
the directory being created at 09:22 today alongside the workspace `git init`).

## Assumption register

| # | Assumption | Disposition | Evidence / answer | Kill criterion |
|---|---|---|---|---|
| A-1 | The operator wants revenue from this eventually | ASKED | Q-1 | — |
| A-2 | The first user is the operator plus the Dome team | ASKED | Q-2 | — |
| A-3 | The operator's sharpest pains are session re-briefing and decisions being forgotten or violated; not repeated investigation or agent collisions | ASKED | Q-4 | — |
| A-4 | An organization of 10 humans and 100–200 agents exists today | RESEARCHED — false on available data | E-14 (OpenAI Codex telemetry: 67.4% of org users run no concurrency; only >10% run 3+); E-15 (Anthropic's flagship fleet was 16 agents, coordinated via git lock files); E-A15 (JetBrains n>15k survey measures no concurrency at all) | — |
| A-5 | Observing agent transcripts is a viable capture mechanism for a third party | RESEARCHED — false | E-12 (OpenAI: transcript format "isn't a stable interface"); M-3 (12 Claude Code versions and 9 undocumented record types in one 2-month local archive); E-B5 (OTel redacts content by default) | — |
| A-6 | Agent/vendor independence is a defensible moat | RESEARCHED — false | E-7 (Warp: cross-harness team memory with provenance), E-N34 (Augment), E-N36 (Devin DeepWiki MCP), E-8 (Notion Lore), E-9 (Atlassian Teamwork Graph to Claude Code and Codex) | — |
| A-7 | Agent handoff is the strongest initial wedge (proposal §10, §16A) | RESEARCHED — false | E-19 (four standalone handoff launches on HN at 1/2/5/5 points), E-C32 (Amp shipped shared threads and handoff 2025-10-23, free), E-17/E-18 (Entire: $60M seed on the same roadmap) | — |
| A-8 | Transcript-to-knowledge extraction is a differentiator | RESEARCHED — false | E-5 (Anthropic Memory Stores), E-6 (Dreams reads 1–100 past sessions and rewrites a store), E-10 (Copilot Memory with citation re-validation), E-4 (claude-mem, 93k stars, free) | — |
| A-9 | A decision record with a named human approver, status lifecycle, and retained rejected alternatives is shipped by nobody | RESEARCHED — true | E-21 (repo search for ADR enforcement: 0 products), research-native §(b)1, research-thirdparty §(b) | — |
| A-10 | Persistent organizational context materially improves coding-agent outcomes | UNVERIFIED | E-2 (context files as a class do not improve task success and add >20% cost); E-3 (AGENTS.md cuts runtime 28.6% at parity); E-26 (SAP's deployment: "effects remain under evaluation"). Cuts both ways. | KC-1 |
| A-11 | A mechanically generated, verified index of approved decisions injected at session start prevents the violations already on record | UNVERIFIED | M-6, M-7 (three dated, costed violations exist as ground truth) | KC-1 |
| A-12 | Per-decision violations can be expressed as hook predicates that block without unacceptable false positives | UNVERIFIED | E-22 (practitioners: hooks "cannot prevent the model from generating wrong intent"); ≈112 hand-built decision hooks exist but all guard generic safety (E-G28) | KC-5 |
| A-13 | Harness vendors will not ship mechanical enforcement of user-recorded decisions (the position is structurally open) | UNVERIFIED — reasoned | E-20 (#2544, 45 reactions, open 14 months), E-22/E-23 (three enforcement asks closed not_planned); reasoning: the ask is a self-indictment of the model | KC-3 |
| A-14 | Someone will pay for decision enforcement | UNVERIFIED | E-21 (0 products), E-24 (only agent-native ADR tool: 12 stars), E-27 (1,715 HN job posts: zero context-maintenance roles); nearest money buys prevention, not adherence (E-28) | KC-2 |
| A-15 | The CTO-bottleneck segment will buy a services engagement that installs the discipline | UNVERIFIED | E-29 (Rally CTO's stated purchase logic, $19–29/user/mo), E-30 (58 employers publicly running Claude Code daily, contactable), E-31 (published $100–300/hr rates with CLAUDE.md authoring as a line item) | KC-2 |
| A-16 | The operator will sustain the decision practice himself | UNVERIFIED — and currently trending false | M-8 (8 ADRs 07-24→08-04, then none for 33 days while handoffs continued); E-C21 (agentwaves at 3 stars, not used in the operator's own primary workspace) | KC-4 |
| A-17 | `workledger/` is the intended project home | UNVERIFIED — trivial | directory created 2026-09-06 09:22 alongside the workspace git init; operator confirms or moves it | KC-6 (dogfood location) |

## Evidence

Primary sources first. Consolidated from the nine reports; the reports hold the full ≈220-row tables.

| # | Claim it supports | Source | Date | Type |
|---|---|---|---|---|
| E-1 | The file-based workaround is at industrial scale: 944,128 `AGENTS.md`, 776,192 `CLAUDE.md`, 118,016 `HANDOFF.md`; the operator's own convention file `wave-state.md` appears in 7 repos | https://api.github.com/search/code (authenticated, counts approximate per GitHub docs) | 2026-09-06 | primary |
| E-2 | Context files as a class do not improve task success and add >20% inference cost; LLM-written ones are marginally negative | https://arxiv.org/abs/2602.11988 (ETH Zurich, v2 2026-06-23) | 2026-09-06 | primary |
| E-3 | AGENTS.md presence cuts median runtime 28.64% and output tokens 16.58% at comparable completion (124 PRs, 10 repos) | https://arxiv.org/abs/2601.20404 | 2026-09-06 | primary |
| E-4 | claude-mem: session capture, compression, re-injection across Claude Code, Codex, Gemini, Copilot, OpenCode; 93,336 stars, 325 open issues, 18,841 npm downloads/week; top open issue has 3 reactions and is about a 64% API-cost overhead | https://github.com/thedotmack/claude-mem ; https://api.npmjs.org | 2026-09-06 | primary |
| E-5 | Anthropic Memory Stores (Managed Agents, beta): workspace-scoped, attachable to many sessions, "one store per end user, per team, or per project", immutable versions, redaction; not reachable from Claude Code | https://platform.claude.com/docs/en/managed-agents/memory | 2026-09-06 | primary |
| E-6 | Anthropic Dreams (research preview): reads a store plus 1–100 past session transcripts and produces a reorganized store with stale entries replaced | https://platform.claude.com/docs/en/managed-agents/dreams | 2026-09-06 | primary |
| E-7 | Warp Agent Memory: one store shared across Warp Agent, Claude Code and Codex; Personal/Agent/Team scopes; extracts "durable facts, learnings, and outcomes" from transcripts; "each memory records where it came from"; research preview, Enterprise tier only | https://docs.warp.dev/agent-platform/agent-memory/ ; https://warp.dev/pricing | 2026-09-06 | primary |
| E-8 | Notion Lore: shared persistent agent memory with a `lore-decision` tool that supports supersede, hooked into Claude Code, Codex, Cursor; a 20% project, ~121 stars | https://github.com/makenotion/lore | 2026-09-06 | primary |
| E-9 | Atlassian is the only vendor claiming the position: Jira as "open control plane for AI coding agents" where "an event in your system of record can … trigger the right agent, and log the outcome" | https://www.atlassian.com/blog/development/scale-agent-impact-with-jira-automation | 2026-09-06 | primary |
| E-10 | GitHub Copilot Memory: repo-scoped facts incl. "architectural decisions", shared with all repo readers, stored with code citations that are re-verified against the current branch at retrieval, 28-day decay; Copilot-only; on by default for Pro | https://docs.github.com/en/copilot/concepts/agents/copilot-memory ; https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/ | 2026-09-06 | primary |
| E-11 | Claude Code auto memory is machine-local and per-repo; its `project` type is "decisions that Claude can't derive from the code or git history"; `CLAUDE_MEMORY_STORES` ("mounted team memory stores") appears in CHANGELOG v2.1.172 and in none of the four relevant doc pages | https://code.claude.com/docs/en/memory ; https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md | 2026-09-06 | primary |
| E-12 | Codex memories are local and per-user; Codex docs state "the transcript format isn't a stable interface for hooks and may change over time" | https://learn.chatgpt.com/docs/customization/memories ; https://learn.chatgpt.com/docs/hooks | 2026-09-06 | primary |
| E-13 | Anthropic list pricing: Sonnet 5 $2/$10, Haiku 4.5 $1/$5, Opus 5 $5/$25 per MTok; batch −50%; 4.7+ tokenizer emits ~30% more tokens per text | https://platform.claude.com/docs/en/about-claude/pricing ; https://claude.com/pricing | 2026-09-06 | primary |
| E-14 | OpenAI Codex telemetry: 67.4% of organizational users run no concurrency; only >10% manage 3+ concurrent agents; inside OpenAI 28.6% manage 5+ | https://cdn.openai.com/pdf/5d1e1489-21c0-43e4-9d42-f87efdbf0082/the-shift-to-agentic-ai-evidence-from-codex.pdf | 2026-09-06 | primary |
| E-15 | Anthropic's 100k-line C compiler: 16 agents, ~2,000 sessions over two weeks, coordinated through git with lock files and progress files | https://www.anthropic.com/engineering/building-c-compiler | 2026-09-06 | primary |
| E-16 | Context rot: a single distractor lowers accuracy below the needle-only baseline; effects compound; focused ~300-token prompts beat ~113k-token full prompts | https://www.trychroma.com/research/context-rot | 2026-09-06 | primary |
| E-17 | Entire: $60M seed at $300M valuation (2026-02-10), founded by the former GitHub CEO; no public pricing | https://techcrunch.com/2026/02/10/former-github-ceo-raises-record-60m-dev-tool-seed-round-at-300m-valuation/ ; https://entire.io/pricing | 2026-09-06 | primary |
| E-18 | Entire ships Checkpoints (MIT CLI) capturing transcripts/prompts/files/tool calls per commit across Claude Code, Codex, Gemini, Copilot, Cursor; names "better handoffs"; its multi-agent semantic layer is announced, not shipped | https://entire.io/blog/hello-entire-world | 2026-09-06 | primary |
| E-19 | Standalone agent-handoff launches on HN draw near-zero interest: AHP 5 pts, Sol 2, Ctxbin 1; versus memory-infra repos at 25k–93k stars | https://hn.algolia.com/api/v1/search?query=agent%20handoff | 2026-09-06 | primary / negative |
| E-20 | anthropics/claude-code #2544 "CLAUDE.md Mandatory Rules Consistently Ignored": 45 reactions, open since 2025-06-24 | https://github.com/anthropics/claude-code/issues/2544 | 2026-09-06 | primary |
| E-21 | GitHub repo search: "architecture decision record enforcement lint" → 0 repos; "ADR compliance check pull request" → 0; "decision drift detection codebase" → 1 repo, 0 stars | https://api.github.com/search/repositories | 2026-09-06 | negative |
| E-22 | #34132 "Rules in .claude/rules/ and CLAUDE.md are advisory-only — no enforcement mechanism": closed not_planned 2026-05-01; commenters ship 24-hook compliance systems and note hooks "cannot prevent the model from generating wrong intent" | https://github.com/anthropics/claude-code/issues/34132 ; https://github.com/anthropics/claude-code/issues/34358 | 2026-09-06 | primary |
| E-23 | #69455 "Claude silently undermines documented architectural decisions without flagging the divergence" (decision recorded in PROJECT_LOG.md and memory, contradicted in prod three times in one session): closed not_planned 2026-08-08; #51728 (violates own persistent instructions "100+ times"): closed not_planned | https://github.com/anthropics/claude-code/issues/69455 ; https://github.com/anthropics/claude-code/issues/51728 | 2026-09-06 | primary |
| E-24 | ADR tooling never became a business: adr-tools 5,669 stars, last commit 2020-03-30; log4brains last commit 2024-12-17; the only agent-native ADR tool (adrkit) has 12 stars | https://github.com/npryce/adr-tools ; https://github.com/thomvaill/log4brains ; https://github.com/mbeacom/adrkit | 2026-09-06 | primary |
| E-25 | Beads #5877 "Memory Beads" (70 comments): "no structured change authorship … a corrected policy can silently replace the only copy of the old policy"; four fleets report hand-maintained memory indexes hitting a wall at 132/165/191 entries | https://github.com/gastownhall/beads/issues/5877 | 2026-09-06 | primary |
| E-26 | SAP SE deployed shared organizational memory for coding agents with contributor-approval gates and per-memory provenance (1,144 curated memories from 900 learnings); "effects on retrieval and coding tasks remain under evaluation" | https://arxiv.org/abs/2608.00122 | 2026-09-06 | primary |
| E-27 | HN "Who is hiring?" Apr–Sep 2026, 1,715 top-level posts: one mention of CLAUDE.md/AGENTS.md (an intern req); zero roles for maintaining agent context or coding-agent governance | https://hn.algolia.com/api/v1/items/49522897 (and five prior monthly threads, ids in demand-archaeology.md) | 2026-09-06 | primary / negative |
| E-28 | MintMCP (agent identity, access control, audit logs for Claude Code/Codex): "40+ paying customers including Braze, Coursera, and Stability AI in the last 6 months"; team 6→12 FTE | https://mintmcp.com/pricing ; HN item 49525367 | 2026-09-06 | primary |
| E-29 | Unblocked: $19/$29 per user/mo; 14 named customers at 100–350 engineers; Rally's CTO: "it wasn't worth our time to cobble that together internally … saved me at least five to ten hours a week" | https://getunblocked.com/pricing/ ; https://getunblocked.com/customers/rally | 2026-09-06 | primary |
| E-30 | 69 HN hiring posts across 58 distinct employers state they run Claude Code daily, each with an apply link or founder email; mostly 2–30-person teams | https://hn.algolia.com/api/v1/items/49522897 (corpus listed in demand-archaeology.md E-D12) | 2026-09-06 | primary |
| E-31 | Claude Code consulting market with published rates: $100–300/hr; engagements from 3-day audits to 6-month embeds; CLAUDE.md authoring and hook/governance setup named as deliverables | https://ayautomate.com/blog/claude-code-consulting-services | 2026-09-06 | secondary (one vendor's page) |
| E-32 | Ramp's internal agent platform "Inspect": 5.5 dedicated FTE plus 150+ contributors; Shopify's "River": 59,918 sessions/30 days, 3,536 merged co-authored PRs. Both are runtimes and session substrates, not decision records | https://newsletter.pragmaticengineer.com/p/why-ramp-built-inspect ; https://shopify.engineering/under-the-river | 2026-09-06 | primary |
| E-33 | Google Cloud OKF v0.2 spec defines provenance, actor (human vs agent vs process), trust tiers (unverified / machine-confirmed / human-reviewed), attestation, as a free file format | https://github.com/GoogleCloudPlatform/open-knowledge-format | 2026-09-06 | primary |
| E-34 | The "underlying source of truth" pitch has a body count: Pivotal Tracker decommissioned 2025; Almanac shut 2025; CodeStream EOL 2026-11-05; Swimm left software for services; DX exited to Atlassian (~$1B) | https://www.pivotaltracker.com/ ; https://get.almanac.io/go-forward ; https://swimm.io/blog/weve-stopped-asking-customers-to-bet-on-the-right-tool ; https://getdx.com/blog/dx-is-joining-atlassian/ | 2026-09-06 | primary |
| E-35 | Solo-founder multi-player dev tools plateau: SourceHut platform revenue $132,226 vs $367,810 consulting after ~5 years; Kalzumeus B2B SaaS ~$6,500 MRR after five years | https://sourcehut.org/blog/2023-03-27-2022-financial-report/ ; https://www.kalzumeus.com/2014/12/22/kalzumeus-software-year-in-review-2014/ | 2026-09-06 | primary (n≈2) |
| E-36 | Median B2B sales cycle 10.1 months; 95% of deals go to a vendor on the buyer's Day-One shortlist; SOC 2 Type II $20k–$150k and roughly a year elapsed | https://6sense.com/newsroom/the-timeline-for-influencing-b2b-buyers-is-shrinking-insights-from-6senses-2025-buyer-experience-report/ ; https://www.vanta.com/collection/soc-2/soc-2-type-2 | 2026-09-06 | primary / secondary |
| E-37 | Agent trajectories leak credentials: 6,708 public trajectories yielded 62 API keys, 33 passwords, 24 tokens; 64 appeared only inside encrypted reasoning | https://profero.io/blog/stolen-thoughts/ | 2026-09-06 | primary |
| E-38 | Extraction fidelity from agent transcripts is unmeasured: no benchmark covers extracting decisions (including reversals) from long tool-use trajectories; queries "agent transcript decision extraction benchmark", "reversal detection long agent transcript" | no public data found | 2026-09-06 | negative |
| E-39 | No public data on agents-per-organization or concurrent agent counts beyond E-14; queries "how many coding agents run concurrently per engineering team survey 2026", "parallel agents per developer DX report" | no public data found | 2026-09-06 | negative |
| E-40 | No survey or benchmark quantifies context-recovery cost between agent sessions; Stack Overflow 2026 survey still in collection; DORA/JetBrains 2026 carry no such question | no public data found | 2026-09-06 | negative |

### First-party measurements (operator's machine, read-only, 2026-09-06)

These are local measurements, not public sources; method stated per row. Nothing under `keys/` was opened.

| # | Measurement | Method |
|---|---|---|
| M-1 | Transcript volume: 185 session files, 201 MB, ≈40.0M content tokens over 35 days (17 active) ⇒ **≈34.3M tokens per developer per 30-day month**, one human, one tool | `~/.claude/projects/**/*.jsonl`, ids stripped, chars/4 |
| M-2 | Full transcript extraction at list price (E-13): **$42.90 (Haiku 4.5) / $85.80 (Sonnet 5) / $214.50 (Opus 5) per developer-month**; 50% GM at Haiku tier needs an $86 seat vs Linear $16, Unblocked $29 | arithmetic on M-1 × E-13 |
| M-3 | Transcript schema instability: 176 files span 12 Claude Code versions (2.1.220→2.1.261) with 9 undocumented record types (`atis-latch`, `bridge-session`, `frame-link`, …) | parse of M-1 corpus |
| M-4 | dome_workspace durable-knowledge corpus: 20 handoffs (23,969 words), 38 memory files (16,454), CLAUDE.md (1,454), 8 ADRs (16,405), 10 spec/plan pairs (49,247) ⇒ **107,529 words ≈ 139,788 tokens** | `wc -w` over the listed paths |
| M-5 | Handoffs are deltas, not state: mean 5-gram overlap between consecutive handoffs **4.3%**; newest handoff shares **0.0%** with its predecessor; the documented session-start path (CLAUDE.md + newest handoff + memory index) is **2,929 words ≈ 3,808 tokens = 2.7% of the corpus** | normalized 5-gram shingles |
| M-6 | Rule replication as the remedy for violations: the consumer-key rule appears in **20 files**, "never touch" in 13, "release branch only" in 7; "never" appears **199 times** across the corpus | `grep -c` |
| M-7 | Decisions violated anyway, dated and costed: `--help` treated as a safe probe (**$1.40–2.70, 2026-08-03**); `_loads_json(raw) or {}` re-introduced "verbatim the bug its own docstring says it was written to prevent" (2026-08-10); "the same bug again, one week later" on rep identity; "ADR-0004's deploy token has still not been rotated" carried verbatim across 3 handoffs | quoted from handoffs and memory files |
| M-8 | The high-value artifact decays first: 8 ADRs written 2026-07-24→08-04 (6 with a named decision owner; ADR-0007 supersedes ADR-0004; alternatives rejected with reasons), then **no ADR for 33 days** while handoffs continued to 09-04. `MEMORY.md` last written 08-29 with **7 of 37 files unreachable** from it, including the file defining what Dome is | file dates; index diff |
| M-9 | Write-at-source output per session: 1,558 tokens (handoff) + 1,070 (memory) = **2,627 tokens ⇒ $0.013–0.066 per session ⇒ $2.09–10.44 per developer-month** at E-13 output rates, versus $34–68 for re-reading transcripts | arithmetic |
| M-10 | Agent fan-out: 108 subagent transcripts under 14 parents; three sessions at 33/36/38 subagents each; **no session id appears anywhere** in the handoff or memory corpus (the durable actors are the human and the artifact) | file counts; `grep` |
| M-11 | agentwaves (the operator's published protocol) is not used in dome_workspace: no `wave-state.md`, `next-session.md`, or `capacity-log.md` exists there | `find` |

### Prior art / incumbents

| Product | What it does | Pricing | Still alive? | Source |
|---|---|---|---|---|
| Anthropic Memory Stores + Dreams | Workspace-scoped shared stores; transcript-driven store rewriting; Managed Agents only | API usage | yes, beta/preview | E-5, E-6 |
| GitHub Copilot Memory | Repo-scoped facts incl. architectural decisions, code-citation provenance, JIT re-validation, 28-day decay; Copilot-only | in Copilot seat | yes, default-on | E-10 |
| Warp Agent Memory | Cross-harness (Warp, Claude Code, Codex) team memory extracted from transcripts with source provenance | Enterprise tier above $50/user/mo | research preview | E-7 |
| Entire (Checkpoints) | Per-commit capture of agent sessions across five harnesses; coordination layer announced | no public pricing | yes, $60M seed | E-17, E-18 |
| claude-mem / cmem.ai | Session capture, compression, re-injection; Team Cloud at $333/seat/mo with no visible buyer | free / $30 / $333 | yes, 93k stars | E-4, E-D4 |
| Unblocked | Knowledge graph over code, Slack, issues, docs; answers "why"; MCP server; team buyer | $19 / $29 per user/mo | yes, 14 named logos | E-29 |
| Beads | Git-synced graph issue tracker for agents (Dolt-backed) | free, MIT | yes, 26.9k stars | E-25 |
| OpenAI Symphony | Spec for orchestrating agent fleets using the issue tracker as shared state | free | yes, 27k stars | E-T24 |
| Notion Lore | Shared agent memory with `lore-decision` + supersede; 20% project | free | yes, ~121 stars | E-8 |
| Atlassian Jira / Teamwork Graph | Graph context to Claude Code and Codex via MCP; Jira Automation as agent control plane with audit trail | $20/dev/mo (twg) | yes | E-9, E-C36 |
| mem0 / Zep-Graphiti / Letta / Cognee / Supermemory | Generic agent memory APIs; temporal edges (Zep); no approval/authority model | free–$375/mo | yes, 25k–65k stars each | E-T1–T9 |
| Sentra | Company-wide bi-temporal fact memory with supersession; not engineering-specific | no public pricing | yes, $5M seed | E-T36, E-D10 |
| Google OKF v0.2 | File format for knowledge with provenance, actors, trust tiers | free spec | yes | E-33 |
| MintMCP | Agent identity, access control, audit logs | custom per-user | yes, 40+ paying | E-28 |
| adr-tools / log4brains / adrkit | Decision-record CLIs | free | dormant / dormant / 12 stars | E-24 |
| Tessl Framework, CodeStream, Swimm (software), Pivotal Tracker, Almanac | Prior "spec/rationale/source-of-truth" products | — | pivoted / EOL 2026-11 / services / dead 2025 / dead 2025 | E-34, E-T29–T31 |

### Dependency + regulatory surface

- **Claude Code hooks** (31 events, `session_id` + `transcript_path`) are documented; agent hooks are flagged experimental; the transcript itself has no published schema (M-3). Legal page reserves enforcement "without prior notice" against binary modification and credential intermediation; hooks do neither, but third-party session ingest is not addressed either way (https://code.claude.com/docs/en/hooks ; https://code.claude.com/docs/en/legal-and-compliance, accessed 2026-09-06).
- **Codex hooks** exist with the written disclaimer that the transcript format is not a stable interface (E-12). **Cursor hooks** are beta and do not fire in cloud agents (E-B3). **OpenCode** plugin API is explicitly beta (E-B4). **Copilot** exposes no third-party observation surface at all (E-B9).
- **PreToolUse exit-code-2 blocking** in Claude Code is documented and is the mechanism practitioners already use for enforcement (E-22). Nothing in the terms restricts a user's own hooks from refusing a tool call in their own repo.
- **Secrets**: transcripts carry credentials invisible in the chat UI (E-37). Any design that ships transcripts off-machine inherits a security review at exactly the orgs large enough to matter.

---

## The case against

Consolidated from three red teams (full text: `plans/research/redteam-*.md`, 21 failure modes). The
eight below are the load-bearing ones; each was engaged by the steel-man and its status is noted.

### FM-1 — The target organization does not exist yet, and the pain that exists is a different pain · *demand*
**Mechanism:** The proposal is load-bearing on 10 humans directing 100–200 agents (§1). Primary vendor telemetry puts 67.4% of Codex org users at zero concurrency and only >10% at three or more (E-14); Anthropic's own flagship fleet was 16 agents coordinating through git lock files (E-15); the largest developer survey does not measure concurrency at all (E-A15). The coordination and active-work JTBDs (§11 #5, §16D) switch on above the number of agents a human can review, which is what caps agent count in the first place. The operator's own fan-out is real (38 subagents in one session, M-10) but those report in-context to a live parent; no collision problem arises, and the operator did not select "parallel agents colliding" as a pain (Q-4).
**Leading indicator:** Discovery calls produce a modal answer of "2–4 agents, one engineer, one repo" and nobody volunteers coordination as a top-three problem before being prompted.
**Evidence:** E-14, E-15, E-39, M-10, Q-4. Steel-man status: conceded on substance.

### FM-2 — Handoff, the proposal's declared strongest wedge, is the most contested and least demanded position on the board · *competitive*
**Mechanism:** Entire has $60M, a former GitHub CEO, an MIT CLI shipped across five harnesses, and the same roadmap (E-17, E-18); Amp shipped shared, searchable threads and a `read_thread` handoff tool in October 2025 for free (E-C32); claude-mem gives cross-harness session capture away at 93k stars (E-4). On the demand side every standalone handoff launch on HN in 2026 drew 1–5 points (E-19), and the memory-tool users with the loudest voice ask for reliability, not handoff or governance (E-G2). The operator's loudest personal pain ("re-briefing a new session") therefore maps to the worst commercial position.
**Leading indicator:** Every discovery call opens with "how is this different from claude-mem / Amp / Entire" and the answer takes three sentences about provenance the prospect does not visibly care about.
**Evidence:** E-4, E-17, E-18, E-19, E-C32, E-G2. Steel-man status: conceded.

### FM-3 — Transcript observation is a private, weekly-churning schema owned by the vendors you compete with, and extraction over it costs more than the seat · *technical*
**Mechanism:** The §17 MVP's input is a transcript. OpenAI states in writing that the format is not a stable interface (E-12); on this machine 176 Claude Code transcripts span 12 versions and 9 undocumented record types in two months (M-3); OTel redacts content by default (E-B5); Copilot has no surface at all. Reading every transcript through an LLM costs $43–215 per developer-month at list price (M-2), scaling with agents while revenue scales with human seats (FM-C1). The vendors run the same extraction inside the process at zero marginal cost (E-6, E-10).
**Leading indicator:** A rising share of sessions yields zero extracted claims, correlated with a harness version string not seen before; gross margin on the design partner falls below 70% within two quarters.
**Evidence:** E-12, E-13, M-1, M-2, M-3, E-B5. Steel-man status: conceded for the observer design; rebutted for write-at-source (M-9).

### FM-4 — Nothing invalidates a claim when the code changes, so the record becomes confidently stale, and stale-but-plausible context is worse than none · *technical*
**Mechanism:** Temporal memory systems invalidate a fact only when a newly ingested episode contradicts it (E-B14); a `git push` emits no episode, so a discovery about a deleted function stays valid with the same embedding forever. The one vendor that solved this (Copilot) did so by storing code citations and re-verifying them inside the repo at retrieval (E-10), which an external MCP server cannot do cheaply. Injecting a retrieved-but-stale claim is a textbook distractor, and a single distractor lowers accuracy below the no-context baseline (E-16). This is corroborated first-party: an unrotated deploy token carried verbatim across three handoffs and an index that orphaned 7 of 37 files within four days (M-7, M-8).
**Leading indicator:** In a design-partner repo after 8 weeks, sample 50 retrieved claims; if more than a handful cite a path or symbol absent at HEAD, the record is a liability. In the §18 A/B, the informed agent shows higher variance than the cold agent.
**Evidence:** E-10, E-16, E-B14, M-7, M-8. Steel-man status: conceded; strongest technical objection.

### FM-5 — The incumbents already shipped storage, extraction, and agent independence; the residual is three fields · *dependency/regulatory*
**Mechanism:** Anthropic ships workspace-scoped Memory Stores with versioning (E-5) and a transcript-driven rewriting pipeline (E-6), and `CLAUDE_MEMORY_STORES` is in the Claude Code changelog but not the docs (E-11). Copilot Memory stores architectural decisions with provenance and freshness, default-on (E-10). Warp, Augment, Devin, Notion Lore and Atlassian are all agent-independent today (E-7, E-8, E-9). What no shipped store carries is proposer-vs-approver, a status lifecycle, and retained rejected alternatives (A-9). A vendor can add three fields in a release.
**Leading indicator:** `CLAUDE_MEMORY_STORES` appears in the env-vars doc page, or the "machine-local" sentence in the memory doc changes, or Copilot Memory widens from repo to org scope.
**Evidence:** E-5, E-6, E-7, E-8, E-9, E-10, E-11. Steel-man status: conceded for storage and extraction; not conceded for the approval schema, with the counter that three fields are cheap to add.

### FM-6 — Markdown in git is the free substitute, the operator already wrote 107k words of it, and ADRs ran a 15-year natural experiment with a negative result · *economic*
**Mechanism:** The workarounds in §5 are free, offline, diffable, reviewable, greppable by any agent without integration, and carry no egress review or token cost. The operator has 107,529 words of them (M-4). Anthropic's own 16-agent fleet used markdown and git (E-15). The proposal's most distinctive primitive, the decision record, has been free and endorsed since 2011 and orgs still do not maintain them: adr-tools dormant since 2020, the only agent-native ADR tool at 12 stars (E-24). The operator's own ADR practice stopped 33 days ago while cheaper artifacts continued (M-8). Automating the writing does not fix the reading or the sustaining.
**Leading indicator:** In the §18 experiment, an arm with a hand-written handoff markdown file lands within 80% of the structured record. Design partners install the product and keep writing HANDOFF.md anyway.
**Evidence:** E-1, E-15, E-24, M-4, M-8, M-11. Steel-man status: conceded on the record; contested on enforcement (a markdown file cannot refuse a tool call: M-6, M-7).

### FM-7 — There is no budget line, no reachable buyer for a hosted product, and the channel is a lottery · *distribution*
**Mechanism:** Engineering AI budgets are 1–3% of eng spend and consumed by seats (E-A11); the closest funded analogue (Unblocked) needed $30M and 34 people to reach a $29 seat (E-A8, E-29); nobody hires humans to maintain agent context (E-27); the median packaged MCP server gets 1,663 weekly downloads with the top three taking 92.5% (E-A7); the operator's own OSS expression of the thesis has 3 stars and its convention file is in 7 repos (E-C21, E-1). Anything above ~30 people requires SOC 2, SSO and a 10-month cycle in a category where 95% of deals go to a Day-One shortlist (E-36). The proposal's "underlying state layer" positioning has a body count and, when it works, exits to the tracker's owner (E-34).
**Leading indicator:** In discovery, "which budget line pays?" is answered with "we'd have to create one." The first enterprise pilot stalls in a security questionnaire over transcript egress.
**Evidence:** E-1, E-27, E-29, E-34, E-36, E-A7, E-A8, E-A11, E-C21. Steel-man status: conceded; no first-party evidence bears on it.

### FM-8 — The operator abandons his own discipline, and the artifact he abandons first is the one this product is made of · *operator*
**Mechanism:** agentwaves, published with a 17-invariant session-close gate, is not used in the operator's own primary workspace (M-11). In that workspace the cheap artifact (handoffs) ran to 09-04 while the high-value one (ADRs with owners, supersession, rejected alternatives) stopped on 08-04 (M-8). The memory index was last regenerated 08-29 and is missing the founder's own definition of the company (M-8). Every failure the steel-man measured is a hygiene failure fixable by a 50-line script, and the operator has demonstrated three times that he will not sustain a chore. A product whose value compounds only if its author keeps recording decisions is exposed to its author.
**Leading indicator:** No new decision record is written in dome_workspace in the six weeks after this brief; the ADR count on 2026-10-18 is still 8.
**Evidence:** M-8, M-11, E-C21, E-1. Steel-man status: raised by the steel-man against itself; unrebutted.

## The case for

Written after the case against; each reason names the failure modes it survives. Full text:
`plans/research/steelman.md`.

### FOR-1 — The handoff is a delta, not a state, and the documented entry point only knows the delta
**Mechanism:** A per-session handoff is written as "what changed", so state never accumulates in it; a reader instructed that "the newest is always the source of truth" receives a diff with no base. This is a pointer problem, not a context-volume problem, and it is measurable rather than hypothesized.
**Evidence:** M-5 (4.3% mean overlap between consecutive handoffs; newest 0.0%; entry path reaches 2.7% of the corpus at 3,808 tokens, i.e. 1.9% of a 200k session).
**Which failure mode it survives:** FM-6 (this is markdown failing at a specific, fixable job, not markdown succeeding); the E-2 "more context hurts" result does not apply because the fix is a smaller, mechanically generated index, not more prose.

### FOR-2 — The unserved primitive is already produced by hand, by the first user, at the standard nobody ships
**Mechanism:** Unprompted, the operator writes decisions with a named human owner, a status, supersession, and rejected alternatives with reasons; the newest handoff has a section "Decisions taken by the founder this session" with accepted / approved / not-yet-agreed states. Two independent research passes found no vendor shipping proposer-vs-approver, authority status, or retained rejected alternatives (A-9). The product does not need to teach the practice; it needs to make the practice reachable and binding.
**Evidence:** M-8 (6 of 8 ADRs with a named decision owner; ADR-0007 supersedes ADR-0004; "rejected on evidence"), E-21, E-24 (the gap is empty, not occupied), research-native §(b)1, research-thirdparty §(b).
**Which failure mode it survives:** FM-5 (the residual is exactly this and it is the only residual), FM-2 (it is not handoff).

### FOR-3 — Write-at-source collapses the cost and observation objections, and the proof is 20 files on disk
**Mechanism:** The agent that lived the session writes the durable record before it ends, in its own context; no second LLM ever reads a transcript, no parser touches a private schema, and nothing leaves the machine. The 20 handoffs and 38 memory files were produced this way with zero transcript parsing.
**Evidence:** M-9 ($0.013–0.066 per session; $2.09–10.44 per developer-month vs $34–68 for transcript re-reading), M-3 (the schema that write-at-source avoids), E-37 (the egress it avoids). Red-team C's own first "what would change my mind" bar was extraction under ~$5/dev/month.
**Which failure mode it survives:** FM-3 entirely; FM-7's security-review half. Caveat: a crashed or compacted session yields nothing, and only the parent session should write (subagent fan-out of 36× would otherwise re-inflate cost).

### FOR-4 — Replication is the operator's current remedy for "decisions violated", and it is measurably failing, which is the product's opening
**Mechanism:** A rule copied into N files has N places to drift and no authoritative one, and a recited rule is still advisory. The pain the operator named is violation (Q-4), and violation is an enforcement problem: a record that is retrieved and then ignored (E-20, E-22, E-23) has not solved it. A PreToolUse hook that exits 2 makes the tool call physically impossible, which is the one thing a markdown file cannot do.
**Evidence:** M-6 (one rule in 20 files; 199 "never"s), M-7 (three dated violations anyway, one costing $1.40–2.70), E-20 (45 reactions, 14 months), E-22/E-23 (the incumbent closed the enforcement ask three times as not planned), E-G28 (≈112 hand-built decision hooks in the wild, all guarding generic safety, none a project decision).
**Which failure mode it survives:** FM-6 on the enforcement half; FM-5 (auto memory "skips anything it can derive from the codebase" and these prohibitions are not derivable); FM-4 (a standing prohibition does not go stale when a file is deleted).

### FOR-5 — Enforcement at the tool boundary is a position the harness vendor has structurally declined
**Mechanism:** "We mechanically block our model from violating your written rule" is a self-indictment that a model vendor cannot ship without conceding that its model does not follow instructions; the ask is the bug report. Enforcement lives at PreToolUse exit-2 and in CI, outside the model, exactly where a third party is permitted to sit. Memory vendors are metered on write and retrieval volume, so a low-volume approval event plus a blocking gate is anti-revenue for them (E-G22: mem0 calls ADD-only "intended design"). A blocked attempt is also a negative-knowledge record captured at the only moment it exists, which is the one known answer to the "900 records, not one a decision" problem (E-G10).
**Evidence:** E-20, E-22, E-23, E-21 (0 products), E-G22, E-G10, E-G33.
**Which failure mode it survives:** FM-5 on the enforcement half (leading-indicator caveat: KC-3); FM-2 (not a memory product); FM-1 (does not require concurrency to be valuable).

---

## Kill criteria

Every UNVERIFIED assumption maps to at least one. Dates are calendar dates from today (2026-09-06).

### KC-1 — The index does not prevent the recorded violations
**Stop if:** Replaying the 3 dated violations in M-7 with (a) today's path (CLAUDE.md + newest handoff) and (b) CLAUDE.md + a mechanically generated index of approved decisions, across 5 runs each, (b) prevents fewer than 2 of the 3 violations in at least 4 of 5 runs, or (b) increases median tokens-to-first-correct-action by more than 20% over (a). Also stop the "informed agent" thesis if a hand-written handoff arm lands within 80% of (b).
**Covers:** A-10, A-11, A-12; FM-4, FM-6.
**Check by:** 2026-09-20.

### KC-2 — Nobody engages or pays
**Stop if:** After contacting 20 named companies from E-30 (the demand-archaeology list) with the opener "you said publicly that Claude Code does substantial implementation work; what happens when a session ends, and which recorded decision has an agent violated?", fewer than 4 take a call by 2026-10-15, or fewer than 1 pays for any engagement (audit, setup sprint, or retainer at ≥$2,000) by 2026-11-15.
**Covers:** A-14, A-15; FM-7.
**Check by:** 2026-11-15.

### KC-3 — The incumbent closes the position
**Stop if:** any 1 of these 3 events occurs: (1) Anthropic documents `CLAUDE_MEMORY_STORES` (or any shared memory) with a status field and a human-approver field, which kills the record half; (2) GitHub widens Copilot Memory to org scope with an approval state, which kills the record half; (3) Claude Code, Codex, or Cursor ships a first-party feature that blocks tool calls against user-recorded project decisions (not generic safety rules), which kills the enforcement half. Events 1 or 2 alone reduce ALT-1 to the hook only; event 3 ends it.
**Covers:** A-13; FM-5.
**Check by:** 2026-12-06, then quarterly.

### KC-4 — The operator does not sustain the practice
**Stop if:** Fewer than 6 new decision records with a named approver are written across dome_workspace and workledger in the 6 weeks to 2026-10-18 (i.e. under 1 per week), or the ADR count in dome_workspace is still 8 on that date.
**Covers:** A-16; FM-8.
**Check by:** 2026-10-18.

### KC-5 — Decisions cannot be expressed as blocking predicates without unacceptable false positives
**Stop if:** Of the standing prohibitions in dome_workspace (M-6: the ~12 rule-type memory files plus CLAUDE.md hard limits), fewer than 80% can be written as a PreToolUse predicate (path, command, or diff pattern) that fires on the recorded violation, or the hook blocks more than 3 legitimate tool calls per week of normal Dome work over 4 weeks.
**Covers:** A-12; FOR-4, FOR-5.
**Check by:** 2026-10-15.

### KC-6 — Dogfood shows no effect
**Stop if:** After 4 weeks of use in dome_workspace, the mechanically generated index is stale (any approved decision file absent from it) at any session start, or a recorded decision is violated without the hook firing more than once, or session-start read cost exceeds 6,000 tokens (roughly 1.5× today's M-5 figure).
**Covers:** A-11, A-16; FM-4, FM-8.
**Check by:** 2026-10-31.

---

## Alternatives considered

Clause #11 Rule 6. Eight candidates scored on identical terms against the operator's real constraints
(solo, no employees, no funding, no SOC 2, no sales team, low-traction GitHub, an unmeasured YouTube
channel, one small-team relationship). Full per-criterion scores: `plans/research/pivot-architect.md`.

| # | Candidate | Buyer (specifically) | Job it does | Build (weeks) | Distribution answer | Score | Verdict |
|---|---|---|---|---|---|---|---|
| ALT-0 | The specification unchanged: session observer → LLM extraction → structured store → MCP + human UI, org-wide | Not established after a full session of searching; only the operator has the pain | Org-wide agent-readable system of record | 26+ | None: no channel, no list, no buyer; MCP registry median 1,663 downloads/wk (E-A7) | 1.25 | NO-GO |
| ALT-1 | Decision enforcement: git-native `decisions/` schema (status, named approver, rejected alternatives, supersedes) + PreToolUse / pre-commit / CI hooks that block violations + blocked-attempt capture + citation verifier | CTO of a 15–80-person team plus the ≈112 operators already hand-building decision hooks (E-G28) | Makes the approved decision the one the agent cannot violate; logs the attempt as negative knowledge | 3–5 | Partial: real audience (E-20, E-G30) reached via content and community, a channel twice measured null for this operator (E-1, E-C21) | 3.81 | GO as the product, carried by ALT-4's channel |
| ALT-2 | Steel-man minimal shape: decisions dir + regenerated session-start index + verify command; no enforcement, no business | The operator | Makes his own decisions reachable and verified | 1–2 | None by construction (personal tooling) | 2.67 | Do it as week 1 of ALT-1; it is KC-1 |
| ALT-3 | Governance / audit gate for compliance buyers ("which human approved what an agent did") | Security and compliance leadership at 200+ engineer orgs | Retrospective agent-decision audit | 8–16 | None reachable by this operator: money is real (E-28) but sits behind SOC 2, SSO and a Day-One shortlist (E-36); requires a partner channel | 2.27 | NO-GO: right money, wrong operator |
| ALT-4 | Productized service: install the decisions / handoff / hook discipline for the CTO-bottleneck segment, OSS as the wedge | CTO or technical co-founder of a 15–80-person Series A/B company who is personally the context bottleneck (E-29 archetype) | Stops the CTO being the routing table; sells the practice the operator already runs | 0–2 | Yes, named: direct outreach to 20 of the 58 employers in E-30 this week; YouTube as content funnel (size not established) | 4.10 | GO as revenue and discovery vehicle, not the destination |
| ALT-5 | The Dome tracker: mobile-first issues + decisions model as a Dome card, ids DOME-N, own git repo (parked by the founder 2026-09-05) | The Dome founder, one person, already asked | Backlog plus decision log for one small team | 2–4 | One customer only; none at n=2 (Beads, Backlog.md, Linear free already serve the generic job) | 3.08 | Conditional: a favour and a dogfood, not a business |
| ALT-6 | Public decision-adherence benchmark ("does your agent violate recorded decisions?") | Nobody pays; vendors and consulting leads | Proves the violation rate is real | 3–6 | Content and community publishing only (HN constraint-led launches convert to stars, E-G29/G30); channel size not established | 3.00 | Marketing artifact for ALT-1 / ALT-4 |
| ALT-7 | Context staleness verifier: CI / pre-commit check that fails when CLAUDE.md, AGENTS.md or an ADR cites a path, symbol or command absent at HEAD | Any team with a context file in CI | Freshness, not memory | 1–2 | Yes: Actions / pre-commit marketplace listing over ~1.7M context files (E-1); single-player, zero-config | 3.54 | Build inside ALT-1; the only cheap answer to FM-4 |

**Scoring criteria used:** distribution concreteness (20%), structural defensibility (15%), revealed
spend (15%), time to first dollar (12%), dogfoodable by the first user this month (12%), build weeks
(10%), kill-test cheapness (10%), unit-economics shape (6%). Distribution is weighted highest because
the adversarial wave's single strongest finding was the absence of a nameable buyer, and E-36 says
95% of deals go to a shortlisted vendor. Sensitivity: ALT-4 and ALT-1 are separated by 0.29 on chosen
weights and tie at 4.00/3.96 if defensibility is raised to 20% and spend cut to 10%. They are
complements: ALT-4 is the distribution answer ALT-1 lacks; ALT-1 is the compounding asset ALT-4 lacks.

**Why the winner beats the specification:** ALT-0 ranks last on every criterion except ambition. It
has no buyer after three agents searched for one; its storage and extraction are already first-party
APIs (E-5, E-6, E-10); its economics invert as its thesis comes true (M-2); its input is a schema the
competitors own (M-3). ALT-1 keeps the one entity nobody ships (the approved decision with rejected
alternatives) and changes the verb from *remember* to *block*, which is the change that moves FM-6
(markdown cannot refuse a tool call), FM-4 (a prohibition does not decay), and FM-5 (the incumbent has
declined the position three times). ALT-4 supplies what ALT-1 lacks: a named, contactable buyer and a
first dollar inside 60 days without a compliance gate. For ALT-0 to win, a buyer would have to name
the budget line unprompted, extraction would have to fall below ~$5/dev/month with measured recall, a
harness would have to publish a versioned session-export contract, and the §18 experiment would have
to beat a markdown control arm by a wide margin. None of the four has happened; three are outside the
operator's control.

**Evidence that each alternative is not already served:** ALT-0: served in pieces by better-resourced
parties (E-5, E-6, E-7, E-10, E-17, E-26). ALT-1: not served (E-21: 0 repos; E-G28: all 112 hooks
guard generic safety). ALT-2: served by free equivalents (E-C23 basic-memory, E-G30 OKF Agent Memory).
ALT-3: served (E-28 MintMCP; E-C33 GitHub enterprise agent controls; E-D19 Vanta waitlisted). ALT-4:
served but unconsolidated at $100–300/hr (E-31; marketplace volume not established, Upwork/Fiverr
returned 403). ALT-5: generic job served (E-25 Beads, E-T20 Backlog.md, E-C13 Linear free); the Dome
packaging is unserved because it is a single-customer requirement. ALT-6: not served (E-38). ALT-7:
partly served first-party and Copilot-only (E-10); **not established** for a harness-agnostic linter,
no search this session covered it; run that search before committing.

---

## Verdict

**Decision:** `RESHAPE`

**Reasoning:** The problem is real and the operator's own workspace proves it with dates and dollar
amounts (M-6, M-7, M-8). The proposed solution is wrong in three load-bearing places: its wedge
(handoff) is the most contested and least demanded position on the board; its mechanism (transcript
observation and extraction) is already a first-party API and runs at a cost that inverts with adoption;
and its scope (an org-wide system of record) has no buyer this operator can reach. What survives is
narrow and specific: the human-approved decision as a first-class, git-native record that a hook can
enforce, with the blocked attempt recorded as negative knowledge. That position is empty (E-21),
structurally declined by the harness vendor (E-22, E-23), immune to code staleness by construction,
and dogfoodable this month against ground truth already on disk.

**If RESHAPE — what changes:**
- **Primitive:** from a graph of Work / Spec / Decision / Discovery / Claim / Session / Artifact to one
  entity, the Decision (with the standing prohibition as its degenerate case), plus the blocked
  attempt as its negative-knowledge twin. Specs already live in `docs/superpowers/`; git holds artifacts.
- **Verb:** from *remember* to *block*. The session-start index is a by-product; the hook is the product.
- **Capture:** from session observer plus LLM extraction to write-at-source by the parent session
  (M-9), refusing to close a session that leaves a proposed decision without an approver.
- **Scope:** from org-wide and cross-vendor to one repo and one harness (Claude Code) for v0; Codex
  hooks second only if a paying engagement needs it.
- **Wedge:** from §16A (handoff) to §16C (decision provenance), fused with enforcement.
- **Go-to-market:** from a hosted product to a productized service (ALT-4) to the CTO-bottleneck
  segment, with the OSS enforcement tool (ALT-1) as the deliverable and the compounding asset.
- **Not built:** transcript ingestion, cloud store, MCP server, vector retrieval, agent identity,
  cross-agent presence, a handoff product, a human UI, Jira/Linear projections, and any company
  requiring SOC 2 before the first invoice.

**Strongest argument against this verdict:** Every failure the steel-man measured is hygiene, not
capability. A stale index, a rule copied into 20 files, and an abandoned ADR directory are each fixed
by a 50-line script, and a 50-line script is a chore, not a product. The operator has now demonstrated
three times that he does not sustain a chore: agentwaves at 3 stars, its convention file in 7 repos,
and agentwaves absent from his own primary workspace. Worse, the abandonment runs in exactly the wrong
direction, since the cheap artifact survived and the high-value one stopped 33 days ago. If the author
of the product is its counter-example, then the reshape is a NO-GO wearing a costume, and the honest
verdict is: take the ALT-4 revenue, keep the practice as a personal discipline, and do not pretend the
hook is a company. KC-4 exists to make this argument falsifiable within six weeks.

**Cheapest next test:** KC-1, this week, on data already on disk. Generate the decision index from the
existing dome_workspace ADRs and rule-type memory files, then replay the three recorded violations
(M-7) with and without it. It costs one afternoon and no external contact, and it decides whether
ALT-2/ALT-1 have any effect before a line of hook code is written. In parallel, send the 20 emails
(KC-2), since that costs nothing and its clock is the longest.

---

## Handoff to Wave 0

Provisional. Wave 0 must not begin until the operator explicitly selects a direction; this section
records what the verdict implies if he selects the reshape.

- **P1 scope this implies:** A git-native `decisions/` directory (markdown + YAML frontmatter: id,
  status ∈ {proposed, approved, superseded, deferred}, approver, evidence paths, alternatives rejected
  with reasons, supersedes, enforce-as predicate); a `SessionStart` hook that injects a mechanically
  regenerated index of approved and open decisions only; a `SessionEnd`/`Stop` hook that writes new
  proposed decisions in-context and warns when one lacks an approver; a `PreToolUse` hook that
  evaluates enforce-as predicates and exits 2 on violation, appending the blocked attempt to
  `decisions/attempts.log`; a `decisions verify` command that fails when a cited path or symbol is
  absent at HEAD (ALT-7). Dogfooded in dome_workspace first, then packaged as a Claude Code plugin.
- **Out of scope for P1, deliberately:** transcript parsing; any server, auth, or cloud store; MCP;
  embeddings or semantic search; agent or session identity; concurrency or presence; Codex/Cursor/
  OpenCode support; a human UI beyond the markdown files and `git log`; Jira/Linear/GitHub projections;
  pricing.
- **Stack decision + rationale (proposed, not decided):** a single-binary CLI with no runtime
  dependency on the user's machine (Go or Rust; the operator's existing tooling in dome_workspace and
  agentwaves is Python and shell, so Python with a `uv`-managed entry point is the lower-friction
  alternative if single-binary distribution is not needed for a plugin). Predicates as glob/regex over
  tool name, path, command, and diff, no DSL in P1. Decided at Wave 0 with the operator.
- **Open questions deferred to a later phase:** whether the paid surface of ALT-1 is a hosted
  approval queue, a CI app, or nothing (FM-7 is unresolved for ALT-1 and it rides ALT-4's invoice);
  whether Codex support is worth its transcript-format risk (E-12); whether OKF v0.2 (E-33) should
  be the on-disk format so the schema question is someone else's; whether the Dome tracker (ALT-5)
  is built as a favour; YouTube audience size and whether it is a channel at all.

---

## Final output — the twenty items requested in proposal §24

1. **Refined product thesis.** Coding agents already have memory; what they lack is a binding
   record of what a named human decided, and a mechanism that prevents them from violating it.
   The product is the approved decision as a git-native, hook-enforced record, with the blocked
   attempt captured as what was tried and rejected. It is not a system of record for the org; it is
   the one entity in that system that nobody ships and that markdown cannot enforce.
2. **Strongest evidence for the problem.** First-party: one rule replicated into 20 files and violated
   anyway three times on record, one costing $1.40–2.70 (M-6, M-7); the memory index stale within
   four days and missing the definition of the company (M-8); the documented session-start path
   reaching 2.7% of the knowledge corpus (M-5). Public: #2544 at 45 reactions for 14 months (E-20)
   and a stranger filing the operator's exact incident, closed not planned (E-23).
3. **Strongest evidence against the problem.** Context files as a class do not improve task success
   (E-2); the org the proposal is built for does not exist by two orders of magnitude (E-14, E-15);
   handoff-as-product draws 1–5 points per launch (E-19); nobody hires or budgets for it (E-27,
   E-A11); the operator's own high-value practice stopped 33 days ago (M-8); SAP built nearly the
   whole proposal and reports no effect yet (E-26).
4. **Primary user.** v0: the operator and the Dome team in dome_workspace (Q-2). First buyer: the
   CTO or technical co-founder of a 15–80-person Series A/B product company who is personally the
   context bottleneck and whose team publicly runs Claude Code daily (E-29, E-30).
5. **Primary JTBD.** Proposal JTBD #4 and #7 fused: preserve the decision with a named approver, and
   keep the agent from violating it. Not #1/#2 (handoff), which the evidence ranks as the worst
   position, and not #5 (coordination), which the operator did not select and which is being built
   internally by the companies that have it.
6. **Current workarounds.** CLAUDE.md/AGENTS.md (≈1.7M files, E-1); timestamped handoff files;
   memory directories with hand-maintained indexes (four fleets in E-25 hit a wall at 132–191
   entries); ADRs; rule replication across files (M-6); ≈112 hand-built decision-named hooks that in
   practice guard only generic safety (E-G28); PreToolUse hook farms (E-22).
7. **Competitive / alternative solutions.** First-party: Anthropic Memory Stores + Dreams (E-5,
   E-6), Copilot Memory (E-10), Claude Code auto memory and the undocumented team store (E-11).
   Cross-harness: Warp (E-7), Augment, Devin, Notion Lore (E-8), Atlassian (E-9). Capture: Entire
   (E-17), claude-mem (E-4). Coordination: Beads (E-25), Symphony. Knowledge: Unblocked (E-29).
   Format: OKF v0.2 (E-33). Governance: MintMCP (E-28). See the prior-art table.
8. **Core product primitive.** The Decision: id, status, named human approver, evidence, rejected
   alternatives with reasons, supersedes, and an enforce-as predicate. Its degenerate case is the
   standing prohibition; its twin is the blocked attempt. Not Work, Session, Claim, or a graph.
9. **Proposed data model.** One directory, `decisions/`, one file per decision (markdown body, YAML
   frontmatter with the fields above), one append-only `attempts.log`, one generated `INDEX.md`.
   Relationships are limited to `supersedes` and `evidence` paths. OKF v0.2 as the frontmatter
   vocabulary is an open question (E-33).
10. **Best MVP.** ALT-1 with ALT-7 inside it, dogfooded in dome_workspace, delivered through ALT-4
    engagements: `decisions/` schema, session-start index injection, session-end capture with an
    approver gate, PreToolUse blocking with attempt logging, and a staleness verifier.
11. **Alternative MVPs considered.** Eight, scored on identical terms (table above): the
    specification (last), the personal minimal shape, the compliance audit gate, the productized
    service (first), the Dome tracker, a public adherence benchmark, and a context-staleness linter.
12. **Validation experiments.** KC-1 (replay the three recorded violations with and without the
    index, plus a hand-written-handoff control arm); KC-5 (predicate coverage and false-positive rate
    over four weeks of Dome work); KC-6 (four-week dogfood: index freshness, violations caught,
    session-start token cost); KC-2 (20 outreach emails with one qualifying question that doubles as
    the discovery interview). Distinguishing from generic memory: the control arms are claude-mem
    and a plain handoff file, not "no context."
13. **Success metrics.** Recorded violations prevented per week (target: the three in M-7 all
    blocked on replay, zero unblocked violations in four weeks of dogfood); false blocks under 3 per
    week; index freshness 100% at every session start; session-start read cost under 6,000 tokens;
    decision records written at ≥1 per week with an approver; ≥4 calls and ≥1 paid engagement from
    20 emails by 2026-11-15.
14. **Architecture proposal.** Local-first, no server: three Claude Code hooks (SessionStart,
    Stop/SessionEnd, PreToolUse) plus one CLI (`decisions index | verify | attempt`), all reading and
    writing files in the repo. Observation is write-at-source by the parent session, not transcript
    parsing. Retrieval is a pointer (the generated index), not search. MCP is not appropriate for v0:
    the agent needs no query surface beyond the injected index, and the registry channel is a lottery
    (E-A7). Minimum human UI: the markdown files, `git log`, and `attempts.log`.
15. **Open product questions.** What, if anything, is paid in ALT-1 (FM-7 unresolved)? Does the
    hook's block need an override path, and who may use it? Should a blocked attempt auto-file a
    proposed decision? Is Codex worth its transcript-format risk? Is the YouTube channel a channel?
    Is the Dome tracker a favour worth doing? Should the on-disk format be OKF?
16. **Technical risks.** Predicates may not express real decisions (KC-5; E-22's "cannot prevent
    wrong intent"); hooks are the most stable surface but the event set has churned (E-B1); the
    session that should write the record may crash or compact first (FOR-3 caveat); subagent fan-out
    must not write (M-10); staleness for claims that do decay needs the verifier to be good (FM-4).
17. **Product risks.** The author abandons the practice (FM-8, KC-4); the harness vendor ships
    enforcement or an approver field (KC-3); the residual is three fields and a hook, i.e. a
    template, not a product (FM-6); services eat the product (E-35: SourceHut's platform was 26% of
    revenue after five years); constraint-led launches convert to stars, not revenue (E-G29, E-G30).
18. **Security / privacy risks.** Minimal in the reshape: nothing leaves the machine, no transcript
    is read, decisions live in the repo the team already controls, and `keys/` stays governed by the
    existing rule. Residual: a decision file can itself contain a secret or a customer name and is
    committed; the attempts log records commands the agent tried, which may include secrets (E-37).
    The rejected ALT-0 design carried a credential-exfiltration channel and a procurement wall.
19. **Reasons not to build it.** (a) No one is established to pay for decision enforcement (E-21,
    E-24, E-27). (b) The operator's own ADR practice stopped 33 days ago (M-8) and his published
    discipline is unused in his own workspace (M-11). (c) The residual over first-party memory is
    three fields and a hook (FM-5). (d) The prohibition class of decision may be the only class that
    survives staleness, and it is small. (e) ADRs ran a 15-year free experiment with a negative
    result (E-24). (f) Revenue, if any, comes from services, which historically eat the product.
20. **Recommended next step.** This week, before any product code: run KC-1 on dome_workspace data
    (one afternoon) and send the 20 KC-2 emails (one hour). If KC-1 passes, build ALT-2 as week 1 of
    ALT-1 inside dome_workspace under the superpowers brainstorming → spec → plan flow, with KC-4,
    KC-5 and KC-6 as the six-week gate. Do not build ALT-0. Do not build ALT-3. Decide ALT-5 as a
    favour, separately. The operator selects the direction; nothing here is a build authorization.
