# Session 3 Handoff

**Generated:** 2026-09-09 by the orchestrator at S2 close.
**Stale-after:** any user direction change OR any merged PR appearing post-generation.

---

## User: paste this as your first session-start message

> Read `.orchestrator/agents/orchestrator.md`. We're continuing workledger at P7 (design pass). I'll be the user; you're the Orchestrator. Read `plans/next-session.md` and execute it. Budget: full.

---

## Session 3 quick-context

- **Shipped:** P1–P5 (tags `p1-shipped` … `p5-shipped`, version 0.3.0). CHANGELOG has the feature list per phase.
- **Deferred by the operator:** P6 (Dome card). Spec and contracts are on main (`plans/feature-p6-dome-card.md`, `docs/contracts/p6/`); do not dispatch unless the operator un-defers it.
- **P8 (Onboarding and home) is the operator's priority (2026-09-09) and runs before P7 Wave 1:** spec `plans/feature-p8-onboarding-home.md`, contract `docs/contracts/p8/daemon-and-api.md`, tracking #75, builds #76 (daemon/multi-repo) → #77 (onboarding ops) and #78 (Home) → #79 (wizard) → #81 (QA e2e); #80 (release/brew) independent.
- **P7 state:** Wave 0 (#73: Figma token sync script, Code Connect skeletons, Lighthouse script) merged or in flight; see `gh pr list`. **Wave 1 is blocked on operator inputs:** the Figma file key, node ids for the ten components listed in `plans/feature-p7-design.md`, and a variables export (or MCP `get_variable_defs` output). Ask for them first; nothing else in P7 can proceed without them.
- **Operating mode:** ACTIVE, Lean (Clause #12). Clause #13 exists in agentwaves but is NOT in force here (operator decision 2026-09-09).
- **gh identity:** prefix every gh call with `export GH_TOKEN=$(gh auth token --user ManasHardas)`; never `gh auth switch`.
- **Worktrees:** one per PR under `.worktrees/`, always removed from the repo root with an absolute path; check `git worktree list` at start and prune leftovers.
- **Merge discipline:** after `gh pr merge`, read `gh pr view N --json state` and proceed only on `MERGED`; tag only after that.

---

## Active priors (from velocity.json, S2 lean-mode actuals)

| Class | Implementer | Reviewer | Fix-cycles | Slot total |
|---|---|---|---|---|
| Frontend feature page (lean, CR) | 100–300k | 80–100k | 0–1 | ~200–400k |
| Backend service/command (lean, CR or CR+security) | 150–600k | 90–120k | 0–1 | ~300–700k |
| Infra thin (orchestrator-verified) | 85k | 0 | 0 | ~90k |
| QA e2e (no review) | 105–125k | 0 | 0 | ~120k |

---

## Pre-rendered slot 1 dispatch brief (P7 Wave 1, once inputs exist)

```
Read `.orchestrator/agents/frontend.md` and `CLAUDE.md`. Clause #12 — Lean mode: do exactly this
issue, report in under 100 words, no side quests.

Worktree: `.worktrees/p7-b` on branch `p7/apply-designs` from main. Every gh call:
`export GH_TOKEN=$(gh auth token --user ManasHardas)`.

Inputs (from the operator, pasted into the issue): Figma file key, node ids per component, and the
variables export file at `packages/tokens/figma/<name>.json`.

Task: run `node packages/tokens/scripts/from-figma.mjs <export>` and commit the regenerated
tokens.json and preset; fill the Code Connect files' file key and node ids and run
`npx figma connect publish --dry-run`; apply the designs to Ledger, Next, Needs you, Health, Jobs
per `plans/feature-p7-design.md` §Scope 3–5 with every value through tokens; verify at 375 px and
1280 px in light and dark with screenshot pairs in the PR; `pnpm -F web lighthouse` scores in the PR.

PR: `Closes #<P7 Wave 1 issue>`, gate outputs, screenshots. Trailer as usual.
```

---

## Pre-rendered slot 2-N (compressed)

- If P6 is un-deferred: three PRs in order per `plans/feature-p6-dome-card.md` (CardFSSource + publish/pull; apps/card + dome theme; mirror script), the middle one with a Security review (Dome key surface); the founder creates `DomeHQ/card-workledger` and a card instance first.
- Housekeeping candidates, each one small PR, only if asked: `serve` health lists identities file status; malformed `identities.yaml` prints a `workledger:` stderr line.

---

## Watchdogs

- **T-A:** cumulative > 3.5M → close the session.
- **T-G:** any slot > 1.5× the lean anchors above → user-escalate.
- **T-D:** second fix-cycle iteration on any slot → stop after its clean merge.

## Stop conditions

P7 Wave 1 merged and tagged `p7-shipped`, or blocked on inputs after asking once; chore-close with velocity rows, wave-state, capacity-log S3, this file regenerated for S4, guardrails script.

## User-override section

- Push policy: always push to `origin` (personal alias) without asking. Never a Dome remote from this repo.
- GitHub Actions failure emails are an account-level setting the operator disables at github.com/settings/notifications; nothing in the repo controls them.
