/**
 * The SSE event bus (api.md §SSE). Six event names, each with the payload the contract names,
 * fanned out to every open `/api/events` stream.
 *
 * Every payload carries `repo` — docs/contracts/p8/daemon-and-api.md §Multi-repo endpoints,
 * "SSE events gain `repo: <id>`; a client filters" — because one stream now serves every repo
 * on the machine and a per-repo view has to know which ledger an invalidation belongs to.
 */

/** The events `/api/events` emits, plus the keep-alive. */
export type LedgerEvent =
  | { event: "session.changed"; data: { ulid: string; repo: string } }
  | { event: "backlog.changed"; data: { id: string; repo: string } }
  | { event: "notes.changed"; data: { repo: string } }
  | { event: "health.changed"; data: { repo: string } }
  /** docs/contracts/p3/api.md: "SSE `job.changed { id, status }` added to `/api/events`". */
  | { event: "job.changed"; data: { id: string; status: string; repo: string } }
  /**
   * docs/contracts/p8/daemon-and-api.md amendment 4 (#94): the daemon started or stopped serving
   * `repo` — the wizard's `init`, a `workledger init` the index re-read picked up, a removal —
   * so a client re-reads `/api/repos` rather than waiting for a reload.
   */
  | { event: "repos.changed"; data: { repo: string } };

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
