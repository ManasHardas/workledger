# Phase 7 — Design pass

**Status:** Frozen pending Wave 0 (lean mode). **Tag:** `p7-shipped`.

**Strategic context.** P2 and P6 ship a usable but default-styled UI on `packages/tokens`. P7 is
the visual pass the operator plans to drive from Figma through the Figma MCP server (design spec
§14.1): tokens become the single bridge, components get Code Connect mappings, and the web and card
targets get the mobile and PWA polish. This phase changes appearance and small interactions, not
data, contracts, or routes.

## Scope (one to two sessions)

1. **Token sync**: `packages/tokens/scripts/from-figma.mjs` that takes an exported Figma variables
   JSON (or the MCP `get_variable_defs` output saved to a file) and rewrites `tokens.json` for the
   default and `dome` themes; the Tailwind preset regenerates; a diff of changed tokens is printed.
2. **Component mapping**: one `*.figma.tsx` Code Connect file per shadcn primitive and per app
   component that has a Figma counterpart (button, input, badge, card, sheet, tabs, session card,
   backlog item, note card, health row), pointing at the Figma node ids the operator supplies.
3. **Screens**: apply the Figma designs to Ledger, Next, Needs you, Health, Jobs, and the card
   variants; every value through tokens; no new dependencies; light and dark verified.
4. **Mobile and PWA**: 375 px layouts for every view; touch targets ≥ 44 px; installable manifest
   with icons from the design; offline shell (service worker caches the app, never the data).
5. **Accessibility**: keyboard reachability for every interaction already listed; visible focus;
   `prefers-reduced-motion` respected; contrast checked against the tokens.

## Inputs the operator provides

Figma file with variables and screens; node ids for the components above. Until they exist, this
phase cannot start Wave 1; Wave 0 (the sync script and the Code Connect skeletons) can.

## Acceptance

- [ ] `from-figma.mjs` round-trips the current `tokens.json` unchanged from an export of the current values.
- [ ] Every component in the list has a Code Connect file that `figma connect` validates.
- [ ] Each screen matches its Figma frame at 375 px and 1280 px (screenshot pairs in the PR); no hardcoded values (grep gate from P2 stays green).
- [ ] Lighthouse PWA and accessibility checks pass on the built app served by `workledger serve`.

## Out of scope
New features, new routes, data changes.
