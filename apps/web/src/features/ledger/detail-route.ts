import { useCallback, useSyncExternalStore } from "react";

import { parseRoute, repoHref } from "../../lib/router.js";

/**
 * The Session route: `#/r/<repo>/session/<ulid>` opens one session; `#/r/<repo>/session` opens
 * that repo's most recent one (P9). It used to hang off the Ledger as `#/…/ledger/<ulid>`, which
 * `lib/router.ts` still parses into this view so saved links keep working.
 *
 * The links stay real `#/…` anchors, so the back button and a Dome card's `openDeepLink` both
 * work untouched (design spec §14.2).
 */
export function detailHref(repo: string, ulid: string): string {
  return repoHref(repo, "session", ulid);
}

/** The Session view with no ulid: the repo's most recent session. */
export function latestSessionHref(repo: string): string {
  return repoHref(repo, "session");
}

export function ledgerListHref(repo: string): string {
  return repoHref(repo, "ledger");
}

/**
 * The ulid in `#/r/<repo>/session/<ulid>`, or `null` when the route names no session — which is
 * the Session view's "show me the most recent one" case, not an error.
 */
export function detailUlidFromHash(hash: string): string | null {
  const route = parseRoute(hash);
  if (route.kind !== "repo" || route.view !== "session") return null;
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
