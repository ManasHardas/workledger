/**
 * `subscribe` — `EventSource` over `/api/events` with automatic reconnect (ledger-source.md).
 *
 * The browser's own `EventSource` reconnects, but only on a clean stream close and only on the
 * interval the server dictates with a `retry:` field; a `workledger serve` that was restarted, or
 * a laptop that slept through the connection, surfaces as `onerror` with the source stuck in
 * `CLOSED`. So the reconnect is owned here: on any error the socket is closed and a fresh one is
 * opened after an exponential backoff, capped at 10 s so a server that is down for an hour is
 * polled six times a minute rather than thousands.
 *
 * The `EventSourceLike` shape below is structural for the same reason as `FetchLike` in
 * `./http.ts`: this package compiles without `lib.dom`, and a test needs to inject a stub.
 */
import type { LedgerEvent } from "./types.js";

import { ApiClientError } from "./errors.js";

/** The one field of `MessageEvent` an SSE listener reads. */
export interface MessageEventLike {
  readonly data: string;
}

/** The subset of `EventSource` this client uses. A real `EventSource` satisfies it. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEventLike) => void): void;
  close(): void;
}

/** `new EventSource(url)`. */
export type EventSourceCtor = new (url: string) => EventSourceLike;

/** The listener registration an error handler needs; separated so the ctor type stays minimal. */
interface ErrorSink {
  onerror: ((event: unknown) => void) | null;
}

/** First reconnect delay. Short enough that a server restart is invisible to the user. */
export const RETRY_BASE_MS = 500;

/** ledger-source.md's cap: "exponential backoff capped at 10 s". */
export const RETRY_MAX_MS = 10000;

/** `base * 2^attempt`, clamped to `max`. `attempt` is 0 for the first retry. */
export function backoffDelay(attempt: number, base = RETRY_BASE_MS, max = RETRY_MAX_MS): number {
  if (attempt < 0) return base;
  // `2 ** attempt` overflows to Infinity past ~1024; `Math.min` handles that correctly, but the
  // exponent is clamped first so the intermediate stays a finite number a test can reason about.
  const doubled = base * 2 ** Math.min(attempt, 32);
  return Math.min(doubled, max);
}

/** The knobs `subscribe` needs from its source. */
export interface SubscribeOptions {
  url: string;
  handler: (event: LedgerEvent) => void;
  EventSource: EventSourceCtor;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Injected so a test does not have to wait real milliseconds. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** api.md §SSE names the events; `ping` is the keep-alive and carries nothing for the UI. */
const EVENT_NAMES = ["session.changed", "backlog.changed", "notes.changed", "health.changed"];

/** Parse one frame into a `LedgerEvent`, or `undefined` if it is not one. */
export function toLedgerEvent(name: string, data: string): LedgerEvent | undefined {
  if (!EVENT_NAMES.includes(name)) return undefined;
  let payload: unknown;
  try {
    payload = data === "" ? {} : JSON.parse(data);
  } catch {
    // A truncated frame is a transport fault, not a ledger change: drop it rather than tearing
    // the subscription down, because the next event carries the same invalidation anyway.
    return undefined;
  }
  const record = payload === null || typeof payload !== "object" ? {} : (payload as Record<string, unknown>);
  if (name === "session.changed") {
    const ulid = record["ulid"];
    return typeof ulid === "string" ? { type: "session.changed", ulid } : undefined;
  }
  if (name === "backlog.changed") {
    const id = record["id"];
    return typeof id === "string" ? { type: "backlog.changed", id } : undefined;
  }
  return name === "notes.changed" ? { type: "notes.changed" } : { type: "health.changed" };
}

/**
 * Open the stream and keep it open. Returns the unsubscribe, which is idempotent and stops the
 * reconnect loop as well as closing the current socket.
 */
export function subscribeSse(options: SubscribeOptions): () => void {
  const base = options.retryBaseMs ?? RETRY_BASE_MS;
  const max = options.retryMaxMs ?? RETRY_MAX_MS;
  // `setTimeout` is not declared here: the package compiles with `"types": []` and no `lib.dom`,
  // so neither `@types/node`'s nor the browser's declaration is in scope. It exists in every
  // runtime this package targets, and reading it off `globalThis` is what keeps that true without
  // adopting one platform's typings.
  const timers = globalThis as unknown as {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
  const later = options.setTimeout ?? ((fn, ms) => timers.setTimeout(fn, ms));
  const cancel = options.clearTimeout ?? ((handle) => timers.clearTimeout(handle));

  let closed = false;
  let attempt = 0;
  let source: EventSourceLike | undefined;
  let retryHandle: unknown;

  const open = (): void => {
    if (closed) return;
    let next: EventSourceLike;
    try {
      next = new options.EventSource(options.url);
    } catch {
      // A constructor that throws (a bad URL, a runtime with no network) must still back off
      // rather than kill the subscription: the caller holds an unsubscribe, not a promise.
      scheduleRetry();
      return;
    }
    source = next;
    for (const name of EVENT_NAMES) {
      next.addEventListener(name, (event) => {
        // A frame proves the stream is healthy, so the backoff resets here rather than on
        // `onopen` — some SSE implementations fire `open` for a connection that then stalls.
        attempt = 0;
        const parsed = toLedgerEvent(name, event.data);
        if (parsed !== undefined) options.handler(parsed);
      });
    }
    (next as Partial<ErrorSink>).onerror = () => {
      if (closed || source !== next) return;
      source = undefined;
      next.close();
      scheduleRetry();
    };
  };

  function scheduleRetry(): void {
    if (closed) return;
    const delay = backoffDelay(attempt, base, max);
    attempt += 1;
    retryHandle = later(() => {
      retryHandle = undefined;
      open();
    }, delay);
  }

  open();

  return () => {
    if (closed) return;
    closed = true;
    if (retryHandle !== undefined) cancel(retryHandle);
    source?.close();
    source = undefined;
  };
}

/** `globalThis.EventSource`, or a throw naming the fix. */
export function globalEventSource(): EventSourceCtor {
  const found = (globalThis as { EventSource?: EventSourceCtor }).EventSource;
  if (typeof found !== "function") {
    throw new ApiClientError(
      "no-eventsource",
      "no global EventSource in this runtime — pass one to createSource({ EventSource })",
    );
  }
  return found;
}
