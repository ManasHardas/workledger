import { useEffect, useState } from "react";

import { Button } from "../../components/ui/button.js";
import type { Repo } from "../../lib/ledger-source.js";
import { ONBOARDING_HREF, machineHref, replaceHash } from "../../lib/router.js";
import { useMachine } from "../../lib/source-context.js";
import type { Async } from "../../lib/use-async.js";
import { BACKFILL_RUN_EVENT, clearBackfillRun, finishBackfillRun, readBackfillRun, type BackfillRun } from "./flags.js";
import { plural } from "./format.js";
import { PROGRESS_POLL_MS } from "./use-backfill-progress.js";

/**
 * "Backfill finished: N sessions across M repos", on Home, once.
 *
 * Driven by the run record in `localStorage` (`./flags.ts`). While the record says a run is
 * still going — the operator left the wizard for Home — this polls `status` at the running
 * step's cadence and marks the finish itself, so leaving early costs nothing. Dismiss clears the
 * record; the next wizard pass writes a fresh one.
 */
export function BackfillBanner({ pollMs = PROGRESS_POLL_MS }: { pollMs?: number }) {
  const source = useMachine();
  const [run, setRun] = useState<BackfillRun | null>(readBackfillRun);

  useEffect(() => {
    const refresh = () => setRun(readBackfillRun());
    window.addEventListener(BACKFILL_RUN_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(BACKFILL_RUN_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const pending = run !== null && run.finished === null;
  useEffect(() => {
    if (!pending) return;
    let live = true;
    const read = () => {
      source.status().then(
        (status) => {
          if (live && status.complete) finishBackfillRun(status);
        },
        () => {
          // A daemon that is unreachable right now says nothing; the next tick asks again.
        },
      );
    };
    read();
    const timer = setInterval(read, pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, pending, pollMs]);

  if (run === null || run.finished === null) return null;
  const { done, failed } = run.finished;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-accent p-3 text-sm text-accent-foreground"
    >
      <p className="m-0">
        Backfill finished: {plural(done, "session")} across {plural(run.repos.length, "repo")}.
        {failed > 0 ? (
          <>
            {" "}
            {plural(failed, "session")} failed —{" "}
            <a href={machineHref("jobs")} className="underline underline-offset-2">
              see Jobs
            </a>
            .
          </>
        ) : null}
      </p>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={clearBackfillRun}>
        Dismiss
      </Button>
    </div>
  );
}

/** Whether this page load has already sent an empty Home to the wizard. */
let redirected = false;

/** Tests render many apps in one module; each starts as a fresh page load. */
export function resetEmptyMachineRedirect(): void {
  redirected = false;
}

/**
 * `#/` on a daemon that serves no repo goes to the wizard (daemon-and-api.md §CLI: `open` targets
 * `/#/onboarding` when `/api/repos` is empty; this is the same rule for a Home reached any other
 * way, including the legacy `#/ledger` redirect). Once per page load: an operator who leaves the
 * wizard for Home on purpose gets Home's empty state and its own "Add projects", not a bounce.
 * `replaceHash`, so Back from the wizard does not land on the redirect again.
 */
export function EmptyMachineRedirect({ repos }: { repos: Async<Repo[]> }) {
  const empty = repos.state === "ready" && repos.value.length === 0;
  useEffect(() => {
    if (!empty || redirected) return;
    redirected = true;
    replaceHash(ONBOARDING_HREF);
  }, [empty]);
  return null;
}
