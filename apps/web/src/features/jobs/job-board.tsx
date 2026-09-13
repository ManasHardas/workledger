import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { RowList } from "../../components/ui/list-row.js";
import { PageSection } from "../../components/ui/page.js";
import { cn } from "../../lib/cn.js";
import {
  JOB_FILTERS,
  countByFilter,
  finishedOrder,
  inFlightOrder,
  matchesFilter,
  type JobFilter,
} from "./format.js";

import type { Job } from "../../lib/ledger-source.js";

/** Body/Regular, muted — the one line a list shows when it has nothing, or is still reading. */
export const QUIET_LINE = "px-3.5 py-2 text-base leading-body tracking-body text-muted-foreground";

/**
 * The status filter as a row of tabs — `All · In flight · Done · Failed · Cancelled` — each with
 * its count from the whole list, so what finished and what is still in flight is findable at a
 * glance. Drawn like the nav rows. Tab/Enter work as buttons do; the arrow keys, Home and End move
 * between tabs the way a tablist does.
 */
export function JobFilterTabs({
  jobs,
  filter,
  onChange,
  panelId,
  idPrefix,
}: {
  jobs: readonly Job[];
  filter: JobFilter;
  onChange: (filter: JobFilter) => void;
  panelId: string;
  idPrefix: string;
}) {
  const counts = countByFilter(jobs);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const at = JOB_FILTERS.findIndex((tab) => tab.value === filter);
    const last = JOB_FILTERS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (at + 1) % JOB_FILTERS.length
        : event.key === "ArrowLeft"
          ? (at - 1 + JOB_FILTERS.length) % JOB_FILTERS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onChange(JOB_FILTERS[next]!.value);
    tabs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="Job status" className="flex flex-wrap items-center gap-1" onKeyDown={move}>
      {JOB_FILTERS.map((tab, index) => {
        const selected = tab.value === filter;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            id={`${idPrefix}-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg px-2 text-base leading-body tracking-body transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-selected font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}{" "}
            <span className="text-xs font-normal leading-tight tabular-nums text-subtle-foreground">
              {counts[tab.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The jobs under the selected tab. `All` is two sections — In flight (running first, then queued)
 * and Finished (most recently finished first) — so the two questions the page answers never share
 * a list; any other tab is one list of that status, newest first (In flight: running first).
 *
 * `empty` is the line for a list with nothing in it under a single tab.
 */
export function JobBoard<J extends Job>({
  jobs,
  filter,
  idPrefix,
  empty,
  renderRow,
}: {
  jobs: readonly J[];
  filter: JobFilter;
  idPrefix: string;
  empty: (filter: Exclude<JobFilter, "all">) => string;
  renderRow: (job: J) => ReactNode;
}) {
  if (filter !== "all") {
    // In flight keeps its running-first order under its own tab too.
    const ordered =
      filter === "in-flight" ? inFlightOrder(jobs) : jobs.filter((job) => matchesFilter(job.status, filter));
    return ordered.length === 0 ? (
      <p className={QUIET_LINE}>{empty(filter)}</p>
    ) : (
      <RowList aria-label="Jobs, newest first">{ordered.map(renderRow)}</RowList>
    );
  }
  const flying = inFlightOrder(jobs);
  const finished = finishedOrder(jobs);
  return (
    <>
      <PageSection id={`${idPrefix}-in-flight`} title="In flight" aside={String(flying.length)}>
        {flying.length === 0 ? (
          <p className={QUIET_LINE}>Nothing in flight.</p>
        ) : (
          <RowList aria-label="In flight, running first">{flying.map(renderRow)}</RowList>
        )}
      </PageSection>
      <PageSection id={`${idPrefix}-finished`} title="Finished" aside={String(finished.length)}>
        {finished.length === 0 ? (
          <p className={QUIET_LINE}>Nothing has finished yet.</p>
        ) : (
          <RowList aria-label="Finished, newest first">{finished.map(renderRow)}</RowList>
        )}
      </PageSection>
    </>
  );
}

/** Stable per mount: the tab ids and the panel they control. */
export function useBoardIds(): { idPrefix: string; panelId: string } {
  const base = useId().replace(/[^A-Za-z0-9_-]/g, "");
  return { idPrefix: `jobs-${base}`, panelId: `jobs-${base}-panel` };
}
