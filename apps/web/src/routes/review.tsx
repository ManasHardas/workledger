import { useMemo } from "react";

import { PageBody, PageHeader } from "../components/ui/page.js";
import { useLiveRepos } from "../features/home/live.js";
import { HISTORY_TYPES, useLiveNotes, useLiveOpenNotes } from "../features/needs/live.js";
import { NeedsPanel, useNotesOfType } from "../features/needs/needs-panel.js";
import { NextList } from "../features/next/next-view.js";
import { useBacklog } from "../features/next/use-backlog.js";
import { HistoryNotes } from "../features/review/history-notes.js";
import { reviewCounts } from "../features/review/counts.js";
import { REVIEW_PANEL_ID, ReviewToolbar, reviewTabId } from "../features/review/review-toolbar.js";
import { useReviewView, type ReviewViewId } from "../features/review/view.js";
import { useMachine, useRepoId, useSource } from "../lib/source-context.js";

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
 * The toolbar (operator, 2026-09-13) narrows the page to one kind — Blockers, Questions,
 * Proposals — or to the history of Decisions and Discoveries, and moves between projects on the
 * same view. The page reads each thing once and hands the same read to the list and the count.
 *
 * Neither half is new machinery: the answer is recorded as a decision note on the session it came
 * from (`resolveNote`), and accepting an item sets `confirmed_by`, which is the trust tier the
 * schema already carries. There is no verdict entity here, deliberately.
 */
/**
 * The keys each view actually answers to, and nothing more: the backlog owns `a` and `x`, the
 * answer cards own Enter, and the history views are read-only.
 */
const REPO_HINTS: Record<ReviewViewId, string | undefined> = {
  all: "j k to move · a accept · x discard · enter to answer",
  blocker: "j k to move · enter to answer",
  question: "j k to move · enter to answer",
  proposal: "j k to move · a accept · x discard",
  decision: undefined,
  discovery: undefined,
};

export function ReviewView() {
  const machine = useMachine();
  const source = useSource();
  const repo = useRepoId();
  const repos = useLiveRepos(machine);
  const [view, setView] = useReviewView();

  const open = useLiveOpenNotes();
  const history = useLiveNotes(HISTORY_TYPES);
  const backlog = useBacklog();

  const decisions = useNotesOfType(history.result, "decision");
  const discoveries = useNotesOfType(history.result, "discovery");
  const counts = useMemo(
    () =>
      reviewCounts(
        open.result,
        history.result,
        backlog.result.state === "ready"
          ? backlog.result.value.filter((item) => item.frontmatter.status === "proposed").length
          : undefined,
      ),
    [open.result, history.result, backlog.result],
  );

  return (
    <>
      <PageHeader title="Review" aside={REPO_HINTS[view]} />
      <PageBody rhythm="review">
        <ReviewToolbar view={view} onView={setView} counts={counts} repo={repo} repos={repos} />
        <div
          id={REVIEW_PANEL_ID}
          role="tabpanel"
          aria-labelledby={reviewTabId(view)}
          className="flex min-w-0 flex-col gap-6.5"
        >
          {view === "all" ? (
            <>
              <NeedsPanel live={open} />
              <NextList backlog={backlog} />
            </>
          ) : view === "blocker" || view === "question" ? (
            <NeedsPanel live={open} section={view} />
          ) : view === "proposal" ? (
            <NextList backlog={backlog} only="proposed" />
          ) : (
            <HistoryNotes
              key={view}
              type={view}
              result={view === "decision" ? decisions : discoveries}
              sourceOf={() => source}
            />
          )}
        </div>
      </PageBody>
    </>
  );
}
