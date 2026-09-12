import { NeedsPanel } from "../features/needs/needs-panel.js";
import { NextView } from "../features/next/next-view.js";

/**
 * Review — everything waiting on a human, in one place (P9, operator: "Review is all the needs you
 * stuff").
 *
 * It merges what P2 split across two views: the open `blocker` and `question` notes an agent
 * raised, and the backlog those agents proposed. Both are the same act — a person judging what the
 * agents produced — and splitting them scattered one sitting across two screens.
 *
 * Answers come first. A blocker is work that has already stopped; a proposed backlog item is work
 * that has not started, so it can wait the length of a scroll.
 *
 * Neither half is new machinery: the answer is recorded as a decision note on the session it came
 * from (`resolveNote`), and accepting an item sets `confirmed_by`, which is the trust tier the
 * schema already carries. There is no verdict entity here, deliberately.
 */
export function ReviewView() {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="review-answers-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 id="review-answers-heading" className="text-xl font-extrabold leading-title">
            Waiting on an answer
          </h2>
          <p className="text-xs text-muted-foreground">
            Blockers and questions an agent could not settle on its own.
          </p>
        </div>
        <NeedsPanel />
      </section>

      <NextView />
    </div>
  );
}
