/**
 * Display helpers for the jobs queue — `docs/contracts/p3/cli.md` §Jobs on the wire, rendered.
 *
 * Same rule as `features/ledger/format.ts`: every timestamp is a UTC ISO-8601 string the CLI
 * wrote, so it is rendered in UTC and in one fixed shape rather than through `toLocaleString`.
 * A queue read the same way on every machine is the point — a job row is evidence.
 */
import type { Job } from "../../lib/ledger-source.js";

/** The lifecycle of a `jobs` row. `?status=` accepts exactly these (p3/api.md). */
export const JOB_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/** `--since 7d|14d|30d|all` (cli.md §backfill), as the selector offers them. */
export const SINCE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "Everything on this machine" },
];

export const DEFAULT_SINCE = "14d";

/** Which badge a status gets. `running` is the only one that is neither good news nor bad. */
export function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "running") return "default";
  if (status === "failed") return "destructive";
  if (status === "done") return "secondary";
  return "outline";
}

/** Cancel is offered only where the queue accepts it: a job that has not finished. */
export function canCancel(status: string): boolean {
  return status === "queued" || status === "running";
}

/** Retry is offered only for a job that stopped without doing its work. */
export function canRetry(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/** `2026-09-09 18:23 UTC`, or `—` for a timestamp the row does not carry yet. */
export function formatWhen(iso: string | null): string {
  if (iso === null || iso === "") return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** `1m 12s` / `840ms`. Whole seconds above one second, because nothing here is a benchmark. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m`;
}

/**
 * How long the job has been at whatever it is doing.
 *
 * A finished job reports the span it actually took; a running one reports how long it has been
 * running *as of `now`*, which the caller passes in so the value is deterministic in a test and
 * moves in a browser. A queued job has no elapsed time at all — it has a wait, which the `created`
 * column already shows.
 */
export function elapsed(job: Job, now: number): string {
  if (job.started_at === null) return "—";
  const from = Date.parse(job.started_at);
  if (Number.isNaN(from)) return "—";
  const to = job.finished_at === null ? now : Date.parse(job.finished_at);
  if (Number.isNaN(to)) return "—";
  return formatDuration(to - from);
}

/** `41,233` — the same grouping the provenance panel uses for byte counts. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** `1.4 MB`. Decimal units, because the estimate is about time-to-read, not about blocks. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]!}`;
}

/**
 * `$0.02`. Two decimals down to a cent and four below it, so an estimate of a third of a cent
 * reads as `$0.0033` rather than as a free `$0.00` the operator would consent to without thinking.
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "—";
  return usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/**
 * When a queued job is waiting for the harness's usage window (#100), or `undefined`.
 *
 * `retry_after` is only a wait while it is still ahead of `now`: a row whose instant has passed
 * is an ordinary queued job the runner will claim on its next pass.
 */
export function waitingUntil(job: Pick<Job, "status" | "retry_after">, now: number): string | undefined {
  if (job.status !== "queued" || job.retry_after === null) return undefined;
  const at = Date.parse(job.retry_after);
  if (Number.isNaN(at) || at <= now) return undefined;
  return job.retry_after;
}

/**
 * `1:00 AM`, or `Sep 11, 1:00 AM` when that is not today — in the *viewer's* zone, the one
 * exception to this file's UTC rule. The harness names the reset in the operator's own zone
 * ("resets 1am (America/Los_Angeles)"), and "wait until 08:00 UTC" would send them to a
 * converter to learn what they were just told.
 */
export function formatLocalTime(iso: string, now: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const sameDay = at.toDateString() === new Date(now).toDateString();
  return at.toLocaleString(
    undefined,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

/** The one sentence the Jobs card and the wizard share for a usage-window wait (#100). */
export function waitingSentence(retryAfter: string, now: number): string {
  return `Waiting for your Claude usage window to reset at ${formatLocalTime(retryAfter, now)}`;
}

/** The tail of a ULID — enough to tell two rows apart without a column of 26 characters. */
export function shortId(id: string): string {
  return id.length <= 8 ? id : `…${id.slice(-8)}`;
}
