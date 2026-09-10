/**
 * `adapters/usage-limit.ts` — the limit line a resumed `claude -p` prints when the account's
 * window is spent, and the clock arithmetic that turns "resets 1am (America/Los_Angeles)" into
 * an instant (#100). Pure, so every case runs against a fixed clock.
 */
import { describe, expect, it } from "vitest";

import { USAGE_LIMIT_FALLBACK_MS, detectUsageLimit, nextWallClock, parseResetInstant } from "../src/adapters/usage-limit.js";

/** 2026-09-10 13:00 PDT — the afternoon of the run that hit the wall. */
const NOW = new Date("2026-09-10T20:00:00.000Z");

/** The line from the 2026-09-10 logs, verbatim. */
const LINE = "You've hit your session limit · resets 1am (America/Los_Angeles)";

describe("detectUsageLimit", () => {
  it("recognizes Claude Code's session-limit line and resolves 1am Los Angeles to the next instant", () => {
    const limit = detectUsageLimit(`${LINE}\n`, NOW);
    expect(limit).toEqual({ line: LINE, resetAt: "2026-09-11T08:00:00.000Z", parsed: true });
  });

  it("finds the line inside other output, and reads 'usage limit' wording too", () => {
    const output = "Loading session…\nYou've hit your usage limit · resets 3pm (America/Los_Angeles)\n";
    expect(detectUsageLimit(output, NOW)).toMatchObject({ resetAt: "2026-09-10T22:00:00.000Z", parsed: true });
  });

  it("is not fooled by ordinary failures", () => {
    expect(detectUsageLimit("No conversation found with session ID: abc\n", NOW)).toBeUndefined();
    expect(detectUsageLimit("", NOW)).toBeUndefined();
  });

  it("still counts as the limit when the reset time cannot be read, waiting an hour", () => {
    const limit = detectUsageLimit("You've hit your session limit · resets soon\n", NOW);
    expect(limit).toMatchObject({ parsed: false, resetAt: new Date(NOW.getTime() + USAGE_LIMIT_FALLBACK_MS).toISOString() });
    expect(USAGE_LIMIT_FALLBACK_MS).toBe(60 * 60_000);
  });

  it("caps the quoted line", () => {
    const long = `You've hit your session limit ${"x".repeat(500)}`;
    expect(detectUsageLimit(long, NOW)?.line).toHaveLength(200);
  });
});

describe("parseResetInstant", () => {
  it("reads minutes, 24-hour clocks, and an 'at'", () => {
    expect(parseResetInstant("resets at 1:30pm (America/Los_Angeles)", NOW)?.toISOString()).toBe("2026-09-10T20:30:00.000Z");
    expect(parseResetInstant("resets 22:15 (Europe/Berlin)", NOW)?.toISOString()).toBe("2026-09-10T20:15:00.000Z");
  });

  it("rolls a time already past today over to tomorrow", () => {
    // 12pm PDT is 19:00Z, an hour before NOW.
    expect(parseResetInstant("resets 12pm (America/Los_Angeles)", NOW)?.toISOString()).toBe("2026-09-11T19:00:00.000Z");
  });

  it("reads the API-style epoch form", () => {
    const epoch = Date.parse("2026-09-11T07:20:00.000Z") / 1000;
    expect(parseResetInstant(`Claude AI usage limit reached|${String(epoch)}`, NOW)?.toISOString()).toBe("2026-09-11T07:20:00.000Z");
    expect(parseResetInstant(`limit reached|${String(epoch * 1000)}`, NOW)?.toISOString()).toBe("2026-09-11T07:20:00.000Z");
  });

  it("gives up on a zone Intl does not know and on an impossible clock", () => {
    expect(parseResetInstant("resets 1am (Mars/Olympus_Mons)", NOW)).toBeUndefined();
    expect(parseResetInstant("resets 13pm (America/Los_Angeles)", NOW)).toBeUndefined();
    expect(parseResetInstant("resets 25:00 (Europe/Berlin)", NOW)).toBeUndefined();
  });
});

describe("nextWallClock", () => {
  it("crosses a DST change: 1am Los Angeles after the November fall-back is PST", () => {
    // 2026-10-31 20:00Z is 13:00 PDT; the next 1am is on 2026-11-01, the day the clocks go back
    // at 02:00 — 1am that morning is still PDT, so 08:00Z.
    expect(nextWallClock("America/Los_Angeles", 1, 0, new Date("2026-10-31T20:00:00.000Z")).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    // A day later the same wall clock is PST: 09:00Z.
    expect(nextWallClock("America/Los_Angeles", 1, 0, new Date("2026-11-01T20:00:00.000Z")).toISOString()).toBe("2026-11-02T09:00:00.000Z");
  });

  it("carries the last day of a month into the next", () => {
    expect(nextWallClock("UTC", 1, 0, new Date("2026-09-30T02:00:00.000Z")).toISOString()).toBe("2026-10-01T01:00:00.000Z");
  });
});
