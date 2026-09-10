/**
 * The SSE event bus (api.md §SSE). Five event names, each with the payload the contract names,
 * fanned out to every open `/api/events` stream.
 */

/** The events `/api/events` emits, plus the keep-alive. */
export type LedgerEvent =
  | { event: "session.changed"; data: { ulid: string } }
  | { event: "backlog.changed"; data: { id: string } }
  | { event: "notes.changed"; data: Record<string, never> }
  | { event: "health.changed"; data: Record<string, never> }
  /** docs/contracts/p3/api.md: "SSE `job.changed { id, status }` added to `/api/events`". */
  | { event: "job.changed"; data: { id: string; status: string } };

/** A subscriber. Returning is enough; the bus never awaits a listener. */
export type Listener = (event: LedgerEvent) => void;

/** A synchronous fan-out with no backpressure: an SSE writer buffers, it does not block. */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  /** @returns the unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Deliver to every subscriber. One throwing listener must not starve the others. */
  emit(event: LedgerEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }

  /** Open stream count — the SSE test and `/api/health` both want it. */
  get size(): number {
    return this.listeners.size;
  }
}
