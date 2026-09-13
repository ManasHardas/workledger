import type { Async } from "../../lib/use-async.js";
import type { ReviewViewId } from "./view.js";

/** How many of each view there is; `undefined` until the reads behind it are in. */
export type ReviewCounts = Record<ReviewViewId, number | undefined>;

/**
 * The toolbar's numbers: open blockers and questions, waiting proposals, and every decision and
 * discovery; All is what waits on a person — the answers owed and the proposals. A count whose
 * read is not in yet is left out rather than shown as zero.
 */
export function reviewCounts(
  open: Async<{ type: string }[]>,
  history: Async<{ type: string }[]>,
  proposals: number | undefined,
): ReviewCounts {
  const count = (result: Async<{ type: string }[]>, type: string) =>
    result.state === "ready" ? result.value.filter((note) => note.type === type).length : undefined;
  const blocker = count(open, "blocker");
  const question = count(open, "question");
  return {
    all: blocker === undefined || question === undefined || proposals === undefined ? undefined : blocker + question + proposals,
    blocker,
    question,
    proposal: proposals,
    decision: count(history, "decision"),
    discovery: count(history, "discovery"),
  };
}
