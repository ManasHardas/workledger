import { useMemo } from "react";

import { PageBody, PageHeader } from "../components/ui/page.js";
import { useLiveRepos } from "../features/home/live.js";
import { AllNeedsPanel, useLiveMachineNotes, useRepoSources } from "../features/needs/all-needs-panel.js";
import { HISTORY_TYPES, OPEN_TYPES } from "../features/needs/live.js";
import { useNotesOfType } from "../features/needs/needs-panel.js";
import { reviewCounts } from "../features/review/counts.js";
import { HistoryNotes } from "../features/review/history-notes.js";
import { MachineProposals, useMachineProposals } from "../features/review/machine-proposals.js";
import { REVIEW_PANEL_ID, ReviewToolbar, reviewTabId } from "../features/review/review-toolbar.js";
import { useReviewView } from "../features/review/view.js";
import { useMachine } from "../lib/source-context.js";

/**
 * Review, machine-wide — what waits on a person across every repo (P8), as the Review frame's
 * cards (`10:2`) with each one naming its repo.
 *
 * The same toolbar as a repo's Review: All is the open questions and blockers, then every
 * project's proposals grouped by repo; the other views narrow to one kind. There is no
 * machine-wide backlog read, so the proposals are each repo's own, read through `forRepo(id)`.
 */
export function AllNeedsView() {
  const machine = useMachine();
  const repos = useLiveRepos(machine);
  const [view, setView] = useReviewView();

  const open = useLiveMachineNotes(OPEN_TYPES, true);
  const history = useLiveMachineNotes(HISTORY_TYPES);
  const proposals = useMachineProposals(repos);

  const decisions = useNotesOfType(history.result, "decision");
  const discoveries = useNotesOfType(history.result, "discovery");
  const historyNotes = view === "decision" ? decisions : discoveries;
  const sources = useRepoSources(historyNotes.state === "ready" ? historyNotes.value : []);

  const counts = useMemo(
    () =>
      reviewCounts(
        open.result,
        history.result,
        proposals.state === "ready" ? proposals.value.reduce((sum, entry) => sum + entry.count, 0) : undefined,
      ),
    [open.result, history.result, proposals],
  );

  return (
    <>
      <PageHeader title="Review" aside="Across every project on this machine" />
      <PageBody rhythm="review">
        <ReviewToolbar view={view} onView={setView} counts={counts} repo={null} repos={repos} />
        <div
          id={REVIEW_PANEL_ID}
          role="tabpanel"
          aria-labelledby={reviewTabId(view)}
          className="flex min-w-0 flex-col gap-6.5"
        >
          {view === "all" ? (
            <>
              <AllNeedsPanel live={open} />
              <MachineProposals proposals={proposals} />
            </>
          ) : view === "blocker" || view === "question" ? (
            <AllNeedsPanel live={open} section={view} />
          ) : view === "proposal" ? (
            <MachineProposals proposals={proposals} />
          ) : (
            <HistoryNotes
              key={view}
              type={view}
              result={historyNotes}
              sourceOf={(note) => (note.repo === undefined ? machine : (sources.get(note.repo.id) ?? machine))}
            />
          )}
        </div>
      </PageBody>
    </>
  );
}
