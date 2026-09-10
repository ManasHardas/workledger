import { useState } from "react";

import { hrefFor, useRoute, type RouteId } from "../lib/router.js";
import { KeyboardHelp } from "./keyboard-help.js";
import { Button } from "./ui/button.js";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet.js";

export interface NavItem {
  id: RouteId;
  label: string;
}

/**
 * The app shell: a top nav over the active view. Mobile-first — the nav is a sheet behind a menu
 * button until `sm`, where it becomes a row of links. Links are real `#/…` anchors so the browser's
 * back button and a card's `openDeepLink` both work without JavaScript in the middle.
 */
export function AppShell({ nav, children }: { nav: NavItem[]; children: React.ReactNode }) {
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Open navigation">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" aria-describedby={undefined}>
              <SheetHeader>
                <SheetTitle>workledger</SheetTitle>
              </SheetHeader>
              <nav aria-label="Views" className="flex flex-col gap-1">
                {nav.map((item) => (
                  <SheetClose asChild key={item.id}>
                    <a
                      href={hrefFor(item.id)}
                      aria-current={route === item.id ? "page" : undefined}
                      className="rounded-md px-3 py-2 text-base aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground hover:bg-muted"
                    >
                      {item.label}
                    </a>
                  </SheetClose>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
          <span className="text-base font-semibold">workledger</span>
          <nav aria-label="Views" className="ml-auto hidden gap-1 sm:flex">
            {nav.map((item) => (
              <a
                key={item.id}
                href={hrefFor(item.id)}
                aria-current={route === item.id ? "page" : undefined}
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
