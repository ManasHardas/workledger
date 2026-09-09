import { useCallback, useEffect, useState } from "react";

import type { LedgerEvent, LedgerSource } from "../lib/ledger-source.js";
import { useAsync, type Async } from "../lib/use-async.js";

/** What {@link useLiveRead} hands a view: the read's state, and a way to run it again. */
export interface LiveRead<T> {
  result: Async<T>;
  /** Re-runs the read now — what a view calls after its own write changed the data. */
  refresh: () => void;
}

/**
 * One `LedgerSource` read that re-runs when the source says the data behind it changed.
 *
 * `subscribe` is a no-op on a source whose `capabilities.live` is false (fixtures, a Dome card),
 * so a view written against this hook degrades to a plain one-shot read there rather than breaking
 * — which is the point of the capability flags in `docs/contracts/p2/ledger-source.md`. `refresh`
 * is the path that does not depend on that: a write returns, the view asks for the data again.
 *
 * `read` must be stable across renders (a module-level function or a `useCallback`), the same
 * contract `useAsync` already imposes on its `load`.
 */
export function useLiveRead<T>(
  source: LedgerSource,
  events: readonly LedgerEvent["type"][],
  read: (source: LedgerSource) => Promise<T>,
): LiveRead<T> {
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  // The array literal a caller writes inline is a new identity every render; its contents are not.
  const key = events.join(",");

  useEffect(() => {
    const wanted = new Set(key.split(","));
    return source.subscribe((event) => {
      if (wanted.has(event.type)) refresh();
    });
  }, [source, key, refresh]);

  // `nonce` is the refetch trigger: bumping it gives `useAsync` a new `load` to run.
  const load = useCallback(() => read(source), [source, read, nonce]);
  return { result: useAsync(load), refresh };
}
