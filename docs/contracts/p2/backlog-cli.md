# Backlog and note commands (frozen 2026-09-09)

Replaces P1's `backlog` stub. Every subcommand is a pure function in
`packages/cli/src/backlog-ops.ts` (`acceptItem`, `discardItem`, `doneItem`, `editItem`,
`assignItem`, `rankItem`, `mergeItems`, `resolveNote`) used by both the CLI and the server. `by`
is `{ name, email }` from the repo's git config (refuse with exit 1 if empty). Every op appends a
`history` entry per the frozen `HistoryEntry` schema, sets `updated`, and writes atomically.

```
workledger backlog accept  <WL-id>                         # proposed|in_progress → accepted; sets confirmed_by
workledger backlog discard <WL-id>                         # any → discarded
workledger backlog done    <WL-id>                         # any → done; done_by stays null (human closure)
workledger backlog edit    <WL-id> [--title T] [--body B] [--priority p1|p2|p3|none] [--area a,b]
workledger backlog assign  <WL-id> [--owner "Name <email>" | --none]
workledger backlog rank    <WL-id> <n>
workledger backlog merge   <WL-id> --into <WL-id>          # source → discarded (history op: merge, diff "merged into <id>");
                                                           # target body += "\n\nMerged from <source id>: <source title>\n<source body>"; target history op: merge
workledger backlog show    <WL-id> [--json]
workledger backlog list    [--status s1,s2] [--json]
workledger note resolve    <session-ulid> <cp> <index> --decision "text"
                                                           # appends a decision note "[cp n] by human: <text>; reason: resolves <type> #<index>"
                                                           # to the session and marks the note resolved via a `resolved: [ {cp, index} ]` frontmatter list
```

Exit codes: 0 ok · 1 usage/validation (unknown id, illegal transition) · 4 not an enabled repo.
State machine for `status`: `proposed → accepted|discarded|done`, `accepted → in_progress|done|discarded`,
`in_progress → done|discarded|accepted`, `done → accepted` (reopen), `discarded → proposed` (restore).
Illegal transitions exit 1 with the allowed targets listed.
