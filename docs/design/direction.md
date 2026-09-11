# Design direction (2026-09-11, operator: "lets make the ui pretty ... center it to look more like X interface ... Also match font and style from X")

Supersedes the Linear direction of 2026-09-10 (DL-22). **Provisional:** the operator said the
same day that X was meant as inspiration, not a template to copy wholesale, and that the design
will be revisited; treat this document as the current state, not a settled choice. Designed in code, not in Figma; these tokens
are the source of truth. Every value below lives in `packages/tokens` and is consumed through the
Tailwind preset. No component hardcodes a colour, radius, or shadow.

## Shell

X's shape: one centred group of three columns, with black on either side of it.

- **Left nav, 275 px, sticky, full height.** Top: the mark, monochrome, linking Home, and under
  it the project switcher (an avatar initial, the name in bold, a quiet second line). Then the
  views for the current project as pills: 26 px icon, 20 px label, the current one in bold with a
  heavier icon, a count after the label in grey where one exists. Then "Add projects" as the one
  big inverted pill. Below 900 px the nav is a sheet behind a hamburger.
- **Middle column, 600 px**, with a hairline down either side from 640 px. A sticky 48 px header,
  translucent over the content with a blur, carries the 20 px extrabold title and the health chip.
  Content is flat: sections and list items are separated by hairlines bled to both edges of the
  column, not boxed in cards. The session list reads as a timeline: author and harness on the first
  line, the goal as the body, the counts along the foot.
- **Right column, 350 px, from 1280 px, sticky.** The evidence panel docks at its top as a module
  (radius 16, hairline border, 17 px extrabold title, a round close control): X's "Today's News"
  slot. Under it, a one-line keyboard hint. Folders with sessions are listed on Home only, never in
  the shell (operator, 2026-09-11: "remove the folders with sessions box").
- **The panel without a right column.** From 768 to 1279 px it floats at the right edge, inset
  12 px, radius 16, the glow shadow, non-modal; the centred group moves left to make room. Below
  768 px it is a modal bottom sheet at 85 vh with a drag handle, Escape and swipe-down to close.
  Focus moves into the panel on open and back to the opener on close in every form.

## Tokens

Dark first, light kept complete, both X's. Dark: background `#000000`, text `#e7e9ea`, secondary
text `#8b9197`, tertiary `#7e848a` (both a step above X's `#71767b` so they clear AA on the hover
and selected surfaces), hairline `#2f3336`, hover and selected `#16181c`. Light: `#ffffff`,
`#0f1419`, `#536471`, hairline `#eff3f4`. One blue, `#1d9bf0`, for selection, focus and links
only; chips that need a colour take its tint. Status colours stay reserved for status: X's red,
yellow and green, at chip weight, never as a whole-row fill.

Shapes: every button, nav item and chip is a pill; modules and the panel are 16 px; rows inside a
list are 8 px. One shadow, X's soft glow, on things that float over the page only.

Type: X's own fallback stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
Arial`), which is SF Pro on a Mac. Chirp itself is X's licensed face and the app never fetches a
web font (design spec §14). Sizes are X's: 13 meta, 15 body, 17 module heading, 20 nav and page
title. Weights: 400 body, 700 names, the current view and buttons, 800 headings. Line height 20 px
on the body. Tabular numerals for every count and duration. Monospace only for identifiers: paths,
commits, ids.

Density: 8 px grid. List rows 44 px, nav pills 52 px. A list row shows a hover background, a focus
ring on keyboard focus, and a left accent bar when selected.

## Rules that outlive this document

1. A gist is prose; identifiers are monospace. Never mix the two weights in one line.
2. Chips carry state, not decoration: harness, status, kind. At most three per row.
3. Evidence is never inline. It lives in the right panel.
4. Every count is a link to the thing it counts.
5. Nothing in the middle column may scroll horizontally at 375 px.
6. Three radii only: a pill for anything you press, 16 px for a module, 8 px for a row.
