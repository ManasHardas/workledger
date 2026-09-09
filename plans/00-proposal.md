# Product Proposal: Agent-Readable System of Record for Software Work

(Operator's original proposal, verbatim. Status: early product thesis, intentionally unresolved.)

## 1. The thesis

Software development is moving toward a world where humans increasingly direct and supervise large populations of coding agents. A future engineering organization might contain 10–12 human engineers + 100–200+ specialized coding agents.

Humans: high-level product and engineering outcomes, defining problems, assigning work, reviewing specifications, approving consequential decisions, resolving ambiguity, taking accountability for decisions made by their agents.

Agents: investigation, planning, decomposition, specification, implementation, testing, code review, debugging, system operation, research, documentation, handoff to other agents.

In this world, software-development labor becomes abundant while organizational context, coordination, judgment, and accountability become scarce.

Problem: Hundreds or thousands of agents may simultaneously work on the same software organization, but they do not have a shared, persistent, machine-readable representation of what the organization knows, what it is building, what has been tried, what has been decided, what remains unfinished, and who is accountable.

The proposed product is a shared engineering state layer that sits above individual coding agents and below human-facing workflow tools.

## 2. Key distinction — three kinds of "agent memory"

A. Personal / agent memory ("what should this agent remember?") — preferences, prior conversations. Being addressed by native agent memory.
B. Repository memory ("what should every agent in this repo know?") — CLAUDE.md, AGENTS.md, rules files. Useful but static.
C. Organizational engineering state ("what does the organization currently know about the software it is building?") — what work is happening, what was attempted, discovered, decided and why, rejected approaches, dependencies, approved specs, blocked work, which agents work on related areas, which human owns the decision, which claims are authoritative, what is unresolved. Should exist independently of any agent, model, tool, or human's memory. THIS is the thesis.

## 3. The product

The agent-readable system of record for software work. Observes software-development activity across coding agents and engineering systems, extracts meaningful information, structures it into a persistent model, exposes it to humans and agents.

Architecture: Humans (goals/decisions/approvals) -> ENGINEERING WORK RECORD (Work, Specifications, Decisions, Discoveries, Claims/Facts, Dependencies, Ownership, Agent Sessions, Artifacts, Outcomes, Provenance) -> Claude / Codex / OpenCode -> Codebase; and projections to GitHub / Linear / Jira.

The engineering record is upstream of the individual agents and downstream tools. Claude, Codex, Jira, Linear should not own the memory. The organization owns the engineering record.

## 4. Why existing tools are not the fundamental solution

Jira/Linear model: work items, projects, status, assignments, human workflow. Proposed system model: knowledge, work, decisions, discoveries, provenance, relationships, machine-readable organizational state. Jira/Linear could become projections of this state. "Do not build a better Jira integration. Build the underlying state layer that Jira and Linear can consume."

## 5. Evidence the problem already exists

Workarounds: CLAUDE.md / AGENTS.md; handoff files (HANDOFF.md, SESSION.md, PROGRESS.md, TASK_STATE.md); agent-written memory (discoveries, decisions, conventions, session summaries); shared memory MCPs; native agent memory; human-mediated handoff (copying summaries, diffs, PR descriptions, Slack messages between agents). These solve smaller versions of the problem.

## 6. The suspected gap

Not "give Claude memory." "Give the entire engineering organization shared, agent-independent state." If the org switches Claude -> Codex, a developer leaves, a session ends, or another agent begins the same task six months later, the knowledge remains.

## 7. What the system should remember

Not transcript archival. Raw agent activity -> Observation -> Claim/Fact -> Discovery / Decision / Specification / Work state / Outcome. Durable organizational knowledge, not transcript storage.

## 8. Trust, provenance, authority

Distinguish "agent thinks X" from "the organization has decided X." Concepts: Observation, Claim, Evidence, Discovery, Proposed decision, Approved decision, Superseded decision. Example decision record with proposer (agent), evidence, alternatives, rejection reasons, approver (human), date, status: Authoritative. Provenance may be more valuable than the memory itself.

## 9. Accountability

Chain: Human goal -> Agent investigation -> Discovery -> Agent recommendation -> Human approval -> Implementation -> Outcome. System should answer who owns, who approved, which agent proposed, what evidence, what alternatives, which agents implemented, what happened afterward.

## 10. Agent handoff

Strongest potential initial use case. Today: Agent A works -> session ends -> context disappears -> Agent B rediscovers everything. Future: Agent A -> Engineering Record -> Agent B queries relevant state -> continues. Key metric: context recovery time.

## 11. Jobs to be done

1. Start work with organizational context (don't repeat work or violate prior decisions).
2. Recover context after another agent without reading the entire prior session.
3. Preserve discoveries as durable org knowledge.
4. Preserve decisions with rationale and provenance.
5. Understand active work in an area to avoid duplication/conflict.
6. Understand organizational history of unfamiliar code.
7. Maintain human accountability for consequential recommendations.
8. Give agents the smallest useful set of relevant context, not a memory dump.

## 12. Candidate entities (hypotheses)

Work (feature, bug, investigation, refactor, migration, incident, debt); Specification (problem, outcome, requirements, constraints, acceptance criteria, non-goals, open questions, approval); Decision; Discovery; Claim/Fact; Agent Session; Artifact (code, commit, PR, test, doc, migration); Person/Owner; Relationship (has_specification, has_decision, has_discovery, has_session, affects_artifact, depends_on, blocked_by, owned_by; proposed_by, approved_by, based_on, affects, supersedes; performed_by, modifies, discovers, proposes, completes).

## 13. Agent interface

search(), get_relevant_context(), get_related_work(), get_decisions(), get_discoveries(), get_active_work(), get_dependencies(), get_specification(), get_owner(), record_discovery(), propose_decision(), record_outcome(). Agent asks "what does the org already know that's relevant to this task?" MCP likely initial delivery, to be evaluated.

## 14. Human interface

Not a PM tool replacement. Views: work graph, decision history, agent activity, org knowledge search, accountability, timeline, handoff.

## 15. Integration philosophy

Inputs: Claude Code, Codex, OpenCode, Cursor, GitHub, GitLab, Slack, Linear, Jira, CI/CD, production. Outputs: agent context, MCP, API, webhooks, Linear, Jira, GitHub, Slack, human UI. Core remains agent/model/tool agnostic.

## 16. Wedge hypotheses

A. Agent handoff (measure: context recovery time).
B. Organizational context retrieval before work (measure: duplicated work, wrong approaches, human intervention, completion time).
C. Decision/provenance system (measure: do humans and agents use it).
D. Cross-agent coordination / awareness of concurrent work (measure: conflicts, duplicated work, overlapping modifications).

## 17. Smallest plausible MVP

Claude Code / Codex -> session observer -> LLM extraction -> structured record -> simple store -> MCP/agent API + minimal human UI. Start with 1-2 agent integrations, session ingestion, extraction, storage, semantic + structured retrieval, agent interface, simple inspection UI. Do NOT build: Jira/Linear replacement, PM system, coding agent, IDE, orchestration platform, generic enterprise knowledge platform. First question: does giving agents persistent organizational context materially improve software development?

## 18. Most important experiment

Cold agent (repo + task + normal context) vs Informed agent (repo + task + Engineering Record context). Measure time to productive action, completion time, repeated investigations, wrong approaches, human interventions, files unnecessarily examined, token consumption, result quality. Cleaner: Agent A -> Agent B handoff, B with raw task vs B with structured context from A's work.

## 19. Critical questions

Product: is org engineering state painful today; at what agent count does it become acute; is the problem handoff, discovery, coordination, provenance, or other; who feels pain; who pays; 5-person team vs 50-person org; is a human UI needed initially.
Data model: fundamental primitive — Work? Decision? Claim? Session? graph? what deserves durability; transient reasoning vs durable knowledge.
Trust: conflicting claims; confidence; how claims become authoritative; stale knowledge; superseded decisions; provenance.
Retrieval: vector enough? graph traversal? structured queries? agent-driven? how much context? context pollution.
Platform: could Claude/Codex/OpenCode build this; will native memory make it unnecessary; could GitHub be the SoR; could Linear/Jira evolve into it; does agent independence justify a separate system; is MCP right.
Security: sensitive info in sessions; what never leaves the machine; local/cloud/hybrid; permission propagation; cross-team visibility.

## 20. Biggest risks

1. Problem isn't painful. 2. Native agent memory solves it. 3. Data too noisy (DB of mediocre LLM summaries). 4. Retrieval not trustworthy (stale/incorrect knowledge). 5. Becomes project management. 6. Integration complexity eats the company. 7. Wrong primitive.

## 21. Success

Not "nice dashboard." "Wait. The agent already knows that?" e.g., "Why is this API structured this way?" -> "Three agents investigated this previously. Agent #183 proposed changing it, rejected because it breaks the payments service. Current architecture approved by the responsible engineer on March 17. Here is the original investigation and code."

## 22-23. Long-term vision and deeper thesis

Agents coordinate through shared persistent organizational state rather than direct communication; the engineering record is the shared state of a distributed system of humans and agents. Today that state is fragmented across human memory, context windows, markdown files, git, GitHub, Jira, Linear, Slack, docs, PRs, agent-specific memory. Product = canonical, agent-readable engineering state layer across all of them. Infrastructure for the agentic engineering organization, not another PM tool.
