import { PageBody, PageHeader } from "../components/ui/page.js";
import { AllNeedsPanel } from "../features/needs/all-needs-panel.js";

/**
 * Review, machine-wide — open `question` and `blocker` notes across every repo (P8), as the Review
 * frame's answer cards (`10:2`) with each card naming its repo. No proposals: there is no
 * machine-wide backlog read.
 */
export function AllNeedsView() {
  return (
    <>
      <PageHeader title="Review" aside="Across every project on this machine" />
      <PageBody rhythm="review">
        <AllNeedsPanel />
      </PageBody>
    </>
  );
}
