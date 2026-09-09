# P2 data flow

## Reads

`serve` starts, resolves the repo root, opens the index (read only), and builds an in-memory
read model by parsing `.workledger/sessions/*.md` and `backlog/*.md` with `parseSessionText` and
`parseItem`. A file watcher (chokidar or `fs.watch` with a polling fallback) over `.workledger/**`
invalidates the changed file, re-parses it, and emits the matching SSE event after a 100 ms
debounce. `GET` endpoints serve from the read model; `/api/brief` calls the same `readBriefInput`
+ `buildBrief` as the CLI, without `now`.

## Writes

UI → `LocalServerSource` → `POST /api/backlog/:id/<op>` → `backlog-ops.ts` function (the same
one the CLI runs) → atomic file write → watcher → read model refresh → SSE `backlog.changed`.
The response returns the fresh `BacklogView` so the UI does not wait for the event. Concurrent
edits to one item from two tabs: last write wins at the file level; both history entries
survive only if the second reads after the first wrote (the op re-reads the file immediately
before writing, under a per-id in-process mutex in the server).

## Notes resolution

`resolveNote` appends a `decision` note line to the session body (`[cp n] by human: …; reason:
resolves <type> #<index>`) and records `{cp, index}` under a `resolved` list in the session
frontmatter (additive field; the P1 schema allows additional properties). Open notes = notes of
type blocker/question not in `resolved`.

## Identity

`by` for every write is the repo's git `user.name`/`user.email`; the server refuses writes with
409 if either is empty. No accounts, no sessions, loopback only.

## Assets and packaging

`apps/web` builds with Vite into `packages/cli/dist/web/`; `scripts/bundle-cli.mjs` copies it;
`check-pack.mjs` allows `dist/web/**` in the tarball; the published dependency set stays
`{ better-sqlite3 }`. Size cap 1 MB gzipped, checked in CI.

## Budgets

Read-model build for 500 sessions and 500 items under 500 ms at startup; SSE event within
2 s of a file change; POST round trip under 100 ms on the reference machine.
