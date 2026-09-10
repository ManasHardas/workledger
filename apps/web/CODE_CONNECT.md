# Code Connect

Figma Code Connect makes Dev Mode show *this repo's* component call for a selected node instead of
a generated approximation. Design spec §14.1 asks for one mapping per primitive and per app
component that has a Figma counterpart; the `*.figma.tsx` files next to those components are those
mappings, checked in as skeletons because the Figma file does not exist yet.

## What is here

| File | Figma node stands for |
|---|---|
| `src/components/ui/button.figma.tsx` | Button |
| `src/components/ui/input.figma.tsx` | Input |
| `src/components/ui/badge.figma.tsx` | Badge |
| `src/components/ui/card.figma.tsx` | Card |
| `src/components/ui/sheet.figma.tsx` | Sheet (maps `SheetContent`) |
| `src/components/ui/tabs.figma.tsx` | Tabs (maps `TabsList`) |
| `src/features/ledger/session-card.figma.tsx` | Session card |
| `src/features/next/backlog-item.figma.tsx` | Backlog item |
| `src/features/needs/note-card.figma.tsx` | "Needs you" note card |
| `src/features/health/health-row.figma.tsx` | Health row |

`test/code-connect.test.ts` is the standing check on them: it loads every file, asserts each one
registers exactly one connection at a well-formed node URL in a single Figma file, and calls each
`example` to prove the snippet it publishes actually builds an element.

## Filling in the placeholders

Every URL reads

```
https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_BUTTON
```

Two substitutions, both from Figma:

1. **`FIGMA_FILE_KEY`** — the segment after `/design/` in the design file's URL. The same key in
   every file; the schema test fails if two files disagree.
2. **`NODE_ID_*`** — select the component in Figma, *Copy link to selection*, and take the
   `node-id` query parameter (it looks like `2814-1057`). One per file.

Then check the mapping itself: `props` must name Figma properties as they are spelled on the
canvas, and every value a variant maps to must be a value the component actually accepts. A variant
with no code counterpart publishes a snippet that does not compile.

## Publishing

Code Connect is **not** a dependency of this repo. The CLI pulls `ts-morph`, its own pinned
`typescript`, `esbuild-wasm`, `jsdom`, `prettier` and `undici` — a second toolchain in the lockfile,
installed on every CI run, for files nothing in the build imports. So the files import a small
local stand-in instead, and the operator reaches the real package with `npx` at publish time:

```bash
# From apps/web, with a Figma personal access token that has Code Connect write scope.
export FIGMA_ACCESS_TOKEN=...
npx --yes @figma/code-connect@latest connect parse   # dry run: prints what would be published
npx --yes @figma/code-connect@latest connect publish
```

`connect parse` (and `publish`) resolve the `figma` import for real, so before running either,
switch each file's first import over:

```diff
-import figma from "../../lib/code-connect.js";
+import figma from "@figma/code-connect";
```

`src/lib/code-connect.ts` mirrors the real API exactly — `connect`, `string`, `enum`, `boolean`,
`children`, `textContent` — so that one line is the whole change. Add whichever helpers the real
mappings need (`figma.instance`, `figma.className`, …) to the stand-in at the same time, or the
schema test stops covering the files.

## The two example-only files

`note-card.figma.tsx` and `health-row.figma.tsx` use Code Connect's component-less form,
`figma.connect(url, { props, example })`, because `NoteCard` and `Row` are internal to
`needs-panel.tsx` and `health-report.tsx`. The example shows the composition the node stands for,
which is publishable as is. If those components are exported later, pass the component as the first
argument and shorten the example to a single call — nothing else changes.
