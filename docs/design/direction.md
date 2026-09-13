# Design direction (2026-09-12: the app is the Figma Product Designs file)

**The Figma files are the source of design.** The screens are the four frames in *workledger —
Product Designs* (`GlA5fi6UzX90dU4N0WmFnC`): Home `11:2`, Ledger `7:2`, Session `2:2`, Review
`10:2`, each 1440 × 1040 in dark mode. The values are the variables and text styles of *workledger
— Design System* (`O8nwIMP8e9zqqtOEJuCIyd`), synced into `packages/tokens` by `from-figma.mjs`
(`docs/design/figma.md`). Linear is the inspiration behind both (density with air, quiet chrome,
one accent used sparingly); the green accent, the status colours and the vocabulary are
workledger's own (DL-22).

This supersedes the X direction of 2026-09-11, which the operator judged a clone. The build that
followed it synced the Figma colours but kept X's shell; `plans/feature-p9-figma-screens.md`
records why and is the measured spec the screens were rebuilt from. When this document and a
frame disagree, the frame wins — read it with the Figma MCP (`get_design_context`) rather than from
memory.

## Shell

Three columns, as the frames draw them at 1440 px. The nav is pinned to the left edge; the reading
column and the right column travel together at their frame widths (856 + 352 px) and centre in the
space the nav leaves, so a window wider than the frame gets even margins instead of a gap between
the text and its details (operator, 2026-09-13). The header's hairline runs edge to edge.

- **Nav, 232 px**, a hairline on its right, 12 px sides, 16 px top, rows 2 px apart. First the
  project row — a 20 px green mark, the project in Body/Strong, a ▾ on All projects — which opens
  the switcher (filter, the projects, and "Add projects"). A 12 px gap, then 28 px rows: a 16 px
  line icon (1.25 px stroke, green on the current row, grey elsewhere), the label (Body/Medium on
  the current row, Body/Regular muted elsewhere), a Meta count where one exists. The current row
  sits on the `selected` surface. Order: Home, Ledger, Sessions, Review, a hairline, Jobs, Health.
  Add projects is a row of the same shape pinned to the foot of the nav. Below 900 px the nav is a
  sheet behind a hamburger.
- **Reading column**, taking the rest. Each view draws its own 52 px header — Title/Page on the
  left, a Meta summary or keyboard hint on the right, a hairline under it — and its own body, 32 px
  from both edges, capped at 820 px (780 px on a session).
- **Right column, 352 px, from 1280 px**, 16 px of padding right, top and bottom. It holds the
  view's module (Selected project, Selected session, Provenance, Selected) and under it any panel a
  person opened. Below 1280 px a view either appends its module to the reading column (a session's
  provenance) or drops it and opens items directly (the selection summaries); an opened panel floats
  at the right edge from 768 to 1279 px and is a bottom sheet below 768 px.

## Components

- **Card** — the reading column's unit: 8 px corners, a hairline, the `card` surface, 14 px sides.
  Selected: the primary border on the `selected` surface. Sessions, recap points, projects,
  answers, proposals and every list row are cards, 10 px apart.
- **Module** — the right column's unit: 12 px corners, a hairline, the `card` surface; a head, then
  sections separated by hairlines, each a Meta/Strong label over a Body/Regular value; a foot with a
  green Body/Medium link.
- **Chip** — 22 px pill, Meta/Strong. Solid status fills (`destructive`, `warning`, `success`),
  the accent tint for open and question, and the neutral chip (muted fill, hairline) for labels such
  as `ended` or a harness.
- **Button** — 28 px, 8 px corners, Meta/Strong. Primary is the green fill; a destructive action is
  the red outline and arms before it runs.
- **Section head** — Title/Section on the left, a Meta aside on the right.

## Tokens

Colour, radius, spacing, type size and line height come from the Figma variables; tracking and the
two families are hand-maintained in `tokens.json` (Figma text styles carry them, not variables).

Type is Inter (bundled, `"Inter Variable"`) with Roboto Mono (bundled) for identifiers. The ramp:
Title/Page 20/26 semibold −1.2 %, Title/Section 15/20 semibold −1.2 %, Body 13/20 at 400, 500 and
600 −0.6 %, Meta 12/16 at 400 and 500, Mono/Meta 12/16. Text colours step foreground →
muted-foreground → subtle-foreground; the accent green is for the current view, selection, links
and the "need you" count.

## Rules that outlive this document

1. A gist is prose; identifiers are monospace. Never mix the two in one run of text.
2. Chips carry state, not decoration: harness, status, kind. At most three per row.
3. Evidence is never inline in the reading column. It lives in the right column.
4. Every number shown is derived from the ledger or the daemon; copy the data cannot back is
   replaced, never invented.
5. Nothing in the reading column may scroll horizontally at 375 px.
6. Radii: pills for chips, 6 px for inputs, 8 px for cards, buttons and nav rows, 12 px for modules.
