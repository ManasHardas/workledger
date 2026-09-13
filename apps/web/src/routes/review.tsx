import { PageBody, PageHeader } from "../components/ui/page.js";
import { NeedsPanel } from "../features/needs/needs-panel.js";
import { NextView } from "../features/next/next-view.js";

/**
 * Review — everything waiting on a human, in one place (P9; frame `10:2`, titled "Review" by the
 * operator's decision rather than the frame's "Needs you").
 *
 * It merges what P2 split across two views: the open `blocker` and `question` notes an agent
 * raised, and the backlog those agents proposed. Both are the same act — a person judging what the
 * agents produced — and splitting them scattered one sitting across two screens.
 *
 * Answers come first. A blocker is work that has already stopped; a proposed backlog item is work
 * that has not started, so it can wait the length of a scroll. Below the proposals, the rest of the
 * backlog (accepted, in progress, done, discarded) stays reachable in the same style.
 *
 * Neither half is new machinery: the answer is recorded as a decision note on the session it came
 * from (`resolveNote`), and accepting an item sets `confirmed_by`, which is the trust tier the
 * schema already carries. There is no verdict entity here, deliberately.
 */
export function ReviewView() {
  return (
    <>
      <PageHeader title="Review" aside="j k to move · a accept · x discard · enter to answer" />
      <PageBody rhythm="review">
        <NeedsPanel />
        <NextView />
      </PageBody>
    </>
  );
}
