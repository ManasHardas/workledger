import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../lib/cn.js";
import type { Repo } from "../lib/ledger-source.js";

/**
 * The project switcher at the foot of the left nav, where X keeps its account switcher
 * (`docs/design/direction.md` §Shell): "current project, keyboard-openable, filterable".
 *
 * A button that opens a small modal list rather than a `<select>`, because the direction asks for
 * a filter and a native select has none. Everything about it is keyboard-reachable without a
 * roving-tabindex of our own: the trigger is a button, the filter box takes focus on open, Escape
 * closes, and the results are ordinary buttons in the tab order behind the box.
 */

/** The value that means Home and the machine-wide tabs rather than one project. */
export const ALL_PROJECTS = "";

export interface ProjectSwitcherProps {
  repos: Repo[];
  /** The selected repo id, or {@link ALL_PROJECTS}. */
  value: string;
  onSelect: (id: string) => void;
}

export function ProjectSwitcher({ repos, value, onSelect }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);

  const current = repos.find((repo) => repo.id === value);
  // A route naming a repo the list does not (yet) hold still shows its id rather than lying that
  // nothing is selected.
  const label = value === ALL_PROJECTS ? "All projects" : (current?.name ?? value);

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return repos;
    return repos.filter(
      (repo) => repo.name.toLowerCase().includes(needle) || repo.path.toLowerCase().includes(needle),
    );
  }, [repos, filter]);

  function choose(id: string) {
    setOpen(false);
    onSelect(id);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        // The accessible name says both what the control is and what it currently holds, so it is
        // findable without reading the surrounding nav.
        aria-label={`Project: ${label}`}
        // X's account switcher, at the foot of the nav: an avatar, the name in bold, a quiet
        // second line, and the overflow mark.
        className="flex w-full items-center gap-3 rounded-full p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-lg font-bold text-secondary-foreground"
        >
          {value === ALL_PROJECTS ? <AllIcon /> : label.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 leading-body">
          <span className="block truncate text-sm font-bold">{label}</span>
          <span className="block truncate text-sm text-muted-foreground">Switch project</span>
        </span>
        <MoreIcon />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-16 z-50 flex max-h-[60vh] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-panel"
        >
          <DialogPrimitive.Title className="sr-only">Switch project</DialogPrimitive.Title>
          <input
            autoFocus
            type="text"
            aria-label="Filter projects"
            placeholder="Filter projects…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="border-b border-hairline bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Projects to switch to">
            <li>
              <Row selected={value === ALL_PROJECTS} onClick={() => choose(ALL_PROJECTS)}>
                All projects
              </Row>
            </li>
            {matches.map((repo) => (
              <li key={repo.id}>
                <Row selected={repo.id === value} onClick={() => choose(repo.id)}>
                  {repo.name}
                </Row>
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">No project matches.</li>
            ) : null}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Row({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex h-row w-full items-center gap-2 px-4 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected ? "font-bold" : "",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <CheckIcon /> : null}
    </button>
  );
}

/** Inlined so the bundle asks the network for nothing (design spec §14: no external assets). */
function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true" className="shrink-0">
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </svg>
  );
}

/** The selected project's mark in the list, in the one accent X uses for it. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className="shrink-0 text-primary"
    >
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The avatar of "All projects", which has no initial of its own. */
function AllIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}
