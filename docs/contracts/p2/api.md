# P2 API contract — `workledger serve` (frozen 2026-09-09)

Local HTTP server, Hono, bound to `127.0.0.1` on a random high port (or `--port`). No auth
(single local user). JSON everywhere except `/api/brief` (text) and `/api/events` (SSE). All
timestamps ISO 8601 UTC. Errors: `{ "error": { "code": string, "message": string } }` with 400
(bad input), 404 (unknown id), 409 (state conflict, e.g. accept on a discarded item), 500.

## Read models

```ts
type Line          = { cp: number; text: string; files?: string[]; commit?: string; verified?: "tests-passed"|"tests-failed"|"not-verified" };
type RemainingLine = Line & { ref: string; rel: "new"|"updates"|"closes"; why: string; blocked_by?: string[] };
type NoteLine      = { cp: number; type: "discovery"|"decision"|"blocker"|"question"; text: string; by?: "human"|"agent"; reason?: string; resolved?: boolean };
type ParsedSession = { frontmatter: SessionFrontmatter; goal: string|null; done: Line[]; remaining: RemainingLine[]; notes: NoteLine[]; unparsed: { section: string; line: string }[]; startedIn: string|null; about: string[] };  // startedIn/about: the frontmatter's started_in and about (P8 amendment 10, 2026-09-10, additive)
type BacklogView   = { frontmatter: BacklogItem; body: string };
type NoteRef       = NoteLine & { session: string; index: number };  // session ulid; index = position within its checkpoint (amended 2026-09-09)
type Health        = { cli: string; repo: string; harnesses: DoctorEntry[]; index: { path: string; bytes: number; openSessions: number }; config: { valid: boolean; problems: string[] }; lastHookAt: string|null };
type Identity      = { email: string; name: string; dome_user: string|null };  // one row of .workledger/identities.yaml (added 2026-09-09, additive)
```

`SessionFrontmatter` and `BacklogItem` are the frozen P1 schemas. `ParsedSession` comes from
`parseSessionText`; `BacklogView` from `parseItem`.

## Endpoints

| Method | Path | Query / body | Returns |
|---|---|---|---|
| GET | `/api/sessions` | `author`, `harness`, `status`, `since` (ISO), `q` (case-insensitive substring over goal, line text, note text), `limit` (default 100) | `ParsedSession[]` newest `started` first |
| GET | `/api/sessions/:ulid` | | `ParsedSession` |
| GET | `/api/backlog` | `status` (comma list; default all but `discarded`) | `BacklogView[]` by `rank` asc, then `updated` desc |
| GET | `/api/backlog/:id` | | `BacklogView` |
| GET | `/api/notes` | `type` (comma list), `open=true` (unresolved only) | `NoteRef[]` newest first |
| GET | `/api/brief` | `max_tokens` | `text/plain` (same bytes as `workledger brief`) |
| GET | `/api/health` | | `Health` |
| GET | `/api/identities` | | `Identity[]` by `email` asc; `[]` when the file is absent (docs/contracts/p5/config-and-identities.md) |
| POST | `/api/backlog/:id/accept` | | `BacklogView` |
| POST | `/api/backlog/:id/discard` | | `BacklogView` |
| POST | `/api/backlog/:id/done` | | `BacklogView` (`done_by: null`, history `op: status`) |
| POST | `/api/backlog/:id/start` | | `BacklogView` (accepted → in_progress) |
| POST | `/api/backlog/:id/restore` | | `BacklogView` (discarded → proposed; done → accepted) |
| POST | `/api/backlog/:id/edit` | `{ title?, body?, priority?: "p1"|"p2"|"p3"|null, area?: string[] }` | `BacklogView` |
| POST | `/api/backlog/:id/assign` | `{ owner: Actor|null }` | `BacklogView` |
| POST | `/api/backlog/:id/rank` | `{ rank: number }` | `BacklogView` |
| POST | `/api/backlog/:id/merge` | `{ into: string }` | `{ source: BacklogView, target: BacklogView }` |
| POST | `/api/notes/resolve` | `{ session: string, cp: number, index: number, decision: string }` | `ParsedSession` |
| GET | `/api/events` | | SSE |

Every POST calls the same function the CLI command calls (`docs/contracts/p2/backlog-cli.md`);
`by` is the git user of the repo. The server never writes ledger files directly.

## SSE

`text/event-stream`, events `session.changed { ulid }`, `backlog.changed { id }`,
`notes.changed {}`, `health.changed {}`, and a `ping` every 15 s. Emitted from a file watcher
over `.workledger/**` debounced at 100 ms; if the watcher fails, the server polls every 2 s and
emits the same events.

## Static assets

`GET /` and any non-`/api` path serve `packages/cli/dist/web/` (the built `apps/web`), with
`index.html` as the fallback for hash routing.
