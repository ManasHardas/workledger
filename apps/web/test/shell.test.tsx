import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { FIXTURE_BACKLOG, FIXTURE_NOTES, FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import { createSource } from "../src/lib/ledger-source.js";
import { ROUTE_IDS, routeFromHash } from "../src/lib/router.js";

/** Points the shell at a route the way an `#/…` link or a card's `openDeepLink` would. */
function renderAt(route: string) {
  window.location.hash = route;
  return render(<App source={createSource("fixture")} />);
}

beforeEach(() => {
  window.location.hash = "";
});

afterEach(cleanup);

describe("app shell", () => {
  it("renders a nav link for every route", () => {
    renderAt("#/ledger");
    const nav = screen.getAllByRole("navigation", { name: "Views" })[0]!;
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(labels).toEqual(ROUTE_IDS.map((id) => `#/${id}`));
  });

  it("falls back to the Ledger route for an empty or unknown hash", () => {
    expect(routeFromHash("")).toBe("ledger");
    expect(routeFromHash("#/nope")).toBe("ledger");
    expect(routeFromHash("#/needs-you")).toBe("needs-you");
  });

  it("marks the active route on its nav link", async () => {
    renderAt("#/health");
    await screen.findByRole("heading", { name: "Health", level: 2 });
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.every((link) => link.getAttribute("href") === "#/health")).toBe(true);
  });
});

describe("routes render fixture data", () => {
  it("Ledger opens on the open sessions and widens to all", async () => {
    renderAt("#/ledger");
    await screen.findByRole("heading", { name: "Ledger", level: 2 });

    const open = FIXTURE_SESSIONS.filter((s) => s.frontmatter.status === "open");
    const ended = FIXTURE_SESSIONS.filter((s) => s.frontmatter.status !== "open");
    expect(open.length).toBeGreaterThan(0);
    expect(ended.length).toBeGreaterThan(0);

    for (const session of open) {
      expect(await screen.findByText(session.goal!)).toBeDefined();
    }
    // The default scope is "Open", so an ended session is filtered out until the tab changes.
    expect(screen.queryByText(ended[0]!.goal!)).toBeNull();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "All" }));
    for (const session of FIXTURE_SESSIONS) {
      expect(await screen.findByText(session.goal!)).toBeDefined();
    }
  });

  it("Next lists the fixture backlog grouped by status", async () => {
    renderAt("#/next");
    await screen.findByRole("heading", { name: "Next", level: 2 });
    for (const item of FIXTURE_BACKLOG) {
      expect(await screen.findByText(item.frontmatter.title)).toBeDefined();
    }
    // The fixture source is read-only, so every write control is disabled rather than absent.
    const buttons = await screen.findAllByRole("button", { name: /Accept|Done/ });
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("Needs you lists the open questions and blockers", async () => {
    renderAt("#/needs-you");
    await screen.findByRole("heading", { name: "Needs you", level: 2 });
    for (const note of FIXTURE_NOTES) {
      expect(await screen.findByText(note.text)).toBeDefined();
    }
  });

  it("Health reports the repo and every harness", async () => {
    renderAt("#/health");
    expect(await screen.findByText("github.com/ManasHardas/workledger")).toBeDefined();
    expect(await screen.findByText("claude-code")).toBeDefined();
    expect(await screen.findByText("cursor")).toBeDefined();
    // The reading the page derives from the fixture's probe: `cursor` has no binary on PATH.
    expect(await screen.findByText("`cursor` is not on PATH")).toBeDefined();
  });

  it("shows a loading state before the first read resolves", () => {
    renderAt("#/ledger");
    expect(screen.getByRole("status")).toBeDefined();
  });
});
