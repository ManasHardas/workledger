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
