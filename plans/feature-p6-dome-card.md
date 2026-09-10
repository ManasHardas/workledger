# Phase 6 — Dome card

**Status:** Frozen pending Wave 0 (lean mode). **Tag:** `p6-shipped`.

**Strategic context.** The same UI must run as a card inside Dome (design spec §14.2, DL-17). A
card is a self-contained static bundle in an iframe, secure context, identity from
`dome-embedded-app-sdk` (`sdk.user`, `sdk.owner`, `sdk.canWrite`, `sdk.instanceIuid`), data through
cardFS (card-scoped documents, 5 MB read cap, user-scoped auth), no server, no external assets,
released only by pushing a `DomeHQ/*` repo's `release` branch through cards-ci. Reference
constraints and SDK usage: `~/Projects/dome_workspace/card-shopify_store` (`src/sdk/useCardSdk.ts`,
`vite.config.ts`, `manifest-card.json`) and the memory notes there on cardFS read ceilings,
secure context, and release mechanics.

## Scope (one to two sessions)

1. **`CardFSSource`** in `packages/api-client`: implements `LedgerSource` over chunked ledger
   documents (`ledger.json`, `ledger.2.json`, …, each measured under 5 MB, part count on the first);
   reads all parts in parallel and fails loudly on a missing part; writes backlog edits to an
   append-only `edits.json` (`{ id, op, args, by: { dome_user, name }, at }`), applied optimistically
   in memory; `capabilities: { write: canWrite, live: false, provenance: false }`; no `subscribe`.
2. **`workledger publish --target cardfs`**: renders `.workledger/` into the chunked documents and
   uploads them to a card instance (instance iuid and key from config or env; the key is never
   committed) through the Dome REST publish path the sibling cards use (`dome_intel/publish.py` is the
   reference; port the minimum). Run by a developer or CI on push to `main`.
3. **`workledger pull --from cardfs`**: downloads `edits.json`, replays each edit through
   `backlog-ops` with `by` mapped via `identities.yaml` (dome_user → email), then truncates the log.
4. **`apps/card`**: a Vite entry that imports the web app's screens, boots the SDK in exactly one
   file (`src/sdk.ts`), resolves `dome_user`, `canWrite`, and the instance iuid, selects
   `CardFSSource`, hides Now/Jobs/Health, renders the provenance panel as "on the developer's
   machine", uses hash routing for `openDeepLink`, bundles every asset (no CDN, no web fonts),
   and carries `manifest-card.json` plus the cards-ci `release-build.yml` copied from the BART card.
5. **`dome` theme** in `packages/tokens` sampled from the sibling cards' `styles.css`.
6. **Mirror**: `scripts/mirror-card.mjs` performs `git subtree split --prefix apps/card` and pushes to
   `DomeHQ/card-workledger` when `CARD_MIRROR_REMOTE` is set; the personal repo never carries Dome
   secrets or the Dome identity. The founder creates the DomeHQ repo and CI secrets.

## Contracts (direct commit)

`docs/contracts/p6/cardfs-ledger.md` (document layout, chunking rule, `edits.json` shape,
identity mapping), `docs/contracts/p6/cli.md` (`publish`, `pull`, `mirror`).

## Acceptance

- [ ] `pnpm -F card build` yields a self-contained bundle with zero off-origin URLs; loading it in the Dome desktop Local mode (localhost, secure by exemption) shows this repo's sessions and backlog from cardFS documents published by `publish --target cardfs`.
- [ ] With `canWrite`, accepting an item in the card appends to `edits.json`; `pull --from cardfs` on the developer machine turns it into a history entry with the mapped identity.
- [ ] A 7 MB ledger publishes as two parts and loads; a missing part shows an error, never a shrunken ledger.
- [ ] `scripts/mirror-card.mjs` produces a subtree with `manifest-card.json` and the workflow at its root; no Dome key appears in either repo (fixture scan stays clean).

## Out of scope
Live sessions in the card; two-way sync; Dome-side card definition and release (founder).
