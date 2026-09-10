import type { Job, OnboardingStatus } from "../../lib/ledger-source.js";

/**
 * The one thing the wizard remembers outside the URL: the backfill it started.
 *
 * The run keeps going on the daemon after the operator leaves for Home ("the page must not block
 * on this step"), so its completion has to be noticed by whichever page is open when it lands —
 * the running step if they stayed, the Home banner if they did not — and announced exactly once.
 * That is a record in `localStorage`: written when `run` answers 202, marked finished by whoever
 * sees `status.complete` first, and cleared when the banner is dismissed.
 *
 * `jobIds` is what lets the running step count per repo: `/api/onboarding/status` gives totals
 * only, so the per-repo split is `/api/jobs/all` filtered to the jobs this run queued.
 */
export interface BackfillRun {
  /** The repos the run was queued for, absolute. */
  repos: string[];
  /** The job ids `run` answered with. */
  jobIds: string[];
  startedAt: string;
  /** The final status, once someone saw `complete`. */
  finished: { done: number; failed: number; total: number; at: string } | null;
}

export const BACKFILL_RUN_KEY = "workledger.onboarding.backfill";

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    // A browser set to block site data throws on the accessor itself; the wizard still works,
    // it just cannot announce completion on Home.
    return undefined;
  }
}

export function readBackfillRun(): BackfillRun | null {
  const raw = storage()?.getItem(BACKFILL_RUN_KEY);
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BackfillRun>;
    if (!Array.isArray(parsed.repos) || !Array.isArray(parsed.jobIds) || typeof parsed.startedAt !== "string") {
      return null;
    }
    return { repos: parsed.repos, jobIds: parsed.jobIds, startedAt: parsed.startedAt, finished: parsed.finished ?? null };
  } catch {
    return null;
  }
}

function write(run: BackfillRun | null): void {
  const store = storage();
  if (store === undefined) return;
  if (run === null) store.removeItem(BACKFILL_RUN_KEY);
  else store.setItem(BACKFILL_RUN_KEY, JSON.stringify(run));
  // `storage` events only fire in *other* tabs; the banner in this one listens for this.
  window.dispatchEvent(new Event(BACKFILL_RUN_EVENT));
}

/** Fired on `window` whenever the record changes in this tab. */
export const BACKFILL_RUN_EVENT = "workledger:backfill-run";

/** `run` answered 202: remember what was queued. */
export function startBackfillRun(repos: string[], jobs: Job[], now = new Date()): BackfillRun {
  const run: BackfillRun = { repos, jobIds: jobs.map((job) => job.id), startedAt: now.toISOString(), finished: null };
  write(run);
  return run;
}

/** Someone saw `status.complete`: freeze the totals for the banner. Idempotent. */
export function finishBackfillRun(status: OnboardingStatus, now = new Date()): BackfillRun | null {
  const run = readBackfillRun();
  if (run === null) return null;
  if (run.finished !== null) return run;
  const finished = { ...run, finished: { done: status.done, failed: status.failed, total: status.total, at: now.toISOString() } };
  write(finished);
  return finished;
}

/** The banner was dismissed, or a new wizard pass begins: forget the run. */
export function clearBackfillRun(): void {
  write(null);
}
