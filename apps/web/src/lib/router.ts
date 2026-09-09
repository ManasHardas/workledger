import { useCallback, useSyncExternalStore } from "react";

/**
 * Hash routing, per design spec §14 — the app is served from a random local port and, as a Dome
 * card, from an iframe whose path it does not control, so the route has to live after the `#`.
 * `openDeepLink` targets the same strings (§14.2).
 */
export const ROUTE_IDS = ["ledger", "next", "needs-you", "health"] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

export const DEFAULT_ROUTE: RouteId = "ledger";

export function hrefFor(id: RouteId): string {
  return `#/${id}`;
}

/** Reads a `#/<id>` hash, falling back to the default for an empty or unknown one. */
export function routeFromHash(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, "").split("/")[0];
  return (ROUTE_IDS as readonly string[]).includes(id ?? "") ? (id as RouteId) : DEFAULT_ROUTE;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The current route, re-read on every `hashchange`. */
export function useRoute(): RouteId {
  const snapshot = useCallback(() => routeFromHash(window.location.hash), []);
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_ROUTE);
}
