import { useCallback } from "react";

import { AsyncPanel } from "../../../components/async-panel.js";
import { Button } from "../../../components/ui/button.js";
import type { AppSource, HistoryResult, OnboardingWindow } from "../../../lib/ledger-source.js";
import { useAsync } from "../../../lib/use-async.js";
import { COUNTED_WINDOWS, WINDOW_LABELS, formatBytes, plural } from "../format.js";
import { goTo, type WizardState } from "../state.js";
import { StepActions, StepFrame } from "../wizard.js";

/** Joins a path list into a dependency key; no path can hold it. */
const LIST_SEP = "\u0000";

/**
 * Step 2 — how far back to read (plans/feature-p8-onboarding-home.md step 3).
 *
 * Five cards from `GET /api/onboarding/history`: the sessions and transcript bytes in each
 * window across the repos just enabled — 7, 30 and 90 days, and every transcript regardless of
 * age (amendment 9) — and "none". Choosing one *is* the answer, so the cards are the buttons and
 * there is no separate Continue. `none` skips the method step: there is nothing to choose a
 * method for. A window the daemon did not count (an older daemon without `all`) gets no card.
 */
export function HistoryStep({ state, source }: { state: WizardState; source: AppSource }) {
  const repos = state.repos ?? [];
  // The list's identity is its contents: the array itself is a new object on every hash read.
  const reposKey = repos.join(LIST_SEP);
  const history = useAsync(useCallback(() => source.history(reposKey === "" ? [] : reposKey.split(LIST_SEP)), [source, reposKey]));

  function choose(since: OnboardingWindow) {
    goTo({ ...state, step: since === "none" ? "done" : "method", since, method: since === "none" ? "none" : undefined });
  }

  return (
    <StepFrame
      title="How much history to backfill"
      lead={
        <>
          Past sessions in the {plural(repos.length, "repo")} you enabled can get a checkpoint written after the
          fact. Counts are sessions the harness stores hold for each window, and the transcript
          bytes behind them. Pick a window to see what writing them would take; nothing runs yet.
        </>
      }
    >
      <AsyncPanel result={history} empty="">
        {(result) => (
          <div role="group" aria-label="Backfill window" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {COUNTED_WINDOWS.filter((window) => result.windows[window] !== undefined).map((window) => (
              <WindowCard key={window} window={window} result={result} onChoose={choose} />
            ))}
            <button
              type="button"
              onClick={() => choose("none")}
              className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-dashed border-border p-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-base font-semibold">{WINDOW_LABELS.none}</span>
              <span className="text-xs text-muted-foreground">
                Start fresh — only sessions from now on are recorded.
              </span>
            </button>
          </div>
        )}
      </AsyncPanel>
      <StepActions>
        <Button variant="ghost" onClick={() => goTo({ ...state, step: "projects" })}>
          Back
        </Button>
      </StepActions>
    </StepFrame>
  );
}

function WindowCard({
  window,
  result,
  onChoose,
}: {
  window: (typeof COUNTED_WINDOWS)[number];
  result: HistoryResult;
  onChoose: (since: OnboardingWindow) => void;
}) {
  const counted = result.windows[window];
  if (counted === undefined) return null;
  const { sessions, bytes } = counted;
  return (
    <button
      type="button"
      onClick={() => onChoose(window)}
      className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-base font-semibold">{WINDOW_LABELS[window]}</span>
      <span className="text-2xl font-semibold tabular-nums">{plural(sessions, "session")}</span>
      <span className="text-xs text-muted-foreground">{formatBytes(bytes)} of transcripts</span>
    </button>
  );
}
