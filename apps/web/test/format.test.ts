import { describe, expect, it } from "vitest";

import { formatAgo } from "../src/features/home/format.js";
import {
  dayHeading,
  formatClock,
  formatDayMonth,
  formatDayMonthYear,
  formatDuration,
  sessionSpan,
} from "../src/features/ledger/format.js";

const NOW = Date.parse("2026-09-11T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("formatAgo — the Figma frames' relative time", () => {
  it.each([
    [null, "never"],
    [new Date(NOW - 20_000).toISOString(), "just now"],
    [new Date(NOW - MIN).toISOString(), "1 minute ago"],
    [new Date(NOW - 2 * MIN).toISOString(), "2 minutes ago"],
    [new Date(NOW - HOUR).toISOString(), "1 hour ago"],
    [new Date(NOW - 4 * HOUR).toISOString(), "4 hours ago"],
    ["2026-09-10T20:00:00Z", "yesterday"],
    ["2026-09-09T12:00:00Z", "2 days ago"],
  ])("%s → %s", (iso, expected) => {
    expect(formatAgo(iso, NOW)).toBe(expected);
  });

  it("calls anything on the previous calendar day yesterday, even under 24 hours ago", () => {
    expect(formatAgo("2026-09-10T23:30:00Z", Date.parse("2026-09-11T00:30:00Z"))).toBe("1 hour ago");
    expect(formatAgo("2026-09-10T09:00:00Z", Date.parse("2026-09-11T08:00:00Z"))).toBe("yesterday");
  });
});

describe("ledger formats — UTC, one shape everywhere", () => {
  it("formats clocks, days and durations", () => {
    expect(formatClock("2026-09-11T06:49:30Z")).toBe("06:49");
    expect(formatDayMonth("2026-09-11T06:49:30Z")).toBe("11 Sep");
    expect(formatDayMonthYear("2026-09-10T19:32:00Z")).toBe("10 Sep 2026");
    expect(formatDuration(94 * MIN)).toBe("1 h 34 m");
    expect(formatDuration(4 * MIN + 10_000)).toBe("4 m");
    expect(formatDuration(8 * HOUR + 12 * MIN)).toBe("8 h 12 m");
    expect(formatDuration(2 * HOUR)).toBe("2 h 0 m");
    expect(formatDuration(0)).toBe("0 m");
  });

  it("heads a day group with Today only for today", () => {
    expect(dayHeading("2026-09-11T06:49:00Z", NOW)).toBe("Today · 11 September");
    expect(dayHeading("2026-09-10T19:32:00Z", NOW)).toBe("10 September");
    expect(dayHeading("2025-12-31T19:32:00Z", NOW)).toBe("31 December 2025");
  });

  it("spans a session from its start to its end, or to its last checkpoint", () => {
    const base = { started: "2026-09-11T06:49:00Z", checkpoints: [{ at: "2026-09-11T07:10:00Z" }] };
    expect(sessionSpan({ ...base, ended: "2026-09-11T08:23:00Z" })).toEqual({
      clocks: "06:49 – 08:23",
      duration: "1 h 34 m",
      end: "2026-09-11T08:23:00Z",
    });
    expect(sessionSpan({ ...base, ended: null })).toEqual({
      clocks: "06:49 – 07:10",
      duration: "21 m",
      end: "2026-09-11T07:10:00Z",
    });
    // An end on another UTC day shows the start alone: "19:32 · 8 h 12 m".
    expect(
      sessionSpan({ started: "2026-09-10T19:32:00Z", ended: "2026-09-11T03:44:00Z", checkpoints: [] }),
    ).toEqual({ clocks: "19:32", duration: "8 h 12 m", end: "2026-09-11T03:44:00Z" });
    expect(sessionSpan({ started: "2026-09-10T19:32:00Z", checkpoints: [] })).toEqual({
      clocks: "19:32",
      duration: "0 m",
      end: null,
    });
  });
});
