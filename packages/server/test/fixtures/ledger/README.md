# Fixture ledger

A frozen copy of the *shape* of a real `.workledger/`, written by hand to the same schema the CLI
emits. The server tests read this instead of `<repo>/.workledger` so that dogfooding — which adds a
session file to this repo every session (CLAUDE.md, DL-14) — cannot turn `main` red.

Nothing here is personal: the author is the `Ada Lovelace` / `<redacted:email>` identity the
`packages/core` and `packages/cli` fixtures already use, and the ULIDs are hand-typed.

Contents, and what each piece is here to exercise:

- `config.yaml` — the same keys `workledger init` writes.
- `sessions/01JQ8ZK4T000000000000000S1.md` — ended, two checkpoints, one note of every type
  (`discovery`, `decision`, `blocker`, `question`), a `## Done` line with files and a `verified`
  stamp, and a `## Remaining` line pointing at a backlog item.
- `sessions/01JQ8ZK4T000000000000000S2.md` — ended, one checkpoint, two notes, and a frontmatter
  `resolved:` entry naming the second of them, so the resolved-note projection has a case that
  does not depend on anything a test appends.
- `backlog/WL-01JQ8ZK4T00000000000000B1.md` — `proposed`, so the E2E has an item to accept.
- `backlog/WL-01JQ8ZK4T00000000000000B2.md` — `accepted`, with a human `confirmed_by` and a
  two-entry history.

When a schema changes, regenerate by hand and keep the counts derived in the tests, never pinned.
