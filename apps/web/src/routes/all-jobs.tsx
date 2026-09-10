import { AllJobsQueue } from "../features/jobs/all-jobs-queue.js";

/** Jobs, machine-wide — every repo's recovery queue in one list (P8). */
export function AllJobsView() {
  return (
    <section aria-labelledby="jobs-heading" className="flex flex-col gap-4">
      <h2 id="jobs-heading" className="text-xl font-semibold">
        Jobs
      </h2>
      <AllJobsQueue />
    </section>
  );
}
