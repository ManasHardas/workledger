import { useEffect, useState } from "react";

import { LedgerFilterSelect } from "../../components/ui/ledger-filter-select.js";
import { Input } from "../../components/ui/input.js";
import { useSource } from "../../lib/source-context.js";

/** `SessionQuery`'s three optional string filters, with `""` standing for "not set". */
export interface LedgerFilters {
  author: string;
  harness: string;
  status: string;
  since: string;
}

export const EMPTY_FILTERS: LedgerFilters = { author: "", harness: "", status: "", since: "" };

/** `HARNESSES` and `SESSION_STATUS` in `@workledger/core`, which the fixtures are typed against. */
const HARNESS_OPTIONS = [
  { value: "", label: "Any harness" },
  { value: "claude-code", label: "claude-code" },
  { value: "cursor", label: "cursor" },
  { value: "codex", label: "codex" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "open", label: "open" },
  { value: "ended", label: "ended" },
  { value: "crashed", label: "crashed" },
  { value: "repaired", label: "repaired" },
];

/** Relative windows, resolved to the ISO instant `SessionQuery.since` takes. */
const SINCE_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

/** Turns the `since` selection into the ISO instant the query carries, or `undefined` for "any". */
export function sinceInstant(days: string, now: number = Date.now()): string | undefined {
  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return undefined;
  return new Date(now - count * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The authors that appear anywhere in the ledger, for the author filter's options.
 *
 * It is a second unfiltered read rather than a projection of the filtered list, so choosing an
 * author does not delete every other author from the menu. A failure here leaves the menu at "Any
 * author" — a filter that cannot list its options is not worth an error banner over the sessions.
 */
function useAuthors(): string[] {
  const source = useSource();
  const [authors, setAuthors] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    source.listSessions().then(
      (sessions) => {
        if (!live) return;
        const names = [...new Set(sessions.map((s) => s.frontmatter.author.name))].sort((a, b) =>
          a.localeCompare(b),
        );
        setAuthors(names);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [source]);

  return authors;
}

/**
 * The Ledger's filter row: author, harness, status and date, plus the full-text search box that
 * maps straight onto `listSessions({ q })` (design spec §8).
 *
 * Mobile-first: one column stacked, four across from `sm` up.
 */
export function LedgerFilterBar({
  filters,
  onChange,
  q,
  onQChange,
  statusLocked,
}: {
  filters: LedgerFilters;
  onChange: (next: LedgerFilters) => void;
  q: string;
  onQChange: (next: string) => void;
  /** True on the "Open" tab, where the scope already pins the status. */
  statusLocked?: boolean;
}) {
  const authors = useAuthors();
  const set = <K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        aria-label="Search sessions"
        placeholder="Search goals, items and notes"
        value={q}
        onChange={(event) => onQChange(event.target.value)}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <LedgerFilterSelect
          label="Author"
          value={filters.author}
          onChange={(event) => set("author", event.target.value)}
          options={[
            { value: "", label: "Any author" },
            ...authors.map((name) => ({ value: name, label: name })),
          ]}
        />
        <LedgerFilterSelect
          label="Harness"
          value={filters.harness}
          onChange={(event) => set("harness", event.target.value)}
          options={HARNESS_OPTIONS}
        />
        <LedgerFilterSelect
          label="Status"
          value={statusLocked ? "open" : filters.status}
          disabled={statusLocked}
          onChange={(event) => set("status", event.target.value)}
          options={STATUS_OPTIONS}
        />
        <LedgerFilterSelect
          label="Since"
          value={filters.since}
          onChange={(event) => set("since", event.target.value)}
          options={SINCE_OPTIONS}
        />
      </div>
    </div>
  );
}
