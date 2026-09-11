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
`repos: Repo[]`. Amendment 4 (2026-09-09, #94): a sixth SSE event, `repos.changed { repo: <id> }`,
is emitted whenever the daemon starts or stops serving a repo — `POST /api/onboarding/init`
enabling one, a `workledger init` the daemon's index re-read picks up, a removal — and the
machine-mode daemon starts that repo's watcher and job poller at that moment, not at the next
start. A client re-reads `GET /api/repos` on it; the wizard's Home never needs a reload.

Amendment 5 (2026-09-10, #97): `GET /api/jobs/:id/log` (`?repo=<id>` in machine mode; loopback
only like every route) returns the job's `log_path` file as `text/plain; charset=utf-8` — the
resumed session's output the runner kept under `~/.workledger/logs/` — and 404 `not_found` when the
job is not this repo's or has no log. `LedgerSource` gains `jobLog(id)`; the Jobs card shows it as a
collapsed "Log" section. `POST /api/jobs/:id/retry` on a `repair` job also hands the re-queued job to
the daemon's resume runner, so a retry from the Jobs view runs rather than waiting for a CLI drain.

Amendment 6 (2026-09-10, #99) — shutdown grace period. On `SIGTERM`/`SIGINT` the daemon stops its
runners claiming, `SIGKILL`s the process group of every in-flight resume, waits up to 1.5 s for those
jobs to record `failed`, removes `serve.json`, closes the listener *and every open connection* (an
`/api/events` stream never closes on its own), stops the watchers, and exits — within **3 s** of the
signal at most, by a hard exit if anything else still holds the loop. Rows still `queued` stay queued.
`workledger stop` waits **5 s** for the pid after `SIGTERM`, then sends `SIGKILL`, waits 1 s more,
removes `serve.json` and exits 0; it exits 1 only when the pid survives `SIGKILL`.

Amendment 7 (2026-09-10, #100): `Job` gains `error_code: string | null` (`harness-usage-limit`
when the harness refused the job for its subscription window) and `retry_after: string | null`
(the ISO instant before which a `queued` job is not run — the window's reset), per
`docs/contracts/p3/cli.md` §Jobs. `GET /api/onboarding/status` gains `waiting: number` (queued
jobs whose `retry_after` is ahead — neither ahead nor failed) and `retryAfter: string | null`
(the earliest such instant); `running` no longer counts them, `total = done + failed + running +
waiting`, and `complete` is false while any wait. The Jobs card shows a waiting job as "Waiting
for your Claude usage window to reset at <local time>"; the wizard's running and done steps count
them as waiting with the same sentence, and its method step states that replay uses the
Claude/Codex subscription and that a large backfill may pause until the usage window resets.

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

## Amendment 8 (2026-09-10) — workspace-root sessions (#105)

A session is attributed to every enabled or candidate repo whose root appears in its transcript's
tool inputs (Read/Edit/Write/Glob/Grep paths, Bash command text, `cd` targets), not only to the
directory it was started in. `RepoCandidate` gains `startedIn: string[]` (distinct session start
directories that are not the repo itself) and `touchedSessions: number` (sessions attributed by
touched paths). A transcript counts for a repo when it has at least one write under that root, or
at least 5 references to it of which at least one is a non-Bash path tool input
(Read/Edit/Write/Glob/Grep/NotebookEdit `file_path`/`path`/`notebook_path` under the root) or a
Bash `cd` into the root; Bash command text mentions alone never attribute (#110). The reference
rule applies only to sessions started outside any repo (a workspace folder) or inside the repo
itself; a session started inside a repo X counts for a different repo Y only with ≥1 write under Y.
"Inside a repo" means the start directory has its own `.git`, or lies below a candidate or enabled
repo while holding none; a start directory with no `.git` of its own that holds a candidate is a
workspace folder, outside any repo whatever its git ancestors. A transcript may count for several
repos. `history`, `plan` and `run`
use the same attribution; `run` queues one repair job per (session, repo) pair, and the repair
instruction names the target root.

`workledger checkpoint --repo <path>` writes the digest into that repo's ledger regardless of the
process cwd (the index row is keyed by (harness session id, repo)); without `--repo` the cwd's repo
is used as before. `workledger init --workspace <dir>` writes the three hook files into a non-git
folder that contains tracked repos; a hook fired from such a session resolves its target repo(s)
from the transcript's touched paths (same rule as above) and, at Stop, instructs one checkpoint per
touched repo with `--repo`. `GET /api/onboarding/discover` gains `workspaces: { path, repos:
string[], hooksInstalled: boolean }[]` for start directories that are not themselves repo roots
(no `.git` of their own, whatever their ancestors hold) and contain known or found candidates;
`POST /api/onboarding/init` accepts `workspaces: string[]`.

## Amendment 9 (2026-09-10) — unlimited backfill window

`since` accepts `"all"` everywhere it accepts `"7d" | "30d" | "90d" | "none"`: `GET
/api/onboarding/history` returns a fourth window `"all": { sessions, bytes }`, `plan` and `run`
take `since: "all"`, `workledger onboard --since all` and `workledger backfill --since all` select
every transcript attributed to the repo regardless of age. The wizard's history step shows five
cards: 7 days, 30 days, 90 days, all, none.

## Amendment 10 (2026-09-10) — start directory versus context repos (operator direction)

Two distinct facts about every session. **Start directory** (`startDir`): where the harness was
launched; it decides only where the transcript is stored and where a headless resume must run.
**Context repos** (`contextRepos`): the repos the session is about, inferred from its content;
they decide where checkpoints are filed. The start directory is never an attribution by itself.

Inference, applied identically by discovery, history, backfill, and the Stop hook of any session
(repo-started or workspace-started): score each candidate root from the transcript's tool inputs
(writes, then path-tool inputs and `cd`, then references); a root qualifies with ≥1 write, or ≥5
references including ≥1 path-tool input or `cd`; a session may have several context repos, each
gets its own checkpoint (`--repo`). When no root qualifies, the repo containing the start
directory is the fallback context (a session that only talked). The start directory's own repo
gets no preference beyond that fallback and a tiebreak. The first step of every repair or
extraction job is this inference; the job records `startDir` and `contextRepos` on the session
rows, resumes in `startDir`, and files into each context repo. Session views show "started in"
and "about". Supersedes the cwd clauses of amendment 8 and the cross-repo write rule of #111
where they conflict; the write rule stays for roots other than the fallback.

**The span the live Stop hook infers over (#130, 2026-09-10).** Discovery, history, the backfill
and the repair job infer over the **whole transcript** — they describe a session that is over, and
that is what it was about. The **live Stop hook** infers over the **span since the session's last
checkpoint** alone: what `sessions.scan_counts` has accumulated since that checkpoint, plus the
bytes after `sessions.scan_offset`, which is how far the scan has actually read. A checkpoint
clears the counts — it is what recorded that work — and nothing else does; it never advances the
cursor past what was read (`scan_offset := min(scan_offset, size)`), because the allow path does
not scan and the bytes between the last block and the checkpoint are unread, so stepping over them
would drop the work they carry. The give-up rule leaves cursor and counts alone: it records
nothing, so its block's work is still owed and the next block still asks for it. The block asks
about the work since the last checkpoint, so only evidence from that work attributes: a repo with no qualifying evidence in the span is **not** listed, however much
of the transcript before the span was about it, and a repo whose whole span contribution is reads —
no write and no path-tool input or `cd` — never blocks a Stop. Where the span qualifies nothing, the
fallback is the repos **the previous checkpoint used** (the row's recorded `context_repos`, limited
to enabled repos whose row has a checkpoint on record); failing that, the repo containing the start
directory; failing that — a workspace-started session with neither — the Stop is allowed.

Wire (#116): `SessionView` gains `startedIn: string | null` and `about: string[]` (the
frontmatter's `started_in` and `about`, optional fields added to the P1 session schema);
`RepoCandidate` gains `about: { content: number; fallback: number }` — how many of its sessions
the content qualified, and how many are the fallback — while its `startedIn` and
`touchedSessions` now describe sessions about the repo that were started outside it. The
`sessions` row's `cwd` (0006) is renamed `start_dir` and `context_repos` is added
(`0009_context_repos`).

## Amendment 11 (2026-09-10) — human gists versus agent detail (operator UX direction)

Payload (P1 schema, additive): `done[].text` is the **gist** for humans: an outcome in plain
words, ≤ 140 chars, no file paths, no commit ids, no library names unless the outcome is the
library; `done[].detail` (optional, ≤ 300 chars) carries the specifics for agents (how, what
exactly, caveats). `remaining[].text` ≤ 100 chars, one action per item, split rather than
compound; `remaining[].why` ≤ 100 chars. New optional `memory[]`: `{ text ≤ 200, file? }` — facts
the session committed to a memory file (Claude Code auto-memory, CLAUDE.md, MEMORY.md, or a
project memory dir); the Stop hook may also derive entries from Write/Edit tool inputs under
those paths when the payload omits them. Instruction v4 states all of this with one example
gist versus detail pair, and asks for 3–8 done items describing outcomes "as you would tell a
teammate at standup". The brief for agents includes `detail`; the ledger markdown renders
`text` as the line and `detail`, commit, files, verified as an indented continuation.

UI: **Home** lists git repos first ("Projects") and, in a second group below ("Folders with
sessions"), non-repo folders that have transcripts (workspaces), each with its hooks state.
**Ledger** has no Open/All tabs: open sessions first, then the rest, one list. **Session**
view: Done shows gists only; clicking an item opens a side drawer with detail, commit, files,
verified, and the checkpoint stamp; Remaining shows text and why; Notes shows blocker,
question and decision by default with discovery notes behind a "For agents (n)" disclosure;
a **Memory** section appears when the session has memory entries. Existing checkpoints render
unchanged (their `text` is shown as the gist).

## Amendment 12 (2026-09-10) — `GET /api/workspaces` (Home's second group, #119)

Amendment 11's Home needs the non-repo folders on their own, not folded into a wizard result, so
the daemon gains one machine-wide read. `GET /api/workspaces` → `Workspace[]`, loopback-only like
every route, no `?repo=`:

```ts
interface Workspace {
  path: string;            // absolute, symlinks resolved
  name: string;            // basename(path)
  repos: string[];         // enabled repos under it (≤ 3 levels), absolute
  hooksInstalled: boolean; // the folder's hook files carry the workledger hook
  registered: boolean;     // `init --workspace` recorded it in the index
  sessions: number;        // transcripts started in it, across the harness stores
  lastSessionAt: string | null;
}
```

A folder qualifies when it is a registered workspace, or when a harness store holds transcripts
started in it and it is not a git repo: no `.git` of its own, and either outside any repo or
holding repos itself (amendment 8's workspace rule). A session started in `<repo>/sub` counts for
the repo, never for the subdirectory; one under the OS temp dir counts for nothing. Unlike
`discover`'s `workspaces`, a folder with transcripts and no repo under it is still listed — the
operator's rule is that transcripts in a folder do not make it a project. Sorted newest session
first, then by path. Only metadata is read, never a transcript body: this runs on every Home
render.

`POST /api/onboarding/init` accepts `repos: []` when `workspaces` is non-empty — Home's "Install
hooks" enables a folder whose repos are already tracked. An empty `repos` with no workspace named
is still a 400.

## Amendment 13 (2026-09-10) — commit and file links, and the shell

`GET /api/repos` and the session view expose the repo's web base when its `origin` remote resolves
to a known host: `remote: { host: "github"|"gitlab"|"bitbucket"|"other", webBase, commitUrl(sha),
fileUrl(path, sha) }` derived from the remote URL in either ssh or https form, with credentials and
`.git` stripped; a repo with no remote, or an unrecognised host, reports `remote: null` and the UI
shows the identifier with a copy control and no link. A commit id in the session panel links to
`commitUrl`; a file path links to `fileUrl` at that item's commit when one is recorded, else at the
default branch. Independently, `config.yaml` gains `editor: "vscode" | "cursor" | "none"` (default
`vscode`): when set, each file also offers an open-in-editor control using that scheme and the
absolute local path. Links open in a new tab with `rel="noreferrer noopener"`; no request is ever
made to the remote host by the daemon itself.

UI shape follows `docs/design/direction.md`: left nav, middle pane, and a floating right panel
that is a bottom sheet under 768 px. The panel is non-modal on desktop and modal on mobile.
