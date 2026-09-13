import { useRef, type KeyboardEvent } from "react";

import { LedgerFilterSelect } from "../../components/ui/ledger-filter-select.js";
import { cn } from "../../lib/cn.js";
import type { Repo } from "../../lib/ledger-source.js";
import type { Async } from "../../lib/use-async.js";
import type { ReviewCounts } from "./counts.js";
import { REVIEW_VIEWS, REVIEW_VIEW_LABELS, reviewHref, type ReviewViewId } from "./view.js";

/** The id of a view's tab, for the panel's `aria-labelledby`. */
export function reviewTabId(view: ReviewViewId): string {
  return `review-tab-${view}`;
}

export const REVIEW_PANEL_ID = "review-panel";

const ALL_PROJECTS = "";

/**
 * Review's toolbar: the views as tabs, drawn as the nav draws its rows, and the project filter at
 * the right edge. The row wraps before anything in it scrolls (rule 5).
 *
 * The tabs are a roving-tabindex tablist — one stop in the tab order, the arrows move along it —
 * and choosing one replaces the hash's `?view=` (see `view.ts`). The project filter is a real
 * navigation: to that repo's Review, or to every project's, on the same view.
 */
export function ReviewToolbar({
  view,
  onView,
  counts,
  repo,
  repos,
}: {
  view: ReviewViewId;
  onView: (view: ReviewViewId) => void;
  counts: ReviewCounts;
  /** The route's repo, or `null` on every project's Review. */
  repo: string | null;
  repos: Async<Repo[]>;
}) {
  const tabs = useRef(new Map<ReviewViewId, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const edge = { Home: 0, End: REVIEW_VIEWS.length - 1 }[event.key];
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const at = REVIEW_VIEWS.indexOf(view);
    const next = REVIEW_VIEWS[edge ?? (at + step! + REVIEW_VIEWS.length) % REVIEW_VIEWS.length]!;
    onView(next);
    tabs.current.get(next)?.focus();
  };

  const listed = repos.state === "ready" ? [...repos.value].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const options = [
    { value: ALL_PROJECTS, label: "All projects" },
    ...listed.map((item) => ({ value: item.id, label: item.name })),
    // A repo the list does not (yet) name still has to be the one the select shows.
    ...(repo !== null && !listed.some((item) => item.id === repo) ? [{ value: repo, label: repo }] : []),
  ];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <div
        role="tablist"
        aria-label="Review views"
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
      >
        {REVIEW_VIEWS.map((id) => {
          const selected = id === view;
          const count = counts[id];
          return (
            <button
              key={id}
              ref={(node) => {
                if (node === null) tabs.current.delete(id);
                else tabs.current.set(id, node);
              }}
              id={reviewTabId(id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={REVIEW_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => onView(id)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-base leading-body tracking-body transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "bg-selected font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span>{REVIEW_VIEW_LABELS[id]}</span>
              {/* The space is for the accessible name ("Blockers 3"); a whitespace-only text node
                  in a flex row takes no room, so the gap still sets the spacing. */}
              {count === undefined ? null : " "}
              {count === undefined ? null : (
                <span className="text-xs font-normal leading-tight tabular-nums text-subtle-foreground">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <LedgerFilterSelect
        label="Project"
        options={options}
        value={repo ?? ALL_PROJECTS}
        onChange={(event) => {
          const next = event.target.value;
          window.location.hash = reviewHref(next === ALL_PROJECTS ? null : next, view);
        }}
      />
    </div>
  );
}
