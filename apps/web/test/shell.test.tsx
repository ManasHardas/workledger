import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { resetEmptyMachineRedirect } from "../src/features/onboarding/index.js";
import { detailUlidFromHash } from "../src/features/ledger/detail-route.js";
import { FIXTURE_BACKLOG, FIXTURE_NOTES, FIXTURE_REPOS, FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import { ASIDE_QUERY, NAV_SHEET_QUERY } from "../src/lib/media.js";
import { createSource, type AppSource, type Repo } from "../src/lib/ledger-source.js";
import { HOME_HREF, VIEW_IDS, legacyTarget, parseRoute, repoHref } from "../src/lib/router.js";

/** The nav's order (P9): the three views you read, then the machinery below the separator. */
const NAV_VIEWS = ["ledger", "session", "review", "jobs", "health"] as const;

const FIRST = FIXTURE_REPOS[0]!;
const SECOND = FIXTURE_REPOS[1]!;

/** Points the shell at a route the way an `#/…` link or a card's `openDeepLink` would. */
function renderAt(route: string, source: AppSource = createSource("fixture")) {
  window.location.hash = route;
  return render(<App source={source} />);
}

/** The fixture source with `listRepos` replaced — the empty machine, or a chosen list. */
function withRepos(repos: Repo[]): AppSource {
  const base = createSource("fixture");
  return Object.assign(Object.create(base) as AppSource, { listRepos: () => Promise.resolve(repos) });
}

/**
 * jsdom has no `matchMedia`, so the shell reads every breakpoint as "no match" — the desktop form.
 * A test that wants the narrow form says which queries match; `afterEach` puts it back.
 */
function matchAll(queries: string[]): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: queries.includes(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("router", () => {
  it("parses Home, the wizard, the machine-wide tabs and the repo routes", () => {
    expect(parseRoute("")).toEqual({ kind: "home" });
    expect(parseRoute("#/")).toEqual({ kind: "home" });
    expect(parseRoute("#/nope")).toEqual({ kind: "home" });
    expect(parseRoute("#/onboarding")).toEqual({ kind: "onboarding" });
    expect(parseRoute("#/review")).toEqual({ kind: "machine", view: "review" });
    expect(parseRoute("#/jobs")).toEqual({ kind: "machine", view: "jobs" });
    // Review absorbed Next and Needs you (P9); both old segments resolve to it.
    expect(parseRoute("#/needs")).toEqual({ kind: "machine", view: "review" });
    expect(parseRoute("#/r/abc/next")).toEqual({ kind: "repo", repo: "abc", view: "review", rest: [] });
    // A session is its own view now; the Ledger's old sub-route still reaches it.
    expect(parseRoute("#/r/abc/ledger/01ULID")).toEqual({ kind: "repo", repo: "abc", view: "session", rest: ["01ULID"] });
    // P2's spelling of the view still parses; the id is decoded.
    expect(parseRoute("#/r/a%2Fb/needs-you")).toEqual({ kind: "repo", repo: "a/b", view: "review", rest: [] });
    // A repo route missing its view or its id is nowhere in particular.
    expect(parseRoute("#/r/abc")).toEqual({ kind: "home" });
    expect(parseRoute("#/r//ledger")).toEqual({ kind: "home" });
  });

  it("reads the P2 routes as legacy and resolves them to a repo", () => {
    for (const view of VIEW_IDS) {
      // Review and Jobs are machine-wide tabs, not legacy repo routes.
      if (view === "review" || view === "jobs") continue;
      expect(parseRoute(`#/${view}`)).toEqual({ kind: "legacy", view, rest: [] });
    }
    // `#/needs-you` is the machine-wide Review now, not a legacy repo route.
    expect(parseRoute("#/needs-you")).toEqual({ kind: "machine", view: "review" });
    const detail = parseRoute("#/ledger/01ULID");
    expect(detail).toEqual({ kind: "legacy", view: "ledger", rest: ["01ULID"] });
    if (detail.kind !== "legacy") throw new Error("unreachable");
    // A legacy session link lands on the Session view, keeping its ulid.
    expect(legacyTarget(detail, "abc")).toBe("#/r/abc/session/01ULID");
  });

  it("builds hrefs and reads the session ulid back out of one", () => {
    expect(repoHref("abc", "health")).toBe("#/r/abc/health");
    expect(repoHref("a/b", "ledger", "01ULID")).toBe("#/r/a%2Fb/ledger/01ULID");
    expect(repoHref("abc", "session", "01ULID")).toBe("#/r/abc/session/01ULID");
    expect(detailUlidFromHash("#/r/abc/session/01ULID")).toBe("01ULID");
    // The old sub-route still resolves to the session it names.
    expect(detailUlidFromHash("#/r/abc/ledger/01ULID")).toBe("01ULID");
    // The Session view with no ulid means "the most recent one", not an error.
    expect(detailUlidFromHash("#/r/abc/session")).toBeNull();
    expect(detailUlidFromHash("#/r/abc/ledger")).toBeNull();
    expect(detailUlidFromHash("#/ledger/01ULID")).toBeNull();
  });
});

describe("legacy redirects", () => {
  it("sends #/ledger to the first repo's Ledger, keeping the session ulid", async () => {
    renderAt("#/ledger");
    await waitFor(() => expect(window.location.hash).toBe(repoHref(FIRST.id, "ledger")));
    cleanup();

    const ulid = FIXTURE_SESSIONS[0]!.frontmatter.id;
    renderAt(`#/ledger/${ulid}`);
    await waitFor(() => expect(window.location.hash).toBe(repoHref(FIRST.id, "session", ulid)));
    expect(await screen.findByRole("heading", { name: FIXTURE_SESSIONS[0]!.goal!, level: 1 })).toBeDefined();
  });

  it("sends #/health to the first repo, and #/needs-you and #/jobs stay machine-wide", async () => {
    // Needs you became the machine-wide Review, so it no longer redirects into a repo.
    renderAt("#/needs-you");
    await screen.findByRole("heading", { name: "Review", level: 1 });
    expect(window.location.hash).toBe("#/needs-you");
    cleanup();

    renderAt("#/health");
    await waitFor(() => expect(window.location.hash).toBe(repoHref(FIRST.id, "health")));
    cleanup();

    renderAt("#/jobs");
    await screen.findByRole("heading", { name: "Jobs", level: 1 });
    expect(window.location.hash).toBe("#/jobs");
  });

  it("sends a legacy route Home, and an empty Home on to the wizard, when no repo is enabled", async () => {
    resetEmptyMachineRedirect();
    renderAt("#/ledger", withRepos([]));
    await waitFor(() => expect(window.location.hash).toBe("#/onboarding"));
    expect(await screen.findByRole("heading", { name: "Choose the repos to track" })).toBeDefined();
  });

  it("does not leave the legacy route behind the back button", async () => {
    // The hash set by `renderAt` is itself an entry; the redirect must not add another.
    window.location.hash = "#/next";
    const before = window.history.length;
    renderAt("#/next");
    await waitFor(() => expect(window.location.hash).toBe(repoHref(FIRST.id, "review")));
    expect(window.history.length).toBe(before);
  });
});

describe("app shell", () => {
  it("renders Home and the machine-wide tabs in the nav on Home", async () => {
    renderAt("#/");
    // Every view draws its own page header now (P9): Home's title is the page's one h1.
    await screen.findByRole("heading", { name: "Home", level: 1 });
    const nav = screen.getAllByRole("navigation", { name: "Views" })[0]!;
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["#/", "#/review", "#/jobs"]);
    expect(within(nav).getByRole("link", { current: "page" }).getAttribute("href")).toBe("#/");
  });

  it("renders Home, the three views and the machinery below the separator, marking the active one", async () => {
    renderAt(repoHref(FIRST.id, "health"));
    await screen.findByRole("heading", { name: "Health", level: 1 });
    const nav = screen.getAllByRole("navigation", { name: "Views" })[0]!;
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([HOME_HREF, ...NAV_VIEWS.map((view) => repoHref(FIRST.id, view))]);
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.every((link) => link.getAttribute("href") === repoHref(FIRST.id, "health"))).toBe(true);
  });

  it("names the current repo in the switcher and switches to the same view of another", async () => {
    renderAt(repoHref(FIRST.id, "review"));
    // The switcher is a button opening a filterable list, not a `<select>`: the direction asks for
    // a filter and a native select has none (docs/design/direction.md §Shell).
    await waitFor(() => expect(screen.getByRole("button", { name: `Project: ${FIRST.name}` })).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: `Project: ${FIRST.name}` }));
    fireEvent.click(await screen.findByRole("button", { name: SECOND.name }));
    expect(window.location.hash).toBe(repoHref(SECOND.id, "review"));

    // The hash change is what renames the switcher, and jsdom delivers `hashchange` a tick later.
    fireEvent.click(await screen.findByRole("button", { name: `Project: ${SECOND.name}` }));
    fireEvent.click(await screen.findByRole("button", { name: "All projects" }));
    expect(window.location.hash).toBe("#/");
  });

  it("filters the switcher's list and leaves the rest of the nav alone", async () => {
    renderAt("#/");
    fireEvent.click(await screen.findByRole("button", { name: "Project: All projects" }));
    await screen.findByRole("button", { name: FIRST.name });
    expect(screen.getByRole("button", { name: SECOND.name })).toBeDefined();

    fireEvent.change(screen.getByRole("textbox", { name: "Filter projects" }), {
      target: { value: SECOND.name },
    });
    expect(screen.queryByRole("button", { name: FIRST.name })).toBeNull();
    expect(screen.getByRole("button", { name: SECOND.name })).toBeDefined();

    fireEvent.change(screen.getByRole("textbox", { name: "Filter projects" }), {
      target: { value: "no-such-project" },
    });
    expect(await screen.findByText("No project matches.")).toBeDefined();
  });

  it("switches from Home into a repo's Ledger, and shows an unlisted id as is", async () => {
    renderAt("#/");
    fireEvent.click(await screen.findByRole("button", { name: "Project: All projects" }));
    fireEvent.click(await screen.findByRole("button", { name: FIRST.name }));
    expect(window.location.hash).toBe(repoHref(FIRST.id, "ledger"));
    cleanup();

    renderAt(repoHref("unknown00000", "ledger"));
    expect(await screen.findByRole("button", { name: "Project: unknown00000" })).toBeDefined();
  });

  it("puts the per-view counts of the repo row beside the nav rows, in tabular numerals", async () => {
    renderAt(repoHref(FIRST.id, "ledger"));
    const nav = screen.getAllByRole("navigation", { name: "Views" })[0]!;
    await waitFor(() => {
      const ledger = within(nav).getByRole("link", { name: /^Ledger/ });
      expect(ledger.textContent).toContain(String(FIRST.sessions7d));
    });
    // Review holds both halves of what waits on a person, so its count is both.
    const review = within(nav).getByRole("link", { name: /^Review/ });
    expect(review.textContent).toContain(String(FIRST.openNotes + FIRST.openBacklog));
    // Health has no count on the repo row, and an invented one would be worse than none.
    expect(within(nav).getByRole("link", { name: "Health" }).textContent).toBe("Health");
    expect(
      within(nav).getByText(String(FIRST.openNotes + FIRST.openBacklog)).className,
    ).toContain("tabular-nums");
  });

  it("leaves the folders with sessions to Home: the shell lists none of its own", async () => {
    renderAt("#/");
    // Home's own group is there, so the fixture does have folders to list...
    await screen.findByRole("list", { name: "Folders with sessions" });
    // ...and the shell's copy of them, which the operator had removed (2026-09-11), is not.
    expect(screen.queryByRole("list", { name: "Folders" })).toBeNull();
  });

  it("puts the project switcher at the top of the nav, above the views", async () => {
    renderAt(repoHref(FIRST.id, "ledger"));
    const switcher = await screen.findByRole("button", { name: `Project: ${FIRST.name}` });
    const nav = screen.getAllByRole("navigation", { name: "Views" })[0]!;
    expect(switcher.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("collapses the nav into a sheet below 900 px and keeps every link in it", async () => {
    matchAll([NAV_SHEET_QUERY]);
    renderAt(repoHref(FIRST.id, "ledger"));
    // Swapped, not hidden: there is exactly one nav in the tree, and it is behind the hamburger.
    expect(screen.queryByRole("navigation", { name: "Views" })).toBeNull();
    const hamburger = await screen.findByRole("button", { name: "Open navigation" });

    fireEvent.click(hamburger);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([HOME_HREF, ...NAV_VIEWS.map((view) => repoHref(FIRST.id, view))]);
  });

  it("closes the nav sheet on a tap on any of the five views, and offers a visible way out", async () => {
    matchAll([NAV_SHEET_QUERY]);
    renderAt(repoHref(FIRST.id, "ledger"));
    fireEvent.click(await screen.findByRole("button", { name: "Open navigation" }));
    const nav = await screen.findByRole("navigation", { name: "Views" });

    // A modal sheet whose only exits are Escape and a strip of overlay is a trap, so it carries
    // its own control (#132 review).
    expect(screen.getByRole("button", { name: "Close navigation" })).toBeDefined();

    // Picking a view navigates *and* closes: the route effect watches the whole route, and each
    // link is a `SheetClose` besides.
    fireEvent.click(within(nav).getByRole("link", { name: /^Jobs/ }));
    await waitFor(() => expect(window.location.hash).toBe(repoHref(FIRST.id, "jobs")));
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Views" })).toBeNull());
    // Nothing is left `aria-hidden` behind a sheet that is gone.
    expect(document.querySelectorAll("[aria-hidden='true'][data-aria-hidden]").length).toBe(0);
  });

  it("offers Add projects from the project switcher, since the nav has no button for it", async () => {
    renderAt(repoHref(FIRST.id, "ledger"));
    const nav = screen.getAllByRole("navigation", { name: "Views" })[0]!;
    expect(within(nav).queryByRole("link", { name: "Add projects" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: `Project: ${FIRST.name}` }));
    expect((await screen.findByRole("link", { name: "Add projects" })).getAttribute("href")).toBe("#/onboarding");
  });

  it("draws the right column only from 1280 px, and no page header of its own", async () => {
    renderAt(repoHref(FIRST.id, "health"));
    await screen.findByRole("heading", { name: "Health", level: 1 });
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    // One header, the view's.
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    cleanup();

    matchAll([ASIDE_QUERY]);
    renderAt(repoHref(FIRST.id, "health"));
    await screen.findByRole("heading", { name: "Health", level: 1 });
    expect(screen.getByRole("complementary", { name: "Details" })).toBeDefined();
  });

  it("renders the onboarding wizard", async () => {
    renderAt("#/onboarding");
    expect(await screen.findByRole("heading", { name: "Choose the repos to track" })).toBeDefined();
  });
});

describe("routes render fixture data", () => {
  it("Ledger shows every session in one list, open ones first, with no scope tabs (amendment 11)", async () => {
    renderAt(repoHref(FIRST.id, "ledger"));
    await screen.findByRole("heading", { name: "Ledger", level: 1 });

    const open = FIXTURE_SESSIONS.filter((s) => s.frontmatter.status === "open");
    const ended = FIXTURE_SESSIONS.filter((s) => s.frontmatter.status !== "open");
    expect(open.length).toBeGreaterThan(0);
    expect(ended.length).toBeGreaterThan(0);

    // No tab hides anything any more: every session is on screen from the first render.
    for (const session of FIXTURE_SESSIONS) {
      expect(await screen.findByText(session.goal!)).toBeDefined();
    }
    expect(screen.queryAllByRole("tab")).toEqual([]);

    const cards = within(screen.getByRole("list", { name: /Sessions, open first/ })).getAllByRole("listitem");
    expect(cards[0]!.textContent).toContain(open[0]!.goal!);
  });

  it("Review lists the fixture backlog grouped by status", async () => {
    renderAt(repoHref(FIRST.id, "review"));
    await screen.findByRole("heading", { name: "Proposed by agents", level: 2 });
    for (const item of FIXTURE_BACKLOG) {
      expect(await screen.findByText(item.frontmatter.title)).toBeDefined();
    }
    // The fixture source is read-only, so every write control is disabled rather than absent.
    const buttons = await screen.findAllByRole("button", { name: /Accept|Done/ });
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("Review lists the open questions and blockers above the backlog", async () => {
    renderAt(repoHref(FIRST.id, "review"));
    await screen.findByRole("heading", { name: "Waiting on an answer", level: 2 });
    for (const note of FIXTURE_NOTES) {
      expect(await screen.findByText(note.text)).toBeDefined();
    }
  });

  it("Health reports the repo and every harness", async () => {
    renderAt(repoHref(FIRST.id, "health"));
    expect(await screen.findByText("github.com/ManasHardas/workledger")).toBeDefined();
    expect(await screen.findByText("claude-code")).toBeDefined();
    expect(await screen.findByText("cursor")).toBeDefined();
    // The reading the page derives from the fixture's probe: `cursor` has no binary on PATH. The
    // complaint itself is evidence, so the row counts it and the panel behind it says what it is.
    const row = await screen.findByRole("listitem", { name: "cursor" });
    expect(within(row).getByText("2 problems")).toBeDefined();
    fireEvent.click(within(row).getByRole("button", { name: "cursor" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("`cursor` is not on PATH")).toBeDefined();
  });

  it("shows a loading state before the first read resolves", () => {
    renderAt(repoHref(FIRST.id, "ledger"));
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });
});
