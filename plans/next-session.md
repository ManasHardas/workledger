# Session 4 Handoff

**Generated:** 2026-09-09 by the orchestrator (PM inline) at S3 close; amended 2026-09-10 after the operator's walkthrough (S3 addendum), after workspace-root sessions shipped (addendum 2), and again after context repos and the human-gist ledger shipped (addendum 3).
**Stale-after:** any user direction change OR any merged PR appearing post-generation.

---

## User: paste this as your first session-start message

> Read `.orchestrator/agents/orchestrator.md`. We're continuing workledger at P8 (ship gate) then P7. I'll be the user; you're the Orchestrator. Read `plans/next-session.md` and execute it. Budget: full.

---

## Session 4 quick-context

- **Phase:** P8 — Onboarding and home. **Built and proven; the six UX points shipped; not tagged.** All twenty-three build PRs are on main (#82 #83 #84 #86 #90 #91 #92 #93 #95 #96, then #98 #102 #103 #104, then #106 #107 #112 #111, then #115 #120 #122 #123 #126; last SHA at S3 close is the `chore(close): S3 addendum 3` commit). Spec `plans/feature-p8-onboarding-home.md`, contract `docs/contracts/p8/daemon-and-api.md` (amendments 1–12), tracking #75 (open; acceptance boxes ticked except the install box, which waits for a published release). Version is still 0.3.0; CHANGELOG has an Unreleased section for P8 that already lists the thirteen post-walkthrough PRs. Three P8 issues are filed and unbuilt: #125 (one repair job per context repo), #113 (live-session guard for backfill) and #108 (migration robustness). #121 was filed and closed as superseded by #120; its PR #124 is closed unmerged — do not reopen either.
- **Workspace-root sessions (DL-19, amendments 8–9):** Claude Code stores a transcript under the slug of the directory a session was started in, and the operator works from `~/Projects/dome_workspace` across card repos. Since #106/#107/#111 a transcript counts for every repo it touches: at least one write under the root, or at least five references of which one is a non-Bash path-tool input or a Bash `cd` into the root (Bash text mentions alone never attribute; a session started inside repo X counts for repo Y only with a write). Sessions are keyed by (harness, session id, repo); `run` queues one job per (session, repo); `workledger checkpoint --repo <path>` writes into that ledger from any cwd; `workledger init --workspace <dir>` installs the three hook files into a non-git folder holding tracked repos and its Stop hook blocks with one `checkpoint --repo` per touched repo; the wizard shows the folders under "Sessions were also started from these folders" and a fifth history card, All (`since: all`). Migrations 0006–0008. **Every agent run uses `WORKLEDGER_HOME=$(mktemp -d)/home`** (CLAUDE.md): a worktree build once migrated the real index and main's `serve` failed with "table workspaces already exists" (#108).
- **Context repos and the human-gist ledger (DL-20, DL-21, amendments 10–12):** the operator's rule is that a session's start directory is almost immaterial except that the transcript is stored there — "the first task of an extraction job is to figure out what repo is this session about and where to file the workledger extract". Since #115/#120/#122/#123/#126 every session carries `startDir` (where the transcript lives; a backfill resumes there, not in the target repo) and `contextRepos` (inferred from the session's content by one shared inference used by discovery, backfill and the live Stop hook; the start directory's repo is only a fallback and tiebreak), and the API reports what a session is `about`. A checkpoint's `done` item is a human gist of at most 140 characters; its `detail`, files and commit are agent evidence the session view opens in a side drawer; remaining items are shorter and split; discovery notes are agent-facing and separated from the human notes; `memory[]` facts get their own Memory section. Home groups tracked projects first and then the folders sessions were started from (`GET /api/workspaces`), and the Ledger has no Open/All tabs. Instruction v4, migration 0009. **No test may pin this repo's live dogfood ledger contents** — two did, main went red, and #120/#122 repaired them to derive their expected values; assert on shape, never on today's ledger text.
- **Two facts a resume touches:** headless resumes (repair, backfill) hand the checkpoint over as `workledger checkpoint --payload '<json>'` (or `--payload-file`), never a heredoc or pipe on stdin: Claude Code's headless permission matcher denies stdin heredocs and pipes even under `Bash(workledger checkpoint*)` (DL-18; instruction v3; 16 KB cap). At most 2 jobs run machine-wide. A resume refused by the operator's Claude usage limit ("resets 1am") is requeued with `retry_after` and retried automatically after the reset (up to three waits); the Jobs card and wizard show the wait.
- **The walkthrough gate:** the operator runs onboarding personally before `p8-shipped` (spec §Acceptance, 2026-09-09 direction). The walkthrough ran on 2026-09-10: every backfill failed (permission matcher, payload cap and timeout, then the usage limit), four lean PRs fixed it, and all five real backfill jobs on the operator's machine then succeeded. The verdict is still pending; do not tag first. Fresh-state commands to repeat if asked, after `pnpm install && pnpm -r build` (`workledger` on PATH is a symlink to `packages/cli/bin/workledger`):
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

Five fix-cycles across twenty-three PRs in S3 (#84, #90, #93, #111, #123); every fix-cycle roughly doubles the reviewer spend on that slot. The two workspace-root first-of-class slots (#106, #107) ran 390–410k implementer and 135–175k reviewer, ~10% above the backend first-of-class anchor. In addendum 3 a schema-plus-prompt change (#122, 424k/113k) and a Home regrouping that also moved an endpoint (#123, 438k/259k with its one fix-cycle) both ran at first-of-class cost without introducing a new subsystem; the two thin backend slots (#115 134k/74k, #120 109k/103k) show the lean pattern where reviewer cost nearly matches the implementer's.

---

## Pre-rendered slot 1 (orchestrator direct task, after the operator's verdict)

Run only once the operator has said the walkthrough is up to the mark and every reported defect is merged. No agent dispatch; direct commits on main per Lean mode.

```
export GH_TOKEN=$(gh auth token --user ManasHardas)
cd /Users/manashardas/Projects/workledger && git fetch origin && git reset --hard origin/main
# 1. Version: packages/cli/package.json "version": "0.3.0" -> "0.4.0" (pnpm -r build; node packages/cli/dist/main.js --version prints 0.4.0).
# 2. CHANGELOG.md: rename "## Unreleased — P8 Onboarding and home" to "## 0.4.0 — P8 Onboarding and home (YYYY-MM-DD)",
#    drop the "Built on main; …" line (#98 #102 #103 #104 #106 #107 #112 #111 #115 #120 #122 #123 #126 are already listed; append #125, #113, #108 and any later defect PR).
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

- **Slot 2 (the three filed P8 builds, before slot 1 unless the operator says otherwise), in this order:** #125 `[P8][Backend]` one repair job per context repo (a crashed session that touched several repos must produce one repair per repo it is about, not one for the start directory); #113 `[P8][Backend]` backfill must not replay a session that is still live in another terminal; #108 `[P8][Backend]` index migrations record applied names, detect a divergent schema, and offer a cache rebuild instead of a raw SQLite error. One lean PR each from the filed bodies, worktree `.worktrees/p8-<slug>`, `Closes #<N>`, CR review, temp `WORKLEDGER_HOME` for every run; #125 sits on the `contextRepos` inference and #108 touches the index schema path, so this is ACTIVE mode (contract-adjacent), not DEGRADED. Anchor: backend fix ~230–310k each; #108 may reach the first-of-class anchor (~510–630k) if the migration table changes shape.
- **Slot 2b (before slot 1 if the operator reports defects):** file each defect as a five-line issue (`[P8][Backend|Frontend] <title>`; body: symptom, expected, where in the code, acceptance, test) and dispatch one lean PR per issue with the matching `agents/<role>.md` brief: worktree `.worktrees/p8-<slug>` on branch `p8/<slug>`, `Closes #<N>`, host verification stated, single CR review (Security only if init/hook/credential surfaces are touched), one fix-cycle then merge. Anchors: backend fix ~230–310k, frontend fix ~90k (orchestrator-verified narrow) to ~430k (page-level). Repeat the fresh-state run after each merge; the operator gives the final verdict.
- **Slot 3 (only if the Figma inputs exist):** P7 Wave 1, Frontend, worktree `.worktrees/p7-b` on `p7/apply-designs`: run `node packages/tokens/scripts/from-figma.mjs <export>` and commit the regenerated tokens and preset; fill the Code Connect files' file key and node ids and run `npx figma connect publish --dry-run`; apply the designs to Ledger, Next, Needs you, Health, Jobs (and Home, new since P8) per `plans/feature-p7-design.md` §Scope 3–5 with every value through tokens; verify at 375 px and 1280 px in light and dark with screenshot pairs and `pnpm -F web lighthouse` scores in the PR; `Closes #<P7 Wave 1 issue>`. Then tag `p7-shipped` and close #72. Anchor ~450k per PR, up to two PRs.
- **P6:** only if the operator un-defers it — three PRs per `plans/feature-p6-dome-card.md` (CardFSSource + publish/pull; apps/card + dome theme; mirror script), the middle one with a Security review; the founder creates `DomeHQ/card-workledger` and a card instance first.
- **Housekeeping candidates, only if asked, one small PR each:** `serve` health lists identities file status; malformed `identities.yaml` prints a `workledger:` stderr line.

---

## Watchdogs for this session

- **T4-A (cumulative ceiling):** cumulative > 3.5M → close the session.
- **T4-G (per-slot):** any slot > 1.5× the lean anchors above → user-escalate.
- **T4-D (fix-cycle):** second fix-cycle iteration on any slot → stop after its clean merge.

## Stop conditions

P8 tagged `v0.4.0` and `p8-shipped` with #75 closed (or the walkthrough still pending a verdict after the fresh-state run is prepared), #125, #113 and #108 merged, P7 Wave 1 merged and tagged `p7-shipped` or blocked on inputs after asking once; then chore-close: velocity rows, wave-state (post-S4), capacity-log S4, this file regenerated for S5, guardrails script (`--session 4`), commit `chore(close): S4` with operating mode and watchdog status in the body.

## Session-close artifacts to update

1. plans/velocity.json (append entries)
2. plans/capacity-log.md (append S4 entry)
3. plans/wave-state.md (update Current state block)
4. plans/next-session.md (regenerate THIS file for S5)

## User-override section

If your priorities at session-start differ from the pre-rendered plan, paste your override after the "Read plans/next-session.md and execute it" message; the orchestrator applies it as a delta.

- Push policy: always push to `origin` (personal alias) without asking. Never a Dome remote from this repo.
- GitHub Actions failure emails are an account-level setting the operator disables at github.com/settings/notifications; nothing in the repo controls them.
