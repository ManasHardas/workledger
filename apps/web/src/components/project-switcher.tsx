import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../lib/cn.js";
import type { Repo } from "../lib/ledger-source.js";

/**
 * The project switcher at the top of the left nav (`docs/design/direction.md` §Shell): "current
 * project, keyboard-openable, filterable".
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
        className="flex h-row w-full items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronIcon />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-16 z-50 flex max-h-[60vh] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-hairline bg-raised shadow-panel"
        >
          <DialogPrimitive.Title className="sr-only">Switch project</DialogPrimitive.Title>
          <input
            autoFocus
            type="text"
            aria-label="Filter projects"
            placeholder="Filter projects…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="border-b border-hairline bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <ul className="min-h-0 flex-1 overflow-y-auto p-1" aria-label="Projects to switch to">
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
              <li className="px-2 py-2 text-xs text-muted-foreground">No project matches.</li>
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
        "flex h-row w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-selected text-accent-foreground" : "text-foreground",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** Inlined so the bundle asks the network for nothing (design spec §14: no external assets). */
function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className="shrink-0 text-subtle-foreground"
    >
      <path d="M5 6.5L8 9.5l3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
