import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ACTIVITY_WEEKS, activityByDay, activityLevel } from "../src/features/ledger/activity.js";
import { SessionActivityGrid } from "../src/features/ledger/activity-grid.js";
import type { ParsedSession } from "../src/lib/ledger-source.js";

/** A fixed Wednesday so the window and its weekday rows are deterministic. */
const NOW = Date.parse("2026-09-30T12:00:00Z");
const TODAY = new Date(NOW).toISOString().slice(0, 10);

/** The least a session needs to be bucketed: when it started and, if it ended, when. */
function session(started: string, ended?: string): ParsedSession {
  return {
    frontmatter: { id: started, started, ended: ended ?? null, status: "ended", checkpoints: [] },
    goal: null,
    done: [],
    remaining: [],
    notes: [],
    memory: [],
    unparsed: [],
    startedIn: null,
    about: [],
  } as unknown as ParsedSession;
}

afterEach(cleanup);

describe("activityLevel", () => {
  it("is 0 only when nothing happened", () => {
    expect(activityLevel(0, 0)).toBe(0);
  });

  it("gives one session the lightest shade even when it never ended", () => {
    expect(activityLevel(1, 0)).toBe(1);
    expect(activityLevel(1, 5 * 60_000)).toBe(1);
  });

  it("darkens with more sessions", () => {
    expect(activityLevel(2, 0)).toBe(2);
    expect(activityLevel(5, 0)).toBe(3);
    expect(activityLevel(8, 0)).toBe(4);
  });

  it("darkens with longer sessions, whether or not there are many", () => {
    expect(activityLevel(1, 60 * 60_000)).toBe(2);
    expect(activityLevel(1, 3 * 60 * 60_000)).toBe(3);
    expect(activityLevel(1, 8 * 60 * 60_000)).toBe(4);
  });

  it("takes the darker of the two readings", () => {
    expect(activityLevel(1, 8 * 60 * 60_000)).toBe(4);
    expect(activityLevel(8, 5 * 60_000)).toBe(4);
  });
});

describe("activityByDay", () => {
  it("has seven days per column and the requested number of weeks", () => {
    const columns = activityByDay([], NOW, 26);
    expect(columns).toHaveLength(26);
    for (const column of columns) expect(column).toHaveLength(7);
  });

  it("ends on the current week, with days after today out of range", () => {
    const flat = activityByDay([], NOW, 4).flat();
    const today = flat.find((day) => day.date === TODAY);
    expect(today?.inRange).toBe(true);
    const future = flat.filter((day) => day.date > TODAY);
    expect(future.length).toBeGreaterThan(0);
    for (const day of future) expect(day.inRange).toBe(false);
  });

  it("buckets a session onto the UTC day it started, and sums siblings", () => {
    const day = activityByDay(
      [session(`${TODAY}T09:00:00Z`, `${TODAY}T10:00:00Z`), session(`${TODAY}T11:00:00Z`)],
      NOW,
    )
      .flat()
      .find((cell) => cell.date === TODAY)!;
    expect(day.sessions).toBe(2);
    // One hour from the ended session; the open one has no end yet and adds nothing.
    expect(day.ms).toBe(60 * 60_000);
    expect(day.level).toBe(2);
  });

  it("sizes its window from the constant", () => {
    expect(activityByDay([], NOW)).toHaveLength(ACTIVITY_WEEKS);
  });
});

describe("SessionActivityGrid", () => {
  it("labels each day with its session count and time for a screen reader", () => {
    render(<SessionActivityGrid sessions={[session(`${TODAY}T09:00:00Z`, `${TODAY}T10:00:00Z`)]} now={NOW} />);

    expect(screen.getByRole("img", { name: "30 Sep 2026: 1 session, 1 h 0 m" })).toBeDefined();
    expect(screen.getByText(/last 6 months · 1 session/)).toBeDefined();
  });

  it("calls an empty day empty", () => {
    render(<SessionActivityGrid sessions={[]} now={NOW} />);
    expect(screen.getByRole("img", { name: "30 Sep 2026: no sessions" })).toBeDefined();
  });
});
