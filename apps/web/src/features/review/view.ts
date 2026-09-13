import { useCallback, useSyncExternalStore } from "react";

import { machineHref, replaceHash, repoHref } from "../../lib/router.js";

/**
 * Review's views (operator, 2026-09-13): everything waiting on a person, or one kind of it.
 *
 * `all` is the page as the frame draws it; `blocker` and `question` narrow the answers;
 * `proposal` is only what agents proposed; `decision` and `discovery` are the read-only history of
 * what was decided and what was found.
 */
export const REVIEW_VIEWS = ["all", "blocker", "question", "proposal", "decision", "discovery"] as const;

export type ReviewViewId = (typeof REVIEW_VIEWS)[number];

export const REVIEW_VIEW_LABELS: Record<ReviewViewId, string> = {
  all: "All",
  blocker: "Blockers",
  question: "Questions",
  proposal: "Proposals",
  decision: "Decisions",
  discovery: "Discoveries",
};

/** The `?…` of a hash, or `""`. */
function queryOf(hash: string): string {
  const at = hash.indexOf("?");
  return at < 0 ? "" : hash.slice(at + 1);
}

/**
 * The view a hash names in `?view=`; `all` when it names none or one this page does not have.
 *
 * The view lives in the hash query, not in state, so it survives a reload and a project switch —
 * and `parseRoute` ignores the query, so `#/review?view=blocker` is still the Review route.
 */
export function reviewViewOf(hash: string): ReviewViewId {
  const view = new URLSearchParams(queryOf(hash)).get("view");
  return (REVIEW_VIEWS as readonly string[]).includes(view ?? "") ? (view as ReviewViewId) : "all";
}

/** `hash` with its `?view=` set to `view`, keeping whatever else its query carries. */
export function withReviewView(hash: string, view: ReviewViewId): string {
  const at = hash.indexOf("?");
  const base = at < 0 ? hash : hash.slice(0, at);
  const params = new URLSearchParams(queryOf(hash));
  params.set("view", view);
  return `${base}?${params.toString()}`;
}

/** Review of one repo, or of every project when `repo` is `null`, on `view`. */
export function reviewHref(repo: string | null, view: ReviewViewId): string {
  return withReviewView(repo === null ? machineHref("review") : repoHref(repo, "review"), view);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * The selected view, and a way to choose another. Choosing replaces the hash rather than pushing
 * it: a tab click is not somewhere the back button should return to.
 */
export function useReviewView(): [ReviewViewId, (view: ReviewViewId) => void] {
  const snapshot = useCallback(() => window.location.hash, []);
  const hash = useSyncExternalStore(subscribe, snapshot, () => "");
  const choose = useCallback((view: ReviewViewId) => {
    replaceHash(withReviewView(window.location.hash, view));
  }, []);
  return [reviewViewOf(hash), choose];
}
