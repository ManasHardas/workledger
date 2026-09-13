import { PageBody, PageHeader } from "../components/ui/page.js";
import { AllJobsQueue } from "../features/jobs/all-jobs-queue.js";

/** Jobs, machine-wide — every repo's recovery queue in one list (P8). */
export function AllJobsView() {
  return (
    <>
      <PageHeader title="Jobs" aside="Across every project on this machine" />
      <PageBody rhythm="home">
        <AllJobsQueue />
      </PageBody>
    </>
  );
}
