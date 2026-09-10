/**
 * `subscribe` — the live half of the contract: a real SSE stream from `packages/server`, and the
 * reconnect the browser's own `EventSource` does not give (`src/events.ts`).
 */
import { appendFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { repoId } from "@workledger/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  backoffDelay,
  createSource,
  globalEventSource,
  globalFetch,
  subscribeSse,
  toLedgerEvent,
} from "../src/index.js";
import { sseSource, startHarness, waitFor } from "./helpers.js";
import type { EventSourceLike, LedgerEvent, MessageEventLike } from "../src/index.js";
import type { Harness } from "./helpers.js";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.stop();
});

describe("live stream", () => {
  it("receives backlog.changed after a backlog file is touched", async () => {
    const source = createSource("local", { baseUrl: harness.baseUrl, EventSource: sseSource });
    const events: LedgerEvent[] = [];
    const unsubscribe = source.subscribe((event) => events.push(event));

    try {
      const backlog = path.join(harness.ledger, "backlog");
      const file = readdirSync(backlog).find((name) => name.endsWith(".md"));
      expect(file).toBeDefined();
      const id = file!.replace(/\.md$/, "");

      // The stream has to be connected before the write, or the watcher's event predates the
      // subscription and nothing is delivered.
      await new Promise((resolve) => setTimeout(resolve, 300));
      appendFileSync(path.join(backlog, file!), "\n<!-- touched by the api-client test -->\n");

      await waitFor(
        () => events.some((e) => e.type === "backlog.changed"),
        8000,
        "backlog.changed",
      );
      const changed = events.find((e) => e.type === "backlog.changed");
      // P8: the server stamps its repo id on every frame; the client passes it through.
      expect(changed).toEqual({ type: "backlog.changed", id, repo: repoId(harness.root) });
    } finally {
      unsubscribe();
    }
  });

  it("receives session.changed and notes.changed after a session file is touched", async () => {
    const source = createSource("local", { baseUrl: harness.baseUrl, EventSource: sseSource });
    const events: LedgerEvent[] = [];
    const unsubscribe = source.subscribe((event) => events.push(event));

    try {
      const sessions = path.join(harness.ledger, "sessions");
      const file = readdirSync(sessions).find((name) => name.endsWith(".md"))!;
      await new Promise((resolve) => setTimeout(resolve, 300));
      appendFileSync(path.join(sessions, file), "\n");

      await waitFor(() => events.some((e) => e.type === "notes.changed"), 8000, "notes.changed");
      expect(events.some((e) => e.type === "session.changed")).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it("stops delivering after unsubscribe, and unsubscribing twice is a no-op", async () => {
    const source = createSource("local", { baseUrl: harness.baseUrl, EventSource: sseSource });
    const events: LedgerEvent[] = [];
    const unsubscribe = source.subscribe((event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 300));
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();

    const sessions = path.join(harness.ledger, "sessions");
    const file = readdirSync(sessions).find((name) => name.endsWith(".md"))!;
    appendFileSync(path.join(sessions, file), "\n");
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(events).toEqual([]);
  });
});

describe("frame decoding", () => {
  it("maps each contract event onto its LedgerEvent", () => {
    expect(toLedgerEvent("session.changed", '{"ulid":"01A"}')).toEqual({
      type: "session.changed",
      ulid: "01A",
    });
    expect(toLedgerEvent("backlog.changed", '{"id":"bl-1"}')).toEqual({
      type: "backlog.changed",
      id: "bl-1",
    });
    expect(toLedgerEvent("notes.changed", "{}")).toEqual({ type: "notes.changed" });
    expect(toLedgerEvent("health.changed", "")).toEqual({ type: "health.changed" });
  });

  it("drops the keep-alive, unknown names, bad JSON and a missing id", () => {
    // A `ping` is the stream's liveness proof, not a ledger change: forwarding it would make
    // every subscriber re-fetch every 15 s.
    expect(toLedgerEvent("ping", "{}")).toBeUndefined();
    expect(toLedgerEvent("message", "{}")).toBeUndefined();
    expect(toLedgerEvent("session.changed", "{not json")).toBeUndefined();
    expect(toLedgerEvent("session.changed", "{}")).toBeUndefined();
    expect(toLedgerEvent("backlog.changed", "null")).toBeUndefined();
  });
});

describe("backoff", () => {
  it("doubles from the base and clamps at the contract's 10 s", () => {
    expect(backoffDelay(0)).toBe(RETRY_BASE_MS);
    expect(backoffDelay(1)).toBe(RETRY_BASE_MS * 2);
    expect(backoffDelay(2)).toBe(RETRY_BASE_MS * 4);
    expect(backoffDelay(4)).toBe(RETRY_BASE_MS * 16);
    expect(backoffDelay(5)).toBe(RETRY_MAX_MS);
    // The exponent would overflow to Infinity long before this; the cap has to hold anyway.
    expect(backoffDelay(200)).toBe(RETRY_MAX_MS);
    expect(backoffDelay(-1)).toBe(RETRY_BASE_MS);
    expect(backoffDelay(3, 10, 40)).toBe(40);
  });
});

describe("reconnect", () => {
  /** An `EventSource` that never connects: every instance fails on the next tick. */
  class Flaky implements EventSourceLike {
    static opened: string[] = [];
    onerror: ((event: unknown) => void) | null = null;
    closed = false;
    readonly #listeners = new Map<string, (event: MessageEventLike) => void>();

    constructor(url: string) {
      Flaky.opened.push(url);
      Flaky.last = this;
    }

    static last: Flaky | undefined;

    addEventListener(type: string, listener: (event: MessageEventLike) => void): void {
      this.#listeners.set(type, listener);
    }

    close(): void {
      this.closed = true;
    }

    emit(type: string, data: string): void {
      this.#listeners.get(type)?.({ data });
    }
  }

  it("reopens with a growing delay and stops when unsubscribed", () => {
    Flaky.opened = [];
    const delays: number[] = [];
    const pending: (() => void)[] = [];
    const unsubscribe = subscribeSse({
      url: "http://127.0.0.1:1/api/events",
      handler: () => {},
      EventSource: Flaky,
      retryBaseMs: 100,
      retryMaxMs: 400,
      setTimeout: (fn, ms) => {
        delays.push(ms);
        pending.push(fn);
        return pending.length;
      },
      clearTimeout: () => {},
    });

    // Four consecutive failures: the delay doubles until it hits the cap.
    for (let i = 0; i < 4; i += 1) {
      Flaky.last!.onerror?.(new Error("dead"));
      pending.shift()!();
    }
    expect(delays).toEqual([100, 200, 400, 400]);
    expect(Flaky.opened).toHaveLength(5);
    expect(Flaky.opened.every((url) => url.endsWith("/api/events"))).toBe(true);

    unsubscribe();
    expect(Flaky.last!.closed).toBe(true);
    Flaky.last!.onerror?.(new Error("dead"));
    expect(delays).toHaveLength(4);
  });

  it("resets the backoff once a frame arrives", () => {
    Flaky.opened = [];
    const delays: number[] = [];
    const pending: (() => void)[] = [];
    const seen: LedgerEvent[] = [];
    const unsubscribe = subscribeSse({
      url: "http://127.0.0.1:1/api/events",
      handler: (event) => seen.push(event),
      EventSource: Flaky,
      retryBaseMs: 100,
      retryMaxMs: 400,
      setTimeout: (fn, ms) => {
        delays.push(ms);
        pending.push(fn);
        return pending.length;
      },
      clearTimeout: () => {},
    });

    Flaky.last!.onerror?.(new Error("dead"));
    pending.shift()!();
    Flaky.last!.onerror?.(new Error("dead"));
    pending.shift()!();
    expect(delays).toEqual([100, 200]);

    // A healthy frame proves the connection works, so the next outage starts from the base again.
    Flaky.last!.emit("backlog.changed", '{"id":"bl-9"}');
    expect(seen).toEqual([{ type: "backlog.changed", id: "bl-9" }]);
    Flaky.last!.onerror?.(new Error("dead"));
    expect(delays).toEqual([100, 200, 100]);
    unsubscribe();
  });

  it("backs off rather than throwing when the constructor itself fails", () => {
    const delays: number[] = [];
    const Broken = class {
      constructor() {
        throw new Error("no network");
      }
    } as unknown as typeof Flaky;
    const unsubscribe = subscribeSse({
      url: "http://127.0.0.1:1/api/events",
      handler: () => {},
      EventSource: Broken,
      retryBaseMs: 100,
      setTimeout: (_fn, ms) => {
        delays.push(ms);
        return 1;
      },
      clearTimeout: () => {},
    });
    expect(delays).toEqual([100]);
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("platform globals", () => {
  it("uses globalThis.fetch when none is injected", async () => {
    const source = createSource("local", { baseUrl: harness.baseUrl });
    expect((await source.health()).repo).toBe(harness.root);
    expect(typeof globalFetch()).toBe("function");
  });

  it("names the fix when a global is missing", () => {
    // Node has no EventSource global as of 25.x, which is exactly the runtime this asserts on.
    const found = (globalThis as { EventSource?: unknown }).EventSource;
    if (typeof found === "function") {
      expect(globalEventSource()).toBe(found);
    } else {
      expect(() => globalEventSource()).toThrow(/pass one to createSource/);
    }

    const saved = (globalThis as { fetch?: unknown }).fetch;
    try {
      delete (globalThis as { fetch?: unknown }).fetch;
      expect(() => globalFetch()).toThrow(/pass one to createSource/);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = saved;
    }
  });
});
