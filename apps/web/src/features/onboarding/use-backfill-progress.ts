import { useEffect, useRef, useState } from "react";

import { messageOf } from "../../lib/errors.js";
import type { AppSource, JobAcrossRepos, OnboardingStatus } from "../../lib/ledger-source.js";
import type { Async } from "../../lib/use-async.js";
import type { BackfillRun } from "./flags.js";

/** How often the running step re-reads status between `job.changed` events. */
export const PROGRESS_POLL_MS = 2000;

/** One repo's share of the run. */
export interface RepoProgress {
  path: string;
  done: number;
  failed: number;
  total: number;
}

export interface BackfillProgress {
  status: Async<OnboardingStatus>;
  /** In the order the run named its repos. Empty until the job list has been read once. */
  perRepo: RepoProgress[];
}

/**
 * The wizard's jobs, filtered out of `/api/jobs/all`.
 *
 * By id when the run's ids are known. The fallback — a job queued for one of the run's repos
 * after the run started — is for a record whose ids were lost (another tab started the run, the
 * page was reloaded before the 202 landed): a looser filter that is still this run's work.
 */
export function jobsOfRun(jobs: readonly JobAcrossRepos[], run: BackfillRun): JobAcrossRepos[] {
  if (run.jobIds.length > 0) {
    const ids = new Set(run.jobIds);
    return jobs.filter((job) => ids.has(job.id));
  }
  return jobs.filter((job) => run.repos.includes(job.repo_path) && job.created_at >= run.startedAt);
}

/** Per-repo done/failed/total from the run's jobs, in the run's repo order. */
export function progressByRepo(jobs: readonly JobAcrossRepos[], run: BackfillRun): RepoProgress[] {
  return run.repos.map((path) => {
    const own = jobs.filter((job) => job.repo_path === path);
    return {
      path,
      done: own.filter((job) => job.status === "done").length,
      failed: own.filter((job) => job.status === "failed" || job.status === "cancelled").length,
      total: own.length,
    };
  });
}

/**
 * `GET /api/onboarding/status` on a 2 s tick and on every `job.changed`, plus the per-repo split.
 *
 * The event is the same "what changed, never the new value" signal the Jobs view follows: it
 * re-reads rather than patching from the frame. The tick is the fallback for a stream that
 * dropped — the daemon's own job watcher polls at 2 s, so nothing faster would show more. Both
 * stop the moment `complete` is seen, and the hook stops entirely when `enabled` is false.
 */
export function useBackfillProgress(
  source: AppSource,
  run: BackfillRun | null,
  enabled: boolean,
  pollMs = PROGRESS_POLL_MS,
): BackfillProgress {
  const [status, setStatus] = useState<Async<OnboardingStatus>>({ state: "loading" });
  const [perRepo, setPerRepo] = useState<RepoProgress[]>([]);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let complete = false;

    const read = () => {
      if (!live || complete) return;
      const current = runRef.current;
      void Promise.all([
        source.status(),
        // A run whose record is gone still shows totals; only the split needs the ids.
        current === null ? Promise.resolve([] as JobAcrossRepos[]) : source.listAllJobs().catch(() => [] as JobAcrossRepos[]),
      ]).then(
        ([next, jobs]) => {
          if (!live) return;
          complete = next.complete;
          setStatus({ state: "ready", value: next });
          if (current !== null) setPerRepo(progressByRepo(jobsOfRun(jobs, current), current));
        },
        (error: unknown) => {
          if (live) setStatus({ state: "error", message: messageOf(error) });
        },
      );
    };

    read();
    const timer = setInterval(read, pollMs);
    const stop = source.subscribe((event) => {
      if (event.type === "job.changed") read();
    });
    return () => {
      live = false;
      clearInterval(timer);
      stop();
    };
  }, [source, enabled, pollMs]);

  return { status, perRepo };
}
