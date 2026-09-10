import { useEffect, useState } from "react";

import { Button } from "../../../components/ui/button.js";
import type { AppSource, OnboardingStatus } from "../../../lib/ledger-source.js";
import { HOME_HREF } from "../../../lib/router.js";
import { finishBackfillRun, readBackfillRun } from "../flags.js";
import { plural } from "../format.js";
import { goTo, replaceWith, type WizardState } from "../state.js";
import { useBackfillProgress, type RepoProgress } from "../use-backfill-progress.js";
import { StepActions, StepFrame } from "../wizard.js";

/**
 * Step 4 — the backfill, live (plans/feature-p8-onboarding-home.md step 5).
 *
 * Nothing is started here: `run` was posted on the method step and the jobs are the daemon's.
 * This screen follows `GET /api/onboarding/status` on a 2 s tick and on every `job.changed`,
 * splits the count per repo, and moves to Done when nothing is still ahead. The way out to Home
 * is a plain link — the daemon keeps going, and Home announces the finish when it comes.
 */
export function RunningStep({ state, source }: { state: WizardState; source: AppSource }) {
  const [run] = useState(readBackfillRun);
  const { status, perRepo } = useBackfillProgress(source, run, true);

  // Nothing still ahead: record the finish and move on. Both are idempotent, so re-running on a
  // later poll or hash read is harmless — and the move unmounts this step anyway.
  const complete = status.state === "ready" && status.value.complete;
  useEffect(() => {
    if (status.state !== "ready" || !status.value.complete) return;
    finishBackfillRun(status.value);
    replaceWith({ ...state, step: "done" });
  }, [status, state]);

  return (
    <StepFrame
      title="Backfilling"
      lead={
        state.method === "extract"
          ? "The daemon is extracting a checkpoint from each transcript. Each finished session appears in its repo's Ledger as it lands; a failure is listed under Jobs with its log."
          : "The daemon is resuming each past session headlessly and writing its checkpoint. Each finished session appears in its repo's Ledger as it lands; a failure is listed under Jobs with its log."
      }
    >
      {status.state === "loading" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Reading progress…
        </p>
      ) : status.state === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          Could not read progress: {status.message}. The backfill itself is unaffected; Jobs lists every job.
        </p>
      ) : (
        <Progress status={status.value} perRepo={perRepo} />
      )}
      <StepActions>
        <a
          href={HOME_HREF}
          className="rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go to home — the backfill keeps running
        </a>
        <Button className="ml-auto" variant="outline" onClick={() => goTo({ ...state, step: "done" })} disabled={!complete}>
          Continue
        </Button>
      </StepActions>
    </StepFrame>
  );
}

function Progress({ status, perRepo }: { status: OnboardingStatus; perRepo: RepoProgress[] }) {
  const finished = status.done + status.failed;
  const percent = status.total === 0 ? 100 : Math.round((finished / status.total) * 100);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="progressbar"
        aria-label="Backfill progress"
        aria-valuemin={0}
        aria-valuemax={status.total}
        aria-valuenow={finished}
        aria-valuetext={`${String(finished)} of ${plural(status.total, "session")}`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${String(percent)}%` }} />
      </div>
      <p role="status" className="text-sm tabular-nums">
        {String(finished)} of {plural(status.total, "session")} finished
        {status.failed > 0 ? ` · ${plural(status.failed, "failure")}` : ""}
        {status.running > 0 ? ` · ${String(status.running)} still ahead` : ""}
      </p>
      {perRepo.length > 0 ? (
        <table className="w-full text-sm">
          <caption className="sr-only">Progress per repo</caption>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 font-normal">
                repo
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                done
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                failed
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                total
              </th>
            </tr>
          </thead>
          <tbody>
            {perRepo.map((repo) => (
              <tr key={repo.path} className="border-t border-border">
                <td className="max-w-0 truncate py-1 font-mono text-xs" title={repo.path}>
                  {repo.path.split("/").pop()}
                </td>
                <td className="py-1 text-right tabular-nums">{String(repo.done)}</td>
                <td className="py-1 text-right tabular-nums">{String(repo.failed)}</td>
                <td className="py-1 text-right tabular-nums">{String(repo.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
