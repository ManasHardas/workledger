import { useCallback } from "react";

import { AsyncPanel } from "../../../components/async-panel.js";
import { buttonVariants } from "../../../components/ui/button.js";
import { cn } from "../../../lib/cn.js";
import type { AppSource, OnboardingStatus } from "../../../lib/ledger-source.js";
import { HOME_HREF, machineHref } from "../../../lib/router.js";
import { useAsync } from "../../../lib/use-async.js";
import { finishBackfillRun } from "../flags.js";
import { plural } from "../format.js";
import type { WizardState } from "../state.js";
import { StepActions, StepFrame } from "../wizard.js";

/** Both "no backfill" exits say the same thing, so it is one string, also asserted by the tests. */
export const NOTHING_BACKFILLED = "Nothing was backfilled; new sessions will be recorded from now on.";

/**
 * Step 5 — what happened (plans/feature-p8-onboarding-home.md step 6).
 *
 * A run reads `status` once more for the final totals and points at Jobs for any failure. The
 * two exits that ran nothing — `none` on the history step, Skip on the method step — say so in
 * one sentence, because "done" after choosing nothing must not read as "backfilled".
 */
export function DoneStep({ state, source }: { state: WizardState; source: AppSource }) {
  const ran = state.since !== undefined && state.since !== "none" && state.method !== undefined && state.method !== "none";
  const repos = (state.repos ?? []).length;

  if (!ran) {
    return (
      <StepFrame title="All set" lead={`${plural(repos, "repo")} enabled.`}>
        <p className="text-sm">{NOTHING_BACKFILLED}</p>
        <Exit />
      </StepFrame>
    );
  }
  return <RunSummary source={source} repos={repos} />;
}

function RunSummary({ source, repos }: { source: AppSource; repos: number }) {
  const status = useAsync(
    useCallback(async () => {
      const value = await source.status();
      // The running step normally records the finish; a reload that landed here first does it now.
      if (value.complete) finishBackfillRun(value);
      return value;
    }, [source]),
  );
  return (
    <StepFrame title="Backfill finished" lead={`${plural(repos, "repo")} enabled and their history digested.`}>
      <AsyncPanel result={status} empty="">
        {(value) => <Totals status={value} repos={repos} />}
      </AsyncPanel>
      <Exit />
    </StepFrame>
  );
}

function Totals({ status, repos }: { status: OnboardingStatus; repos: number }) {
  if (status.total === 0) return <p className="text-sm">{NOTHING_BACKFILLED}</p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        <span className="font-semibold tabular-nums">{plural(status.done, "session")}</span> across{" "}
        {plural(repos, "repo")} now have a checkpoint.
        {!status.complete ? ` ${String(status.running)} still running; Home shows the finish.` : ""}
      </p>
      {status.failed > 0 ? (
        <p role="alert" className="text-destructive">
          {plural(status.failed, "session")} could not be digested.{" "}
          <a href={machineHref("jobs")} className="underline underline-offset-2">
            See the failed jobs
          </a>{" "}
          for the log and a retry.
        </p>
      ) : null}
    </div>
  );
}

function Exit() {
  return (
    <StepActions>
      <a href={HOME_HREF} className={cn(buttonVariants(), "ml-auto")}>
        Go to home
      </a>
    </StepActions>
  );
}
