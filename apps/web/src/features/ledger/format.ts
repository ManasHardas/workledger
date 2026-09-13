/**
 * Display helpers for ledger timestamps and counts.
 *
 * Every ledger timestamp is a UTC ISO-8601 string written by the CLI. They are rendered in UTC and
 * in one fixed shape rather than through `toLocaleString`, so the same file reads the same way on
 * every machine, in every test, and in a Dome card's iframe.
 */
export function formatInstant(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** `41,233` — a byte offset a human can compare at a glance. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** The `[cp n]` marker the session file itself carries in front of every body line. */
export function cpMarker(cp: number): string {
  return `[cp ${cp}]`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** `06:49`, UTC. */
export function formatClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

/** `11 Sep`, UTC. */
export function formatDayMonth(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${String(at.getUTCDate())} ${MONTHS_SHORT[at.getUTCMonth()]!}`;
}

/** `10 Sep 2026`, UTC. */
export function formatDayMonthYear(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${formatDayMonth(iso)} ${String(at.getUTCFullYear())}`;
}

/** `1 h 34 m`, `4 m` — whole minutes, rounded down. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${String(minutes)} m` : `${String(hours)} h ${String(minutes % 60)} m`;
}

/**
 * A Ledger day group's heading: `Today · 11 September`, else `10 September`, with the year only
 * when it is not this year. UTC calendar days, like every time on the page.
 */
export function dayHeading(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "Undated";
  const today = new Date(now);
  const label = `${String(at.getUTCDate())} ${MONTHS_LONG[at.getUTCMonth()]!}`;
  const sameDay =
    at.getUTCFullYear() === today.getUTCFullYear() &&
    at.getUTCMonth() === today.getUTCMonth() &&
    at.getUTCDate() === today.getUTCDate();
  if (sameDay) return `Today · ${label}`;
  return at.getUTCFullYear() === today.getUTCFullYear() ? label : `${label} ${String(at.getUTCFullYear())}`;
}

/** The fields of a session's frontmatter its span is read from. */
export interface SpanInput {
  started: string;
  ended?: string | null;
  checkpoints: readonly { at: string }[];
}

/**
 * How long a session ran, as the Ledger card and the Session header print it (P9 frames):
 * `06:49 – 08:23` and `1 h 34 m`. The end is `ended`, else the last checkpoint — a session still
 * open, or one that crashed, has run at least that long. The end clock is left off when it falls
 * on another UTC day, because `19:32 – 03:44` reads as running backwards.
 */
export function sessionSpan(input: SpanInput): { clocks: string; duration: string; end: string | null } {
  const end = input.ended ?? input.checkpoints.at(-1)?.at ?? null;
  const start = formatClock(input.started);
  if (end === null) return { clocks: start, duration: formatDuration(0), end: null };
  const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
  const sameDay = day(input.started) === day(end);
  return {
    clocks: sameDay ? `${start} – ${formatClock(end)}` : start,
    duration: formatDuration(Date.parse(end) - Date.parse(input.started)),
    end,
  };
}
