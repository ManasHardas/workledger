import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { TRANSCRIPT_NOTICE } from "../src/features/ledger/provenance-panel.js";
import { FIXTURE_REPOS, FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import { ASIDE_QUERY } from "../src/lib/media.js";
import { createSource, type AppSource, type Line, type ParsedSession } from "../src/lib/ledger-source.js";

/**
 * The Session frame (`plans/feature-p9-figma-screens.md` §Session, Figma `2:2`), rendered through
 * the whole shell so the right column exists when the viewport says it does.
 */

const REPO = FIXTURE_REPOS[0]!;
const ENDED = FIXTURE_SESSIONS.find((s) => s.frontmatter.status === "ended")!;

const outcome = (cp: number, text: string, extra: Partial<Line> = {}): Line => ({ cp, text, ...extra });

/**
 * The ended fixture session widened to what the frame shows: six recap points (one holding three
 * outcomes), a checkpoint stamped after `ended`, a long backlog ref.
 */
const WIDE: ParsedSession = {
  ...ENDED,
  frontmatter: {
    ...ENDED.frontmatter,
    started: "2026-09-11T06:49:00Z",
    ended: "2026-09-11T08:23:00Z",
    status: "crashed",
    checkpoints: [
      { n: 1, at: "2026-09-11T07:11:00Z", turns: 1, transcript_offset: 4_142_636, trigger: "bytes" },
      { n: 2, at: "2026-09-11T07:16:00Z", turns: 3, transcript_offset: 4_280_661, trigger: "manual" },
      { n: 3, at: "2026-09-11T09:20:00Z", turns: 6, transcript_offset: 4_873_980, trigger: "minutes" },
    ],
  },
  done: [
    outcome(3, "Investigated the review design", {}),
    outcome(2, "Rebuilt the app and shipped it", {
      commit: "e2d4c27",
      verified: "tests-passed",
      detail: "PanelSlot portal target in panel.tsx",
      files: ["apps/web/src/components/ui/panel.tsx"],
    }),
    outcome(2, "Docked the evidence panel", { commit: "e2d4c27" }),
    outcome(1, "Replaced tokens throughout", { commit: "e2d4c27" }),
    outcome(1, "Reversed the copy", { commit: "eb45e80", verified: "tests-failed" }),
    outcome(1, "Built the design system", { commit: "aaaa111" }),
    outcome(1, "Moved the switcher", { commit: "bbbb222" }),
    outcome(1, "Bundled Roboto Mono", { commit: "cccc333" }),
  ],
  remaining: [
    { cp: 3, ref: "WL-01M29EKZ3TCQZKHP28GHVX9QG7", rel: "new", text: "Bundle Inter and point the sans stack at it", why: "" },
    { cp: 3, ref: "WL-short", rel: "new", text: "Draw the icon set", why: "" },
  ],
};

function wideSource(): AppSource {
  const base = createSource("fixture");
  return Object.assign(Object.create(base) as AppSource, {
    async getSession(ulid: string) {
      return ulid === WIDE.frontmatter.id ? WIDE : base.getSession(ulid);
    },
  });
}

function renderSession(ulid: string = WIDE.frontmatter.id, source: AppSource = wideSource()) {
  window.location.hash = `#/r/${REPO.id}/session/${ulid}`;
  return render(<App source={source} />);
}

/** Stubs `matchMedia` so exactly these queries match (jsdom has none). */
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

describe("Session — header and goal", () => {
  it("leads back to the Ledger and names the repo, with the goal as the page heading", async () => {
    renderSession();
    const heading = await screen.findByRole("heading", { level: 1, name: WIDE.goal! });
    expect(heading).toBeDefined();

    const back = screen.getByRole("link", { name: "← Ledger" });
    expect(back.getAttribute("href")).toBe(`#/r/${REPO.id}/ledger`);
    // No `repoPath` from the fixture, so the name is the last segment of `host/path`.
    expect(back.parentElement?.textContent).toContain("workledger");
  });

  it("prints status, harness and the meta line, counting checkpoints recorded after the end", async () => {
    renderSession();
    await screen.findByRole("heading", { level: 1, name: WIDE.goal! });
    expect(screen.getByText("crashed")).toBeDefined();
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(
      screen.getByText("Manas Hardas · 11 Sep 06:49 – 08:23 UTC · 1 h 34 m · 3 checkpoints, 1 recorded after it ended"),
    ).toBeDefined();
  });

  it("keeps where the session ran below the fold, not in the meta line", async () => {
    renderSession(ENDED.frontmatter.id, createSource("fixture"));
    await screen.findByRole("heading", { level: 1, name: ENDED.goal! });
    const where = screen.getByRole("heading", { level: 2, name: "Where it ran" }).closest("section")!;
    expect(where.textContent).toContain(`started in ${ENDED.startedIn}`);
    expect(where.textContent).toContain("about workledger, card-shopify_store");
  });
});

describe("Session — What happened", () => {
  it("shows four points with no summary line, then Show all that reveals every outcome", async () => {
    renderSession();
    const section = (await screen.findByRole("heading", { level: 2, name: "What happened" })).closest("section")!;
    expect(within(section).getByText("8 outcomes, grouped by evidence")).toBeDefined();

    const cards = () => within(section).getAllByRole("listitem").filter((li) => li.className.includes("rounded-lg"));
    expect(cards()).toHaveLength(4);
    // The commit point: headline gist, then the mono evidence line and nothing between them.
    const first = cards()[1]!;
    const text = first.querySelector("div")!;
    expect(Array.from(text.children).map((child) => child.textContent)).toEqual([
      "Rebuilt the app and shipped it",
      "cp 1–2 · e2d4c27 · 3 outcomes",
    ]);
    expect(within(section).queryByText("Docked the evidence panel")).toBeNull();

    const more = within(section).getByRole("button", { name: "Show all 8 outcomes" });
    fireEvent.click(more);
    expect(cards()).toHaveLength(6);
    expect(within(section).getByRole("button", { name: "Docked the evidence panel" })).toBeDefined();
    expect(within(section).getByRole("button", { name: "Replaced tokens throughout" })).toBeDefined();

    fireEvent.click(within(section).getByRole("button", { name: "Show fewer" }));
    expect(cards()).toHaveLength(4);
  });

  it("offers no Show all when every outcome is already on screen", async () => {
    renderSession(ENDED.frontmatter.id, createSource("fixture"));
    const section = (await screen.findByRole("heading", { level: 2, name: "What happened" })).closest("section")!;
    expect(within(section).queryByRole("button", { name: /Show all/ })).toBeNull();
    expect(within(section).getByText("cp 1 · 4e77b03 · 1 outcome")).toBeDefined();
  });
});

describe("Session — Left open", () => {
  it("shows each item with its ref cut as the frame cuts it (WL-01M29EKZ…), the full ref in the title", async () => {
    renderSession();
    const section = (await screen.findByRole("heading", { level: 2, name: "Left open" })).closest("section")!;
    const long = within(section).getByText("WL-01M29EKZ…");
    expect(long.getAttribute("title")).toBe("WL-01M29EKZ3TCQZKHP28GHVX9QG7");
    expect(within(section).getByText("Bundle Inter and point the sans stack at it")).toBeDefined();
    expect(within(section).getByText("WL-short")).toBeDefined();
  });
});

describe("Session — Provenance", () => {
  it("docks in the right column from 1280 px with one row per checkpoint", async () => {
    matchAll([ASIDE_QUERY]);
    renderSession();
    const column = await screen.findByRole("complementary", { name: "Details" });
    const module = await within(column).findByRole("region", { name: "Provenance" });
    expect(within(module).getByText("Exactly what was done, and where it is recorded.")).toBeDefined();

    const rows = within(within(module).getByRole("list", { name: "Checkpoints, oldest first" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      "[cp 1]11 Sep 07:11 UTCe2d4c271 turn · bytes · transcript 0 – 4,142,636 B",
      "[cp 2]11 Sep 07:16 UTCe2d4c273 turns · manual · transcript 4,142,636 – 4,280,661 B",
      "[cp 3]11 Sep 09:20 UTC—6 turns · minutes · transcript 4,280,661 – 4,873,980 B",
    ]);
    expect(within(module).getByText(TRANSCRIPT_NOTICE)).toBeDefined();
  });

  it("renders inline in the reading column below 1280 px", async () => {
    renderSession();
    const module = await screen.findByRole("region", { name: "Provenance" });
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
    expect(screen.getByRole("main").contains(module)).toBe(true);
  });

  it("shows the opened outcome in the module when docked, not in a panel", async () => {
    matchAll([ASIDE_QUERY]);
    renderSession();
    await screen.findByRole("complementary", { name: "Details" });
    const gist = await screen.findByRole("button", { name: "Rebuilt the app and shipped it" });
    expect(gist.getAttribute("aria-haspopup")).toBeNull();
    fireEvent.click(gist);

    const selected = await screen.findByRole("region", { name: "Rebuilt the app and shipped it" });
    expect(within(selected).getByText("Selected outcome")).toBeDefined();
    expect(within(selected).getByText("PanelSlot portal target in panel.tsx")).toBeDefined();
    expect(within(selected).getByText("apps/web/src/components/ui/panel.tsx")).toBeDefined();
    expect(within(selected).getByText("e2d4c27")).toBeDefined();
    expect(within(selected).getByText("tests-passed")).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the outcome in the floating panel when not docked", async () => {
    renderSession();
    const gist = await screen.findByRole("button", { name: "Rebuilt the app and shipped it" });
    expect(gist.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(gist);

    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("PanelSlot portal target in panel.tsx")).toBeDefined();
    expect(within(panel).getByText("tests-passed")).toBeDefined();
    expect(screen.queryByText("Selected outcome")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
