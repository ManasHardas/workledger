import { describe, expect, it } from "vitest";

import {
  BACKLOG_ID_PATTERN,
  BACKLOG_ID_PREFIX,
  ULID_LENGTH,
  ULID_PATTERN,
  createUlidFactory,
  isBacklogId,
  isUlid,
  newBacklogId,
  newSessionId,
  ulidTime,
} from "../src/index.js";

/** The frozen shape from `session-frontmatter.schema.json` §`id`, spelled out independently. */
const CONTRACT_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** The frozen shape from `backlog-item.schema.json` §`id`. */
const CONTRACT_BACKLOG_ID = /^WL-[0-9A-HJKMNP-TV-Z]{26}$/;

/** A clock that never moves, so every id lands in the same millisecond. */
function frozenClock(ms: number): () => number {
  return () => ms;
}

/** Deterministic entropy, so a test's id stream is reproducible. */
function fixedRandom(fill: number): () => Uint8Array {
  return () => new Uint8Array(10).fill(fill);
}

describe("newSessionId", () => {
  it("session ids match the frozen ULID pattern", () => {
    const ids = Array.from({ length: 1000 }, () => newSessionId());
    const offenders = ids.filter((id) => !CONTRACT_ULID.test(id));
    expect(offenders).toEqual([]);
    expect(ULID_PATTERN.source).toBe(CONTRACT_ULID.source);
  });

  it("mints 26 uppercase Crockford characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const id = newSessionId();
      expect(id).toHaveLength(ULID_LENGTH);
      expect(id).toHaveLength(26);
      expect(id).toBe(id.toUpperCase());
      // Crockford drops I, L, O and U so the id cannot be misread aloud.
      expect(id).not.toMatch(/[ILOU]/);
    }
  });

  it("ids generated in one tick sort lexicographically", () => {
    const ids = Array.from({ length: 1000 }, () => newSessionId());
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("newBacklogId", () => {
  it("backlog ids match the frozen WL pattern", () => {
    const ids = Array.from({ length: 1000 }, () => newBacklogId());
    const offenders = ids.filter((id) => !CONTRACT_BACKLOG_ID.test(id));
    expect(offenders).toEqual([]);
    expect(BACKLOG_ID_PATTERN.source).toBe(CONTRACT_BACKLOG_ID.source);
  });

  it("is the WL- prefix followed by a bare ULID", () => {
    const id = newBacklogId();
    expect(id.startsWith(BACKLOG_ID_PREFIX)).toBe(true);
    expect(isUlid(id.slice(BACKLOG_ID_PREFIX.length))).toBe(true);
  });

  it("shares the process id stream with session ids, so both stay mutually ordered", () => {
    const session = newSessionId();
    const backlog = newBacklogId().slice(BACKLOG_ID_PREFIX.length);
    expect(backlog > session).toBe(true);
  });
});

describe("createUlidFactory monotonicity", () => {
  it("strictly increases inside a single millisecond with a frozen clock", () => {
    const next = createUlidFactory({ now: frozenClock(1_757_419_200_000), random: fixedRandom(0) });
    const ids = Array.from({ length: 500 }, () => next());
    for (let i = 1; i < ids.length; i += 1) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
    // Same millisecond means an identical 10-character time field for every id.
    const timeFields = new Set(ids.map((id) => id.slice(0, 10)));
    expect(timeFields.size).toBe(1);
  });

  it("increments the random field rather than redrawing it", () => {
    const next = createUlidFactory({ now: frozenClock(0), random: fixedRandom(0) });
    expect(next()).toBe("0000000000" + "0000000000000000");
    expect(next()).toBe("0000000000" + "0000000000000001");
    expect(next()).toBe("0000000000" + "0000000000000002");
  });

  it("does not go backwards when the clock does", () => {
    let ms = 2_000;
    const next = createUlidFactory({ now: () => ms, random: fixedRandom(7) });
    const first = next();
    ms = 1_000; // NTP correction or a leap second
    const second = next();
    expect(second > first).toBe(true);
    expect(ulidTime(second)).toBe(2_000);
  });

  it("draws fresh entropy once the clock advances", () => {
    let ms = 10;
    let draws = 0;
    const next = createUlidFactory({
      now: () => ms,
      random: () => {
        draws += 1;
        return new Uint8Array(10).fill(draws);
      },
    });
    next();
    next();
    expect(draws).toBe(1);
    ms = 11;
    next();
    expect(draws).toBe(2);
  });

  it("throws when the random field overflows inside one millisecond", () => {
    const next = createUlidFactory({ now: frozenClock(5), random: fixedRandom(0xff) });
    expect(next()).toBe(`0000000005${"Z".repeat(16)}`);
    expect(() => next()).toThrow(/overflowed/);
  });

  it("rejects a clock outside the 48-bit time field", () => {
    const next = createUlidFactory({ now: frozenClock(281_474_976_710_656), random: fixedRandom(0) });
    expect(() => next()).toThrow(RangeError);
  });

  it("rejects a non-finite clock", () => {
    const next = createUlidFactory({ now: () => Number.NaN, random: fixedRandom(0) });
    expect(() => next()).toThrow(RangeError);
  });

  it("rejects entropy of the wrong width", () => {
    const next = createUlidFactory({ now: frozenClock(1), random: () => new Uint8Array(4) });
    expect(() => next()).toThrow(TypeError);
  });

  it("refuses to mint ids when the runtime has no Web Crypto", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      // Default entropy only: an injected `random` never touches Web Crypto.
      expect(() => createUlidFactory()()).toThrow(/getRandomValues/);
    } finally {
      if (original === undefined) {
        delete (globalThis as Record<string, unknown>)["crypto"];
      } else {
        Object.defineProperty(globalThis, "crypto", original);
      }
    }
  });

  it("copies caller-supplied entropy instead of mutating it", () => {
    const shared = new Uint8Array(10);
    const next = createUlidFactory({ now: frozenClock(1), random: () => shared });
    next();
    next();
    expect([...shared]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("ulidTime", () => {
  it("recovers the millisecond a ULID was minted in", () => {
    for (const ms of [0, 1, 1_757_419_200_123, 281_474_976_710_655]) {
      const next = createUlidFactory({ now: frozenClock(ms), random: fixedRandom(0) });
      expect(ulidTime(next())).toBe(ms);
    }
  });

  it("accepts a WL- backlog id as well as a bare ULID", () => {
    const id = newBacklogId();
    const time = ulidTime(id);
    expect(time).toBeLessThanOrEqual(Date.now());
    expect(ulidTime(id.slice(BACKLOG_ID_PREFIX.length))).toBe(time);
  });

  it("tracks the wall clock for a default-constructed id", () => {
    const before = Date.now();
    const id = newSessionId();
    const after = Date.now();
    expect(ulidTime(id)).toBeGreaterThanOrEqual(before);
    expect(ulidTime(id)).toBeLessThanOrEqual(after);
  });

  it("rejects anything that is not a ULID", () => {
    for (const bad of ["", "not-a-ulid", "0".repeat(25), "0".repeat(27), `I${"0".repeat(25)}`]) {
      expect(() => ulidTime(bad)).toThrow(TypeError);
    }
  });
});

describe("isUlid / isBacklogId", () => {
  it("accepts what the generators mint", () => {
    expect(isUlid(newSessionId())).toBe(true);
    expect(isBacklogId(newBacklogId())).toBe(true);
  });

  it("rejects the other kind of id and non-strings", () => {
    const session = newSessionId();
    expect(isBacklogId(session)).toBe(false);
    expect(isUlid(BACKLOG_ID_PREFIX + session)).toBe(false);
    for (const bad of [undefined, null, 42, {}, [], "wl-" + session, session.toLowerCase()]) {
      expect(isUlid(bad)).toBe(false);
      expect(isBacklogId(bad)).toBe(false);
    }
  });
});
