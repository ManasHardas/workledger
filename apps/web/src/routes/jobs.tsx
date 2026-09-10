import { JobQueue } from "../features/jobs/job-queue.js";

/** Jobs — the recovery queue: scan, repair, backfill and extract (design spec §8, p3/cli.md). */
export function JobsView() {
  return (
    <section aria-labelledby="jobs-heading" className="flex flex-col gap-4">
      <h2 id="jobs-heading" className="text-xl font-semibold">
        Jobs
      </h2>
      <JobQueue />
    </section>
  );
}
