# .workledger

The ledger for this repo. It is the source of truth; `~/.workledger/index.sqlite` is only a
cache and can be rebuilt from these files.

- `config.yaml` — thresholds, brief budget and privacy knobs. See `workledger doctor`.
- `sessions/<ulid>.md` — one file per coding-agent session: frontmatter, Done, Notes.
- `backlog/WL-<ulid>.md` — one file per backlog item, with its history.

Agents never write these files directly; every write goes through `workledger checkpoint` or
the backlog commands, which validate and secret-scan first. Commit this directory.
