# P8 contracts — daemon, multi-repo API, onboarding API (frozen 2026-09-09)

## CLI

```
workledger                       = workledger open
workledger open [--port <n>] [--no-browser]
   if ~/.workledger/serve.json names a live server (pid alive, GET /api/health ok) → print its URL, open the browser
   else start `serve` detached (default port 7419, else a free port), write serve.json { url, pid, startedAt, version },
   wait for /api/health, print the URL, open the browser; opens /#/onboarding when /api/repos is empty
workledger stop                  → SIGTERM the pid in serve.json, remove the file; exit 0 when nothing was running
workledger serve [--repo <path>] [--port <n>] [--no-open]
   without --repo: machine mode over every enabled repo in the index; with --repo: single-repo mode (debug),
   prints "single-repo mode; run `workledger open` for all projects"
workledger onboard [--json] [--roots <a,b>] [--select <paths>] [--since 7d|30d|90d|none] [--method resume|extract|none] [--yes]
   terminal parity for the wizard; --json emits the same objects the API returns
```

`serve.json` is written atomically and removed on clean shutdown; a stale file (dead pid) is ignored and overwritten.

## Repo identity

`repoId` = first 12 hex chars of sha256 of the absolute path of the repo's `.workledger` directory (`<root>/.workledger`). `GET /api/repos` →
`Repo[]`: `{ id, path, name (basename), enabled: true, harnesses: string[], sessions7d, openBacklog,
openNotes, lastHookAt, health: "ok"|"warn"|"broken" }`, from the index and each repo's ledger.

## Multi-repo endpoints

Every P2/P3 endpoint gains a required `repo` query parameter (`?repo=<id>`) in machine mode; a
missing or unknown id → 400 `{ code: "repo-required" }` / 404 `{ code: "repo-not-found" }`.
Exempt (machine-wide by nature): `/api/health`, `/api/repos`, `/api/notes/all`, `/api/jobs/all`,
`/api/events`, `/api/onboarding/*`. `Health.repo` is `null` in machine mode. (Amendment 1, 2026-09-09.) In
single-repo mode the parameter is optional and defaults to the one repo. New aggregate endpoints:
`GET /api/notes/all?type&open` → `NoteRef & { repo: Repo }[]`, `GET /api/jobs/all` → `Job & { repo }[]`.
SSE events gain `repo: <id>`; a client filters. `GET /api/health` returns machine-wide health plus
`repos: Repo[]`.

## Onboarding endpoints

```yaml
GET  /api/onboarding/discover?roots=<csv>      → { known: RepoCandidate[], found: RepoCandidate[], roots: string[] }
     RepoCandidate = { path, name, hasGit, enabled, suggested, harnessSessions: { claude-code?: n, codex?: n, cursor?: n }, lastSessionAt }
     suggested (amendment 2, 2026-09-09) = hasGit && not under the OS temp dir && not an ancestor of another candidate; the wizard pre-checks known candidates only when suggested. The walk always descends into a root even when the root itself has `.git` (a `~/Projects` that is a git repo holding nested repos); nested repos are not entered. Candidates under the OS temp dir (`os.tmpdir()`, `/tmp`, `/private/tmp`) and non-existent paths are dropped from `known`.
     known = repos seen in harness stores (Claude project slugs mapped to cwd, Codex session_meta.cwd); found = .git dirs under roots (depth ≤ 3, default ~/Projects, skipping node_modules and hidden dirs)
GET  /api/onboarding/history?repos=<csv paths>  → { windows: { "7d": { sessions, bytes }, "30d": {...}, "90d": {...} } }
POST /api/onboarding/init      body { repos: string[], harnesses?: string[] }
                                                → { results: [{ path, ok, hooksWritten: string[], trustSteps: string[], error? }] }
POST /api/onboarding/plan      body { repos, since: "7d"|"30d"|"90d"|"none", method: "resume"|"extract"|"none" }
                                                → { sessions, estimate: { seconds } | { tokens, usd, needsApiKey: boolean } | null, unsupported?: { codex: n } }
     amendment 3 (2026-09-09, #85): history, plan and run cover Codex sessions (`~/.codex/sessions`, `session_meta.cwd` inside the repo, resumed with `codex exec resume <id>`) beside Claude Code's. Under method "extract" Codex sessions are excluded from `sessions` and the estimate, reported in `unsupported.codex`, and not queued: the P3 extractor parses Claude Code transcripts only.
POST /api/onboarding/run       body { repos, since, method, consent: true }
                                                → { jobs: Job[] } (202); method "extract" without ANTHROPIC_API_KEY → 409 { code: "api-key-required" }
GET  /api/onboarding/status                     → { total, done, failed, running, complete: boolean }
```

All write endpoints are loopback-only like the rest of the server. `init` writes exactly what
`workledger init --yes` writes (the contract hook files) and returns the per-repo summary; it never
edits a repo that already has `.workledger/` beyond adding missing hook files.

## Wizard routes (apps/web)

`/#/onboarding` steps: `projects` → `history` → `method` → `running` → `done`. State is kept in
the URL hash query so a reload resumes the step. Home (`/#/`) shows repo cards; `/#/r/<repoId>/
ledger|next|needs|health|jobs` are the per-repo views (the P2 routes move under `/#/r/<id>/`, with
the old routes redirecting to the first repo).

## Release and install

`.github/workflows/release.yml` on tags `v*`: `pnpm install --frozen-lockfile`, `pnpm build`,
`pnpm test`, `pnpm -F workledger pack`, `npm publish` (skipped with a printed message when
`NPM_TOKEN` is absent), and a GitHub release with the tarball attached. Homebrew tap
`manashardas/homebrew-workledger`, formula `workledger.rb`: `depends_on "node"`, installs the
release tarball with `npm install -g` into the keg (`std_npm_args`), test `workledger --version`.
