/**
 * The work grid's arithmetic: one cell per UTC calendar day over the trailing window, each shaded
 * by how much work that day carries (GitHub's contribution graph, in the ledger's own palette).
 *
 * A day's darkness is the worse of two readings — how many sessions *started* that day, and how
 * long they ran for — so a day with more sessions and a day with longer ones both come out darker
 * (the operator's ask, 2026-09-30). A session that crosses midnight counts on the day it started,
 * the same day its card is grouped under ({@link groupByDay}).
 *
 * Pure and framework-free, so the bucketing can be reasoned about and tested without a DOM.
 */
import type { ParsedSession } from "../../lib/ledger-source.js";
import { sessionSpan } from "./format.js";

/** The graphite's five shades: none, then four steps of ink. */
export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

/** One UTC day of the grid. */
export interface ActivityDay {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  /** How many sessions started this day. */
  sessions: number;
  /** Total time those sessions ran, in ms; a session with no end yet contributes zero. */
  ms: number;
  level: ActivityLevel;
  /** False for the trailing days of the current week that have not happened yet. */
  inRange: boolean;
}

/** The default window, in weeks: a rolling half-year, which fits the reading column whole. */
export const ACTIVITY_WEEKS = 26;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * How dark one day is, from the two things the operator wanted counted.
 *
 * Both readings are bucketed on their own and the day takes the larger: one session alone is never
 * the lightest shade (a five-minute session happened), and one long session reaches the darkest
 * without waiting for company.
 */
export function activityLevel(sessions: number, ms: number): ActivityLevel {
  const byCount: ActivityLevel =
    sessions <= 0 ? 0 : sessions === 1 ? 1 : sessions <= 3 ? 2 : sessions <= 6 ? 3 : 4;
  const byTime: ActivityLevel =
    ms <= 0 ? 0 : ms <= 30 * MINUTE_MS ? 1 : ms <= 2 * HOUR_MS ? 2 : ms <= 6 * HOUR_MS ? 3 : 4;
  return (byCount > byTime ? byCount : byTime) as ActivityLevel;
}

/**
 * The grid as columns of seven days (Sunday first, like GitHub), oldest week first, the current
 * week last. `weeks` columns, so the last row ends on or after today and any future day is marked
 * `inRange: false`.
 */
export function activityByDay(
  sessions: readonly ParsedSession[],
  now: number = Date.now(),
  weeks: number = ACTIVITY_WEEKS,
): ActivityDay[][] {
  const today = startOfUtcDay(now);
  const weekday = new Date(today).getUTCDay();
  const first = today - ((weeks - 1) * 7 + weekday) * DAY_MS;

  const totals = new Map<string, { sessions: number; ms: number }>();
  for (const session of sessions) {
    const started = Date.parse(session.frontmatter.started);
    if (Number.isNaN(started)) continue;
    const key = dayKey(started);
    const bucket = totals.get(key) ?? { sessions: 0, ms: 0 };
    bucket.sessions += 1;
    const span = sessionSpan(session.frontmatter);
    if (span.end !== null) bucket.ms += Math.max(0, Date.parse(span.end) - started);
    totals.set(key, bucket);
  }

  const columns: ActivityDay[][] = [];
  for (let week = 0; week < weeks; week++) {
    const column: ActivityDay[] = [];
    for (let day = 0; day < 7; day++) {
      const at = first + (week * 7 + day) * DAY_MS;
      const date = dayKey(at);
      const total = totals.get(date) ?? { sessions: 0, ms: 0 };
      column.push({
        date,
        sessions: total.sessions,
        ms: total.ms,
        level: activityLevel(total.sessions, total.ms),
        inRange: at <= today,
      });
    }
    columns.push(column);
  }
  return columns;
}

function startOfUtcDay(ms: number): number {
  const at = new Date(ms);
  at.setUTCHours(0, 0, 0, 0);
  return at.getTime();
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
