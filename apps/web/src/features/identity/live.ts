import { useCallback, useEffect, useMemo, useState } from "react";

import type { Identity } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { useAsync } from "../../lib/use-async.js";

/** `.workledger/identities.yaml` as the views use it: keyed by lower-cased email. */
export type IdentityMap = ReadonlyMap<string, Identity>;

/** The map a repo with no identities file has — every lookup misses, every actor shows its email. */
export const NO_IDENTITIES: IdentityMap = new Map<string, Identity>();

/**
 * The repo's email → name map, re-read when the source reports that health changed.
 *
 * `health.changed` is the event `.workledger/config.yaml` and its siblings ride on
 * (`docs/contracts/p2/api.md` §SSE), so a name added while the UI is open appears without a
 * reload. There is no error state: the contract's failure mode for this file is "Missing file:
 * emails display as before" (docs/contracts/p5/config-and-identities.md), and a view that lost
 * the map has to keep rendering emails rather than an error where a person's name goes.
 */
export function useIdentities(): IdentityMap {
  const source = useSource();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // A source without `capabilities.live` returns a no-op unsubscribe, so this is safe either way.
    return source.subscribe((event) => {
      if (event.type === "health.changed") setNonce((n) => n + 1);
    });
  }, [source]);

  // `nonce` is a dependency, not an argument: a bump re-runs the same read.
  const result = useAsync(useCallback(() => source.listIdentities(), [source, nonce]));

  return useMemo(() => {
    if (result.state !== "ready") return NO_IDENTITIES;
    return new Map(result.value.map((identity) => [identity.email.trim().toLowerCase(), identity]));
  }, [result]);
}
