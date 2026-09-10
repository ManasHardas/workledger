# workledger — Claude Code guide

Local observer for coding-agent sessions: the session's own agent writes checkpoint digests
through a validated CLI, the ledger lives in `.workledger/` in each repo, and a local UI edits the
backlog. Design: `docs/superpowers/specs/2026-09-09-workledger-design.md`. Decisions:
`docs/decision-log.md`. Phases: `plans/roadmap.md`. Current phase spec: `plans/feature-p8-onboarding-home.md`.

## Hard rules for this repo

- **Remote:** `origin` is `git@github.com-personal:manashardas/workledger.git` (personal identity).
  Push to it without asking. Never add a Dome remote, Dome credentials, or the Dome git identity
  here; the future Dome card mirror is a separate `DomeHQ/*` repo with its own rules.
- **Stack:** TypeScript only (Node ≥ 22, pnpm ≥ 10; this machine has Node 25 and pnpm 11). No Docker in this project; the HARD
  CONSTRAINT's verification path is "on the host with Node ≥ 22 + pnpm ≥ 10", stated in every PR.
- **`packages/core` stays pure:** no Node APIs, no filesystem, no SQLite. Side effects live in
  `packages/cli` and `packages/server`.
- **The ledger is files; the index is a cache.** Nothing in `~/.workledger/` is ever the source of
  truth. Transcript excerpts never enter the repo.
- **Agents never write ledger markdown directly.** Every write goes through `workledger checkpoint`
  or the backlog edit commands.
- **Dogfood:** once `workledger checkpoint` works, this repo is an enabled repo and every session
  records checkpoints here (DL-14).
- **Concurrent agents never share `/tmp` filenames.** Write PR bodies, review bodies, and any
  scratch file to a per-agent path (e.g. `$(mktemp -d)/pr-body.md`), never a fixed `/tmp/*.md`.
  In S1 two agents clobbered each other's `/tmp/prbody.md` and one PR was merged with another
  PR's body (`Closes #10` on PR #22), so its issue had to be closed by hand.
- **Never remove a worktree from inside it.** Merge and clean up from the repo root.
- **`workledger onboard`/init must never touch a repo the operator did not select; the wizard and the CLI enforce this (P8).**
- **Agents never run a build against the operator's real `~/.workledger`.** Every test, review drive, and smoke uses `WORKLEDGER_HOME=$(mktemp -d)/home`; a worktree build that migrates the real index leaves it unreadable by main (2026-09-10: a pre-rebase migration made `serve` fail with "table workspaces already exists"). Only the orchestrator restarts the daemon on port 7419, from the main checkout's build.

## Orchestration (agentwaves)

**Clause #12 — Lean mode is in force** (`.orchestrator/dispatch-templates/clause-12-lean-mode.md`):
one reviewer per PR by default (Security added only for credential/transcript/outside-ledger
surfaces, SRE only for stated timing budgets), one fix-cycle then merge or split, Blockers-only
reviews under 150 words, builder reports under 100 words, no side quests, no new process
artifacts, merge on green, paperwork batched at session close, direct commits for amendments.
The operator wants P1 finished in the next 4–5 sessions.

**Clause #13 (prototype mode) is NOT in force here**: the operator chose to keep the agentwaves protocol under Lean mode (Clause #12) for every phase (2026-09-09). Every PR gets its single review round; credential surfaces get Security. **P6 (Dome card) is deferred by the operator (2026-09-09); do not dispatch it.**


The framework is vendored at `.orchestrator/`; placeholders are resolved per
`plans/agentwaves-stack-map.md`. Start any build session with the paste-line at the top of
`plans/next-session.md`. The ideation gate script must be given an absolute path:
`.orchestrator/scripts/check-ideation-gate.sh --file "$PWD/plans/ideation-workledger.md"`.
Session-close guardrails: `.orchestrator/scripts/check-session-close-guardrails.sh`.


## Session operating modes

**Read `plans/next-session.md` FIRST** at any session-start (Session Handoff Document — pre-rendered playbook by PM at prior session-close). Contains pre-rendered slot 1 dispatch brief, compressed priors digest, watchdog framing. If missing OR stale (older than the latest merged PR), fall back to `plans/wave-state.md` (authoritative state) + legacy session-start ritual (PM dispatch). SHD protocol saves 65-95k per session-start. See `.orchestrator/agents/pm.md` §Session Handoff Document protocol for the format.

**Two operating modes — ACTIVE (full PM discipline) vs DEGRADED (PM-skip):**

DEGRADED mode is allowed ONLY when ALL of:
- All planned slots are narrow-fix or sibling-shape (no first-of-class)
- All issues filed before session start (no orchestrator scope synthesis)
- No new contract artifacts (no new endpoints, tables, OpenAPI changes, migrations)
- Last session closed cleanly (no unresolved fix-cycle)

ACTIVE mode is REQUIRED if ANY of the above conditions fails. ACTIVE mode requires:
- Stage-2 PM dispatched at session-start + session-close (per `.orchestrator/agents/pm.md`)
- Wave 0.5 issue planning before any Wave 1 build dispatch (per `.orchestrator/agents/orchestrator.md` §Wave sequence)
- Dispatch briefs derived from FILED ISSUE BODIES, not orchestrator-synthesized memory

**Source:** retrospective from a real project where PM-skip mode was wrongly applied to a session introducing new pages with new state machines. The orchestrator-synthesized dispatch brief conflated already-shipped endpoints as "future-phase, disable with tooltip"; review agent fired 4 Blockers; ~68k fix-cycle tax incurred. **This rule is now permanent.**

## Session-close guardrails

**`.orchestrator/scripts/check-session-close-guardrails.sh` MUST run before the chore-close commit.** Exit 1 = BLOCKER, stop and fix; exit 2 = WARN, acknowledge each warn-line in the chore-close commit body; exit 0 = clean, proceed. Enforces 17 invariants: velocity.json rollup completeness (one `pr_merge` row per build PR), wave-state.md currency, SHD presence for S<N+1>, capacity-log.md entry, clean working tree, clean worktrees, cc_session_id presence (when your harness exposes one), stale-branch cleanup, operating-mode + watchdog declarations in close commit, etc. Cost ~5s + ~200-300 tokens per session; +5-10k with GitHub API checks for issue/branch verification.

Catches the silent execution drift from non-negotiable spec invariants that is invisible during normal development — agents follow stale memory; the spec keeps living in the doc unaltered until someone runs a retrospective and notices the gap. **No bypass** — file an issue against the script if a check is wrong; do not skip the gate. See `.orchestrator/agents/orchestrator.md` §Session-close ritual + `.orchestrator/agents/pm.md` §Session close step 5.

## Wave -1 — adversarial ideation gate (greenfield only, once per project)

On a **new** project, the brainstorming/ideation session that decides what to build is governed by Clause #11 (`.orchestrator/dispatch-templates/clause-11-adversarial-ideation.md`) and is **extremely critical by default**. Five rules: never assume without asking (every assumption is `ASKED` / `RESEARCHED` / `UNVERIFIED`-with-a-kill-criterion, no fourth category); research before assuming; show data, don't tell (no unsourced market sizing or demand claims — "no public data found" is a legitimate finding, an invented estimate is not); argue both sides with symmetric rigor (≥5 specific failure modes with mechanisms and leading indicators across ≥4 categories, then ≥3 evidenced reasons it works); name falsifiable kill criteria and close with a verdict plus the strongest argument against it.

Findings go in `plans/ideation-<slug>.md` (from `.orchestrator/templates/ideation-brief.md`). **`.orchestrator/scripts/check-ideation-gate.sh` must exit 0 before Wave 0 contract freeze begins.** No bypass. Skip entirely on an existing project — phase-boundary ideation keeps the lighter PM/Designer sanity-check.

The gate's checks are structural: they confirm the reasoning was *done*, not that it was *good*. A green gate is not validation.

## Skill-output gitignore recommendations (conditional)

If your harness ships the `superpowers:brainstorming` skill (or similar skills that run a localhost preview server), the skill writes a transient output cache to `.superpowers/brainstorm/<session-id>/` containing HTML preview files plus a `state/` directory with server PIDs and logs. This is ephemeral per-session data — add to your `.gitignore`:

```
# Superpowers skill output cache (transient, per-session)
.superpowers/
```

Only relevant if you use these skills. Skip if your harness doesn't ship them.

## Project-tunable knobs (env vars)

Two env-var prefixes are recognized:

- **`AW_*`** — protocol-wide knobs that change orchestration behavior (e.g. `AW_CI_QUOTA_CONSTRAINED=1` activates the CI-quota-constrained operating sub-mode).
- **`GUARDRAIL_*`** — knobs specific to `.orchestrator/scripts/check-session-close-guardrails.sh`:
  - `GUARDRAIL_CC_SESSION_GATE=<N>` enables the cc_session_id invariant (check #7) from session N.
  - `GUARDRAIL_MAIN_CI_GATE=<N>` escalates check #18 (main CI green at session-close) from WARN to BLOCKER starting at session N. Default: WARN-only; sub-10s failures auto-classified as INFO (likely billing-block, not a real red).

See `.orchestrator/README.md` §Environment variables for the full table.
