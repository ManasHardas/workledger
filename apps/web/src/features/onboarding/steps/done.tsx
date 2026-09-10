import { useCallback } from "react";

import { AsyncPanel } from "../../../components/async-panel.js";
import { buttonVariants } from "../../../components/ui/button.js";
import { cn } from "../../../lib/cn.js";
import type { AppSource, OnboardingStatus } from "../../../lib/ledger-source.js";
import { HOME_HREF, machineHref } from "../../../lib/router.js";
import { useAsync } from "../../../lib/use-async.js";
import { waitingSentence } from "../../jobs/format.js";
import { finishBackfillRun } from "../flags.js";
import { plural } from "../format.js";
import type { WizardState } from "../state.js";
import { StepActions, StepFrame } from "../wizard.js";

/**
 * Step 5 — what happened (plans/feature-p8-onboarding-home.md step 6).
 *
 * A run reads `status` once more for the final totals and points at Jobs for any failure. The
 * two exits that ran nothing — `none` on the history step, Skip on the method step — lead with
 * "Nothing was backfilled", because "done" after choosing nothing must not read as "backfilled".
 */
export function DoneStep({ state, source }: { state: WizardState; source: AppSource }) {
  const ran = state.since !== undefined && state.since !== "none" && state.method !== undefined && state.method !== "none";
  const repos = (state.repos ?? []).length;

  if (!ran) {
    return (
      <StepFrame
        title="Nothing was backfilled"
        lead={`${plural(repos, "repo")} enabled; new sessions will be recorded from now on.`}
      >
        <Exit />
      </StepFrame>
    );
  }
  return <RunSummary source={source} repos={repos} />;
}

/**
 * The outcome in one line, shared with the Home banner so both say the same thing:
 * "Backfilled N sessions across M repos", "Backfilled N of T sessions; K failed", or
 * "Nothing was backfilled".
 */
export function outcomeLine(status: Pick<OnboardingStatus, "done" | "failed" | "total">, repos: number): string {
  if (status.done === 0) return "Nothing was backfilled";
  if (status.failed > 0) {
    return `Backfilled ${String(status.done)} of ${plural(status.total, "session")}; ${String(status.failed)} failed`;
  }
  return `Backfilled ${plural(status.done, "session")} across ${plural(repos, "repo")}`;
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
  if (status.state !== "ready") {
    return (
      <StepFrame title="Backfill" lead="Reading the outcome…">
        <AsyncPanel result={status} empty="">
          {() => null}
        </AsyncPanel>
        <Exit />
      </StepFrame>
    );
  }
  const value = status.value;
  return (
    <StepFrame
      title={outcomeLine(value, repos)}
      lead={
        value.done === 0
          ? `${plural(repos, "repo")} enabled; new sessions will be recorded from now on.`
          : `${plural(repos, "repo")} enabled. Each backfilled session now has a summary in its repo's ledger.`
      }
    >
      {value.failed > 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {plural(value.failed, "session")} could not be summarized.{" "}
          <a href={machineHref("jobs")} className="underline underline-offset-2">
            See the failed jobs
          </a>{" "}
          for the log and a retry.
        </p>
      ) : null}
      {value.waiting > 0 && value.retryAfter !== null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {plural(value.waiting, "session")} waiting. {waitingSentence(value.retryAfter, Date.now())}; Home announces the finish.
        </p>
      ) : null}
      {value.running > 0 ? (
        <p className="text-sm text-muted-foreground">
          {String(value.running)} still running; Home announces the finish.
        </p>
      ) : null}
      <Exit />
    </StepFrame>
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
