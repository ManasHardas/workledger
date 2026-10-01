import { useMemo } from "react";

import { cn } from "../../lib/cn.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { ACTIVITY_WEEKS, activityByDay, type ActivityDay, type ActivityLevel } from "./activity.js";
import { formatDayMonthYear, formatDuration } from "./format.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Sunday-first rows 0–6, labelled the way GitHub labels them: the three odd weekdays only. */
const WEEKDAYS = ["", "Mon", "", "Wed", "", "Fri", ""];

/**
 * The five shades. Empty days are the neutral surface; the four working shades are the accent
 * ramp, drawn as opacity over the accent token so a theme swap (light/dark) needs no second set of
 * values and the palette stays the one every other screen reads.
 */
const SHADE: Record<ActivityLevel, string> = {
  0: "bg-secondary",
  1: "bg-primary/15",
  2: "bg-primary/35",
  3: "bg-primary/60",
  4: "bg-primary",
};

const LEGEND: ActivityLevel[] = [0, 1, 2, 3, 4];

/** `9 Sep 2026: 2 sessions, 1 h 34 m`, or `: no sessions` for a blank day. */
function dayLabel(day: ActivityDay): string {
  const date = formatDayMonthYear(day.date);
  if (day.sessions === 0) return `${date}: no sessions`;
  return `${date}: ${String(day.sessions)} ${day.sessions === 1 ? "session" : "sessions"}, ${formatDuration(day.ms)}`;
}

/**
 * The month caption over a column, shown only where the month changes so it reads as a ruler along
 * the top and never collides with its neighbour.
 */
function monthLabel(columns: readonly ActivityDay[][], index: number): string {
  const month = columns[index]?.[0]?.date.slice(5, 7);
  if (month === undefined) return "";
  if (index > 0 && columns[index - 1]?.[0]?.date.slice(5, 7) === month) return "";
  return MONTHS[Number(month) - 1] ?? "";
}

/**
 * The Ledger's work grid (operator, 2026-09-30): at the top of the page, GitHub's contribution
 * graph over the last {@link ACTIVITY_WEEKS} weeks, one box per UTC day, darker the more work the
 * day holds. It sits above the filters and is deliberately not filtered — it is the repo's whole
 * shape, the way the header's counts summarize the list below it.
 *
 * Drawn as two CSS grids rather than a table: the boxes are a fixed 12 px track either way, but a
 * table would widen a column to fit a month caption and break the lattice, while an out-of-flow
 * grid item simply spills over its neighbours the way the captions need to.
 */
export function SessionActivityGrid({
  sessions,
  now,
}: {
  sessions: readonly ParsedSession[];
  /** Injected in tests so the window is deterministic; `Date.now()` in the app. */
  now?: number;
}) {
  const columns = useMemo(() => activityByDay(sessions, now, ACTIVITY_WEEKS), [sessions, now]);
  const count = columns.reduce((n, column) => n + column.reduce((m, day) => m + day.sessions, 0), 0);

  return (
    <section aria-labelledby="ledger-activity" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 id="ledger-activity" className="text-xs font-medium leading-tight text-subtle-foreground">
          Session activity
        </h2>
        <span className="text-xs leading-tight text-subtle-foreground tabular-nums">
          last 6 months · {count} {count === 1 ? "session" : "sessions"}
        </span>
        <span className="ml-auto hidden items-center gap-1 text-xs leading-tight text-subtle-foreground sm:flex">
          Less
          {LEGEND.map((level) => (
            <span key={level} aria-hidden="true" className={cn("h-3 w-3 rounded-sm", SHADE[level])} />
          ))}
          More
        </span>
      </div>

      <div className="min-w-0 overflow-x-auto pb-1">
        <div className="inline-flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 gap-1">
            <div className="w-7 shrink-0" aria-hidden="true" />
            <div className="grid auto-cols-[0.75rem] grid-flow-col gap-[3px]">
              {columns.map((_, index) => (
                <span
                  key={index}
                  className="whitespace-nowrap text-[10px] font-normal leading-none text-subtle-foreground"
                >
                  {monthLabel(columns, index)}
                </span>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 gap-1">
            <div
              className="grid w-7 shrink-0 grid-rows-[repeat(7,0.75rem)] gap-[3px] text-right"
              aria-hidden="true"
            >
              {WEEKDAYS.map((label, row) => (
                <span key={row} className="pr-1 text-[10px] font-normal leading-none text-subtle-foreground">
                  {label}
                </span>
              ))}
            </div>
            <div className="grid auto-cols-[0.75rem] grid-flow-col grid-rows-[repeat(7,0.75rem)] gap-[3px]">
              {columns.flatMap((column, week) =>
                column.map((day, row) => {
                  const label = dayLabel(day);
                  return (
                    <span
                      key={`${String(week)}-${String(row)}`}
                      role={day.inRange ? "img" : undefined}
                      aria-label={day.inRange ? label : undefined}
                      aria-hidden={day.inRange ? undefined : true}
                      title={day.inRange ? label : undefined}
                      className={cn("h-3 w-3 rounded-sm", day.inRange ? SHADE[day.level] : "bg-transparent")}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
