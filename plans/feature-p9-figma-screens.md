# P9 follow-up — the four screens, built from their Figma frames

> **For agentic workers:** execute task by task (superpowers:subagent-driven-development or
> executing-plans). Steps use `- [ ]`. Every measurement below is copied from
> `get_design_context` on the frame named; when a number here and the frame disagree, the frame
> wins and this file is wrong — re-read the frame with the Figma desktop MCP.

**Goal:** the running app matches the Figma *Product Designs* file (`GlA5fi6UzX90dU4N0WmFnC`)
screen for screen at 1440 × 1040 in dark mode: Home (`11:2`), Ledger (`7:2`), Session (`2:2`),
Review (`10:2`).

**Why this exists:** P9 synced the Figma *variables* (colour, type size, radius) but never rebuilt a
screen from its frame, so the app kept PR #143's X-shaped shell — centred 275/600/350 group, 20 px
pill nav, "Add projects" pill — with Linear colours on top. See the 2026-09-12 diagnosis in this
session's ledger.

**Architecture:** the shell becomes Figma's three full-width columns (232 px nav | flexible reading
column | 352 px right column). The shell no longer draws a page header: each view renders a
`PageHeader` and a `PageBody` so the header copy, body padding and body max-width are the frame's.
The right column holds a view-owned `Aside` module (always visible from 1280 px) above any docked
`Panel`. Shared presentational pieces (chip, button sizes, card, module, section head, stat) live in
`components/ui` so the four screens cannot drift.

**Tech stack:** React 19, Tailwind v4 over the `@workledger/tokens` preset, Radix dialog, Vitest +
Testing Library, Playwright for the screenshot pass.

## Operator decisions (2026-09-12, this session)

1. **Extras stay, below, in the same style.** Each screen matches its frame at the top. What the
   frame omits stays reachable *below* the designed content, restyled with the same components:
   Home — Running, Folders with sessions (Install hooks), Add projects, the backfill banner; Session
   — Notes (human + For agents), Memory, Unparsed, Repair, transcript excerpts; Ledger — Since
   filter, Repair; Review — the Accepted / In progress / Done / Discarded backlog groups with
   reorder, edit, merge, assign.
2. **Nav icons:** the app's real line icons, at Figma's size — 16 px box, 1.25 px stroke, `primary`
   when current, `subtle-foreground` otherwise. Not the placeholder squares.
3. **Review's page title is "Review"** (P9 naming), not the frame's "Needs you". Everything else on
   that screen is the frame.
4. **Recap points have no grey summary line.** Title (the newest outcome's gist) and the mono
   evidence line only.

## Global constraints

- Node ≥ 22 + pnpm ≥ 10 on the host; no Docker. Every test or drive uses
  `WORKLEDGER_HOME=$(mktemp -d)/home`; never the real `~/.workledger`; only the orchestrator restarts
  the 7419 daemon, from the main checkout.
- Values through tokens: colours, radii, font sizes, line heights, tracking and families are
  `@workledger/tokens` utilities. Spacing uses Tailwind v4's 0.25 rem steps (`px-3.5` = 14 px,
  `py-2.75` = 11 px, `gap-0.75` = 3 px); no `[…px]` arbitrary values, no hex.
- No font is fetched at runtime (design spec §14): Inter and Roboto Mono are bundled with
  `@fontsource-variable/*`; the CLI bundle stays under its 1024 KiB web-asset cap.
- Dark is the frame; light mode keeps working through the same tokens.
- Nothing is invented: every number and string shown is derived from the ledger or the daemon; where
  the frame shows copy the data cannot back, the plan names the substitute.
- `j`/`k`, `Enter`, `a`, `x` (armed twice), `alt+↑/↓`, `/`, `?` keep working; old hashes keep parsing.
- One PR, one reviewer (Clause #12). Verified with `pnpm -F web test`, `tsc`, `eslint`, `vite build`,
  `pnpm build`, and a screenshot pair per screen at 1440 × 1040 against the frame.

## The type ramp (Figma text styles → classes)

Letter-spacing is new: add `type.tracking.body = -0.006em` and `type.tracking.title = -0.012em` to
`tokens.json` and a `letterSpacing` scale to `build-preset.mjs` (`tracking-body`, `tracking-title`).

| Figma style | Size / line / weight / tracking | Classes |
| --- | --- | --- |
| Title/Page | 20 / 26 / 600 / −1.2 % | `text-xl leading-title font-semibold tracking-title` |
| Title/Section | 15 / 20 / 600 / −1.2 % | `text-lg leading-body font-semibold tracking-title` |
| Body/Strong | 13 / 20 / 600 / −0.6 % | `text-base leading-body font-semibold tracking-body` |
| Body/Medium | 13 / 20 / 500 / −0.6 % | `text-base leading-body font-medium tracking-body` |
| Body/Regular | 13 / 20 / 400 / −0.6 % | `text-base leading-body tracking-body` |
| Meta/Strong | 12 / 16 / 500 / 0 | `text-xs leading-tight font-medium` |
| Meta | 12 / 16 / 400 / 0 | `text-xs leading-tight` |
| Mono/Meta | Roboto Mono 12 / 16 / 400 | `font-mono text-xs leading-tight` |

`type.family.mono` becomes `"Roboto Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas,
"Liberation Mono", monospace` and `type.family.sans` leads with `"Inter Variable"` (the name the
fontsource-variable face registers — verify in `node_modules/@fontsource-variable/inter/wght.css`).

## Shared components (all frames)

| Piece | Spec |
| --- | --- |
| **Chip** (`Badge`) | h 22 (`h-5.5`), px 8, `rounded-full`, Meta/Strong, no border unless neutral. Variants: `destructive` bg destructive / fg destructive-foreground (crashed, blocker); `warning` bg warning / fg warning-foreground (check this, folder); `success` bg success / fg success-foreground (ok, tests-passed); `question` bg accent / fg accent-foreground; `neutral` bg muted, 1 px border, fg muted-foreground (ended, claude-code). Open status → `question` look (accent). |
| **Button** | h 28 (`h-7`), px 12, `rounded-lg`, Meta/Strong. `primary`: bg primary / fg primary-foreground. `danger-outline`: 1 px destructive border, destructive text, transparent. Arming keeps the existing two-step (`useArm`). |
| **Card** (reading column) | `rounded-lg border border-hairline bg-card`; selected: `border-primary bg-selected`. Padding per use below. |
| **Module** (right column) | `rounded-xl border border-hairline bg-card overflow-hidden`, full width of the 336 px slot. Head: px 16, pt 14, pb 12, gap 6 (4 on Provenance). Section: `border-t border-hairline px-4 py-3 flex flex-col gap-1` with a Meta/Strong muted-foreground label and a Body/Regular foreground value. Foot: `border-t px-4 pt-3 pb-3.5 flex gap-2 items-center`, Body/Medium primary link + Meta subtle aside. |
| **Section head** | `flex gap-2 items-center`: Title/Section foreground (flex-1) + Meta subtle-foreground aside (nowrap). Section = `flex flex-col gap-2.5`. |
| **PageHeader** | `h-13 border-b border-hairline px-8 flex items-center gap-3 sticky top-0 bg-background z-20`: Title/Page (flex-1, truncate) + Meta subtle aside. Session variant: Body/Regular muted "← Ledger" link + Body/Medium foreground repo name. |
| **PageBody** | `px-8 pb-10 flex flex-col w-full`, `max-w` + `pt` + `gap` per screen: Home 820/22/26, Ledger 820/20/24, Review 820/22/26, Session 780/28/28. Add spacing tokens `reading = 51.25rem` (820) and `reading-narrow = 48.75rem` (780). |

## Shell (every frame, nav node e.g. `11:3`)

- Page: `flex min-h-screen bg-background`, full width, **not centred**.
- **Nav** 232 px (`w-nav`, token stays 14.5rem), `border-r border-hairline`, `px-3 py-4 flex flex-col
  gap-0.5`, sticky full height.
  - Project row: `px-2 py-1.5 rounded-lg flex gap-2 items-center`; mark 20 × 20 `rounded-md`
    (6 px) `bg-primary`; name Body/Strong foreground; on All projects a `▾` Meta subtle-foreground
    after a flex-1 name. The whole row is the `ProjectSwitcher` trigger (keeps its dialog; the
    dialog gains an "Add projects" link, decision 1).
  - 12 px spacer (`h-3`).
  - Item: `h-7 px-2 rounded-lg flex gap-2.5 items-center`. Icon 16 px (decision 2). Label flex-1:
    current Body/Medium foreground, others Body/Regular muted-foreground. Count Meta
    subtle-foreground. Current row `bg-selected`; hover `bg-muted`.
  - Separator before Jobs: `h-px bg-hairline w-full` (inside the 2 px gap flow, no margin).
  - Repo route order: Home, Ledger (count sessions7d), Sessions, Review (count openNotes +
    openBacklog), —, Jobs, Health. Machine route: Home, Review, —, Jobs (unchanged set).
- **Reading column**: `flex-1 min-w-0 flex flex-col`; children supply `PageHeader` + `PageBody`.
- **Right column** from 1280 px: `w-88` (352) `shrink-0 pr-4 py-4`, sticky, `flex flex-col gap-4
  overflow-y-auto max-h-screen`; contents: the view's `Aside` slot, then `PanelSlot`. No keyboard hint.
- Below 1280: no right column; `Panel` floats as today; a view's `Aside` renders per its
  `narrow` prop — `inline` (appended to the reading column) or `none`.
- Below 900: nav in a left `Sheet`; a 52 px top bar with the hamburger precedes the view's header.
- `Panel` (docked/floating/sheet) restyled as a Module: `rounded-xl bg-card`, title Title/Section,
  description Meta subtle, close control stays (it is not a Figma module, it is an opened item).

## Home (`11:2`)

**Header:** "Home" · `{repos} projects · {Σ sessions7d} sessions this week · {Σ need you} waiting on you`.

**Body** (820 / pt 22 / gap 26):

1. **Flag** — only when a tracked repo contains others (`isContainerOf > 0`) *and* its open items
   exceed the sum of every other repo's. Card: `bg-card border border-warning rounded-lg px-3.5 py-3
   flex gap-3 items-start`; chip `warning` "check this"; text column gap 0.75: Body/Strong
   "`{name}` holds `{openBacklog}` open items and `{needYou}` questions — more than every real
   project combined"; Body/Regular muted "It is the folder your repos sit in, not a project.
   Sessions run from a worktree or a sibling directory are filed here instead of the repo they were
   about."
2. **Active this week** — repos with `sessions7d > 0`, newest `lastHookAt` first. Head aside
   `{active} of {total}`. Card: `rounded-lg border px-3.5 py-2.75 flex gap-3 items-center`
   (selected: `border-primary bg-selected`, else `border-hairline bg-card`); text column flex-1 gap
   0.75: name Body/Strong, path Mono/Meta subtle with `$HOME` shown as `~` (derive home from the
   longest common `/Users/<name>` prefix of repo paths; fall back to the absolute path); three
   stats `w-18 flex flex-col items-end gap-px`: value Body/Medium (sessions foreground, open
   muted-foreground, need you accent-foreground), label Meta subtle ("sessions", "open", "need
   you"); then relative time Meta subtle.
3. **Quiet** — repos with `sessions7d === 0`. Head aside `{n} projects · nothing this week`. First
   three rows `px-3.5 py-2 flex gap-3 items-center`: name Body/Regular muted flex-1; `{open} open`,
   `{needYou} need you`, time — Meta subtle. Then `pl-3.5 pt-1` Body/Regular primary button
   "Show {rest} more" + ", including `{name}`, which has never run" when a hidden repo has
   `lastHookAt === null` (first such). Expanding shows all and the button reads "Show fewer".

**Aside — Selected project** (default: the first active repo, else the first repo). Head: name
Title/Section; `remote.webBase` without scheme in Mono/Meta subtle (omitted when no remote); chips
health (`ok` success, `warn` warning, `broken` destructive) + one neutral chip per harness. Sections
(each read from `forRepo(id)`): "Last activity" → `{relative lastHookAt} · checkpoint {n of newest
session's last checkpoint}`; "This week" → `{sessions} sessions · {Σ done} outcomes` from
`listSessions({ since: 7 days })`; "Waiting on you" → `{blocker+question open notes} answers ·
{proposed backlog} proposed items`. Foot: "Open the ledger" → `#/r/<id>/ledger`; "copy brief"
button → `forRepo(id).brief()` to clipboard, reads "copied" for 2 s. Narrow: `none` (a card click
navigates to the ledger instead of selecting).

**Need you per repo** = open blocker+question notes from `listAllNotes`, grouped by `repo.id`.

**Relative time** (new `formatAgo` in `features/home/format.ts`): `just now` < 1 min; `{n} minute(s)
ago`; `{n} hour(s) ago`; `yesterday` for 1 calendar day; `{n} days ago`; `never` for null.

**Below (decision 1):** Running, Folders with sessions, and an "Add projects" outline link, each a
Section head + cards in the same style; the backfill banner stays above the flag.

**Interaction:** card = button; click/Enter selects; `j`/`k` move selection across active then
quiet rows; double-click or the foot link opens the ledger.

## Ledger (`7:2`)

**Header:** "Ledger" · `{n} sessions · {Σ done} outcomes · {Σ remaining} still open` over the
current result set.

**Body** (820 / pt 20 / gap 24):

1. **Filters** `flex gap-2 items-center`: search `flex-1 h-8 px-3 rounded-md border border-input`
   placeholder "Search goals, outcomes and notes" (Body/Regular, placeholder subtle); three selects
   `w-32 h-8 px-3 rounded-md border border-input` label Body/Regular muted + `▾` Meta subtle: "Any
   author", "Any harness", "Any status". Since (decision 1) is a fourth select after the three, same
   style.
2. **Day groups** gap 24 between groups; group `flex flex-col gap-2.5`: head Meta/Strong subtle —
   `Today · 11 September` for today, otherwise `10 September` (UTC calendar days; year appended when
   not the current year).
3. **Session card** `rounded-lg border px-3.5 py-3 flex flex-col gap-2` (selected
   `border-primary bg-selected`): goal Body/Strong foreground, wraps (2 lines max, ellipsis); meta
   row `flex gap-2 items-center`: status chip; `{HH:MM – HH:MM} · {duration} · {n} checkpoints`
   Meta subtle flex-1 (end time only when `ended` or last checkpoint is the same UTC day as
   `started`; duration from started to ended, else to the last checkpoint, `1 h 34 m` / `4 m`);
   `{done} outcome(s)` Meta muted; `{remaining} open` Meta subtle.

**Aside — Selected session** (default: first card). Head: goal cut at the first `:` or ` — `
(whole goal when neither) in Title/Section; `{author name} · {harness} · {D Mon HH:MM} UTC` Meta
subtle. Section "What happened" (`px-4 py-3 gap-2`): up to four recap points `flex gap-2.5 py-1.5`:
6 px dot (`success` when tests-passed, `destructive` failed, `subtle-foreground` otherwise) then
Body/Regular gist + Mono/Meta subtle `cp 1–2 · 8f867ef → e2d4c27` (commits oldest → newest joined
with ` → `, `no commit` when none). Foot: "Open the session" → detail href; `{remaining} left open`.
Narrow: `none` (click navigates).

**Interaction:** click selects; `Enter` or double-click opens; `j`/`k` move the selection.
**Below:** Repair control for crashed / needs-repair sessions moves into the aside as a foot button
(wide) and stays under the card (narrow).

## Session (`2:2`)

**Header:** "← Ledger" (to `#/r/<id>/ledger`) + repo name.

**Body** (780 / pt 28 / gap 28):

1. **Goal** `flex flex-col gap-2.5`: goal Title/Page foreground (wraps); meta `flex gap-2
   items-center flex-wrap`: status chip, harness neutral chip, Meta subtle `{author} · {D Mon HH:MM –
   HH:MM} UTC · {duration} · {n} checkpoints` + `, {k} recorded after it ended` when checkpoints are
   stamped after `ended`.
2. **What happened** section gap 3.5; head aside `{n} outcomes, grouped by evidence`. Point card
   `rounded-lg border border-hairline bg-card p-3 flex gap-3.5 items-start`: 8 px dot (colours as
   above) then `flex-1 flex flex-col gap-1`: gist Body/Strong (a button opening the outcome) +
   Mono/Meta subtle `cp 1–2 · 8f867ef → e2d4c27 · 7 outcomes` (decision 4: no grey line). First
   four points; then Body/Regular primary "Show all {n} outcomes" expanding every point and listing
   each outcome gist (Body/Regular muted buttons) under its point.
3. **Left open** section: head Title/Section "Left open" only; rows `py-1.5 flex gap-2.5
   items-center`: text Body/Regular foreground flex-1; ref Mono/Meta subtle, first 12 characters +
   `…`.

**Aside — Provenance** (wide: docked module; narrow: `inline`). Head: "Provenance" Title/Section +
"Exactly what was done, and where it is recorded." Meta subtle. One row per checkpoint
`border-t px-4 py-2.5 flex flex-col gap-0.75 text-xs leading-tight`: top `flex gap-2`: `[cp n]`
mono accent-foreground; `D Mon HH:MM UTC` muted flex-1; commit of that checkpoint's outcomes (newest)
mono foreground, `—` mono subtle when none. Second line subtle: `{turns} turn(s) · {trigger} ·
transcript {from} – {to} B` (thousands separators). The row is a button toggling the existing
`ExcerptViewer` beneath it when `capabilities.provenance`. **Selected outcome** block (shown when an
outcome is opened) `bg-muted border-t px-4 pt-3.5 pb-4 flex flex-col gap-2.5`: "Selected outcome"
Meta/Strong subtle; gist Body/Strong; fields `gap-0.75` label Meta/Strong muted: Detail (Body/Regular),
Files (Mono/Meta foreground, one per line, links as today), Commit (Mono/Meta), Verified label +
chip in a row `gap-2`. On narrow widths an opened outcome uses the floating `Panel` as today.

**Below (decision 1):** Notes (human notes, then For agents), Memory, Unparsed, and the Repair
control, as flat sections with Section heads.

## Review (`10:2`)

**Header:** "Review" (decision 3) · `j k to move · a accept · x discard · enter to answer`.

**Body** (820 / pt 22 / gap 26):

1. **Waiting on an answer** head aside `{n} open`. Card `rounded-lg border px-3.5 py-3 flex flex-col
   gap-2` (selected `border-primary bg-selected`): top `flex gap-2 items-start`: chip (blocker
   destructive / question `question`) + Body/Regular text; foot `flex gap-2 items-center`: Mono/Meta
   subtle `{session first 11} · cp {n} · {D Mon}` flex-1 + primary "Answer" button (selects the card
   and focuses the answer field).
2. **Proposed by agents** head aside `{proposed} waiting · {accepted} accepted`. Card `rounded-lg
   border border-hairline bg-card px-3.5 py-2.5 flex gap-3 items-center`: text column flex-1 gap 0.75:
   title Body/Regular + Mono/Meta subtle `{id first 14} · {session first 11} · cp {n}`; actions
   `flex gap-2`: primary "Accept", danger-outline "Discard" (armed twice).

**Aside — Selected** (default: first answer; narrow: floating `Panel` opened by Answer). Head
`gap-2`: chip + Title/Section text. Sections: "Raised in" → session goal; "Where" → Mono/Meta
`{full session ulid} · cp {n} · {D Mon YYYY}` (checkpoint date); "Why it stopped work" (blocker) /
"Why it is asked" (question) → `reason`, section omitted when absent. Answer block `px-4 pt-3 pb-3.5
gap-2`: "Your answer" label; textarea `rounded-md border border-input px-3 py-2.5` Body/Regular,
placeholder subtle; foot `flex gap-2 items-center`: Meta subtle "Recorded as a decision note on the
session" flex-1 + primary "Answer" (submits `resolveNote`). Read-only source: field and button
disabled with the existing notice.

**Below (decision 1):** the Accepted, In progress, Done and Discarded groups from `NextView`, with
Section heads and the backlog cards above; keyboard stays `NextView`'s.

**Machine-wide `#/review`:** the same answer cards with the repo name appended to the foot line; no
proposals section (there is no machine-wide backlog read).

Jobs, Health, Onboarding: adopt `PageHeader` / `PageBody` (820 / pt 22 / gap 26) and the restyled
chips and buttons; their content is otherwise unchanged.

## Tasks

### Task 1 — Tokens, fonts, primitives
Files: `packages/tokens/tokens.json`, `scripts/build-preset.mjs`, generated `tokens.css` +
`tailwind.preset.js`; `apps/web/package.json` (+ `@fontsource-variable/roboto-mono`),
`src/index.css`; `components/ui/badge.tsx`, `button.tsx`, `card.tsx`; new
`components/ui/page.tsx` (`PageHeader`, `PageBody`, `SectionHead`), `components/ui/module.tsx`
(`Module`, `ModuleHead`, `ModuleSection`, `ModuleFoot`), `components/aside.tsx` (`AsideHost`,
`AsideSlot`, `Aside`); `features/ledger/format.ts` (`formatClock`, `formatDay`, `formatDuration`,
`formatSpan`), `features/home/format.ts` (`formatAgo`); matching `*.figma.tsx` variant lists.
- [ ] Failing unit tests for `formatAgo`, `formatDuration`, `formatSpan`, day labels (UTC).
- [ ] Implement; tokens build; `pnpm -F @workledger/tokens build` then `pnpm -F @workledger/tokens test`.
- [ ] Component tests: Badge variants render the tokens named above; Aside portals into the slot when
  present and honours `narrow`.
- [ ] Commit `[P9][Frontend] Figma type ramp, Roboto Mono, chips, buttons, modules, page frame`.

### Task 2 — Shell
Files: `components/app-shell.tsx`, `components/project-switcher.tsx`, `components/ui/panel.tsx`,
`lib/media.ts` (comments), `test/shell.test.tsx`, `test/narrow.test.tsx`, `test/panel.test.tsx`.
- [ ] Update shell tests to the new structure (no header title from the shell, nav order, separator,
  counts, project row trigger, right column only ≥1280, Add projects inside the switcher dialog).
- [ ] Implement the Shell spec; run `pnpm -F web test`.
- [ ] Commit `[P9][Frontend] The shell is Figma's three columns`.

### Task 3 — Home · Task 4 — Ledger · Task 5 — Session · Task 6 — Review
Each: update that screen's tests first (`home`, `ledger` + `recap`, `ledger`/`excerpt`,
`next` + `needs-health` + `machine`), implement its section above, run `pnpm -F web test`, commit
`[P9][Frontend] <Screen> is the Figma frame`. Independent of each other once Tasks 1–2 land.

### Task 7 — Verify, document, ship
- [ ] `pnpm -F web exec tsc --noEmit`, `pnpm lint`, `pnpm -F web test`, `pnpm build`.
- [ ] Screenshot pairs at 1440 × 1040 dark for all four routes against the Figma screenshots of
  `11:2`, `7:2`, `2:2`, `10:2`; fix every visible difference that is not data.
- [ ] Rewrite `docs/design/direction.md` §Shell and §Tokens to this layout; update
  `docs/design/figma.md` (Review built; screens implemented) and the tokens descriptions that still
  say X.
- [ ] One PR, one reviewer, merge on green; rebuild main; restart the 7419 daemon.
