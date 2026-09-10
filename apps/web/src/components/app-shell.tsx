import { useState } from "react";

import type { Repo } from "../lib/ledger-source.js";
import { HOME_HREF, repoHref, useRoute, type Route, type ViewId } from "../lib/router.js";
import { KeyboardHelp } from "./keyboard-help.js";
import { Button } from "./ui/button.js";
import { SelectField } from "./ui/select-field.js";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet.js";

export interface NavItem {
  href: string;
  label: string;
  current: boolean;
}

/** The five per-repo views, in the order the nav shows them. */
const REPO_VIEWS: readonly { id: ViewId; label: string }[] = [
  { id: "ledger", label: "Ledger" },
  { id: "next", label: "Next" },
  { id: "needs", label: "Needs you" },
  { id: "jobs", label: "Jobs" },
  { id: "health", label: "Health" },
];

/** The nav for a route: Home and the machine-wide tabs, or one repo's five views. */
export function navFor(route: Route): NavItem[] {
  if (route.kind === "repo") {
    return REPO_VIEWS.map((view) => ({
      href: repoHref(route.repo, view.id),
      label: view.label,
      current: route.view === view.id,
    }));
  }
  return [
    { href: HOME_HREF, label: "Home", current: route.kind === "home" },
    { href: "#/needs", label: "Needs you", current: route.kind === "machine" && route.view === "needs" },
    { href: "#/jobs", label: "Jobs", current: route.kind === "machine" && route.view === "jobs" },
  ];
}

/** The value the switcher shows when no repo is selected: Home and the machine-wide tabs. */
const ALL_PROJECTS = "";

/**
 * The app shell: a top nav over the active view. Mobile-first — the nav is a sheet behind a menu
 * button until `sm`, where it becomes a row of links. Links are real `#/…` anchors so the browser's
 * back button and a card's `openDeepLink` both work without JavaScript in the middle.
 *
 * P8: the header names the repo in view and switches between repos. Picking one goes to that
 * repo's version of the current view (or its Ledger from Home); picking "All projects" goes Home.
 */
export function AppShell({ repos, children }: { repos: Repo[]; children: React.ReactNode }) {
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = navFor(route);
  const repoId = route.kind === "repo" ? route.repo : ALL_PROJECTS;
  const current = repos.find((repo) => repo.id === repoId);

  function switchTo(id: string) {
    if (id === ALL_PROJECTS) {
      window.location.hash = HOME_HREF;
      return;
    }
    const view: ViewId = route.kind === "repo" ? route.view : route.kind === "machine" ? route.view : "ledger";
    window.location.hash = repoHref(id, view);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 sm:gap-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 sm:hidden" aria-label="Open navigation">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" aria-describedby={undefined}>
              <SheetHeader>
                <SheetTitle>workledger</SheetTitle>
              </SheetHeader>
              <nav aria-label="Views" className="flex flex-col gap-1">
                {nav.map((item) => (
                  <SheetClose asChild key={item.href}>
                    <a
                      href={item.href}
                      aria-current={item.current ? "page" : undefined}
                      className="rounded-md px-3 py-2 text-base aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground hover:bg-muted"
                    >
                      {item.label}
                    </a>
                  </SheetClose>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <a
            href={HOME_HREF}
            aria-label="workledger — Home"
            className="shrink-0 rounded-md text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            workledger
          </a>
          <SelectField
            aria-label="Project"
            value={repoId}
            onChange={(event) => switchTo(event.target.value)}
            className="min-w-0 max-w-[45vw] truncate sm:max-w-56"
          >
            <option value={ALL_PROJECTS}>All projects</option>
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))}
            {/* A route naming a repo the list does not (yet) hold still shows its id. */}
            {repoId !== ALL_PROJECTS && current === undefined ? <option value={repoId}>{repoId}</option> : null}
          </SelectField>
          <nav aria-label="Views" className="ml-auto hidden gap-1 sm:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={item.current ? "page" : undefined}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      <KeyboardHelp />
    </div>
  );
}

/** Inlined so the bundle asks the network for nothing (design spec §14: no external assets). */
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}
