/**
 * Recognizing a harness that stopped because its subscription window is used up — #100.
 *
 * Claude Code in `-p` mode prints one line and exits 1 when the account's session or usage
 * window is spent: "You've hit your session limit · resets 1am (America/Los_Angeles)". Nothing
 * about that is a fault in the session being resumed, so a repair that meets it must not be
 * failed and retried the way an ordinary non-zero exit is; it must wait for the reset. This
 * module is the recognizer and the clock arithmetic — pure, no I/O, so the repair path and its
 * tests share one definition of "the limit line".
 *
 * The reset time is a wall-clock hour in a named IANA zone, never an instant, so `Intl` is used
 * to find the next occurrence of that wall-clock time in that zone (no dependency; DST is
 * handled by re-reading the zone offset at the guessed instant). A line that names no time this
 * can read still counts as the limit — the fallback is an hour from now, which the issue chose
 * over guessing a longer window.
 */

/** What a limit line said, and when to try again. */
export interface UsageLimit {
  /** The line the harness printed, trimmed and capped, for the job's `error`. */
  line: string;
  /** ISO instant at which the window is expected to reset. */
  resetAt: string;
  /** `true` when `resetAt` was read from the line; `false` for the one-hour fallback. */
  parsed: boolean;
}

/** How long a job waits when the limit line names no reset time this recognizer can read. */
export const USAGE_LIMIT_FALLBACK_MS = 60 * 60_000;

/** The longest line kept in a job's error — a runaway line is still a runaway line. */
const MAX_LINE = 200;

/** The wording Claude Code uses for its session and usage windows (issue #100's regex). */
const LIMIT_LINE = /session limit|usage limit|resets \d/i;

/** `resets 1am (America/Los_Angeles)`, `resets at 3:30 pm (Europe/Berlin)`, `resets 14:00`. */
const RESET_CLOCK =
  /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)\))?/i;

/** The API-style form some builds print: `Claude AI usage limit reached|1757577600`. */
const RESET_EPOCH = /limit reached\|(\d{10,13})\b/i;

/**
 * Find the limit line in a resume's output and work out when to try again.
 *
 * @returns `undefined` when no line looks like the limit; the output is then an ordinary
 * failure and the caller reports it as one.
 */
export function detectUsageLimit(output: string, now: Date): UsageLimit | undefined {
  const line = output
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => LIMIT_LINE.test(candidate));
  if (line === undefined) return undefined;

  const parsed = parseResetInstant(line, now);
  return {
    line: line.slice(0, MAX_LINE),
    resetAt: (parsed ?? new Date(now.getTime() + USAGE_LIMIT_FALLBACK_MS)).toISOString(),
    parsed: parsed !== undefined,
  };
}

/** The reset instant named on `line`, or `undefined` when it names none this can read. */
export function parseResetInstant(line: string, now: Date): Date | undefined {
  const epoch = RESET_EPOCH.exec(line);
  if (epoch?.[1] !== undefined) {
    const digits = epoch[1];
    const at = new Date(digits.length > 10 ? Number(digits) : Number(digits) * 1000);
    return Number.isNaN(at.getTime()) ? undefined : at;
  }

  const clock = RESET_CLOCK.exec(line);
  if (clock?.[1] === undefined) return undefined;
  let hour = Number(clock[1]);
  const minute = clock[2] === undefined ? 0 : Number(clock[2]);
  const meridiem = clock[3]?.toLowerCase();
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return undefined;

  // No zone on the line means the harness printed the machine's own; Claude Code always names
  // one, so this branch is the defensive one.
  const zone = clock[4] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return nextWallClock(zone, hour, minute, now);
  } catch {
    // `Intl` throws a RangeError for a zone it does not know. The line still says "limit"; the
    // caller falls back to an hour.
    return undefined;
  }
}

/** A wall-clock reading of `at` in `zone`. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** `at`, as a clock on the wall in `zone` would show it. Throws for an unknown zone. */
function wallClock(zone: string, at: Date): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  // Some ICU builds print midnight as "24" even under h23.
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

/** The zone's UTC offset at `at`, in milliseconds. */
function offsetMs(zone: string, at: Date): number {
  const wall = wallClock(zone, at);
  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - at.getTime()
  );
}

/**
 * The instant at which a clock in `zone` reads `year-month-day hour:minute`.
 *
 * Guess the instant as if the zone were UTC, read the zone's offset at that guess, and correct
 * once more at the corrected instant — the second pass is what gets a time just across a DST
 * change right.
 */
function instantFor(zone: string, wall: Omit<WallClock, "second">): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const first = naive - offsetMs(zone, new Date(naive));
  return new Date(naive - offsetMs(zone, new Date(first)));
}

/** The next time a clock in `zone` reads `hour:minute`, strictly after `now`. */
export function nextWallClock(zone: string, hour: number, minute: number, now: Date): Date {
  const today = wallClock(zone, now);
  const candidate = instantFor(zone, { ...today, hour, minute });
  if (candidate.getTime() > now.getTime()) return candidate;
  // `Date.UTC` carries a day past the end of the month into the next one.
  return instantFor(zone, { ...today, day: today.day + 1, hour, minute });
}
