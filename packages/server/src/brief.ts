/**
 * `GET /api/brief` — "same bytes as `workledger brief`" (api.md §Endpoints).
 *
 * The brief *builder* is shared: `buildBrief` lives in `@workledger/core/brief` and is a total
 * function of its arguments that never reads a clock, which is what makes both callers
 * deterministic over an unchanged ledger. What is **not** shared is the twenty-line ledger
 * reader in front of it (`readBriefInput` in `packages/cli/src/commands/brief.ts`): that
 * function touches the filesystem, so it cannot move into `packages/core` — CLAUDE.md keeps core
 * pure — and `packages/cli` publishes a bundled `dist/main.js` with a `bin` and no exports map,
 * so there is nothing to import from it either. It is restated here against this package's own
 * read model instead, and `test/read.test.ts` pins the two together: it reads the ledger off
 * disk the way `readBriefInput` does and asserts this route's bytes are `buildBrief`'s over it.
 */
import { buildBrief } from "@workledger/core/brief";
import { doneBriefText } from "@workledger/core/render/session";
import { BriefConfig } from "@workledger/core/schema";
import { parse } from "yaml";
import type { BriefInput } from "@workledger/core/brief";

import { readTextFile } from "./paths.js";
import type { LedgerPaths } from "./paths.js";
import type { ReadModel } from "./read-model.js";

/** `brief.max_tokens` from `.workledger/config.yaml`, or the schema default when unreadable. */
export function briefMaxTokens(paths: LedgerPaths): number {
  const text = readTextFile(paths.config);
  if (text === undefined) return BriefConfig.parse({}).max_tokens;
  try {
    const doc = parse(text) as Record<string, unknown> | null;
    return BriefConfig.parse(doc?.["brief"] ?? {}).max_tokens;
  } catch {
    return BriefConfig.parse({}).max_tokens;
  }
}

/**
 * The read model in the shape `buildBrief` consumes. `buildBrief` does its own filtering,
 * ordering and capping, so every parsed file is handed over unfiltered.
 */
export function briefInput(model: ReadModel): BriefInput {
  const backlog: BriefInput["backlog"] = model
    .listBacklog({ status: "proposed,accepted,in_progress,done,discarded", limit: Number.MAX_SAFE_INTEGER })
    .map((item) => ({ frontmatter: item.frontmatter }));

  const sessions: BriefInput["sessions"] = model
    .listSessions({ limit: Number.MAX_SAFE_INTEGER })
    .map((session) => ({
      frontmatter: session.frontmatter,
      done: session.done.map(doneBriefText),
      notes: session.notes.map((note) => ({ type: note.type, text: note.text, cp: note.cp })),
    }));

  return { backlog, sessions };
}

/** The brief text. No `now`: `workledger brief` is contracted to be byte-identical across runs. */
export function renderBrief(model: ReadModel, maxTokens: number): string {
  return buildBrief(briefInput(model), { maxTokens });
}
