# RED-TEAM B — Technical & Dependency/Platform

Adversarial brief against `proposal.md` (agent-readable system of record for software work).
All URLs accessed **2026-09-06**. Local measurements taken on this machine, same date.

---

## Evidence table

| ID | Claim | Source | Accessed |
|----|-------|--------|----------|
| E-B1 | Claude Code documents 31 hook events; all hooks receive `session_id`, `transcript_path`, `cwd`, `permission_mode`. Only "agent hooks" carry an experimental warning. | https://code.claude.com/docs/en/hooks | 2026-09-06 |
| E-B2 | Codex CLI ships an equivalent hook set (SessionStart/End, Pre/PostToolUse, Sub-agent, Compaction) with `transcript_path`. Docs state: **"the transcript format isn't a stable interface for hooks and may change over time."** | https://learn.chatgpt.com/docs/hooks (redirect from https://developers.openai.com/codex/hooks) | 2026-09-06 |
| E-B3 | Cursor hooks expose `conversation_id` ("Stable ID of the conversation across many turns") and `transcript_path`; `sessionStart`/`sessionEnd`/MCP/Tab hooks **do not fire in cloud agents**. Hooks are in beta ("APIs may change"); a filed bug reports `subagentStart`/`subagentStop` never firing. | https://cursor.com/docs/hooks ; https://forum.cursor.com/t/subagentstart-and-subagentstop-hooks-never-fire-foreground-or-background-while-beforeshellexecution-from-the-same-hooks-json-works-normally/168758 | 2026-09-06 |
| E-B4 | OpenCode plugin API exposes `sessionID` and session lifecycle events, but is **explicitly beta**: "Because the plugin API is beta, publish compatible plugin updates when V2 entrypoints or contracts change." | https://opencode.ai/v2/docs/build/plugins | 2026-09-06 |
| E-B5 | Claude Code OTel export **redacts content by default**: "Spans redact user prompt text, tool input details, and tool content by default." Content requires `OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_TOOL_CONTENT=1`, etc. Content-bearing span attributes "are **not part of the stable span schema**." | https://code.claude.com/docs/en/monitoring-usage | 2026-09-06 |
| E-B6 | **Local measurement.** 176 transcript JSONL files on this machine span **12 distinct Claude Code versions** (2.1.220 → 2.1.261). Record `type` values include undocumented internals: `atis-latch`, `bridge-session`, `frame-link`, `queue-operation`, `artifact-autoreact-ledger`, `artifact-comment-monitor`, `file-history-delta`, `cost-state`, `ai-title`. No public schema exists for any of these. | `find ~/.claude/projects -name '*.jsonl'`, parsed 2026-09-06 | 2026-09-06 |
| E-B7 | Claude Code **auto memory** is shipped and on by default. Its `project` memory type is defined as "ongoing work, deadlines, and **decisions that Claude can't derive from the code or git history**." Stored at `~/.claude/projects/<project>/memory/`. | https://code.claude.com/docs/en/memory | 2026-09-06 |
| E-B8 | A **team memory sync engine** exists in shipped Claude Code source (`src/services/teamMemorySync/`), discovered 2026-03-31 via npm source maps: per-repo key-value store at `~/.claude/projects/<hash>/memory/team/`, syncs bidirectionally with Anthropic servers, gated on first-party OAuth (excludes Bedrock/Vertex), scans uploads with 30+ gitleaks-derived regexes. | https://jakegoldsborough.com/blog/2026/inside-claude-codes-team-memory-sync/ | 2026-09-06 |
| E-B9 | **GitHub Copilot agentic memory** entered public preview 2026-01-15; coding-agent knowledge bases enabled by default 2026-03-11. Memories store "the underlying facts, **cited code locations**, and reasoning"; on retrieval the agent "**verifies the citations in real-time**, validating that the information is accurate." Scope: repository-level, write-permission contributors only. | https://github.blog/changelog/2026-01-15-agentic-memory-for-github-copilot-is-in-public-preview/ ; https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/ | 2026-09-06 |
| E-B10 | Claude Code **cross-session messaging** ships from v2.1.224 (Windows v2.1.234): `ListAgents` + `SendMessage` discover and message other sessions on the machine (per-session UDS/named pipe), and sessions on **other machines** and on Claude Code on the web via Remote Control through Anthropic servers. | https://code.claude.com/docs/en/cross-session-messaging | 2026-09-06 |
| E-B11 | Claude Code **agent teams** (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) provide a shared task list with file-lock claiming and a mailbox at `~/.claude/teams/{team}/inboxes/{agent}.json`. Documented limits: "One team per session… You can't create additional named teams or **share a team across sessions**"; task list "persists locally and is **never uploaded**." | https://code.claude.com/docs/en/agent-teams | 2026-09-06 |
| E-B12 | Anthropic Claude Code legal page: developers "may not collect, store, or intermediate Claude.ai credentials or session tokens"; the binary "must not be modified"; "Anthropic reserves the right to take measures to enforce these restrictions and **may do so without prior notice**." | https://code.claude.com/docs/en/legal-and-compliance | 2026-09-06 |
| E-B13 | **Context rot** (Chroma, pub. 2025-07-14): 18 frontier models; performance degrades continuously with input length on retrieval and even on verbatim replication; **a single distractor** lowers accuracy vs. the needle-only baseline and effects compound; on LongMemEval all model families scored significantly higher on ~300-token focused prompts than ~113k-token full prompts. | https://www.trychroma.com/research/context-rot | 2026-09-06 |
| E-B14 | Zep/Graphiti temporal model: four timestamps (`t'_created`, `t'_expired`, `t_valid`, `t_invalid`); an **LLM compares new edges against semantically related existing edges** to find contradictions, then sets `t_invalid`. Invalidation is triggered by newly ingested episodes, not by external state change. | https://arxiv.org/pdf/2501.13956 ; https://help.getzep.com/graphiti/graphiti/overview | 2026-09-06 |
| E-B15 | Memory poisoning study (arXiv 2606.04329, v1 2026-06-03): six attack classes, MPBench; finding — "**agents designed to write and retrieve memory more aggressively are more exploitable**," and "existing prompt injection defenses fail to cover memory poisoning attacks." | https://arxiv.org/abs/2606.04329 | 2026-09-06 |
| E-B16 | Credential leakage from agent traces (pub. 2026-08-10): 315,320 encrypted reasoning blocks from 6,708 publicly posted agent trajectories yielded 704 privacy artifacts — 62 API keys, 33 passwords, 24 access tokens, 30 personal emails; **64 appeared only inside encrypted reasoning**, never in the chat window. Harnesses spanned Claude, GPT-5/5.2 Codex, Gemini. | https://profero.io/blog/stolen-thoughts/ | 2026-09-06 |
| E-B17 | Secrets sprawl: GitGuardian reports 28,649,024 new secrets in public GitHub commits in 2025 (+34% YoY); Claude Code-assisted commits showed a **3.2% secret-leak rate vs. 1.5% baseline**. | https://www.helpnetsecurity.com/2026/04/14/gitguardian-ai-agents-credentials-leak/ | 2026-09-06 |
| E-B18 | Anthropic list pricing: Sonnet 5 $2 / $10 per MTok; Haiku 4.5 $1 / $5; Opus 5 $5 / $25; Batch API −50%. Note: "Claude 4.7 and later models… use a newer tokenizer… **approximately 30% more tokens for the same text**." | https://platform.claude.com/docs/en/about-claude/pricing | 2026-09-06 |

---

## Observation surface matrix

| Harness | Mechanism | Documented? | Stable? | ToS-permitted for 3rd-party ingest? | Source |
|---|---|---|---|---|---|
| Claude Code | 31 hook events, incl. `SessionStart`/`Stop`/`PostToolUse`/`SubagentStop`, with `session_id` + `transcript_path` | Yes | Mostly (agent hooks flagged experimental); event set has grown/renamed repeatedly | Not addressed either way. Legal page prohibits modifying the binary and intermediating credentials — hooks don't do either, but silence ≠ permission | E-B1, E-B12 |
| Claude Code | `~/.claude/projects/**/*.jsonl` transcripts | **No** — no published schema | **No** — 12 versions in one local archive; 9 undocumented record types incl. `atis-latch`, `bridge-session`, `frame-link` | Local file read; permitted, but load-bearing on a private format | E-B6 |
| Claude Code | OpenTelemetry export | Yes | Metrics stable; **content attributes explicitly not part of the stable span schema** | Yes, but content is redacted by default; enabling requires org-wide env-var change | E-B5 |
| Codex CLI | Hooks (SessionStart/End, Pre/PostToolUse, Sub-agent, Compact) | Yes | Vendor states **transcript format is not a stable interface** | Not addressed | E-B2 |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | Community-reverse-engineered only | No — same disclaimer applies | Local read | E-B2 |
| Cursor | Agent hooks with `conversation_id`, `transcript_path` | Yes | **Beta**; `sessionStart`/`sessionEnd` absent in cloud agents; sub-agent hooks reported non-firing | Not addressed | E-B3 |
| OpenCode | Plugin API (V2), `sessionID`, session lifecycle | Yes | **Explicitly beta**; V1→V2 contract break already happened | OSS — the only surface with no unilateral kill switch | E-B4 |
| Copilot | None for third parties. Memory is a first-party tool the agent calls. | n/a | n/a | **No third-party observation surface** | E-B9 |

Read the matrix as a whole: **every single row is either undocumented, self-declared unstable, beta, redacted by default, or vendor-only.** There is no stable, documented, ToS-blessed observation contract in the industry as of today.

---

## Failure modes

### FM-B1 — The observation layer is a private, weekly-churning schema owned by the people you compete with

**Mechanism.** The product's entire input is a transcript. Claude Code's transcript is an undocumented internal format: on this one machine, 176 files span 12 releases in what is roughly a two-month window, and carry record types (`bridge-session`, `atis-latch`, `frame-link`, `artifact-autoreact-ledger`) that appear in no public documentation and are plainly implementation state for unreleased features (E-B6). OpenAI has already put the disclaimer in writing — "the transcript format isn't a stable interface for hooks and may change over time" (E-B2). Hooks are the more stable path, but hooks give you *events*, not the model's reasoning; to get the reasoning you must open `transcript_path`, which lands you back on the private schema. Every parser you write is a per-harness, per-release maintenance liability, and the proposal names four harnesses (§15). This is the "integration complexity eats the company" risk in §20, but sharper: it is not integration *breadth*, it is integration *decay rate*.

**Leading indicator.** Extraction quality silently drops after a harness minor release, because unknown record types are skipped rather than erroring. Watch for: a rising share of sessions producing zero extracted claims, correlated with a `version` field you have not seen before.

**Evidence.** E-B2, E-B3, E-B4, E-B6.

### FM-B2 — Extraction is a per-session variable cost that scales with agent count, against a price that scales with seats

**Mechanism.** "LLM extracts durable decisions and discoveries" is a full read of every transcript. At list price (E-B18), a single 200k-token transcript with ~3k tokens of structured output costs:

- Haiku 4.5: 200,000 × $1/M + 3,000 × $5/M = **$0.215**
- Sonnet 5: 200,000 × $2/M + 3,000 × $10/M = **$0.43**
- Opus 5: 200,000 × $5/M + 3,000 × $25/M = **$1.075**

The proposal's own scenario is 100–200 agents (§1). At 100 agents × 10 sessions/day × 22 working days = 22,000 sessions/month, that is **$4,730/mo (Haiku), $9,460/mo (Sonnet 5), $23,650/mo (Opus 5)** in extraction alone — halved with the Batch API, but doubled again the moment you re-extract on prompt changes, and this excludes retrieval, embeddings, re-verification, and the fact that a serious system must re-evaluate old claims against new ones (E-B14). Two compounding pressures: extraction quality is the product, so the incentive is to use the *strongest* model; and Anthropic's own docs note the 4.7+ tokenizer emits ~30% more tokens for the same text (E-B18), so per-transcript cost rises with each model generation even at flat prices. Meanwhile the buyer's mental model for a "system of record" is per-seat SaaS — 10–12 humans (§1), not 200 agents. The unit economics point the wrong way as the customer succeeds.

**Leading indicator.** COGS per paying seat rises with customer adoption. Concretely: gross margin falls below ~70% on the design-partner account within two quarters, and the first mitigation proposed internally is "sample sessions" or "extract only on Stop, not per session," both of which degrade the product's core promise of completeness.

**Evidence.** E-B18, and the token accounting above (arithmetic, not a cited figure).

### FM-B3 — Nothing invalidates a claim when the code changes, so the record becomes confidently stale

**Mechanism.** This is the load-bearing failure. §8 wants Claim → Superseded, and §20 lists stale knowledge as risk 4. The state of the art in temporal memory is Zep/Graphiti: an LLM compares a *newly ingested episode* against semantically related existing edges and, on contradiction, writes `t_invalid` (E-B14). Invalidation is therefore triggered **only by new conversational input that happens to contradict the old claim**. But the dominant staleness source here is not another agent's utterance — it is a `git push`. When someone deletes the function that a Discovery was about, no episode arrives, no contradiction is detected, and the claim stays `valid` forever, ranked by the same embedding it always had. The one vendor that solved this solved it by *not* being a memory store: Copilot stores "cited code locations" with each memory and "verifies the citations in real-time" at retrieval (E-B9). That is the correct design, and note what it requires — the reader is inside the repo with the current tree in hand. A third-party MCP server answering `get_decisions()` has no cheap way to do that: it must resolve every cited symbol against the caller's current HEAD, which is either (a) a program-analysis product the proposal explicitly says it will not build (§17 "Do NOT build"), or (b) an extra round-trip and permission surface per claim. Without it, JTBD #6 ("understand organizational history of unfamiliar code") returns archaeology that is true about a codebase that no longer exists.

**Leading indicator.** Median age of retrieved claims rises monotonically while the invalidation rate stays near zero. Practically: in a design-partner repo, sample 50 retrieved claims after 8 weeks and count how many reference a file path, symbol, or line range that no longer exists at HEAD. If that number is not near zero, the record is a liability.

**Evidence.** E-B9, E-B14. No public data found on invalidation rates in production code-memory systems; queries: "code memory staleness invalidation benchmark", "temporal knowledge graph code artifact binding", "claim invalidation commit-triggered".

### FM-B4 — Retrieved-but-wrong context is worse than no context, and the JTBD is the wrong side of that trade

**Mechanism.** §11 JTBD #8 is "the smallest useful set of relevant context." Chroma's context-rot work is usually cited as supporting this — and its LongMemEval result does: ~300-token focused prompts beat ~113k-token full prompts across every model family (E-B13). But read the construction. The focused prompt was an *oracle* extraction — the known-correct span. This product's focused prompt is an LLM-extracted claim of unknown fidelity, retrieved by cosine similarity over LLM-written summaries. The same paper's distractor experiment is the one that matters: **a single distractor lowers accuracy below the needle-only baseline, and multiple distractors compound** (E-B13). A stale-but-plausible decision record retrieved into an agent's opening context is textbook distractor — maximally similar to the query (that is why it was retrieved) and wrong. So the product's failure mode is not "unhelpful"; it is *actively worse than the cold-agent control* in §18, and it will be worse in the specific cases where it fires most confidently. Compounding this: similarity search cannot distinguish recency — a claim from five minutes ago and a semantically identical one from five months ago are the same vector.

**Leading indicator.** In the §18 A/B, the Informed agent shows *higher variance* than the Cold agent, not lower mean time. A widening tail is the signature of injected distractors; a naive mean comparison will hide it. Watch also for agents that spend turns *disproving* a retrieved claim.

**Evidence.** E-B13.

### FM-B5 — Platform absorption: the wedge is already being shipped by the harness vendors, inside the trust boundary you can't reach

**Mechanism.** §19 asks "could Claude/Codex build this." They already are, and the specific shape matters. (a) Claude Code auto memory is **on by default**, and its `project` category is defined as "ongoing work, deadlines, and decisions that Claude can't derive from the code or git history" (E-B7) — that is verbatim category C from §2. (b) A **team memory sync engine** is in shipped Claude Code source: per-repo store, bidirectional sync to Anthropic servers, gitleaks-based pre-upload scanning, gated on first-party OAuth (E-B8). Anthropic has already built the ingestion pipeline, the sync protocol, and the secret-redaction layer this product would need — from *inside* the process, with no parsing tax and no marginal extraction cost, because the model is already holding the context. (c) GitHub shipped agentic memory to public preview 2026-01-15 and turned coding-agent knowledge bases on by default 2026-03-11, with real-time citation verification (E-B9). Note the asymmetry: the vendors get the observation surface for free and can change or close it at will (E-B2 says the format may change; E-B12 says enforcement may occur "without prior notice"). The proposal's counter is agent-independence — "if the org switches Claude → Codex the knowledge remains" (§6). That is a real argument, but it is a *hedging* value proposition, and orgs rarely pay a separate vendor to hedge against a tool they are actively standardizing on.

**Leading indicator.** A Claude Code release note (or a `~/.claude/projects/*/memory/team/` directory appearing on a design partner's machine) that turns team memory on by default. At that moment the free, zero-integration, in-process version of wedge A and wedge B exists for every Claude Code user.

**Evidence.** E-B7, E-B8, E-B9, E-B12.

### FM-B6 — Real-time cross-agent presence requires a registry the harnesses already own and deliberately keep local

**Mechanism.** Wedge D and JTBD #5 need "which agents are working on related areas" *now*. To know that, you need liveness, working directory, and current file scope for every running session across every machine. Claude Code already ships exactly this — `ListAgents`/`SendMessage`, per-session Unix sockets for same-machine discovery, and cross-machine/cloud reach via Remote Control through Anthropic servers (E-B10) — plus agent teams with a file-locked shared task list and per-agent mailboxes (E-B11). Two consequences. First, the wedge is occupied by a first-party feature that requires no integration. Second, the parts a third party would need are *deliberately* local: teams are "scoped to that session," cannot be shared across sessions, and the task list "persists locally and is **never uploaded**" (E-B11); local session discovery reads files under the user's home directory and is explicitly restricted to a single OS user, so a container and its host cannot even see each other (E-B10). To build cross-machine presence yourself you must run a daemon on every developer machine reporting liveness to your cloud — a new deployment, security-review, and reliability surface that has nothing to do with the knowledge thesis, and which the §17 MVP does not contemplate.

**Leading indicator.** The presence feature's first bug reports are all about false negatives — sessions the system doesn't see (containers, WSL, remote dev boxes, cloud agents) — rather than about the quality of the conflict detection.

**Evidence.** E-B10, E-B11.

### FM-B7 — Shipping transcripts to a cloud extractor is a credential-exfiltration channel and a procurement wall

**Mechanism.** Agent transcripts are the highest-density secret material a developer produces: they contain `.env` reads, pasted tokens, shell history, and — per the August 2026 study — credentials embedded in reasoning blocks that are **invisible in the chat UI and undetectable by standard secret scanners** (E-B16: 62 API keys, 33 passwords, 24 access tokens across 6,708 public trajectories, 64 artifacts appearing only inside encrypted reasoning). Independently, Claude Code-assisted commits show roughly double the baseline secret-leak rate (E-B17). A product whose architecture is "session observer → cloud LLM extraction → persistent store, shared across the org" (§17) therefore (a) creates a new copy of every secret an agent ever touched, in a system explicitly designed to *persist and redistribute* it, and (b) creates a cross-team read path — an intern's agent querying `get_discoveries()` can surface a claim extracted from a staff engineer's production-incident session. Note that Anthropic's own team-memory implementation runs 30+ gitleaks-derived patterns before upload and silently skips flagged files (E-B8) — i.e. the vendor treated this as table stakes and accepted lossy behavior to get it. A local-first alternative is the honest answer, but it forfeits the cross-machine, cross-team org record that *is* the thesis (§2C). And the store is a poisoning target: writing and retrieving memory aggressively is precisely the property that the MPBench work identifies as making agents more exploitable, with existing prompt-injection defenses not covering it (E-B15).

**Leading indicator.** The first enterprise security questionnaire stalls the deal, and the requested remediation is on-prem or local-only extraction — which converts the product from a shared org record into per-machine memory, i.e. into the thing Anthropic already ships for free.

**Evidence.** E-B8, E-B15, E-B16, E-B17.

### FM-B8 — "Agent #847 proposed" does not survive compaction, resumption, or a harness switch

**Mechanism.** §21's showcase moment requires durable, meaningful agent identity. The IDs exist — Claude Code `session_id`, Cursor `conversation_id` ("stable across many turns"), Codex `session_id`, OpenCode `sessionID` (E-B1, E-B2, E-B3, E-B4) — but they are opaque per-harness UUIDs with no cross-harness namespace, and they are not stable in the ways that matter. Claude Code's `SessionStart` re-fires on `resume` and on `fork` (E-B1); agent teams derive team names from the first eight characters of the session ID and warn that in-process teammates are **not restored** by `/resume` (E-B11); compaction (`PreCompact`/`PostCompact`) rewrites the very context an extractor would attribute a decision to. So one human's one piece of work fragments into many session IDs, several of which are forks or resumes of each other, and none of which mean anything to a reader. "Agent #847" is not a person, a role, or a durable actor — it is a UUID prefix. The provenance chain in §9 (human goal → agent investigation → recommendation → approval) needs a stable *human* and *work* anchor, which the harnesses do not provide and which git already provides better via commit authorship and PR review. The accountability story is therefore either redundant with git/GitHub or unanchored.

**Leading indicator.** In the human UI, the "agent activity" view is unreadable — dozens of near-duplicate sessions per task — and the first requested feature is manual session grouping, i.e. asking the human to supply the identity the system was supposed to derive.

**Evidence.** E-B1, E-B2, E-B3, E-B4, E-B11.

---

## What would change my mind

1. **A stable, contractual observation API.** Any harness publishing a versioned, semver'd session-export schema with a deprecation policy — or Anthropic/OpenAI documenting third-party session ingest as a supported use case. Today none exists (matrix above); it would collapse FM-B1.
2. **A cheap, correct code→claim invalidation primitive.** Evidence that citation verification of the Copilot kind (E-B9) can be done by an external MCP server at retrieval time for <100ms and without repo-wide read permission would substantially defuse FM-B3, which is the failure mode the other retrieval arguments hang on.
3. **A distractor-aware A/B.** A §18 experiment reporting the *distribution*, not the mean — specifically showing that the Informed agent's p90 does not regress against the Cold control on tasks where retrieval fires. That would show retrieval quality clears the bar E-B13 sets, and would weaken FM-B4.
4. **Anthropic shipping team memory and it being visibly bad.** If team memory ships (E-B8) with, say, a 25KB index cap and no provenance, decision status, or supersession — the shape auto memory has today (E-B7) — the agent-independent record has room above it, and FM-B5 shrinks from existential to competitive.
5. **A local-first architecture that still produces a shared record.** A design where extraction runs on-device and only structured, redacted claims (never transcripts) leave the machine would blunt FM-B7 while keeping the thesis. It does not fix FM-B2 — it moves the token cost onto the customer's own bill, which may be a feature.

---

## Negative results

- **No public data found** on extraction fidelity from *agent* transcripts specifically (as opposed to news/meeting summarization). FaithBench, Vectara's leaderboard, and FineSurE all evaluate prose summarization; none covers "extract durable decisions from a 200k-token tool-use trajectory, including reversals." Queries: "agent transcript decision extraction benchmark", "tool-use trajectory summarization faithfulness", "extract decisions from coding agent session evaluation", "reversal detection long agent transcript". **This is a gap that cuts both ways** — I cannot quantify FM-B2's quality half, and the steel-man cannot claim it works.
- **Unsourced figure, deliberately excluded.** A widely-shared claim that "add-all" memory reached 2,400 records at 13% accuracy vs. selective memory at 248 records / 39% appears at https://tianpan.co/blog/2026-04-12-the-forgetting-problem-when-agent-memory-becomes-a-liability (accessed 2026-09-06); the author names no study and the underlying paper could not be located. Not used as evidence.
- **Zep's DMR/LongMemEval accuracy numbers could not be extracted** from the arXiv PDF (2501.13956) by the fetch tool. The temporal-model mechanism (E-B14) is confirmed; the headline accuracy figures are not cited here.
- **MPBench attack success rates** are not in the arXiv abstract and the PDF did not parse. Only the paper's stated qualitative conclusions are cited (E-B15).
- **Cursor's beta warning could not be quoted verbatim** — `cursor.com/docs/hooks.md` 404s and the rendered page did not surface an explicit banner. The beta status is attested by secondary sources and by the documented cloud-agent gaps and open non-firing-hook bug (E-B3).
- **No Claude Code changelog entry for team memory** was found; E-B8 rests on a single source-map analysis. Treat the *existence* of `teamMemorySync` as well-attested and its *ship status/default* as uncertain.
- **No third-party observation surface for GitHub Copilot** was found at all. Queries: "Copilot hooks third party", "Copilot session transcript export API", "Copilot agent telemetry export". Its absence is itself the finding: on Copilot, the proposal has no MVP.
