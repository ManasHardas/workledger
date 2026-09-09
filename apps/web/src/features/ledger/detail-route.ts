import { useCallback, useSyncExternalStore } from "react";

/**
 * The Ledger's sub-route: `#/ledger/<ulid>` opens one session's detail.
 *
 * `lib/router.ts` reads only the first hash segment, so `#/ledger/<ulid>` already routes to this
 * view; what the shared router does not expose is the segment after it. Rather than widen the
 * router (which two other P2 views are building against), the Ledger reads its own parameter here,
 * from the same `hashchange` the router subscribes to. The links stay real `#/…` anchors, so the
 * back button and a Dome card's `openDeepLink` both work untouched (design spec §14.2).
 */
export function detailHref(ulid: string): string {
  return `#/ledger/${ulid}`;
}

export const LEDGER_LIST_HREF = "#/ledger";

/** The ulid in `#/ledger/<ulid>`, or `null` on the list route. */
export function detailUlidFromHash(hash: string): string | null {
  const segments = hash.replace(/^#\/?/, "").split("/");
  if (segments[0] !== "ledger") return null;
  const ulid = segments[1];
  return ulid && ulid.length > 0 ? decodeURIComponent(ulid) : null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useDetailUlid(): string | null {
  const snapshot = useCallback(() => detailUlidFromHash(window.location.hash), []);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
