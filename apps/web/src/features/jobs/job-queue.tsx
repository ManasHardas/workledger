import { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/ui/button.js";
import { RowList } from "../../components/ui/list-row.js";
import { SelectField } from "../../components/ui/select-field.js";
import { useRepoId, useSource } from "../../lib/source-context.js";
import { BackfillSheet, explain } from "./backfill-sheet.js";
import { JOB_STATUSES } from "./format.js";
import { JobPanel } from "./job-panel.js";
import { JobRow } from "./job-row.js";
import { useAction, useJobs, useNow } from "./use-jobs.js";

/** `?status=` as the filter offers it: every lifecycle state, plus "no filter at all". */
const ALL = "";

/**
 * The recovery queue of `docs/contracts/p3/cli.md` §Jobs, live, on the shell's list rhythm (#134).
 *
 * The three things this view is for, in the order the operator needs them: what the queue is doing
 * right now, why the failed row failed, and the two ways to put work into it — a scan that finds
 * sessions whose harness died, and a backfill of history from before install. The middle one is a
 * row's worth of evidence rather than a row, so it is in the right panel (`job-panel.tsx`).
 *
 * Nothing here polls. `serve` sweeps for orphans on its own five-minute tick and every job
 * transition arrives as `job.changed`, so a queue that changed because the CLI ran in another
 * terminal looks exactly like one that changed because a button here was pressed.
 */
export function JobQueue() {
  const source = useSource();
  const repoId = useRepoId();
  const [status, setStatus] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const jobs = useJobs(status === ALL ? undefined : status);
  const canWrite = source.capabilities.write;
  const reload = jobs.reload;

  const scan = useAction(useCallback(() => source.scan(), [source]));
  const scanState = scan.state;

  // A scan that queued repairs wrote rows the `job.changed` poller will report on its own 2 s
  // tick — but the operator has just pressed a button, and waiting for the tick reads as "the
  // scan did nothing". One re-read per completed scan, keyed on the summary's identity.
  useEffect(() => {
    if (scanState.state === "done") reload();
  }, [scanState, reload]);

  const list = jobs.result.state === "ready" ? jobs.result.value : [];
  // The clock ticks only while something is actually running, so an idle queue is a static page
  // rather than a component that re-renders once a second forever.
  const now = useNow(list.some((job) => job.status === "running"));
  const opened = list.find((job) => job.id === openId) ?? null;
  const readLog = useCallback(
    () => (openId === null ? Promise.resolve("") : source.jobLog(openId)),
    [source, openId],
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-48 flex-1 text-sm text-muted-foreground">
          Repairs, backfills and extractions. A scan marks sessions whose harness died as{" "}
          <code>crashed</code> and queues a repair for each one.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canWrite || scanState.state === "running"}
            onClick={() => scan.run()}
          >
            {scanState.state === "running" ? "Scanning…" : "Scan now"}
          </Button>
          {canWrite ? <BackfillSheet onQueued={reload} /> : null}
        </div>
      </div>

      {scanState.state === "done" ? (
        <p role="status" className="text-sm">
          Scan found {String(scanState.value.orphaned)}{" "}
          {scanState.value.orphaned === 1 ? "orphan" : "orphans"} and queued{" "}
          {String(scanState.value.queued)} {scanState.value.queued === 1 ? "repair" : "repairs"}.
        </p>
      ) : null}
      {scanState.state === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          Scan failed: {explain(scanState.error)}
        </p>
      ) : null}

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
          Could not read the queue: {jobs.result.message}
        </p>
      ) : list.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          The queue is empty. Run a scan, or backfill history from before install.
        </p>
      ) : (
        <RowList aria-label="Jobs, newest first">
          {list.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              now={now}
              canWrite={canWrite}
              selected={openId === job.id}
              pending={jobs.pending[job.id] === true}
              error={jobs.errors[job.id]}
              onOpen={() => setOpenId(job.id)}
              onCancel={() => jobs.act(job.id, () => source.cancelJob(job.id))}
              onRetry={() => jobs.act(job.id, () => source.retryJob(job.id))}
            />
          ))}
        </RowList>
      )}

      <JobPanel
        job={opened}
        repoId={repoId}
        now={now}
        readLog={readLog}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
