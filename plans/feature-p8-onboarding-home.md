# Phase 8 — Onboarding and home

**Status:** Frozen pending Wave 0 (lean mode). **Tag:** `p8-shipped`.

**Strategic context.** Operator direction, 2026-09-09: "I should be able to see all the projects
on my top level view in workledger home … during onboarding I should be asked which projects I
want to track, and then automatically `workledger init` is run in those repos … I would prefer if
it happens in a webpage instead of a terminal." P2's `serve --repo` was a shortcut; P8 replaces it
with one local daemon per machine, a Home view over every tracked repo, and a web onboarding
wizard that installs, selects repos, chooses a backfill window, gets consent, runs the backfill
while the home page is usable, and reports completion. Contracts: `docs/contracts/p8/`.

## The six steps (operator's list) and where each lands

| Step | Operator's wording | Implementation |
|---|---|---|
| 1 | `npm install` or `brew install workledger` should work | Release workflow on tag: npm publish (needs `NPM_TOKEN`), GitHub release with the tarball, Homebrew tap `manashardas/homebrew-workledger` formula depending on `node` |
| 2 | checkbox list of all projects to track (repos with `.git`) | Wizard step "Projects": repos discovered from harness stores (pre-checked) plus `.git` directories under configured roots (default `~/Projects`), with an "add folder" input |
| 3 | backfill for 7, 30, 90 days | Wizard step "History": three cards with the session count and size per window computed from the stores, plus "none" |
| 4 | ask if resume-based backfill is allowed, else show an extraction estimate the user can deny | Wizard step "Method": resume (uses the harness subscription) yes/no; if no, extraction estimate (tokens, USD, needs `ANTHROPIC_API_KEY`) accept/deny; deny → no backfill |
| 5 | backfill runs, user waits, server on, home visible | Wizard step "Running": progress from `job.changed`; a "Go to home" link; home already shows repos and finished sessions as they land |
| 6 | user informed on completion | Wizard step "Done" plus a home banner; a desktop notification when the OS allows it (optional) |

## Scope (two sessions)

1. **Machine-level server.** `workledger` (no args) = `workledger open`: start the daemon if not
   running (default port 7419, else a free port; URL and pid in `~/.workledger/serve.json`), open the
   browser at Home. The server serves every enabled repo the index knows; all P2/P3 endpoints take
   a `repo` parameter (repo id = the `.workledger` root path hashed; listed by `/api/repos`); SSE
   events carry `repo`. `serve --repo <path>` remains for debugging. `workledger stop` stops it.
2. **Home view.** One card per tracked repo: name, path, sessions in the last 7 days, open backlog
   count, open blockers/questions, last hook time, health status; click to enter that repo's Ledger.
   Machine-wide "Needs you" and "Jobs" tabs aggregate across repos with the repo shown per row.
   "Add projects" opens the wizard.
3. **Onboarding wizard** at `/#/onboarding`, auto-opened when the daemon starts with zero enabled
   repos: steps 2–6 above. Discovery, init, estimate, and backfill run through server endpoints
   that call the CLI's own functions (`init` per repo with the hook files written and shown as a
   summary; harness trust steps listed for Codex).
4. **Install path.** `.github/workflows/release.yml` on `v*` tags: build, pack, publish to npm
   (skipped with a clear message if `NPM_TOKEN` is absent), attach the tarball to a GitHub release;
   tap repo with a formula that installs the release tarball with `npm install -g` under Homebrew's
   `node`; README install section updated; `workledger` prints the home URL on first run.
5. **Migration.** Repos enabled by P1–P5 already appear in the index; Home lists them; nothing to
   re-run. `serve --repo` users see a one-line notice pointing at `workledger open`.

## Wave 0.5 dispatch list

Backend (2): daemon + `open`/`stop` + `serve.json` + multi-repo server (`/api/repos`, `repo`
parameter everywhere, SSE `repo` field, index-driven repo list) with api-client updates; onboarding
ops (`discoverRepos`, `sessionCounts(window)`, `initRepos`, `backfillPlan`, `runBackfill`) exposed
as `/api/onboarding/*` and used by a CLI `workledger onboard --json` for parity.
Frontend (2): Home view + repo switcher + machine-wide Needs you/Jobs; onboarding wizard.
Infra (1): release workflow, Homebrew tap formula, README install.
QA (1): e2e — fresh temp `HOME` with two temp repos and fixture transcripts, run `workledger`
(no args), drive the wizard in Playwright through steps 2–6 with resume allowed and a stub `claude`,
assert both repos initialized and backfilled, Home shows both.

## Acceptance

- [ ] `npm install -g` from the release tarball and `brew install manashardas/workledger/workledger` both put `workledger` on PATH (the npm publish itself is verified in dry-run until `NPM_TOKEN` exists).
- [ ] `workledger` with no arguments starts the daemon once, prints the URL, opens Home; a second invocation reuses it.
- [ ] With zero enabled repos the wizard opens; it lists repos with agent sessions pre-checked and other `.git` repos under `~/Projects`; selecting and continuing runs `init` in each (hook files present, summary shown).
- [ ] The history step shows counts for 7/30/90 days from the stores; the method step offers resume, and on refusal an extraction estimate that can be denied (no backfill then).
- [ ] Backfill runs with live progress while Home is usable; completion is shown; sessions appear per repo.
- [ ] Home lists every enabled repo with live counts; Needs you and Jobs aggregate across repos.
- [ ] Tests and coverage gate green; the hook allow-path timing unchanged.
- [ ] **Operator walkthrough (2026-09-09 direction):** the operator runs the onboarding flow end to end from a fresh state (`WORKLEDGER_HOME=$(mktemp -d) workledger`) on this machine and judges it "up to the mark"; `p8-shipped` is tagged only after that verdict, and each defect found becomes a five-line issue in the same phase.

## Out of scope
Cloud sync; the Dome card (P6, deferred); design polish (P7).
