# Session 4 Handoff

**Generated:** 2026-09-09 by the orchestrator (PM inline) at S3 close.
**Stale-after:** any user direction change OR any merged PR appearing post-generation.

---

## User: paste this as your first session-start message

> Read `.orchestrator/agents/orchestrator.md`. We're continuing workledger at P8 (ship gate) then P7. I'll be the user; you're the Orchestrator. Read `plans/next-session.md` and execute it. Budget: full.

---

## Session 4 quick-context

- **Phase:** P8 — Onboarding and home. **Built, not tagged.** All ten build PRs are on main (#82 #83 #84 #86 #90 #91 #92 #93 #95 #96; last SHA at S3 close is the `chore(close): S3` commit). Spec `plans/feature-p8-onboarding-home.md`, contract `docs/contracts/p8/daemon-and-api.md` (amendments 1–4), tracking #75 (open; acceptance boxes ticked except the install box, which waits for a published release). Version is still 0.3.0; CHANGELOG has an Unreleased section for P8.
- **The walkthrough gate:** the operator runs onboarding personally before `p8-shipped` (spec §Acceptance, 2026-09-09 direction). Prepare and wait for the verdict; do not tag first. Fresh-state commands, after `pnpm install && pnpm -r build` (`workledger` on PATH is a symlink to `packages/cli/bin/workledger`):
  - `workledger` — the machine's real state: daemon starts or is reused, Home lists the repos already enabled by P1–P5.
  - `WORKLEDGER_HOME=$(mktemp -d)/wl workledger` — zero enabled repos: the daemon starts on a fresh home and opens the wizard at `/#/onboarding`; `workledger stop` with the same `WORKLEDGER_HOME` afterwards.
  - Each defect the operator reports becomes a five-line issue in P8 (`[P8][<Role>] <title>`), fixed as one lean PR each.
- **Secrets needed from the operator (repository settings, not agents):** `NPM_TOKEN` (npm publish; the workflow prints `npm publish <tarball> --access public` when absent) and `TAP_TOKEN` (a token that can push to `ManasHardas/homebrew-workledger`; the workflow prints the manual formula update when absent). The `v0.4.0` tag can go out without them; the release then carries the tarball only.
- **P7 state:** Wave 0 merged (#74). **Wave 1 is blocked on operator inputs:** the Figma file key, node ids for the ten components in `plans/feature-p7-design.md`, and a variables export (or MCP `get_variable_defs` output). Ask once; nothing in P7 proceeds without them.
- **P6 (Dome card):** deferred by the operator; spec and contracts on main; do not dispatch unless un-deferred.
- **Operating mode:** ACTIVE, Lean (Clause #12). Clause #13 is NOT in force here (operator decision 2026-09-09).
- **gh identity:** prefix every gh call with `export GH_TOKEN=$(gh auth token --user ManasHardas)`; never `gh auth switch`.
- **Worktrees:** one per PR under `.worktrees/`, always removed from the repo root with an absolute path; check `git worktree list` at start and prune leftovers.
- **Merge discipline:** after `gh pr merge`, read `gh pr view N --json state` and proceed only on `MERGED`; tag only after that.
- **Close-commit subject:** `chore(close): S<N>`; the guardrails script recognises both `chore: S<N>` and `chore(close): S<N>` since S3.

---

## Active priors (from velocity.json, S3 lean-mode actuals; S2 in parentheses where different)

| Class | Implementer | Reviewer | Fix-cycles | Slot total |
|---|---|---|---|---|
| Backend first-of-class, daemon/server or endpoint-chained (lean, CR) | 350–370k (S2: 150–600k) | 160–260k (S2: 90–120k) | 0–1 | ~510–630k |
| Backend sibling or fix slot (lean, CR) | 135k | 90–175k | 0–1 | ~230–310k |
| Frontend feature page or wizard (lean, CR) | 290–340k (S2: 100–300k) | 140–190k (S2: 80–100k) | 0–1 | ~430–530k |
| Frontend narrow fix (orchestrator-verified, no review) | 90k | 0 | 0 | ~90k |
| Full-stack integration fix (lean, CR) | 155k | 85k | 0 | ~240k |
| Infra thin (orchestrator-verified, no review) | 87k | 0 | 0 | ~90k |
| QA e2e (no review) | 175k (S2: 105–125k) | 0 | 0 | ~175k |

Three fix-cycles across ten PRs in S3 (#84, #90, #93); every fix-cycle roughly doubles the reviewer spend on that slot.

---

## Pre-rendered slot 1 (orchestrator direct task, after the operator's verdict)

Run only once the operator has said the walkthrough is up to the mark and every reported defect is merged. No agent dispatch; direct commits on main per Lean mode.

```
export GH_TOKEN=$(gh auth token --user ManasHardas)
cd /Users/manashardas/Projects/workledger && git fetch origin && git reset --hard origin/main
# 1. Version: packages/cli/package.json "version": "0.3.0" -> "0.4.0" (pnpm -r build; node packages/cli/dist/main.js --version prints 0.4.0).
# 2. CHANGELOG.md: rename "## Unreleased — P8 Onboarding and home" to "## 0.4.0 — P8 Onboarding and home (YYYY-MM-DD)",
#    drop the "Built on main; …" line, append one bullet per P8 defect PR fixed after the walkthrough.
# 3. Commit: "P8 shipped: changelog 0.4.0, version bump" with the usual trailers; git push origin main.
# 4. Tags (annotated, on that commit): git tag -a v0.4.0 -m "workledger 0.4.0 — P8 onboarding and home"
#    and git tag -a p8-shipped -m "P8 shipped"; git push origin v0.4.0 p8-shipped.
#    v0.4.0 triggers .github/workflows/release.yml (build, pack, npm publish or the printed manual
#    command when NPM_TOKEN is absent, GitHub release with the tarball, tap update or the printed
#    manual command when TAP_TOKEN is absent). Watch it: gh run list --workflow release.yml --limit 1;
#    gh run watch <id>. If it fails, fix on main, delete and re-push the tag (Clause #9: one run per tag).
# 5. Tick the install box on #75 if the release published (npm or tap), comment with the run URL and
#    the tag SHAs, then: gh issue close 75 --comment "P8 shipped: v0.4.0, p8-shipped."
# 6. wave-state.md: P8 shipped, version 0.4.0; then continue with slot 2.
```

Estimated cost: ~20–40k orchestrator tokens, no agents.

---

## Pre-rendered slot 2-N (compressed)

- **Slot 2 (before slot 1 if the operator reports defects):** file each defect as a five-line issue (`[P8][Backend|Frontend] <title>`; body: symptom, expected, where in the code, acceptance, test) and dispatch one lean PR per issue with the matching `agents/<role>.md` brief: worktree `.worktrees/p8-<slug>` on branch `p8/<slug>`, `Closes #<N>`, host verification stated, single CR review (Security only if init/hook/credential surfaces are touched), one fix-cycle then merge. Anchors: backend fix ~230–310k, frontend fix ~90k (orchestrator-verified narrow) to ~430k (page-level). Repeat the fresh-state run after each merge; the operator gives the final verdict.
- **Slot 3 (only if the Figma inputs exist):** P7 Wave 1, Frontend, worktree `.worktrees/p7-b` on `p7/apply-designs`: run `node packages/tokens/scripts/from-figma.mjs <export>` and commit the regenerated tokens and preset; fill the Code Connect files' file key and node ids and run `npx figma connect publish --dry-run`; apply the designs to Ledger, Next, Needs you, Health, Jobs (and Home, new since P8) per `plans/feature-p7-design.md` §Scope 3–5 with every value through tokens; verify at 375 px and 1280 px in light and dark with screenshot pairs and `pnpm -F web lighthouse` scores in the PR; `Closes #<P7 Wave 1 issue>`. Then tag `p7-shipped` and close #72. Anchor ~450k per PR, up to two PRs.
- **P6:** only if the operator un-defers it — three PRs per `plans/feature-p6-dome-card.md` (CardFSSource + publish/pull; apps/card + dome theme; mirror script), the middle one with a Security review; the founder creates `DomeHQ/card-workledger` and a card instance first.
- **Housekeeping candidates, only if asked, one small PR each:** `serve` health lists identities file status; malformed `identities.yaml` prints a `workledger:` stderr line.

---

## Watchdogs for this session

- **T4-A (cumulative ceiling):** cumulative > 3.5M → close the session.
- **T4-G (per-slot):** any slot > 1.5× the lean anchors above → user-escalate.
- **T4-D (fix-cycle):** second fix-cycle iteration on any slot → stop after its clean merge.

## Stop conditions

P8 tagged `v0.4.0` and `p8-shipped` with #75 closed (or the walkthrough still pending a verdict after the fresh-state run is prepared), P7 Wave 1 merged and tagged `p7-shipped` or blocked on inputs after asking once; then chore-close: velocity rows, wave-state (post-S4), capacity-log S4, this file regenerated for S5, guardrails script (`--session 4`), commit `chore(close): S4` with operating mode and watchdog status in the body.

## Session-close artifacts to update

1. plans/velocity.json (append entries)
2. plans/capacity-log.md (append S4 entry)
3. plans/wave-state.md (update Current state block)
4. plans/next-session.md (regenerate THIS file for S5)

## User-override section

If your priorities at session-start differ from the pre-rendered plan, paste your override after the "Read plans/next-session.md and execute it" message; the orchestrator applies it as a delta.

- Push policy: always push to `origin` (personal alias) without asking. Never a Dome remote from this repo.
- GitHub Actions failure emails are an account-level setting the operator disables at github.com/settings/notifications; nothing in the repo controls them.
