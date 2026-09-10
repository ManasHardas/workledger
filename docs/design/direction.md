# Design direction (2026-09-10, operator: "make it look more like Linear ... I just want it to look good")

Designed in code, not in Figma. The Figma path (P7 Wave 1) stays available later; these tokens are
the source of truth until then. Every value below lives in `packages/tokens` and is consumed
through the Tailwind preset. No component hardcodes a colour, radius, or shadow.

## Shell

Three panes, in the Linear shape.

- **Left nav, 240 px, fixed, its own scroll.** Top: wordmark plus the project switcher (current
  project, keyboard-openable, filterable). Then the views for that project: Ledger, Next, Needs
  you, Jobs, Health, each with a 16 px icon and a right-aligned count where one exists. Then a
  "Folders with sessions" section listing workspaces with their hook state. Bottom: Add projects.
  Collapses below 900 px into a sheet behind a hamburger; below 640 px the nav is the sheet only.
- **Middle pane.** The working surface. Reading content (a session) sits in a 760 px column;
  lists and tables take the full width. A sticky header carries the title, the status chips, and
  the primary action, with a hairline border under it.
- **Right pane: a floating panel, never a full-height drawer.** 380 px wide, inset 12 px from the
  top, right, and bottom, radius 10, one shadow, its own scroll and its own header with a close
  control. Non-modal on desktop: the middle pane stays scrollable and clickable behind it, and
  the panel is what a second click replaces. Below 768 px it becomes a bottom sheet at 85 vh with
  a drag handle, modal, Escape and swipe-down to close. Focus moves into the panel on open and
  returns to the opener on close in both forms.

## Tokens

Dark first, light kept complete. Surfaces are near-black and separated by hairlines rather than
heavy borders: base `#0D0E10`, pane `#141517`, raised `#1A1B1F`, hairline `rgba(255,255,255,.07)`.
Text: primary `rgba(255,255,255,.92)`, secondary `.62`, tertiary `.42`. One accent hue for
selection, focus, and links only (`#6E79F5` dark / `#4F5BD5` light); status colours stay reserved
for status: amber for blocked, red for failed, green for verified, all at chip weight, never as a
whole-row fill. Radii 6 (control), 10 (panel). One shadow, on the floating panel only.

Type: the system UI stack. 13 px base, 12 px meta, 15 px section heading, 20 px page title;
line-height 1.45; tabular numerals for every count and duration. Monospace only for identifiers:
paths, commits, ids.

Density: 8 px grid. Row height 32 px in lists, 28 px in the nav. A list row shows a hover
background, a focus ring on keyboard focus, and a left accent bar when selected.

## Rules that outlive this document

1. A gist is prose; identifiers are monospace. Never mix the two weights in one line.
2. Chips carry state, not decoration: harness, status, kind. At most three per row.
3. Evidence is never inline. It lives in the right panel.
4. Every count is a link to the thing it counts.
5. Nothing in the middle pane may scroll horizontally at 375 px.
