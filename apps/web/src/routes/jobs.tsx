import { PageBody, PageHeader } from "../components/ui/page.js";
import { JobQueue } from "../features/jobs/job-queue.js";

/** Jobs — the recovery queue: scan, repair, backfill and extract (design spec §8, p3/cli.md). */
export function JobsView() {
  return (
    <>
      <PageHeader title="Jobs" />
      <PageBody rhythm="home">
        <JobQueue />
      </PageBody>
    </>
  );
}
