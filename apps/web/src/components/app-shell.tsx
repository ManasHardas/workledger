import { useEffect, useState } from "react";

import { cn } from "../lib/cn.js";
import type { Repo } from "../lib/ledger-source.js";
import { useHasAside, useNavIsSheet } from "../lib/media.js";
import {
  HOME_HREF,
  ONBOARDING_HREF,
  machineHref,
  repoHref,
  useRoute,
  type Route,
  type ViewId,
} from "../lib/router.js";
import { KeyboardHelp } from "./keyboard-help.js";
import { ALL_PROJECTS, ProjectSwitcher } from "./project-switcher.js";
import { Button, buttonVariants } from "./ui/button.js";
import { PanelHost, PanelSlot } from "./ui/panel.js";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet.js";

/**
 * The app shell (`docs/design/direction.md` §Shell): one centred group of a 275 px left nav (the
 * project switcher at the top, the views as pills, the one big "Add projects" pill), a 600 px
 * middle column with a hairline down either side under a translucent sticky header, and — from
 * 1280 px — a 350 px right column whose module is the evidence panel (`components/ui/panel.tsx`).
 *
 * Below 900 px the nav is a sheet behind a hamburger — the whole nav, swapped rather than restyled,
 * so there is never a second copy of every link hiding under `display: none` for a screen reader or
 * a `getByRole` query to find.
 *
 * Folders with sessions are Home's alone: the operator had the shell's copy of them removed
 * (2026-09-11), so the nav carries no folder list at any width.
 *
 * Links are real `#/…` anchors, so the browser's back button and a card's `openDeepLink` both work
 * without JavaScript in the middle.
 */

export interface NavItem {
  href: string;
  label: string;
  current: boolean;
  /** The count after the label, when the view has one. Rendered with tabular numerals. */
  count?: number;
  icon: ViewIconName;
}

type ViewIconName = "ledger" | "next" | "needs" | "jobs" | "health" | "home";

/** The five per-repo views, in the order the nav shows them. */
const REPO_VIEWS: readonly { id: ViewId; label: string; icon: ViewIconName }[] = [
  { id: "ledger", label: "Ledger", icon: "ledger" },
  { id: "next", label: "Next", icon: "next" },
  { id: "needs", label: "Needs you", icon: "needs" },
  { id: "jobs", label: "Jobs", icon: "jobs" },
  { id: "health", label: "Health", icon: "health" },
];

/**
 * The count beside each per-repo view, from the repo row `GET /api/repos` already serves. Ledger
 * counts the last seven days' sessions, Next the open backlog, Needs you the open notes; Jobs and
 * Health have no number on that row, and an invented one would be worse than none (rule 4: every
 * count is a link to the thing it counts).
 */
function countFor(view: ViewId, repo: Repo | undefined): number | undefined {
  if (repo === undefined) return undefined;
  if (view === "ledger") return repo.sessions7d;
  if (view === "next") return repo.openBacklog;
  if (view === "needs") return repo.openNotes;
  return undefined;
}

/** The nav for a route: Home and the machine-wide tabs, or one repo's five views. */
export function navFor(route: Route, repos: Repo[] = []): NavItem[] {
  if (route.kind === "repo") {
    const repo = repos.find((each) => each.id === route.repo);
    return REPO_VIEWS.map((view) => ({
      href: repoHref(route.repo, view.id),
      label: view.label,
      current: route.view === view.id,
      count: countFor(view.id, repo),
      icon: view.icon,
    }));
  }
  const openNotes = repos.reduce((total, repo) => total + repo.openNotes, 0);
  return [
    { href: HOME_HREF, label: "Home", current: route.kind === "home", icon: "home" },
    {
      href: machineHref("needs"),
      label: "Needs you",
      current: route.kind === "machine" && route.view === "needs",
      count: repos.length === 0 ? undefined : openNotes,
      icon: "needs",
    },
    {
      href: machineHref("jobs"),
      label: "Jobs",
      current: route.kind === "machine" && route.view === "jobs",
      icon: "jobs",
    },
  ];
}

/**
 * A route as one comparable string. `useRoute()` parses a fresh object out of the hash on every
 * render, so a `useEffect` that wants "the route changed" has to depend on this, not on the object.
 */
function routeKey(route: Route): string {
  if (route.kind === "repo") return `repo/${route.repo}/${route.view}/${route.rest.join("/")}`;
  if (route.kind === "machine") return `machine/${route.view}`;
  if (route.kind === "legacy") return `legacy/${route.view}/${route.rest.join("/")}`;
  return route.kind;
}

/** The sticky header's title: what the middle pane is *about*, not which view of it is showing. */
function paneTitle(route: Route, repo: Repo | undefined, repoId: string): string {
  if (route.kind === "onboarding") return "Add projects";
  if (route.kind === "machine") return "All projects";
  if (route.kind === "repo") return repo?.name ?? repoId;
  return "Home";
}

export function AppShell({ repos, children }: { repos: Repo[]; children: React.ReactNode }) {
  const route = useRoute();
  const asSheet = useNavIsSheet();
  // A real viewport is never both, but a stubbed `matchMedia` can say so; the sheet wins.
  const hasAside = useHasAside() && !asSheet;
  const [menuOpen, setMenuOpen] = useState(false);

  const repoId = route.kind === "repo" ? route.repo : ALL_PROJECTS;
  const current = repos.find((repo) => repo.id === repoId);
  const nav = navFor(route, repos);

  // The sheet is a route-scoped thing: leaving the route it was opened from must never leave it
  // open over the new one. `route` itself is a fresh object on every render, so the dependency is
  // a key derived from it — watching only `kind` and the repo id let a tap on one of the five
  // views navigate with the modal sheet still up, the document still `aria-hidden`, and focus
  // still inside it (#132 review).
  const where = routeKey(route);
  useEffect(() => setMenuOpen(false), [where]);

  function switchTo(id: string) {
    if (id === ALL_PROJECTS) {
      window.location.hash = HOME_HREF;
      return;
    }
    const view: ViewId = route.kind === "repo" ? route.view : route.kind === "machine" ? route.view : "ledger";
    window.location.hash = repoHref(id, view);
  }

  const sidebar = (inSheet: boolean) => (
    <Sidebar nav={nav} repos={repos} repoId={repoId} onSwitch={switchTo} inSheet={inSheet} />
  );

  return (
    <PanelHost>
      {(panelOpen) => (
        <div className="min-h-screen bg-background text-foreground">
          <div
            className={cn(
              // No transition on the padding: the pane's width is measured the moment the panel
              // opens (a screenshot, a layout read), and an animated reflow makes that a race.
              "flex min-h-screen justify-center",
              hasAside ? "gap-8" : "",
              // Between 900 and 1279 px there is no right column, so the panel floats at the right
              // edge, non-modal; the centred group makes room for it rather than being covered by
              // it: 350 px of panel plus its 12 px inset on either side.
              panelOpen && !asSheet && !hasAside
                ? "pr-[calc(var(--wl-spacing-panel)_+_2_*_var(--wl-spacing-inset))]"
                : "",
            )}
          >
            {asSheet ? null : (
              <div className="w-nav shrink-0">
                <div className="sticky top-0 h-screen">{sidebar(false)}</div>
              </div>
            )}
            <div className="flex min-w-0 max-w-reading flex-1 flex-col border-hairline sm:border-x">
              <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-background/65 px-4 backdrop-blur-md">
                {asSheet ? (
                  <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                    <SheetTrigger asChild>
                      <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8 shrink-0" aria-label="Open navigation">
                        <MenuIcon />
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="left" aria-describedby={undefined} className="w-nav max-w-[85vw] p-0">
                      <SheetHeader className="sr-only">
                        <SheetTitle>Navigation</SheetTitle>
                      </SheetHeader>
                      {sidebar(true)}
                    </SheetContent>
                  </Sheet>
                ) : null}
                <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold leading-title">
                  {paneTitle(route, current, repoId)}
                </h1>
                {/*
                  The status chips of direction.md §Shell. The primary action stays with the view
                  that owns it — Home's "Add projects", a session's "Repair" — so the header does not
                  grow a second copy of a control the middle pane already has.
                */}
                {current === undefined ? null : <HealthChip health={current.health} />}
              </header>
              <main id="main" className="min-w-0 flex-1 px-4 py-4">
                {children}
              </main>
            </div>
            {hasAside ? (
              <aside aria-label="Details" className="w-panel shrink-0">
                <div className="sticky top-0 flex max-h-screen flex-col gap-4 overflow-y-auto py-inset">
                  <PanelSlot />
                  <p className="px-4 text-xs text-subtle-foreground">Press ? for keyboard shortcuts.</p>
                </div>
              </aside>
            ) : null}
          </div>
          <KeyboardHelp />
        </div>
      )}
    </PanelHost>
  );
}

/**
 * The nav's contents — the same tree whether it is the fixed column or the sheet behind it.
 *
 * `inSheet` is the one difference, and it is about not trapping anybody: inside the sheet every
 * link also closes it, and the sheet carries a visible close control. The route effect in
 * {@link AppShell} closes it too; both exist because a modal sheet whose only exits are Escape and
 * a 57 px strip of overlay is a trap the moment either one misses (#132 review).
 */
function Sidebar({
  nav,
  repos,
  repoId,
  onSwitch,
  inSheet,
}: {
  nav: NavItem[];
  repos: Repo[];
  repoId: string;
  onSwitch: (id: string) => void;
  inSheet: boolean;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-2 pb-3 pt-1">
      <div className="flex items-center justify-between">
        <Dismissing inSheet={inSheet}>
          <a
            href={HOME_HREF}
            aria-label="workledger — Home"
            className="flex h-row-nav w-row-nav items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark />
          </a>
        </Dismissing>
        {inSheet ? (
          <SheetClose
            aria-label="Close navigation"
            className="mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloseIcon />
          </SheetClose>
        ) : null}
      </div>

      {/* The project comes first: every view below it is a view of the project named here. */}
      <div className="pb-2">
        <ProjectSwitcher repos={repos} value={repoId} onSelect={onSwitch} />
      </div>

      {/* Pills as wide as their label; full width in the sheet, for the thumb. */}
      <nav aria-label="Views" className={cn("flex flex-col gap-1", inSheet ? "items-stretch" : "items-start")}>
        {nav.map((item) => (
          <Dismissing key={item.href} inSheet={inSheet}>
            <a
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "flex h-row-nav max-w-full items-center gap-5 rounded-full pl-3 pr-6 text-xl leading-title text-foreground transition-colors",
                "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                // The current view is marked by weight and a heavier icon, not by a filled row.
                item.current ? "font-bold" : "",
              )}
            >
              <ViewIcon name={item.icon} current={item.current} />
              <span className="min-w-0 truncate">{item.label}</span>
              {item.count === undefined ? null : (
                <span className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground">
                  {item.count}
                </span>
              )}
            </a>
          </Dismissing>
        ))}
      </nav>

      <Dismissing inSheet={inSheet}>
        <a href={ONBOARDING_HREF} className={cn(buttonVariants({ size: "lg" }), "mt-4 w-[90%]")}>
          Add projects
        </a>
      </Dismissing>
    </div>
  );
}

/**
 * A link that also closes the nav sheet when it is inside one. `SheetClose` is Radix's dialog
 * close, so it must not be rendered outside the sheet — hence the flag rather than a hook.
 */
function Dismissing({ inSheet, children }: { inSheet: boolean; children: React.ReactElement }) {
  return inSheet ? <SheetClose asChild>{children}</SheetClose> : children;
}

/** The repo's own health, as a chip in the sticky header — status colour, never a row fill. */
function HealthChip({ health }: { health: Repo["health"] }) {
  const tone =
    health === "broken"
      ? "border-transparent bg-destructive text-destructive-foreground"
      : health === "warn"
        ? "border-transparent bg-warning text-warning-foreground"
        : "border-border text-muted-foreground";
  return (
    <span className={cn("shrink-0 rounded-full border px-2 py-px text-xs font-medium", tone)}>
      {health}
    </span>
  );
}

/**
 * The mark from `public/icon.svg`, drawn in the foreground colour so it reads in both themes.
 * Decorative: the link around it carries the name.
 */
function BrandMark() {
  return (
    <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
      <rect width="64" height="64" rx="14" className="fill-foreground" />
      <g className="stroke-background" strokeWidth="5" strokeLinecap="round">
        <path d="M20 22h24" />
        <path d="M20 32h24" />
        <path d="M20 42h14" />
      </g>
    </svg>
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

/** The 26 px icon each nav pill carries. Decorative: the label beside it is the name. */
function ViewIcon({ name, current }: { name: ViewIconName; current: boolean }) {
  const paths: Record<ViewIconName, React.ReactNode> = {
    home: <path d="M2.5 7L8 2.5 13.5 7v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7z" />,
    ledger: <path d="M3 3h10v10H3zM5.5 6h5M5.5 8.5h5M5.5 11h3" />,
    next: <path d="M3 4.5h10M3 8h10M3 11.5h6" />,
    needs: <path d="M6 6a2 2 0 1 1 2 2v1.5M8 12h.01" />,
    jobs: <path d="M2.5 8h3l1.5 3 2-6 1.5 3h3" />,
    health: <path d="M8 13.5S2.5 10.2 2.5 6.6A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.6c0 3.6-5.5 6.9-5.5 6.9z" />,
  };
  return (
    <svg
      viewBox="0 0 16 16"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth={current ? 1.75 : 1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {paths[name]}
    </svg>
  );
}
