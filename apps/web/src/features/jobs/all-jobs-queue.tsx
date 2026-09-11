import { useCallback, useMemo, useState } from "react";

import { RowList } from "../../components/ui/list-row.js";
import { SelectField } from "../../components/ui/select-field.js";
import { useMachine } from "../../lib/source-context.js";
import { JOB_STATUSES } from "./format.js";
import { JobPanel } from "./job-panel.js";
import { JobRow } from "./job-row.js";
import { useJobList, useNow } from "./use-jobs.js";

/** `?status=` is not a parameter `/api/jobs/all` takes, so the filter is applied to the rows. */
const ALL = "";

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
  const [status, setStatus] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const jobs = useJobList(
    useCallback(() => machine.listAllJobs(), [machine]),
    machine,
  );
  const canWrite = machine.capabilities.write;

  const all = jobs.result.state === "ready" ? jobs.result.value : [];
  const list = useMemo(() => (status === ALL ? all : all.filter((job) => job.status === status)), [all, status]);
  // The clock ticks only while something is actually running, so an idle queue is a static page.
  const now = useNow(all.some((job) => job.status === "running"));
  const opened = list.find((job) => job.id === openId) ?? null;
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
      <p className="text-sm text-muted-foreground">
        Repairs, backfills and extractions across every project. Scans and backfills run from a
        project&apos;s own Jobs.
      </p>

      <label className="flex w-fit flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status</span>
        <SelectField value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value={ALL}>All</option>
          {JOB_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </SelectField>
      </label>

      {jobs.result.state === "loading" ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading…
        </p>
      ) : jobs.result.state === "error" ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          Could not read the queues: {jobs.result.message}
        </p>
      ) : list.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          {status === ALL ? "Every queue is empty." : `No ${status} jobs in any project.`}
        </p>
      ) : (
        <RowList aria-label="Jobs, newest first">
          {list.map((job) => (
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
          ))}
        </RowList>
      )}

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
