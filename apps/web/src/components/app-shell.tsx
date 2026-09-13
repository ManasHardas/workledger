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
import { AsideColumn, AsideHost, AsideSlot } from "./aside.js";
import { KeyboardHelp } from "./keyboard-help.js";
import { ALL_PROJECTS, ProjectSwitcher } from "./project-switcher.js";
import { Button } from "./ui/button.js";
import { PanelHost, PanelSlot } from "./ui/panel.js";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet.js";

/**
 * The app shell, as every Product Designs frame draws it (`plans/feature-p9-figma-screens.md`
 * §Shell): a 232 px nav with a hairline on its right, then the reading
 * column and — from 1280 px — the 352 px right column holding the view's module
 * (`components/aside.tsx`) above any opened panel (`components/ui/panel.tsx`).
 *
 * The frames are 1440 px wide. Past that, the whole app — nav included — stays at the frame's
 * width and centres, so extra space becomes equal margins on both sides (operator, 2026-09-13).
 * The right column's module starts on the reading column's first line, under a band that carries
 * the page header's hairline across it.
 *
 * The shell draws no page header: each view renders its own `PageHeader` and `PageBody`, because
 * the header's copy and the body's rhythm are the screen's.
 *
 * Below 900 px the nav is a sheet behind a hamburger — the whole nav, swapped rather than restyled,
 * so there is never a second copy of every link hiding under `display: none` for a screen reader or
 * a `getByRole` query to find.
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
  /**
   * True for the machinery below the separator — Jobs and Health. They are reachable, but they
   * are not places you go to read, so the four that are keep the top of the nav to themselves.
   */
  secondary?: boolean;
}

type ViewIconName = "ledger" | "session" | "review" | "jobs" | "health" | "home";

/**
 * The nav, in the order the operator asked for (P9, 2026-09-12): Home, Ledger, Session, Review.
 * Home is machine-wide and is added by {@link navFor}; the three below are this project's.
 *
 * Jobs and Health are deliberately absent. They are still routes and still reachable — Home links
 * to them and `#/r/<id>/jobs` still resolves — but they are machinery, not places to read, and a
 * nav of six blunts the four that matter.
 */
const REPO_VIEWS: readonly { id: ViewId; label: string; icon: ViewIconName }[] = [
  { id: "ledger", label: "Ledger", icon: "ledger" },
  { id: "session", label: "Sessions", icon: "session" },
  { id: "review", label: "Review", icon: "review" },
];

/**
 * Below the separator: the recovery queue and the diagnostics. Reachable, but not places you go
 * to read, so they sit apart from the four that are (operator, 2026-09-12).
 */
const SECONDARY_VIEWS: readonly { id: ViewId; label: string; icon: ViewIconName }[] = [
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
  // Review holds both halves of what waits on a person: the questions and blockers an agent
  // raised, and the backlog it proposed. The count is both, because both are on that screen.
  if (view === "review") return repo.openNotes + repo.openBacklog;
  return undefined;
}

/**
 * The nav for a route: Home first always, then this project's Ledger, Session and Review (P9).
 *
 * On a machine-wide route there is no project to scope to, so Home is followed by the aggregated
 * Review and Jobs tabs — the same two surfaces, read across every repo.
 */
export function navFor(route: Route, repos: Repo[] = []): NavItem[] {
  const home: NavItem = {
    href: HOME_HREF,
    label: "Home",
    current: route.kind === "home",
    icon: "home",
  };
  if (route.kind === "repo") {
    const repo = repos.find((each) => each.id === route.repo);
    const item = (view: { id: ViewId; label: string; icon: ViewIconName }, secondary?: boolean) => ({
      href: repoHref(route.repo, view.id),
      label: view.label,
      current: route.view === view.id,
      count: countFor(view.id, repo),
      icon: view.icon,
      ...(secondary === true ? { secondary: true } : {}),
    });
    return [
      home,
      ...REPO_VIEWS.map((view) => item(view)),
      ...SECONDARY_VIEWS.map((view) => item(view, true)),
    ];
  }
  const waiting = repos.reduce((total, repo) => total + repo.openNotes + repo.openBacklog, 0);
  return [
    home,
    {
      href: machineHref("review"),
      label: "Review",
      current: route.kind === "machine" && route.view === "review",
      count: repos.length === 0 ? undefined : waiting,
      icon: "review",
    },
    {
      href: machineHref("jobs"),
      label: "Jobs",
      current: route.kind === "machine" && route.view === "jobs",
      icon: "jobs",
      secondary: true,
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

export function AppShell({ repos, children }: { repos: Repo[]; children: React.ReactNode }) {
  const route = useRoute();
  const asSheet = useNavIsSheet();
  // A real viewport is never both, but a stubbed `matchMedia` can say so; the sheet wins.
  const hasAside = useHasAside() && !asSheet;
  const [menuOpen, setMenuOpen] = useState(false);

  const repoId = route.kind === "repo" ? route.repo : ALL_PROJECTS;
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
    <Sidebar
      nav={nav}
      repos={repos}
      repoId={repoId}
      onSwitch={switchTo}
      inSheet={inSheet}
      onboarding={route.kind === "onboarding"}
    />
  );

  return (
    <AsideHost>
      <PanelHost>
        {(panelOpen) => (
          <div className="min-h-screen bg-background text-foreground">
            {/* The whole app is one block — nav, reading column, right column — at most the width
                the frames are drawn at (232 + 856 + 352 = 1440 px), centred in the window. A wider
                window adds margin on both sides equally (operator, 2026-09-13); past 1440 px a
                hairline closes each side so the block reads as a page, not as columns adrift. */}
            <div className="mx-auto flex min-h-screen w-full max-w-[calc(var(--wl-spacing-nav)_+_var(--wl-spacing-reading)_+_2.25rem_+_var(--wl-spacing-panel))] min-[90.0625rem]:border-x min-[90.0625rem]:border-hairline">
              {asSheet ? null : (
                <div className="w-nav shrink-0 border-r border-hairline">
                  <div className="sticky top-0 h-screen">{sidebar(false)}</div>
                </div>
              )}
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col",
                  // Between 900 and 1279 px there is no right column, so an opened panel floats at
                  // the right edge, non-modal; the content makes room for it rather than being
                  // covered: the panel's width plus its inset on either side.
                  panelOpen && !asSheet && !hasAside
                    ? "pr-[calc(var(--wl-spacing-panel)_+_2_*_var(--wl-spacing-inset))]"
                    : "",
                )}
              >
                {asSheet ? (
                  <div className="flex h-13 shrink-0 items-center gap-2 border-b border-hairline px-4">
                    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                      <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="-ml-1 shrink-0" aria-label="Open navigation">
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
                  </div>
                ) : null}
                <div className="flex w-full min-w-0 flex-1">
                  {/* The view draws its own header and body (`components/ui/page.tsx`): the copy
                      and the rhythm differ per screen. */}
                  <main id="main" className="flex min-w-0 flex-1 flex-col">
                    {children}
                  </main>
                  {hasAside ? (
                    <AsideColumn>
                      <AsideSlot />
                      <PanelSlot />
                    </AsideColumn>
                  ) : null}
                </div>
              </div>
            </div>
            <KeyboardHelp />
          </div>
        )}
      </PanelHost>
    </AsideHost>
  );
}

/**
 * The nav's contents — the same tree whether it is the fixed column or the sheet behind it.
 *
 * Measured from the frames' `nav` node (`11:3`): 12 px sides, 16 px top, a 2 px gap between rows;
 * the project row, a 12 px spacer, then 28 px rows with the separator above Jobs.
 *
 * `inSheet` is the one difference, and it is about not trapping anybody: inside the sheet every
 * link also closes it, and the sheet carries a visible close control. The route effect in
 * {@link AppShell} closes it too; both exist because a modal sheet whose only exits are Escape and
 * a strip of overlay is a trap the moment either one misses (#132 review).
 */
function Sidebar({
  nav,
  repos,
  repoId,
  onSwitch,
  inSheet,
  onboarding,
}: {
  nav: NavItem[];
  repos: Repo[];
  repoId: string;
  onSwitch: (id: string) => void;
  inSheet: boolean;
  /** True on `#/onboarding`, which the Add projects row marks as the current page. */
  onboarding: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 py-4">
      <div className="flex items-center gap-1">
        {/* The project comes first: every view below it is a view of the project named here. */}
        <div className="min-w-0 flex-1">
          <ProjectSwitcher repos={repos} value={repoId} onSelect={onSwitch} />
        </div>
        {inSheet ? (
          <SheetClose
            aria-label="Close navigation"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloseIcon />
          </SheetClose>
        ) : null}
      </div>

      <span aria-hidden="true" className="h-3 w-2 shrink-0" />

      <nav aria-label="Views" className="flex flex-col gap-0.5">
        {nav.map((item, index) => (
          <Dismissing key={item.href} inSheet={inSheet} separated={isFirstSecondary(nav, index)}>
            <a
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "flex h-7 w-full items-center gap-2.5 rounded-lg px-2 text-base leading-body tracking-body transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                item.current
                  ? "bg-selected font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <ViewIcon name={item.icon} current={item.current} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.count === undefined ? null : (
                <span className="shrink-0 text-xs font-normal leading-tight tabular-nums text-subtle-foreground">
                  {item.count}
                </span>
              )}
            </a>
          </Dismissing>
        ))}
      </nav>

      {/* Adding projects is the nav's (operator, 2026-09-13): pinned to the foot of the column,
          a row like the views above it, so it is always one click away without competing with
          them. */}
      <div className="mt-auto pt-3">
        <Dismissing inSheet={inSheet}>
          <a
            href={ONBOARDING_HREF}
            aria-current={onboarding ? "page" : undefined}
            className={cn(
              "flex h-7 w-full items-center gap-2.5 rounded-lg px-2 text-base leading-body tracking-body transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              onboarding
                ? "bg-selected font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <PlusIcon current={onboarding} />
            <span className="min-w-0 flex-1 truncate">Add projects</span>
          </a>
        </Dismissing>
      </div>
    </div>
  );
}

/** The Add projects row's icon, drawn like the view icons: 16 px, 1.25 px stroke. */
function PlusIcon({ current }: { current: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      aria-hidden="true"
      className={cn("shrink-0", current ? "text-primary" : "text-subtle-foreground")}
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M8 5.5v5M5.5 8h5" />
    </svg>
  );
}

/**
 * A link that also closes the nav sheet when it is inside one. `SheetClose` is Radix's dialog
 * close, so it must not be rendered outside the sheet — hence the flag rather than a hook.
 */
function Dismissing({
  inSheet,
  separated,
  children,
}: {
  inSheet: boolean;
  /** Draws the hairline that divides the reading views from the machinery below them. */
  separated?: boolean;
  children: React.ReactElement;
}) {
  const link = inSheet ? <SheetClose asChild>{children}</SheetClose> : children;
  if (separated !== true) return link;
  return (
    <>
      <span aria-hidden="true" className="h-px w-full shrink-0 bg-hairline" />
      {link}
    </>
  );
}

/** True at the first item below the separator, so the hairline is drawn exactly once. */
function isFirstSecondary(nav: NavItem[], index: number): boolean {
  const item = nav[index];
  if (item?.secondary !== true) return false;
  return nav[index - 1]?.secondary !== true;
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
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The 16 px icon each nav row carries: the frame's icon box, with the app's own glyphs in it
 * (operator, 2026-09-12 — the frame's squares are placeholders). 1.25 px strokes, in the primary
 * colour on the current row and the subtle grey on the rest. Decorative: the label is the name.
 */
function ViewIcon({ name, current }: { name: ViewIconName; current: boolean }) {
  const paths: Record<ViewIconName, React.ReactNode> = {
    home: <path d="M2.5 7L8 2.5 13.5 7v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7z" />,
    ledger: <path d="M3 3h10v10H3zM5.5 6h5M5.5 8.5h5M5.5 11h3" />,
    // One session: a single record with its checkpoints down the side.
    session: <path d="M4 2.5h8v11H4zM2 5h2M2 8h2M2 11h2" />,
    // Review: a mark against a list — the human passing over what the agents produced.
    review: <path d="M2.5 4.5h7M2.5 8h5M2.5 11.5h4M10 10.5l1.5 1.5 3-3.5" />,
    jobs: <path d="M2.5 8h3l1.5 3 2-6 1.5 3h3" />,
    health: <path d="M8 13.5S2.5 10.2 2.5 6.6A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.6c0 3.6-5.5 6.9-5.5 6.9z" />,
  };
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", current ? "text-primary" : "text-subtle-foreground")}
    >
      {paths[name]}
    </svg>
  );
}
