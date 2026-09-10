# P6 contracts — cardFS ledger documents and CLI (frozen 2026-09-09)

## Documents in the card instance's cardFS namespace

| Name | Content | Cap |
|---|---|---|
| `ledger.json` | `{ schema_version: 1, published_at, repo, parts: N, sessions: ParsedSession[], backlog: BacklogView[], identities: Identity[] }` | measured < 4.5 MB serialized (UTF-8 bytes of the JSON), leaving headroom under the SDK's 5 MB read ceiling |
| `ledger.2.json` … `ledger.N.json` | `{ part: k, sessions: [...], backlog: [...] }` continuation parts, split by whole records, newest sessions first | same |
| `edits.json` | `{ schema_version: 1, edits: [ { id: ULID, op, target: WL-id, args, by: { dome_user, name, email? }, at } ] }` append-only; `op` ∈ accept, discard, done, start, restore, edit, assign, rank, merge | < 1 MB; the card refuses new edits when over and shows "pull pending" |

Publishing writes the parts first and `ledger.json` last, so a reader that sees `parts: N` can rely
on the others existing. A reader that gets `undefined` for any part (the SDK's silent over-cap
behaviour) throws `LedgerPartMissing` and the card shows an error, never a shrunken ledger.

## `CardFSSource` semantics

- Reads all parts in parallel via `sdk.cardFS.read(name)`; merges; `capabilities = { write: sdk.canWrite,
  live: false, provenance: false }`.
- Writes append to `edits.json` (read, append, write) with optimistic in-memory application; `by.dome_user`
  from `sdk.user`, `name` from the identity map if present.
- `subscribe` returns a no-op unsubscribe. `brief()` returns the published brief text stored in
  `ledger.json` under `brief`.

## CLI

```
workledger publish --target cardfs [--instance <iuid>] [--repo <path>]
   renders .workledger/ into the documents above and uploads them with the Dome REST publish path the
   sibling cards use; instance from --instance, else config.card.instance; credentials from
   WORKLEDGER_CARD_KEY only (never config, never the index); exit 5 on upload failure
workledger pull --from cardfs [--instance <iuid>] [--dry-run]
   downloads edits.json, replays each edit through backlog-ops with `by` mapped by identities.yaml
   (dome_user → email; unmapped → { name: "<dome_user>", email: "" } and a stderr warning), then
   truncates edits.json on success; idempotent by edit id (applied ids recorded in the index)
scripts/mirror-card.mjs
   git subtree split --prefix apps/card, push to $CARD_MIRROR_REMOTE (refuses to run without it),
   never writes the remote into this repo's config
```

`config.yaml` gains `card: { instance: <iuid> | null, publish_on: manual | push }`.
