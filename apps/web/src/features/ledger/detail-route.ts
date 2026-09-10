import { useCallback, useSyncExternalStore } from "react";

import { parseRoute, repoHref } from "../../lib/router.js";

/**
 * The Ledger's sub-route: `#/r/<repo>/ledger/<ulid>` opens one session's detail.
 *
 * `lib/router.ts` keeps whatever follows the view in `rest`; the Ledger reads its own parameter
 * out of it here, from the same `hashchange` the router subscribes to. The links stay real `#/…`
 * anchors, so the back button and a Dome card's `openDeepLink` both work untouched (design spec
 * §14.2).
 */
export function detailHref(repo: string, ulid: string): string {
  return repoHref(repo, "ledger", ulid);
}

export function ledgerListHref(repo: string): string {
  return repoHref(repo, "ledger");
}

/** The ulid in `#/r/<repo>/ledger/<ulid>`, or `null` on the list route. */
export function detailUlidFromHash(hash: string): string | null {
  const route = parseRoute(hash);
  if (route.kind !== "repo" || route.view !== "ledger") return null;
  const ulid = route.rest[0];
  return ulid !== undefined && ulid.length > 0 ? ulid : null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useDetailUlid(): string | null {
  const snapshot = useCallback(() => detailUlidFromHash(window.location.hash), []);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
