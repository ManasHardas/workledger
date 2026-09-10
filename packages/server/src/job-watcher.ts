/**
 * The `job.changed` half of `/api/events` — docs/contracts/p3/api.md.
 *
 * The other four events come off a file watcher, because the ledger is files. Jobs are not: they
 * are rows in `~/.workledger/index.sqlite`, written by whichever process owns the runner —
 * `workledger repair` in another terminal, a `backfill` started an hour ago, the `serve` process
 * itself. SQLite has no change feed a second process can subscribe to, so the honest mechanism is
 * the one api.md §SSE already names for the watcher's own fallback: poll and diff, every 2 s.
 *
 * Only transitions are emitted. A poll that finds the same statuses emits nothing, which is what
 * keeps an idle server's stream carrying nothing but the 15 s ping.
 */
import type { EventBus } from "./events.js";
import type { Job, JobOps } from "./jobs.js";

/** api.md §SSE's fallback cadence, which this reuses. */
export const JOB_POLL_MS = 2000;

export interface JobWatcherOptions {
  ops: JobOps;
  repoRoot: string;
  bus: EventBus;
  pollMs?: number | undefined;
  /**
   * Where a poll's failure goes. The index can be locked, mid-migration, or gone; none of that
   * is a reason to stop watching, and none of it belongs on an SSE stream.
   */
  onError?: ((error: unknown) => void) | undefined;
}

/** A running job watcher. */
export interface JobWatcher {
  /** Run one poll now, rather than waiting for the interval — the tests' whole reason to exist. */
  tick(): Promise<void>;
  close(): void;
}

/**
 * Start polling the jobs table, emitting `job.changed { id, status }` for every row that is new
 * or has moved.
 *
 * A row that disappears emits nothing: jobs are not deleted by any code path in the contract, so
 * a missing row means the index was rebuilt, and announcing a status for a job that no longer
 * exists would be worse than silence.
 */
export function startJobWatcher(options: JobWatcherOptions): JobWatcher {
  const pollMs = options.pollMs ?? JOB_POLL_MS;
  const seen = new Map<string, string>();
  let closed = false;
  // Polls never overlap: a slow index read must not queue a second one behind it.
  let inFlight = false;

  async function tick(): Promise<void> {
    if (closed || inFlight) return;
    inFlight = true;
    let jobs: Job[];
    try {
      jobs = await options.ops.listJobs(options.repoRoot);
    } catch (error) {
      options.onError?.(error);
      return;
    } finally {
      inFlight = false;
    }
    if (closed) return;
    for (const job of jobs) {
      if (seen.get(job.id) === job.status) continue;
      seen.set(job.id, job.status);
      options.bus.emit({ event: "job.changed", data: { id: job.id, status: job.status } });
    }
  }

  // The first poll seeds `seen`, so a server that starts with a queue full of old rows does not
  // announce every one of them to the first client that connects.
  let priming = true;
  const prime = async (): Promise<void> => {
    try {
      for (const job of await options.ops.listJobs(options.repoRoot)) seen.set(job.id, job.status);
    } catch (error) {
      options.onError?.(error);
    } finally {
      priming = false;
    }
  };
  const primed = prime();

  const timer = setInterval(() => void tick(), pollMs);
  // A pending interval keeps Node alive; the server's own listener is what should do that.
  timer.unref?.();

  return {
    async tick(): Promise<void> {
      if (priming) await primed;
      await tick();
    },
    close(): void {
      closed = true;
      clearInterval(timer);
    },
  };
}
