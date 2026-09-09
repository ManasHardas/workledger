# Phase 2 — Local UI

**Status:** Frozen pending Wave 0 (lean mode, Clause #12).

**Tag at phase close:** `p2-shipped`.

**Strategic context.** P1 produces the ledger; P2 is where a human reads it and edits the
backlog. It ships `workledger serve` (a local HTTP server over the repo's `.workledger/` with
server-sent events), the `LedgerSource` interface with its local implementation, and a small
React web app with four views. Design spec §8 (`docs/superpowers/specs/2026-09-09-workledger-design.md`),
§14 stack. Visual design is deferred to P7; P2 ships a usable, unstyled-but-clean UI on default
tokens.

---

## Sub-phase split

| Sub-phase | Scope | Sessions |
|---|---|---|
| **P2a server + client** | `packages/server` (Hono, index reuse, file watcher, SSE, REST), `packages/api-client` (`LedgerSource` + `LocalServerSource`), `workledger serve` and the `backlog` edit commands | 1 |
| **P2b web app** | `packages/tokens` default theme, `apps/web` (Ledger, Next with editing, Needs you, Health, provenance panel), served by `serve` | 1–2 |

---

## Wave 0 — Contract freeze (orchestrator alone, direct commit)

1. **REST + SSE contract** `docs/contracts/p2/api.md`: endpoints below, JSON shapes reuse the
   frozen P1 schemas (`SessionFrontmatter`, `BacklogItem`) plus `ParsedSession` (frontmatter +
   section lines + `unparsed[]`) from `parseSessionText`.
2. **`LedgerSource` interface** `docs/contracts/p2/ledger-source.md`: the methods the UI depends
   on; `LocalServerSource` in P2, `CardFSSource` in P6.
3. **Backlog edit CLI** `docs/contracts/p2/backlog-cli.md`: `workledger backlog accept|discard|
   done|edit|assign|rank|merge <WL-id> …`, each a history entry with a human `by` from git config.
4. **Data-flow doc** `plans/feature-p2-data-flow.md`: watcher → index refresh → SSE event; edit
   → CLI → file → watcher → event; no writes from the server except through the CLI functions.

Phase tracking issue: `[P2] Phase tracking — Local UI`.

---

## Architecture

```
apps/web (React, Vite, Tailwind, shadcn/ui, hash router, PWA)
   │ LedgerSource (packages/api-client)
   ▼
packages/server (Hono): GET /api/sessions, /api/sessions/:id, /api/backlog, /api/notes,
   /api/health, /api/brief; POST /api/backlog/:id/{accept,discard,done,edit,assign,rank,merge};
   GET /api/events (SSE: session.changed, backlog.changed, health.changed)
   │ reads .workledger/** through packages/core parsers; writes only via packages/cli backlog fns
   ▼
<repo>/.workledger/**  ·  ~/.workledger/index.sqlite  ·  ~/.workledger/cache (P3)
```

`workledger serve [--repo] [--port]` starts the server on a random high port, prints the URL,
opens the browser, and serves `apps/web`'s built assets from the CLI package (`dist/web/`).

---

## Data model

No new ledger fields. Server-side read models:

```ts
ParsedSession = { frontmatter: SessionFrontmatter, goal: string|null, done: Line[], remaining: RemainingLine[], notes: NoteLine[], unparsed: {section,line}[] }
Line = { cp: number, text: string, files?: string[], commit?: string, verified?: Verified }
RemainingLine = Line & { ref: string, rel: "new"|"updates"|"closes", why: string, blocked_by?: string[] }
NoteLine = { cp: number, type: NoteType, text: string, by?: "human"|"agent", reason?: string }
BacklogView = { frontmatter: BacklogItem, body: string }
Health = { harnesses: DoctorReport, index: {...}, openSessions: number, lastHookAt: string|null }
```

---

## API surface

```yaml
GET  /api/sessions?repo&author&harness&status&since&q   → ParsedSession[] (newest first; q = full-text over goal/lines/notes)
GET  /api/sessions/:ulid                                 → ParsedSession
GET  /api/backlog?status                                 → BacklogView[] (rank asc, updated desc)
GET  /api/notes?type=blocker,question&open=true          → NoteLine[] with session ulid
GET  /api/brief                                          → text/plain
GET  /api/health                                         → Health
POST /api/backlog/:id/accept|discard|done                → BacklogView (history entry by git user)
POST /api/backlog/:id/edit    body {title?, body?, priority?, area?}
POST /api/backlog/:id/assign  body {owner: Actor|null}
POST /api/backlog/:id/rank    body {rank: number}
POST /api/backlog/:id/merge   body {into: WL-id}        → both items updated; source discarded with history
GET  /api/events                                         → SSE
```

All POSTs call the same functions as `workledger backlog …`; the server never writes files itself.
Bind to `127.0.0.1` only. No auth in P2 (local, single user).

---

## UI (apps/web)

Views: **Ledger** (session cards, filters, search), **Next** (backlog grouped by status; inline
title/body edit, status buttons, assign, priority, drag rank; agent-proposed items visibly marked
until `confirmed_by`), **Needs you** (open blocker and question notes with a resolve action that
appends a `decision` note through a new `workledger note` command), **Health**. A **provenance
panel** shows the checkpoint span's metadata (offset range, turns, trigger) and says "transcript
on this machine; excerpt viewer arrives in P3". Keyboard: `j/k`, `e`, `a`, `d`, `x`, `/`, `?`.
Mobile-first responsive; hash routing; no external assets.

---

## Wave 0.5 dispatch list

Backend (5): server scaffold + read endpoints + SSE watcher; backlog edit functions + CLI;
`api-client` with `LedgerSource` + `LocalServerSource`; `serve` command + static asset serving +
`note` command; server tests (supertest-style, temp repo).
Frontend (4): `packages/tokens` + `apps/web` scaffold (Vite, Tailwind, shadcn/ui, hash router,
PWA manifest); Ledger + session detail + provenance panel; Next with all edit interactions;
Needs you + Health + keyboard.
Infra (1): CI additions for `apps/web` (build, test, bundle into `packages/cli/dist/web`).

---

## Acceptance criteria

- [ ] `workledger serve` in an enabled repo opens a page showing the three dogfood sessions and two backlog items from this repo.
- [ ] Accepting, editing, ranking, and merging items from the UI writes `.workledger/backlog/*.md` with history entries whose `by` is the git user; a second browser tab updates within 2 s via SSE.
- [ ] Every POST is also available as `workledger backlog …` and produces identical files.
- [ ] `apps/web` builds into `packages/cli/dist/web` and the published package still has `better-sqlite3` as its only dependency.
- [ ] Server binds to loopback only; `pnpm test` green; coverage gate green.
- [ ] Clause #3 on Backend PRs; HARD CONSTRAINT stated on every PR.

## Out of scope

Provenance excerpt viewer, repair, backfill, Jobs view (P3); Cursor/Codex (P4); team polish (P5); cardFS (P6); Figma tokens (P7).

## Risks

| Risk | Mitigation |
|---|---|
| UI scope creep | Four views, listed interactions only; Clause #12 |
| Bundling the web app into the CLI package bloats it | Assets are static files under `dist/web`; gzip in CI; cap at 1 MB, else split into `workledger-ui` later |
| SSE + file watcher flakiness on macOS | Debounce 100 ms; fall back to 2 s polling if the watcher errors |
