import { useCallback, useEffect, useState } from "react";

import type { Health } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { useAsync, type Async } from "../../lib/use-async.js";

/**
 * The doctor report, re-read when the source reports that health changed.
 *
 * `subscribe` is the whole of the live contract (`docs/contracts/p2/ledger-source.md`): the event
 * says *what* changed, never the new value, so the view re-reads. On a source whose
 * `capabilities.live` is false the subscription is a no-op and the counter never moves, which is
 * why nothing here branches on the capability.
 */
export function useLiveHealth(): Async<Health> {
  const source = useSource();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    return source.subscribe((event) => {
      if (event.type === "health.changed") setNonce((n) => n + 1);
    });
  }, [source]);

  // `nonce` is a dependency, not an argument: a bump re-runs the same read.
  return useAsync(useCallback(() => source.health(), [source, nonce]));
}
