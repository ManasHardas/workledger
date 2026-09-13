import { useCallback, useState } from "react";

import { cn } from "../../lib/cn.js";
import { useMachine } from "../../lib/source-context.js";
import { filterLabel, type JobFilter } from "./format.js";
import { JobBoard, JobFilterTabs, QUIET_LINE, useBoardIds } from "./job-board.js";
import { JobPanel } from "./job-panel.js";
import { JobRow } from "./job-row.js";
import { useJobList, useNow } from "./use-jobs.js";

/**
 * Every repo's recovery queue in one list — `GET /api/jobs/all` (P8), a row per job.
 *
 * Only the row actions are here. A scan and a backfill are one repo's to run, so they stay on
 * that repo's Jobs, which each row's repo link opens. Cancel and retry go through `forRepo(id)`
 * of the row's repo, so the write carries the `repo` parameter the daemon requires, and so does
 * the panel's log read.
 */
export function AllJobsQueue() {
  const machine = useMachine();
  const [filter, setFilter] = useState<JobFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const jobs = useJobList(
    useCallback(() => machine.listAllJobs(), [machine]),
    machine,
  );
  const ids = useBoardIds();
  const canWrite = machine.capabilities.write;

  const all = jobs.result.state === "ready" ? jobs.result.value : [];
  // The clock ticks only while something is actually running, so an idle queue is a static page.
  const now = useNow(all.some((job) => job.status === "running"));
  const opened = all.find((job) => job.id === openId) ?? null;
  const openedRepo = opened?.repo.id;
  const readLog = useCallback(
    () =>
      openId === null || openedRepo === undefined
        ? Promise.resolve("")
        : machine.forRepo(openedRepo).jobLog(openId),
    [machine, openId, openedRepo],
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-base leading-body tracking-body text-muted-foreground">
        Repairs, backfills and extractions across every project. Scans and backfills run from a
        project&apos;s own Jobs.
      </p>

      <JobFilterTabs jobs={all} filter={filter} onChange={setFilter} {...ids} />

      <div
        role="tabpanel"
        id={ids.panelId}
        aria-labelledby={`${ids.idPrefix}-${filter}`}
        className="flex min-w-0 flex-col gap-6.5"
      >
        {jobs.result.state === "loading" ? (
          <p role="status" className={QUIET_LINE}>
            Loading…
          </p>
        ) : jobs.result.state === "error" ? (
          <p role="alert" className={cn(QUIET_LINE, "text-destructive")}>
            Could not read the queues: {jobs.result.message}
          </p>
        ) : all.length === 0 ? (
          <p className={QUIET_LINE}>Every queue is empty.</p>
        ) : (
          <JobBoard
            jobs={all}
            filter={filter}
            idPrefix={ids.idPrefix}
            empty={(tab) =>
              tab === "in-flight" ? "Nothing in flight in any project." : `No ${filterLabel(tab)} jobs in any project.`
            }
            renderRow={(job) => (
              <JobRow
                key={`${job.repo.id}-${job.id}`}
                job={job}
                repo={job.repo}
                now={now}
                canWrite={canWrite}
                selected={openId === job.id}
                pending={jobs.pending[job.id] === true}
                error={jobs.errors[job.id]}
                onOpen={() => setOpenId(job.id)}
                onCancel={() => jobs.act(job.id, () => machine.forRepo(job.repo.id).cancelJob(job.id))}
                onRetry={() => jobs.act(job.id, () => machine.forRepo(job.repo.id).retryJob(job.id))}
              />
            )}
          />
        )}
      </div>

      <JobPanel
        job={opened}
        repoId={openedRepo ?? ""}
        now={now}
        readLog={readLog}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
