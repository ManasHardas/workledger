import { useCallback, useSyncExternalStore } from "react";

/**
 * Hash routing, per design spec §14 — the app is served from a random local port and, as a Dome
 * card, from an iframe whose path it does not control, so the route has to live after the `#`.
 *
 * P8 (docs/contracts/p8/daemon-and-api.md §Wizard routes): one daemon serves every repo on the
 * machine, so the P2 views moved under `#/r/<repoId>/…`. The map:
 *
 *   #/                        Home — one card per repo
 *   #/onboarding              the wizard (#79)
 *   #/needs, #/jobs           machine-wide Needs you and Jobs, a repo per row
 *   #/r/<id>/<view>[/…]       one repo's Ledger, Next, Needs you, Jobs or Health
 *   #/ledger, #/next, …       the P2 routes, redirected by the app to the first repo's
 *
 * `parseRoute` only reads; the redirect needs the repo list, which is the app's to fetch.
 */
export const VIEW_IDS = ["ledger", "next", "needs", "jobs", "health"] as const;

export type ViewId = (typeof VIEW_IDS)[number];

/** The two views that also exist machine-wide, aggregated across repos. */
export type MachineView = "needs" | "jobs";

export type Route =
  | { kind: "home" }
  | { kind: "onboarding" }
  | { kind: "machine"; view: MachineView }
  | { kind: "repo"; repo: string; view: ViewId; rest: string[] }
  /** A P2 `#/<view>[/…]` hash: the app resolves it to a repo and replaces the URL. */
  | { kind: "legacy"; view: ViewId; rest: string[] };

export const HOME_HREF = "#/";
export const ONBOARDING_HREF = "#/onboarding";

/** P2 spelled the view `needs-you`; the segment is `needs` now, and the old one still parses. */
function viewFrom(segment: string | undefined): ViewId | undefined {
  if (segment === "needs-you") return "needs";
  return (VIEW_IDS as readonly string[]).includes(segment ?? "") ? (segment as ViewId) : undefined;
}

export function machineHref(view: MachineView): string {
  return `#/${view}`;
}

export function repoHref(repo: string, view: ViewId, ...rest: string[]): string {
  return [`#/r/${encodeURIComponent(repo)}/${view}`, ...rest.map(encodeURIComponent)].join("/");
}

/** Reads a hash into a {@link Route}; an empty or unknown one is Home. */
export function parseRoute(hash: string): Route {
  const segments = hash
    .replace(/^#\/?/, "")
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
    return { kind: "repo", repo, view, rest };
  }
  if (head === "needs" || head === "jobs") return { kind: "machine", view: head };
  const view = viewFrom(head);
  if (view === undefined) return { kind: "home" };
  return { kind: "legacy", view, rest: tail };
}

/** `#/r/<id>/<view>` for a legacy route, keeping whatever followed the view (a session ulid). */
export function legacyTarget(route: Extract<Route, { kind: "legacy" }>, repo: string): string {
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
