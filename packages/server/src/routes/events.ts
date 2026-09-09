/**
 * `GET /api/events` — `text/event-stream` carrying the four ledger events and a `ping` every
 * 15 s (api.md §SSE).
 *
 * The ping is what keeps the stream alive through anything that reaps idle connections and what
 * lets the browser's `EventSource` notice a dead server; it is emitted on its own interval rather
 * than piggy-backed on ledger traffic, because a quiet ledger is the case that needs it.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { EventBus, LedgerEvent } from "../events.js";

/** api.md §SSE: "a `ping` every 15 s". */
export const PING_MS = 15000;

export interface EventRouteDeps {
  bus: EventBus;
  pingMs?: number;
}

/** The SSE route. */
export function eventRoutes(deps: EventRouteDeps): Hono {
  const pingMs = deps.pingMs ?? PING_MS;
  const api = new Hono();

  api.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      // The queue exists because the bus is synchronous and `stream.writeSSE` is not: a burst of
      // watcher events must not interleave half-written frames, so they are appended here and
      // drained in order by the single writer loop below.
      const queue: LedgerEvent[] = [];
      let wake: (() => void) | undefined;
      let open = true;

      const unsubscribe = deps.bus.subscribe((event) => {
        queue.push(event);
        wake?.();
      });
      const ping = setInterval(() => {
        queue.push({ event: "ping" } as unknown as LedgerEvent);
        wake?.();
      }, pingMs);
      ping.unref?.();

      stream.onAbort(() => {
        open = false;
        wake?.();
      });

      try {
        while (open) {
          while (queue.length > 0) {
            const next = queue.shift() as LedgerEvent & { event: string; data?: unknown };
            await stream.writeSSE({
              event: next.event,
              data: JSON.stringify(next.data ?? {}),
            });
          }
          if (!open) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
            // A timer as well as the wake-up, so a listener that is dropped while the loop is
            // parked cannot leave the stream asleep forever.
            const timer = setTimeout(resolve, pingMs);
            timer.unref?.();
          });
          wake = undefined;
        }
      } finally {
        clearInterval(ping);
        unsubscribe();
      }
    }),
  );

  return api;
}
