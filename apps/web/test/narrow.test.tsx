import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { FIXTURE_JOBS_ALL, FIXTURE_NOTES, FIXTURE_REPOS, FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import { createSource, type AppSource, type Job, type LedgerSource } from "../src/lib/ledger-source.js";
import { NAV_SHEET_QUERY, PANEL_SHEET_QUERY } from "../src/lib/media.js";
import { repoHref } from "../src/lib/router.js";

/**
 * Rule 5 of `docs/design/direction.md`: **nothing in the middle pane may scroll horizontally at
 * 375 px**. This file is that rule, for all five views (#134).
 *
 * jsdom does no layout, so `scrollWidth` here would be zero for everything and a test that read
 * it would pass on a page that is three screens wide. What is checkable without a layout engine is
 * the *structure* the rule reduces to, and it is the structure that regresses:
 *
 * 1. The middle pane and every list row can give up width — `min-w-0` — so a long child shrinks
 *    the flex item instead of widening it.
 * 2. Every list row wraps, so a row that runs out of room becomes two lines rather than a scroller.
 * 3. Every *unbroken* run of text long enough to overflow a 375 px column — a path, a ULID, a
 *    commit, a store location: things with no space to wrap at — sits inside an element that
 *    truncates, wraps anywhere, clamps, or declares its own horizontal scroller.
 *
 * The pixel measurement that these stand in for is in `test/e2e/narrow.e2e.ts`, which resizes a
 * real Chromium to 375 px and compares `scrollWidth` with the viewport for each of the five views.
 */

const FIRST = FIXTURE_REPOS[0]!;

/** Classes that make a long string safe in a narrow column. */
const CONTAINS_LONG_TEXT = [
  "truncate",
  "wrap-anywhere",
  "break-all",
  "break-words",
  "whitespace-pre-wrap",
  "overflow-x-auto",
  "overflow-auto",
  "line-clamp",
];

/**
 * The longest run of text with no space in it. Prose wraps at its spaces on its own; only an
 * unbroken run can force a 375 px column wider than itself.
 */
function longestWord(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .reduce((longest, word) => Math.max(longest, word.length), 0);
}

/**
 * 24 characters of unbroken text is roughly 160 px at the 13 px base step — enough that a row
 * carrying it plus two chips and a control has nowhere left to go on a 375 px screen. A ULID is
 * 26, an absolute path is longer, and both appear in these views.
 */
const OVERFLOWS = 24;

/** Every unbroken run in the middle pane that nothing above it is prepared to break. */
function unbrokenRuns(main: HTMLElement): string[] {
  const offenders: string[] = [];
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? "";
    if (longestWord(text) < OVERFLOWS) continue;
    let element = node.parentElement;
    let safe = false;
    while (element !== null && main.contains(element)) {
      if (CONTAINS_LONG_TEXT.some((klass) => element!.className.includes(klass))) {
        safe = true;
        break;
      }
      element = element.parentElement;
    }
    if (!safe) offenders.push(text.trim().slice(0, 72));
  }
  return offenders;
}

/** Every list row that cannot shrink or wrap. */
function rigidRows(main: HTMLElement): string[] {
  return [...main.querySelectorAll("li")]
    .filter((row) => row.className.includes("min-h-row"))
    .filter((row) => !row.className.includes("flex-wrap"))
    .map((row) => row.getAttribute("aria-label") ?? row.textContent?.slice(0, 48) ?? "");
}

/**
 * A machine source with something in every list, so the assertions run against populated views
 * rather than five empty states. The fixture's own per-repo queue is empty by design.
 */
function populated(): AppSource {
  const base = createSource("fixture");
  const jobs: Job[] = FIXTURE_JOBS_ALL.map((job) => ({ ...job }));
  const scoped = Object.assign(Object.create(base) as LedgerSource, {
    listJobs: () => Promise.resolve(jobs),
    listNotes: () => Promise.resolve(FIXTURE_NOTES),
    getSession: () => Promise.resolve(FIXTURE_SESSIONS[0]!),
  });
  return Object.assign(Object.create(base) as AppSource, {
    listAllJobs: () => Promise.resolve(FIXTURE_JOBS_ALL),
    forRepo: () => scoped,
  });
}

/** 375 px: both breakpoints match, so the nav is a sheet and the panel is a bottom sheet. */
function at375(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: [NAV_SHEET_QUERY, PANEL_SHEET_QUERY].includes(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const VIEWS: readonly { name: string; href: string; settled: string }[] = [
  { name: "Home", href: "#/", settled: "Projects" },
  { name: "Next", href: repoHref(FIRST.id, "next"), settled: "Proposed" },
  { name: "Needs you", href: repoHref(FIRST.id, "needs"), settled: "Open questions and blockers" },
  { name: "Jobs", href: repoHref(FIRST.id, "jobs"), settled: "Jobs, newest first" },
  { name: "Health", href: repoHref(FIRST.id, "health"), settled: "Harnesses" },
];

beforeEach(() => {
  window.location.hash = "";
  at375();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("no horizontal scroll at 375 px", () => {
  it.each(VIEWS)("$name keeps every long run inside something that breaks it", async (view) => {
    window.location.hash = view.href;
    render(<App source={populated()} />);
    await screen.findByRole("list", { name: view.settled });

    const main = screen.getByRole("main");
    expect(main.className).toContain("min-w-0");
    expect(rigidRows(main)).toEqual([]);
    expect(unbrokenRuns(main)).toEqual([]);
  });

  it.each(VIEWS)("$name still has a settled list to measure", async (view) => {
    window.location.hash = view.href;
    render(<App source={populated()} />);
    // Guards the assertion above against passing on an empty state: every view has rows here.
    const list = await screen.findByRole("list", { name: view.settled });
    await waitFor(() => expect(list.querySelectorAll("li").length).toBeGreaterThan(0));
  });
});
