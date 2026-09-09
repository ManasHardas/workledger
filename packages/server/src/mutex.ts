/**
 * The per-id in-process mutex plans/feature-p2-data-flow.md §Writes asks for.
 *
 * The ops re-read the file immediately before they write it, so two overlapping writes to one
 * item would otherwise interleave as read-A, read-B, write-A, write-B — and B's write, built
 * from the text A had already replaced, would drop A's history entry. Serializing per id makes
 * "last write wins at the file level" true *and* keeps both history entries, which is exactly
 * the guarantee the data-flow doc states.
 *
 * Per id, not global: two tabs editing different items must not queue behind each other, and the
 * only shared state a write has is the file it names.
 */

/** Serializes async work per key, letting unrelated keys run concurrently. */
export class KeyedMutex {
  /** The promise that settles when the last-queued holder of each key releases it. */
  readonly #tails = new Map<string, Promise<void>>();

  /**
   * Run `body` with every key in `keys` held.
   *
   * Multi-key callers (`merge`, which writes two items) take all the gates before awaiting any
   * of them, so two merges naming the same pair in opposite orders cannot deadlock: neither can
   * be holding one key while waiting for the other.
   */
  async run<T>(keys: readonly string[], body: () => Promise<T>): Promise<T> {
    const unique = [...new Set(keys)].sort();
    const waitFor = unique.map((key) => this.#tails.get(key) ?? Promise.resolve());

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const key of unique) this.#tails.set(key, gate);

    try {
      // `allSettled`: a previous holder that rejected has already reported to its own caller,
      // and must not also reject this one.
      await Promise.allSettled(waitFor);
      return await body();
    } finally {
      release();
      // Only if nobody queued behind us — otherwise their gate is the one in the map now.
      for (const key of unique) {
        if (this.#tails.get(key) === gate) this.#tails.delete(key);
      }
    }
  }

  /** Keys with a holder or a waiter right now. Test-only introspection. */
  get held(): number {
    return this.#tails.size;
  }
}
