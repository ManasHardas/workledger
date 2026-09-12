import { useCallback, useSyncExternalStore } from "react";

/**
 * Hash routing, per design spec §14 — the app is served from a random local port and, as a Dome
 * card, from an iframe whose path it does not control, so the route has to live after the `#`.
 *
 * P9 (2026-09-12, operator): the nav is four destinations in this order — Home, Ledger, Session,
 * Review — and the map is:
 *
 *   #/                        Home — every tracked project on the machine
 *   #/onboarding              the wizard (#79)
 *   #/review, #/jobs          machine-wide Review and Jobs, a repo per row
 *   #/r/<id>/ledger           one repo's sessions over time
 *   #/r/<id>/session[/<ulid>] one session; without a ulid, that repo's most recent
 *   #/r/<id>/review           what needs a human: answers owed, and proposals to triage
 *   #/r/<id>/jobs, /health    kept as routes, off the nav (recovery queue and diagnostics)
 *   #/ledger, #/next, …       the P2 routes, redirected by the app to the first repo's
 *
 * **Review absorbed two views.** P2's `next` (the backlog) and `needs` (open questions and
 * blockers) were separate; both are a human judging what agents produced, and splitting them
 * scattered one sitting across two screens, so `#/…/next` and `#/…/needs` now resolve to
 * `review`. **Session took the Ledger's sub-route**: a session used to live at
 * `#/r/<id>/ledger/<ulid>` and is now a destination of its own, with the old form still parsing.
 *
 * `parseRoute` only reads; the redirect needs the repo list, which is the app's to fetch.
 */
export const VIEW_IDS = ["ledger", "session", "review", "jobs", "health"] as const;

export type ViewId = (typeof VIEW_IDS)[number];

/** The views that also exist machine-wide, aggregated across repos. */
export type MachineView = "review" | "jobs";

export type Route =
  | { kind: "home" }
  | { kind: "onboarding" }
  | { kind: "machine"; view: MachineView }
  | { kind: "repo"; repo: string; view: ViewId; rest: string[] }
  /** A P2 `#/<view>[/…]` hash: the app resolves it to a repo and replaces the URL. */
  | { kind: "legacy"; view: ViewId; rest: string[] };

export const HOME_HREF = "#/";
export const ONBOARDING_HREF = "#/onboarding";

/**
 * Older spellings of a view segment, kept parsing so no saved link or open tab breaks:
 * P2 wrote `needs-you`, and P8 had `next` and `needs` as separate views that Review now holds.
 */
const VIEW_ALIASES: Record<string, ViewId> = {
  "needs-you": "review",
  needs: "review",
  next: "review",
};

function viewFrom(segment: string | undefined): ViewId | undefined {
  if (segment === undefined) return undefined;
  const alias = VIEW_ALIASES[segment];
  if (alias !== undefined) return alias;
  return (VIEW_IDS as readonly string[]).includes(segment) ? (segment as ViewId) : undefined;
}

export function machineHref(view: MachineView): string {
  return `#/${view}`;
}

export function repoHref(repo: string, view: ViewId, ...rest: string[]): string {
  return [`#/r/${encodeURIComponent(repo)}/${view}`, ...rest.map(encodeURIComponent)].join("/");
}

/** Reads a hash into a {@link Route}; an empty or unknown one is Home. */
export function parseRoute(hash: string): Route {
  // Everything after `?` is a route's own state — the wizard keeps its step and selections there
  // (`features/onboarding/state.ts`) — and never part of which route it is.
  const segments = hash
    .replace(/^#\/?/, "")
    .split("?")[0]!
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  const [head, ...tail] = segments;
  if (head === undefined) return { kind: "home" };
  if (head === "onboarding") return { kind: "onboarding" };
  if (head === "r") {
    const [repo, viewSegment, ...rest] = tail;
    const view = viewFrom(viewSegment);
    if (repo === undefined || repo === "" || view === undefined) return { kind: "home" };
    // A session used to hang off the Ledger. `#/r/<id>/ledger/<ulid>` keeps working by becoming
    // the Session route it now is, so bookmarks and a card's `openDeepLink` survive the move.
    if (view === "ledger" && rest.length > 0) return { kind: "repo", repo, view: "session", rest };
    return { kind: "repo", repo, view, rest };
  }
  if (head === "jobs") return { kind: "machine", view: "jobs" };
  if (head === "review" || head === "needs" || head === "needs-you") {
    return { kind: "machine", view: "review" };
  }
  const view = viewFrom(head);
  if (view === undefined) return { kind: "home" };
  return { kind: "legacy", view, rest: tail };
}

/** `#/r/<id>/<view>` for a legacy route, keeping whatever followed the view (a session ulid). */
export function legacyTarget(route: Extract<Route, { kind: "legacy" }>, repo: string): string {
  // `#/ledger/<ulid>` is a session, the same way `#/r/<id>/ledger/<ulid>` is.
  if (route.view === "ledger" && route.rest.length > 0) {
    return repoHref(repo, "session", ...route.rest);
  }
  return repoHref(repo, route.view, ...route.rest);
}

/**
 * Replaces the current hash without a history entry — a redirect must not leave the old route
 * behind the back button. `replaceState` fires no `hashchange`, so one is dispatched by hand for
 * the subscribers below.
 */
export function replaceHash(href: string): void {
  if (window.location.hash === href) return;
  window.history.replaceState(window.history.state, "", href);
  window.dispatchEvent(new Event("hashchange"));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The current route, re-read on every `hashchange`. Identity-stable while the hash is. */
export function useRoute(): Route {
  const snapshot = useCallback(() => window.location.hash, []);
  const hash = useSyncExternalStore(subscribe, snapshot, () => "");
  return parseRoute(hash);
}
