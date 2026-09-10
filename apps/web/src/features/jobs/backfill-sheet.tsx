import { useCallback, useEffect, useState } from "react";

import { ActionSheet } from "../../components/ui/action-sheet.js";
import { Button } from "../../components/ui/button.js";
import { SelectField } from "../../components/ui/select-field.js";
import { codeOf, messageOf } from "../../lib/errors.js";
import { useSource } from "../../lib/source-context.js";
import { DEFAULT_SINCE, SINCE_OPTIONS, formatBytes, formatDuration, formatWhen } from "./format.js";
import { useAction } from "./use-jobs.js";

import type { BackfillEstimate, Job } from "../../lib/ledger-source.js";

/**
 * `POST /api/jobs/backfill` from the UI, in the two calls the contract splits it into.
 *
 * `consent: false` is not a refusal, it is `--dry-run`: it queues nothing and the estimate *is*
 * the answer (p3/api.md, cli.md §backfill step 2). So this sheet asks for the estimate the moment
 * it opens and every time the lookback changes, and the run button stays inert until a number is
 * on screen. The operator never authorises a spend they have not been shown — which is the whole
 * reason the endpoint has two modes rather than a `--yes` flag.
 *
 * A build whose `serve` was given no `backfill` op answers 501 (`not_implemented`). That is said
 * plainly rather than dressed up as an empty estimate: "this build cannot" and "there is nothing
 * to backfill" are different facts and the operator has to be able to tell them apart.
 */
export function BackfillSheet({ onQueued }: { onQueued: () => void }) {
  const source = useSource();
  const [open, setOpen] = useState(false);
  const [since, setSince] = useState(DEFAULT_SINCE);

  const estimate = useAction(
    useCallback(
      (lookback: string) => source.backfill({ since: lookback, consent: false }),
      [source],
    ),
  );
  const run = useAction(
    useCallback((lookback: string) => source.backfill({ since: lookback, consent: true }), [source]),
  );

  const estimateRun = estimate.run;
  const runReset = run.reset;
  useEffect(() => {
    if (!open) return;
    runReset();
    estimateRun(since);
  }, [open, since, estimateRun, runReset]);

  const runState = run.state;
  const queued = runState.state === "done" ? runState.value.jobs : null;
  // The caller's list has to re-read once the jobs exist; `job.changed` would say so on its own
  // 2 s tick, which is long enough after a button press to read as nothing having happened.
  useEffect(() => {
    if (runState.state === "done") onQueued();
  }, [runState, onQueued]);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Backfill…
      </Button>
      <ActionSheet
        open={open}
        onOpenChange={setOpen}
        title="Backfill sessions from before install"
        description="Every session in the lookback gets a headless resume that asks it for a digest. Nothing is queued until you confirm."
        footer={
          queued === null ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={estimate.state.state !== "done" || run.state.state === "running"}
                onClick={() => run.run(since)}
              >
                {run.state.state === "running" ? "Queueing…" : "Run backfill"}
              </Button>
            </>
          ) : (
            <Button onClick={() => setOpen(false)}>Close</Button>
          )
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Since</span>
            <SelectField
              value={since}
              disabled={queued !== null}
              onChange={(event) => setSince(event.target.value)}
            >
              {SINCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </label>

          {queued === null ? <Estimate action={estimate.state} /> : null}

          {run.state.state === "failed" ? (
            <p role="alert" className="text-sm text-destructive">
              {explain(run.state.error)}
            </p>
          ) : null}

          {queued === null ? null : (
            <p role="status" className="text-sm">
              Queued {String(queued.length)} {queued.length === 1 ? "job" : "jobs"}. They run in the
              background; this view follows them.
            </p>
          )}
        </div>
      </ActionSheet>
    </>
  );
}

/** The dry estimate: what the run would touch, before anything is queued. */
function Estimate({
  action,
}: {
  action: ReturnType<typeof useAction<[string], { jobs: Job[]; estimate: BackfillEstimate }>>["state"];
}) {
  if (action.state === "running" || action.state === "idle") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Estimating…
      </p>
    );
  }
  if (action.state === "failed") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {explain(action.error)}
      </p>
    );
  }
  const { count, bytes, oldest, seconds } = action.value.estimate;
  if (count === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sessions in this lookback are missing a digest.
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
      <Row label="sessions" value={String(count)} />
      <Row label="transcript" value={formatBytes(bytes)} />
      <Row label="oldest" value={formatWhen(oldest)} />
      <Row label="estimated run" value={formatDuration(seconds * 1000)} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 font-mono">{value}</dd>
    </div>
  );
}

/** The two rejections worth their own sentence; everything else is reported verbatim. */
export function explain(error: unknown): string {
  const code = codeOf(error);
  if (code === "not_implemented") {
    return "This build of workledger cannot backfill yet — its `serve` was not given the backfill command.";
  }
  if (code === "read-only") return "This source is read-only, so it cannot queue jobs.";
  return messageOf(error);
}
