import { describe, expect, it } from "vitest";

import { createSource, shareEvents, type AppSource, type LedgerEvent } from "../src/lib/ledger-source.js";

/** The fixture source with a counted `subscribe` and a distinct `forRepo` result per call. */
function counted() {
  const base = createSource("fixture");
  const handlers = new Set<(event: LedgerEvent) => void>();
  let opened = 0;
  let closed = 0;
  const source = Object.assign(Object.create(base) as AppSource, {
    subscribe(handler: (event: LedgerEvent) => void) {
      opened += 1;
      handlers.add(handler);
      return () => {
        closed += 1;
        handlers.delete(handler);
      };
    },
    forRepo(): AppSource {
      return Object.assign(Object.create(base) as AppSource, {
        subscribe() {
          throw new Error("a scoped source must not open its own stream");
        },
      });
    },
  });
  return {
    source,
    emit: (event: LedgerEvent) => handlers.forEach((handler) => handler(event)),
    opened: () => opened,
    closed: () => closed,
  };
}

describe("shareEvents", () => {
  it("opens one stream for every subscriber, scoped or not, and closes it after the last", () => {
    const inner = counted();
    const shared = shareEvents(inner.source);
    const seen: string[] = [];

    const stopAll = shared.subscribe((event) => seen.push(`all:${event.type}:${event.repo ?? "-"}`));
    const a = shared.forRepo("a");
    const stopA = a.subscribe((event) => seen.push(`a:${event.type}`));
    const stopB = shared.forRepo("b").subscribe((event) => seen.push(`b:${event.type}`));
    expect(inner.opened()).toBe(1);
    // The same id gives the same scoped source, so a view's `useSource()` identity is stable.
    expect(shared.forRepo("a")).toBe(a);

    inner.emit({ type: "notes.changed", repo: "a" });
    inner.emit({ type: "health.changed" });
    inner.emit({ type: "job.changed", id: "j", status: "done", repo: "b" });
    expect(seen).toEqual([
      "all:notes.changed:a",
      "a:notes.changed",
      "all:health.changed:-",
      "a:health.changed",
      "b:health.changed",
      "all:job.changed:b",
      "b:job.changed",
    ]);

    stopAll();
    stopA();
    expect(inner.closed()).toBe(0);
    stopB();
    expect(inner.closed()).toBe(1);

    // A later subscriber reopens it.
    const stopAgain = shared.subscribe(() => {});
    expect(inner.opened()).toBe(2);
    stopAgain();
    expect(inner.closed()).toBe(2);
  });

  it("delegates every other member, bound to the wrapped instance", async () => {
    const inner = counted();
    const shared = shareEvents(inner.source);
    expect(shared.capabilities).toEqual(inner.source.capabilities);
    expect(await shared.listRepos()).toEqual(await inner.source.listRepos());
    expect(await shared.forRepo("a").listNotes({ open: true })).toEqual(await inner.source.listNotes({ open: true }));
  });
});
