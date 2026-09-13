# The Figma design system (2026-09-11)

The design system lives in Figma and is the source of design values; `packages/tokens` follows it.

**Two files, both in the operator's project `652379175`:**

| File | Key | Holds |
| --- | --- | --- |
| workledger — Design System | `O8nwIMP8e9zqqtOEJuCIyd` | variables, styles, Foundations, the seven component sets |
| workledger — Product Designs | `GlA5fi6UzX90dU4N0WmFnC` | the screens: Session `2:2`, Ledger `7:2`, Review `10:2`, Home `11:2` — all four built, and implemented in the app on 2026-09-12 |

The designs file carries its **own copy** of the colour and scale collections and the text styles,
with identical names and values, because variables do not cross files until the system file is
published as a team library. Publishing it collapses the duplication; until then a token change
must be made in both, and only the system file is the one `from-figma.mjs` reads.

## The screens

All four are built on real data — this repo's own ledger and the running daemon's repo list — not
placeholder content. Every screen is 1440 × 1040, dark mode, three columns: a 232 px nav, a reading
column capped at 820 px, and a 352 px panel.

- **Session** — the goal in the human's words, a recap of a few derived points over all the
  session's outcomes, what it left open, and a provenance panel carrying the exact record:
  checkpoint times, turns, triggers, transcript byte spans, commits, files and verified state.
- **Ledger** — sessions grouped by day, each row the goal with its status, span and counts, and a
  right panel showing the selected session's recap.
- **Review** (the frame's title still reads "Needs you"; the app says Review, per the P9 naming) — the two queues the current model already supports, and nothing it does not: open
  `blocker` and `question` notes awaiting an answer (the answer is recorded as a decision note on
  that session, which is what `resolveNote` already does), and the agent-proposed backlog awaiting
  accept or discard (`confirmed_by` is the trust tier). No review or verdict entity is implied.
- **Home** — every tracked project on the machine, active ones first with sessions, open items and
  what needs a human; quiet ones collapsed.

**Home earns its place by saying something the terminal does not.** On the operator's real data it
flags that `Projects` — the folder the repos sit in, not a project — holds 105 open items and 34
questions, more than every real project combined, because sessions run from a worktree or a sibling
directory are filed there; and that `splitfire` is tracked but has never run.

## The recap rule

**The recap is derived, never stored.** Outcomes already carry their evidence, so grouping them by
commit and checkpoint is mechanical — no new field, no model call, and the brief stays
deterministic.

Built with Linear as the primary inspiration (density with air, quiet chrome, one accent used
sparingly, keyboard-first, fast small motion). The accent hue, the status colours and the
vocabulary are workledger's own — see `direction.md` and DL-22.

## The naming contract — read this before adding a variable

`packages/tokens/scripts/from-figma.mjs` **exits 1 without writing** when a Figma variable has no
counterpart in `tokens.json`. So every variable is named exactly as its token path:

| Figma variable      | Token path            | CSS custom property     |
| ------------------- | --------------------- | ----------------------- |
| `color/background`  | `color.<mode>.background` | `--wl-color-background` |
| `spacing/4`         | `spacing.4`           | `--wl-spacing-4`        |
| `radius/md`         | `radius.md`           | `--wl-radius-md`        |
| `type/size/base`    | `type.size.base`      | `--wl-font-size-base`   |
| `type/leading/body` | `type.leading.body`   | `--wl-leading-body`     |

There is deliberately **no primitives layer** (no `green/500` aliased by semantics): a primitives
variable has no token counterpart, so it would stop every sync. Two collections:

- **`workledger`** — 30 colour variables, modes `Light` and `Dark` (the script maps any mode name
  matching `/dark|night/i` to the dark group).
- **`workledger scale`** — 33 float variables in one `Value` mode: spacing, radius, type sizes,
  line heights.

**Not in Figma, on purpose:** `type/family/*` (a `FONT_FAMILY` variable holding a CSS stack cannot
bind to text in Figma), `type/tracking/*` (letter-spacing lives on the text styles, not in a
variable) and `shadow/panel` (Figma variables cannot hold a shadow recipe). Both stay
hand-maintained in `tokens.json`; the shadow exists in Figma as the effect style `shadow/panel`,
whose colour is bound to `color/glow` so it themes itself.

## Syncing Figma → the repo

Export the variables (the MCP `get_variable_defs` output, or a `{name: value}` map per mode), then:

```
node packages/tokens/scripts/from-figma.mjs export-light.json --mode light --dry-run
node packages/tokens/scripts/from-figma.mjs export-dark.json  --mode dark
node packages/tokens/scripts/from-figma.mjs export-scale.json --mode light
```

Always dry-run first: the output is the exact token diff. The script regenerates `tokens.css` and
`tailwind.preset.js` afterwards, so the app can never be a sync behind.

**Known artefact:** `radius/full` round-trips as `624.9375rem` (Figma stores 9999 px and the script
converts px → rem). Equivalent in CSS — any radius past half the box is a pill — but rewrite it to
`9999rem` by hand if the file's tidiness matters.

## What is in the design-system file

- **Cover** — the naming contract, the two modes, the sync command.
- **Foundations** — colour swatches in Light and Dark columns (each pinned to its mode), the type
  specimens with their real specs, the 4 px spacing rhythm, the layout constants, the radii.
- **Components** — one page each: Button (24 variants), Badge (12), Input (8), List row (8),
  Card (4), Panel (3 forms), Nav item (6). Every fill, stroke, padding and radius is bound to a
  variable: the last audit found zero unbound paints and zero default layer names.

Still missing from the system file: an icon set (Nav item carries a placeholder slot — the app
draws its own line icons in that 16 px box, operator decision 2026-09-12), Code Connect mappings,
and the Dome theme. The screens are no longer outstanding — they live in the designs
file, listed above.

## Gotchas learned building it

- `figma.createAutoLayout()` frames carry a **default white fill** — clear it with `fills = []` on
  every layout wrapper, or Dark mode paints white slabs.
- `resize()` **resets sizing modes to FIXED**, so call it before setting `layoutSizing*`, or long
  labels overflow their background.
- A `TEXT` component property on a component set has **one shared default across every variant**,
  so it flattens per-variant sample copy. Use it only where every variant says the same word.
- `componentPropertyReferences = { characters: null }` is rejected; delete the property instead,
  which detaches every variant's reference.
