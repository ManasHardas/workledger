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
