/**
 * Display helpers for the Home cards.
 *
 * The one place the UI shows a *relative* time: a card is a glance, and "3 h ago" answers "is
 * this repo alive?" faster than a UTC instant does. `now` is an argument so a test and a
 * screenshot are deterministic; the view passes `Date.now()`.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `never`, `just now`, `5 min ago`, `3 h ago`, `2 d ago`; an unparseable value is shown as is. */
export function formatRelative(iso: string | null, now: number): string {
  if (iso === null || iso === "") return "never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return `${String(Math.floor(ago / MINUTE))} min ago`;
  if (ago < DAY) return `${String(Math.floor(ago / HOUR))} h ago`;
  return `${String(Math.floor(ago / DAY))} d ago`;
}

/** `1 session` / `4 sessions`. */
export function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The Figma frames' relative time (P9): `just now`, `2 minutes ago`, `4 hours ago`, `yesterday`,
 * `2 days ago`, `never`.
 *
 * Under twelve hours it counts hours, so an hour-old checkpoint that crossed midnight is still
 * "1 hour ago"; past that it counts UTC calendar days, which is what makes last night's work
 * "yesterday" rather than "23 hours ago". UTC because every other time on the page is UTC.
 */
export function formatAgo(iso: string | null, now: number): string {
  if (iso === null || iso === "") return "never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return `${plural(Math.floor(ago / MINUTE), "minute")} ago`;
  const days = Math.round((utcMidnight(now) - utcMidnight(at)) / DAY);
  if (ago < 12 * HOUR || days === 0) return `${plural(Math.floor(ago / HOUR), "hour")} ago`;
  return days === 1 ? "yesterday" : `${String(days)} days ago`;
}

function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
