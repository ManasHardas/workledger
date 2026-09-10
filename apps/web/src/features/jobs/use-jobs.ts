import { useCallback, useEffect, useRef, useState } from "react";

import { messageOf } from "../../lib/errors.js";
import { useSource } from "../../lib/source-context.js";

import type { Job, LedgerSource } from "../../lib/ledger-source.js";

/** The list's three read states. Per-row write failures live in `errors`, keyed by job id. */
export type JobsState<J extends Job = Job> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; value: J[] };

export interface JobsQueue<J extends Job = Job> {
  result: JobsState<J>;
  /** The last failure per job id, cleared when that row's next write starts. */
  errors: Record<string, string>;
  /** Ids with a write in flight, so their buttons disable without freezing the list. */
  pending: Record<string, true>;
  /** Run one `LedgerSource` call against a row and reconcile the list with what it returns. */
  act: (id: string, call: () => Promise<Job>) => void;
  reload: () => void;
}

/** `map` without `key`, spelled so eslint's no-unused-vars has nothing to say about it. */
function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

/**
 * A row's replacement keeps whatever the list's element type carried beyond `Job` — the `repo`
 * of an aggregate row — because a `cancelJob` answers with a bare `Job`.
 */
function replace<J extends Job>(jobs: J[], next: Job): J[] {
  const at = jobs.findIndex((job) => job.id === next.id);
  if (at < 0) return [next as J, ...jobs];
  return jobs.map((job, i) => (i === at ? { ...job, ...next } : job));
}

/** Newest first — the order p3/api.md promises, re-applied here rather than trusted. */
function newestFirst<J extends Job>(jobs: J[]): J[] {
  return [...jobs].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * The queue, live.
 *
 * `job.changed` carries `{ id, status }` and nothing else — the same "what changed, never the new
 * value" rule the rest of the SSE contract follows — so an event re-reads the list rather than
 * patching a row from the event. That is what makes a job the CLI ran, a job this view queued and
 * a job `serve`'s own 5-minute sweep queued all converge to the same list.
 *
 * A source whose `capabilities.live` is false returns a no-op unsubscribe, so nothing here
 * branches on the capability: the list simply stays where the last read left it.
 */
export function useJobs(status?: string): JobsQueue {
  const source = useSource();
  return useJobList(
    useCallback(() => source.listJobs(status), [source, status]),
    source,
  );
}

/**
 * The machinery behind {@link useJobs}, over any list read and any event stream: the per-repo
 * queue reads `listJobs` through its scoped source, the machine-wide one (P8) reads
 * `listAllJobs` and listens on the unscoped stream, where every repo's `job.changed` arrives.
 */
export function useJobList<J extends Job>(list: () => Promise<J[]>, events: Pick<LedgerSource, "subscribe">): JobsQueue<J> {
  const [result, setResult] = useState<JobsState<J>>({ state: "loading" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, true>>({});
  const live = useRef(true);

  const reload = useCallback(() => {
    list().then(
      (jobs) => {
        if (live.current) setResult({ state: "ready", value: newestFirst(jobs) });
      },
      (error: unknown) => {
        if (live.current) setResult({ state: "error", message: messageOf(error) });
      },
    );
  }, [list]);

  useEffect(() => {
    live.current = true;
    reload();
    const stop = events.subscribe((event) => {
      if (event.type === "job.changed") reload();
    });
    return () => {
      live.current = false;
      stop();
    };
  }, [reload, events]);

  const act = useCallback((id: string, call: () => Promise<Job>) => {
    setErrors((prior) => without(prior, id));
    setPending((prior) => ({ ...prior, [id]: true }));
    call().then(
      (job) => {
        if (!live.current) return;
        setPending((prior) => without(prior, id));
        setResult((prior) =>
          prior.state === "ready" ? { state: "ready", value: newestFirst(replace(prior.value, job)) } : prior,
        );
      },
      (error: unknown) => {
        if (!live.current) return;
        setPending((prior) => without(prior, id));
        setErrors((prior) => ({ ...prior, [id]: messageOf(error) }));
      },
    );
  }, []);

  return { result, errors, pending, act, reload };
}

/** One-shot action state — scan, backfill, repair: the calls that are not about a single row. */
export type ActionState<T> =
  | { state: "idle" }
  | { state: "running" }
  | { state: "failed"; error: unknown }
  | { state: "done"; value: T };

export interface Action<A extends unknown[], T> {
  state: ActionState<T>;
  run: (...args: A) => void;
  reset: () => void;
}

/**
 * Runs one `LedgerSource` call and reports all four states, keeping the *rejection* rather than
 * only its message: the consent flow has to read `code` and the `estimate` beside it, and a
 * `catch` that stringified the error first would throw the number away.
 */
export function useAction<A extends unknown[], T>(call: (...args: A) => Promise<T>): Action<A, T> {
  const [state, setState] = useState<ActionState<T>>({ state: "idle" });
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const run = useCallback(
    (...args: A) => {
      setState({ state: "running" });
      call(...args).then(
        (value) => {
          if (live.current) setState({ state: "done", value });
        },
        (error: unknown) => {
          if (live.current) setState({ state: "failed", error });
        },
      );
    },
    [call],
  );

  const reset = useCallback(() => setState({ state: "idle" }), []);
  return { state, run, reset };
}

/**
 * `Date.now()`, re-read every `ms` while `enabled`.
 *
 * The queue shows how long a running job has been running, which is a number that has to move on
 * its own — nothing sends an event once a second. The tick stops the moment nothing is running, so
 * an idle Jobs view re-renders exactly never.
 */
export function useNow(enabled: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [enabled, ms]);
  return now;
}
