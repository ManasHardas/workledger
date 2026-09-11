import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NextView } from "../src/features/next/next-view.js";
import { SourceProvider } from "../src/lib/source-context.js";

import type {
  Actor,
  BacklogStatus,
  BacklogView,
  Identity,
  LedgerEvent,
  LedgerSource,
} from "../src/lib/ledger-source.js";

const AUTHOR: Actor = { name: "Manas Hardas", email: "manas.hardas@gmail.com" };

function item(
  id: string,
  title: string,
  status: BacklogStatus,
  rank: number,
  overrides: Partial<BacklogView["frontmatter"]> = {},
): BacklogView {
  return {
    frontmatter: {
      schema_version: 1,
      id,
      title,
      status,
      proposed_by: {
        harness: "claude-code",
        session: "01JBPX2M4H6E1TSA7VYJ0G8WQD",
        checkpoint: 2,
        author: AUTHOR,
      },
      rank,
      area: ["web"],
      blocked_by: [],
      created: "2026-09-08T12:04:00Z",
      updated: "2026-09-09T08:31:00Z",
      history: [],
      ...overrides,
    },
    body: `${title} — why it matters.`,
  };
}

const PROPOSED = item("WL-01JBQ50R6TT4YB8H2ZC3D9KQ7A", "Reconnect the EventSource", "proposed", 10);
const ACCEPTED = item("WL-01JBQ50R6TT4YB8H2ZC3D9KQ7B", "Ship the Next view", "accepted", 20, {
  confirmed_by: { ...AUTHOR, at: "2026-09-09T08:31:00Z" },
  owner: AUTHOR,
  priority: "p2",
});
const RUNNING = item("WL-01JBQ50R6TT4YB8H2ZC3D9KQ7C", "Generate the Tailwind preset", "in_progress", 30);
const DONE = item("WL-01JBQ50R6TT4YB8H2ZC3D9KQ7D", "Freeze the P2 contracts", "done", 40);
const DISCARDED = item("WL-01JBQ50R6TT4YB8H2ZC3D9KQ7E", "Ship the card target", "discarded", 50);

const ALL = [PROPOSED, ACCEPTED, RUNNING, DONE, DISCARDED];

type Call = [string, ...unknown[]];

/**
 * A `LedgerSource` that records what the view asked it to do.
 *
 * The acceptance criterion for this issue is "each interaction calls the matching `LedgerSource`
 * method", so the assertions are about the calls, not about a rendering the fixture happens to
 * produce — a view that renamed a write would still look right and be wrong.
 */
function spySource(over: Partial<LedgerSource> = {}) {
  const calls: Call[] = [];
  let items = ALL;
  let identities: Identity[] = [];
  // A set, not one slot: the view subscribes once for the backlog and once for the identities
  // map, and a single-handler stub would silently deliver events to whichever ran last.
  const handlers = new Set<(event: LedgerEvent) => void>();
  const record =
    <T,>(name: string, result: (...args: never[]) => T) =>
    (...args: unknown[]): Promise<T> => {
      calls.push([name, ...args]);
      return Promise.resolve(result(...(args as never[])));
    };
  const find = (id: string) => items.find((i) => i.frontmatter.id === id) ?? PROPOSED;

  const source: LedgerSource = {
    capabilities: { write: true, live: true, provenance: true },
    listSessions: async () => [],
    getSession: async () => {
      throw new Error("unused");
    },
    listBacklog: record("listBacklog", () => items),
    getBacklogItem: async (id: string) => find(id),
    listNotes: async () => [],
    brief: async () => "",
    health: async () => {
      throw new Error("unused");
    },
    listIdentities: record("listIdentities", () => identities),
    accept: record("accept", (id: string) => ({
      ...find(id),
      frontmatter: {
        ...find(id).frontmatter,
        status: "accepted" as BacklogStatus,
        confirmed_by: { ...AUTHOR, at: "2026-09-09T09:00:00Z" },
      },
    })),
    discard: record("discard", (id: string) => find(id)),
    done: record("done", (id: string) => find(id)),
    start: record("start", (id: string) => find(id)),
    restore: record("restore", (id: string) => find(id)),
    edit: record("edit", (id: string) => find(id)),
    assign: record("assign", (id: string) => find(id)),
    rank: record("rank", (id: string) => find(id)),
    merge: record("merge", (id: string, into: string) => ({
      source: find(id),
      target: find(into),
    })),
    resolveNote: async () => {
      throw new Error("unused");
    },
    // P3's job surface. `Next` never calls it, so every method says so rather than pretending.
    listJobs: async () => [],
    scan: async () => {
      throw new Error("unused");
    },
    repair: async () => {
      throw new Error("unused");
    },
    backfill: async () => {
      throw new Error("unused");
    },
    cancelJob: async () => {
      throw new Error("unused");
    },
    retryJob: async () => {
      throw new Error("unused");
    },
    jobLog: async () => {
      throw new Error("unused");
    },
    excerpt: async () => {
      throw new Error("unused");
    },
    subscribe: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    ...over,
  };

  return {
    source,
    calls,
    /** What the source will hand back on the next read, as a file change would. */
    setItems: (next: BacklogView[]) => {
      items = next;
    },
    /** `.workledger/identities.yaml` as the next `listIdentities` will report it. */
    setIdentities: (next: Identity[]) => {
      identities = next;
    },
    emit: (event: LedgerEvent) => {
      for (const handler of [...handlers]) handler(event);
    },
  };
}

async function renderNext(over: Partial<LedgerSource> = {}, identities: Identity[] = []) {
  const spy = spySource(over);
  spy.setIdentities(identities);
  render(
    <SourceProvider source={spy.source}>
      <NextView />
    </SourceProvider>,
  );
  await screen.findByText(PROPOSED.frontmatter.title);
  return spy;
}

const card = (title: string) => screen.getByRole("listitem", { name: title });
const press = (button: string, title: string) =>
  fireEvent.click(within(card(title)).getByRole("button", { name: button }));

/**
 * The right panel (#134): everything a row leaves out — the body, the provenance, the owner, the
 * merge target, the history — lives behind the row's title, which opens it.
 */
const openPanel = async (title: string) => {
  fireEvent.click(within(card(title)).getByRole("button", { name: title }));
  return screen.findByRole("dialog");
};
const pressIn = (panel: HTMLElement, button: string) =>
  fireEvent.click(within(panel).getByRole("button", { name: button }));

/** Discard is a two-step control now: a quiet button, then the one that confirms it. */
const discard = (title: string) => {
  press("Discard", title);
  press("Confirm discard", title);
};

afterEach(cleanup);

describe("grouping and provenance", () => {
  it("groups by status in spec order and collapses discarded", async () => {
    await renderNext();
    const labels = ["Proposed", "Accepted", "In progress", "Done", "Discarded"];
    // Card titles are level-3 headings too, so the group headings are the ones named for a status.
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent ?? "")
      .filter((text) => labels.includes(text));
    expect(headings).toEqual(labels);
    expect(screen.queryByRole("listitem", { name: DISCARDED.frontmatter.title })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show discarded" }));
    expect(card(DISCARDED.frontmatter.title)).toBeDefined();
  });

  it("orders a group by rank, then by most recently updated", async () => {
    const older = item("WL-01JBQ50R6TT4YB8H2ZC3D9KQ7F", "Older tie", "proposed", 10, {
      updated: "2026-09-01T00:00:00Z",
    });
    const later = item("WL-01JBQ50R6TT4YB8H2ZC3D9KQ7G", "Later tie", "proposed", 5);
    const spy = spySource();
    spy.setItems([PROPOSED, older, later]);
    render(
      <SourceProvider source={spy.source}>
        <NextView />
      </SourceProvider>,
    );
    await screen.findByText("Later tie");
    const titles = within(screen.getByRole("list", { name: "Proposed" }))
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("aria-label"));
    // rank 5 first; the two rank-10 items break the tie on `updated`, newest first.
    expect(titles).toEqual(["Later tie", PROPOSED.frontmatter.title, "Older tie"]);
  });

  it("shows the harness, session and checkpoint an item came from, in the panel", async () => {
    await renderNext();
    // Rule 3: provenance is evidence, so it is never on the row.
    expect(
      within(card(PROPOSED.frontmatter.title)).queryByText(/01JBPX2M4H6E1TSA7VYJ0G8WQD/),
    ).toBeNull();
    const panel = await openPanel(PROPOSED.frontmatter.title);
    expect(within(panel).getByText("claude-code")).toBeDefined();
    expect(
      within(panel).getByText(/session 01JBPX2M4H6E1TSA7VYJ0G8WQD · cp 2/),
    ).toBeDefined();
  });

  it("keeps each row on the list rhythm, with the accent bar only on the selected one", async () => {
    await renderNext();
    const row = card(PROPOSED.frontmatter.title);
    expect(row.className).toContain("min-h-row");
    expect(row.className).toContain("hover:bg-muted");
    expect(row.hasAttribute("data-selected")).toBe(false);

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() =>
      expect(card(PROPOSED.frontmatter.title).hasAttribute("data-selected")).toBe(true),
    );
    // Nothing hardcodes a colour: the bar is the primary token, the surface the selected one.
    const selected = card(PROPOSED.frontmatter.title);
    expect(selected.className).toContain("bg-selected");
    expect(selected.querySelector("span[aria-hidden='true']")!.className).toContain("bg-primary");
  });

  it("never scrolls sideways at 375 px: the title gives up its width, nothing else does", async () => {
    await renderNext();
    const row = card(PROPOSED.frontmatter.title);
    const title = within(row).getByRole("button", { name: PROPOSED.frontmatter.title });
    // `min-w-0 … truncate` is the whole of rule 5 on a row: every other child is `shrink-0`, so
    // the one element that can be long is the one that gets clipped.
    expect(title.className).toContain("min-w-0");
    expect(title.className).toContain("truncate");
    expect(row.className).toContain("flex-wrap");
  });
});

/**
 * docs/contracts/p5/config-and-identities.md, through issue #64: "any `Actor` or `HumanStamp`
 * whose `email` matches (case-insensitively) is displayed with the mapped `name` … Missing file:
 * emails display as before."
 *
 * Every assertion here comes in a pair — what the map does to the rendering, and what the *same*
 * card shows with no file at all — because the second half is the promise that this is a display
 * layer a repo which never wrote the file is unaffected by.
 */
describe("identities", () => {
  const MAPPED: Identity[] = [
    // Deliberately not the case the ledger records, so a pass proves the lookup is folded.
    { email: "Manas.Hardas@GMAIL.com", name: "Manas Hardas (mapped)", dome_user: null },
  ];
  const HISTORIC = item("WL-01JBQ50R6TT4YB8H2ZC3D9KQ7H", "Has a history", "accepted", 60, {
    owner: AUTHOR,
    confirmed_by: { ...AUTHOR, at: "2026-09-09T08:31:00Z" },
    history: [
      { at: "2026-09-09T08:00:00Z", by: AUTHOR, op: "status", diff: "proposed → accepted" },
      // An agent-originated change is a `{ session, checkpoint }` and has no email at all, so
      // there is nothing for the map to replace and nothing to hover.
      {
        at: "2026-09-09T08:30:00Z",
        by: { session: "01JBPX2M4H6E1TSA7VYJ0G8WQD", checkpoint: 3 },
        op: "edit",
      },
    ],
  });

  /**
   * Every element whose `title` is `email` inside one item's *panel* — the identities map names
   * actors, and every actor an item has (proposed_by, owner, confirmed_by, history) is evidence,
   * so it lives in the panel (#134, rule 3).
   */
  const tooltipped = async (title: string, email: string) => {
    const panel = await openPanel(title);
    return within(panel)
      .getAllByTitle(email)
      .map((node) => node.textContent);
  };

  it("renders the mapped name for owner, confirmed_by and proposed_by.author", async () => {
    await renderNext({}, MAPPED);
    const shown = await tooltipped(ACCEPTED.frontmatter.title, AUTHOR.email);
    // proposed_by.author, owner and confirmed_by — three actors, one name, one tooltip each.
    expect(shown).toEqual([
      "Manas Hardas (mapped)",
      "Manas Hardas (mapped)",
      "Manas Hardas (mapped)",
    ]);
  });

  it("renders the mapped name for a history entry's `by`, and leaves a SessionRef alone", async () => {
    const spy = spySource();
    spy.setIdentities(MAPPED);
    spy.setItems([HISTORIC]);
    render(
      <SourceProvider source={spy.source}>
        <NextView />
      </SourceProvider>,
    );
    await screen.findByText(HISTORIC.frontmatter.title);

    const panel = await openPanel(HISTORIC.frontmatter.title);
    const history = within(panel).getByRole("list", { name: "History" });
    const rows = within(history).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Manas Hardas (mapped)");
    expect(within(rows[0]!).getByTitle(AUTHOR.email)).toBeDefined();
    // The agent row names its session instead; there is no email on it to hover.
    expect(rows[1]!.textContent).toContain("session 01JBPX2M4H6E1TSA7VYJ0G8WQD");
    expect(within(rows[1]!).queryByTitle(AUTHOR.email)).toBeNull();
  });

  it("falls back to the email when the address is unmapped or the file is absent", async () => {
    // No file at all — the default `renderNext` identities.
    await renderNext();
    expect(await tooltipped(ACCEPTED.frontmatter.title, AUTHOR.email)).toEqual([
      AUTHOR.email,
      AUTHOR.email,
      AUTHOR.email,
    ]);
    // The ledger's own `name` is not the fallback: it is whatever git happened to be configured
    // with, which is the value the file exists to override.
    expect(within(screen.getByRole("dialog")).queryByText(AUTHOR.name)).toBeNull();
    cleanup();

    // A file that maps somebody else leaves this address exactly where the missing file did.
    await renderNext({}, [{ email: "grace@example.com", name: "Grace Hopper", dome_user: null }]);
    expect(await tooltipped(ACCEPTED.frontmatter.title, AUTHOR.email)).toEqual([
      AUTHOR.email,
      AUTHOR.email,
      AUTHOR.email,
    ]);
  });

  it("re-reads the file on health.changed, so an edit lands without a reload", async () => {
    const spy = await renderNext();
    expect((await tooltipped(ACCEPTED.frontmatter.title, AUTHOR.email))[0]).toBe(AUTHOR.email);

    spy.setIdentities(MAPPED);
    spy.emit({ type: "health.changed" });
    const panel = screen.getByRole("dialog");
    await waitFor(() =>
      expect(within(panel).getAllByTitle(AUTHOR.email)[0]!.textContent).toBe(
        "Manas Hardas (mapped)",
      ),
    );
  });
});

describe("the agent-proposed marker", () => {
  it("marks an unconfirmed item and drops the marker once confirmed_by lands", async () => {
    const spy = await renderNext();
    // At most three chips, and each one carries state (rule 2): the marker is one word now.
    expect(within(card(PROPOSED.frontmatter.title)).getByText("agent")).toBeDefined();
    // ACCEPTED carries a confirmed_by stamp in the fixture, so it never shows the marker.
    expect(within(card(ACCEPTED.frontmatter.title)).queryByText("agent")).toBeNull();

    press("Accept", PROPOSED.frontmatter.title);
    expect(spy.calls).toContainEqual(["accept", PROPOSED.frontmatter.id]);
    await waitFor(() =>
      expect(within(card(PROPOSED.frontmatter.title)).queryByText("agent")).toBeNull(),
    );
  });
});

describe("the status machine", () => {
  it("offers only the transitions the contract allows", async () => {
    await renderNext();
    fireEvent.click(screen.getByRole("button", { name: "Show discarded" }));
    const names = (title: string) =>
      within(card(title))
        .getAllByRole("button")
        .map((b) => b.textContent)
        .filter((name) => ["Accept", "Start", "Done", "Discard", "Restore"].includes(name ?? ""));

    expect(names(PROPOSED.frontmatter.title)).toEqual(["Accept", "Done", "Discard"]);
    expect(names(ACCEPTED.frontmatter.title)).toEqual(["Start", "Done", "Discard"]);
    expect(names(RUNNING.frontmatter.title)).toEqual(["Accept", "Done", "Discard"]);
    expect(names(DONE.frontmatter.title)).toEqual(["Restore"]);
    expect(names(DISCARDED.frontmatter.title)).toEqual(["Restore"]);
  });

  it.each([
    ["Accept", "accept", PROPOSED],
    ["Done", "done", PROPOSED],
    ["Start", "start", ACCEPTED],
  ] as const)("«%s» calls source.%s", async (label, method, target) => {
    const spy = await renderNext();
    press(label, target.frontmatter.title);
    expect(spy.calls).toContainEqual([method, target.frontmatter.id]);
  });

  /**
   * The reviewer's complaint on #128: a solid red Discard sitting in the list. The control is
   * quiet now, the destructive colour is on the confirming step only, and one click discards
   * nothing (docs/design/direction.md via #134).
   */
  it("«Discard» is a quiet two-step control, and one click discards nothing", async () => {
    const spy = await renderNext();
    const title = PROPOSED.frontmatter.title;

    const quiet = within(card(title)).getByRole("button", { name: "Discard" });
    expect(quiet.className).not.toContain("bg-destructive");
    expect(quiet.className).toContain("text-muted-foreground");

    press("Discard", title);
    expect(spy.calls.some(([name]) => name === "discard")).toBe(false);
    const confirm = within(card(title)).getByRole("button", { name: "Confirm discard" });
    // The one place the destructive colour is allowed outside a status chip — as an outline.
    expect(confirm.className).toContain("text-destructive");
    expect(confirm.className).toContain("border-destructive");

    fireEvent.click(confirm);
    expect(spy.calls).toContainEqual(["discard", PROPOSED.frontmatter.id]);
  });

  it("«Keep» disarms the confirming step without discarding", async () => {
    const spy = await renderNext();
    const title = PROPOSED.frontmatter.title;
    press("Discard", title);
    press("Keep", title);
    expect(spy.calls.some(([name]) => name === "discard")).toBe(false);
    expect(within(card(title)).getByRole("button", { name: "Discard" })).toBeDefined();
  });

  it("«Restore» calls source.restore for a done and for a discarded item", async () => {
    const spy = await renderNext();
    fireEvent.click(screen.getByRole("button", { name: "Show discarded" }));
    press("Restore", DONE.frontmatter.title);
    press("Restore", DISCARDED.frontmatter.title);
    expect(spy.calls).toContainEqual(["restore", DONE.frontmatter.id]);
    expect(spy.calls).toContainEqual(["restore", DISCARDED.frontmatter.id]);
  });
});

describe("editing", () => {
  it("renames in place, on the row, and sends only the title", async () => {
    const spy = await renderNext();
    const title = PROPOSED.frontmatter.title;
    press("Edit", title);
    fireEvent.change(within(card(title)).getByLabelText("Title"), {
      target: { value: "Reconnect the stream" },
    });
    press("Save", title);
    expect(spy.calls).toContainEqual([
      "edit",
      PROPOSED.frontmatter.id,
      { title: "Reconnect the stream" },
    ]);
  });

  it("edits the body through the panel's textarea", async () => {
    const spy = await renderNext();
    const panel = await openPanel(PROPOSED.frontmatter.title);
    fireEvent.change(within(panel).getByLabelText("Body"), {
      target: { value: "A dropped stream freezes the view." },
    });
    pressIn(panel, "Save body");
    expect(spy.calls).toContainEqual([
      "edit",
      PROPOSED.frontmatter.id,
      { body: "A dropped stream freezes the view." },
    ]);
  });

  it("sets and clears the priority through the panel", async () => {
    const spy = await renderNext();
    const first = await openPanel(PROPOSED.frontmatter.title);
    fireEvent.change(within(first).getByLabelText("Priority"), { target: { value: "p1" } });
    expect(spy.calls).toContainEqual(["edit", PROPOSED.frontmatter.id, { priority: "p1" }]);

    // A second row replaces the panel's contents rather than opening a second panel.
    const second = await openPanel(ACCEPTED.frontmatter.title);
    fireEvent.change(within(second).getByLabelText("Priority"), { target: { value: "none" } });
    expect(spy.calls).toContainEqual(["edit", ACCEPTED.frontmatter.id, { priority: null }]);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("assign, rank and merge", () => {
  it("assigns an owner by name and email, and unassigns with null", async () => {
    const spy = await renderNext();
    const panel = await openPanel(PROPOSED.frontmatter.title);
    fireEvent.change(within(panel).getByLabelText("Owner name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(within(panel).getByLabelText("Owner email"), {
      target: { value: "ada@example.com" },
    });
    pressIn(panel, "Assign");
    expect(spy.calls).toContainEqual([
      "assign",
      PROPOSED.frontmatter.id,
      { name: "Ada Lovelace", email: "ada@example.com" },
    ]);

    pressIn(await openPanel(ACCEPTED.frontmatter.title), "Unassign");
    expect(spy.calls).toContainEqual(["assign", ACCEPTED.frontmatter.id, null]);
  });

  /** Four proposed items, ranked 0..3, so a drag has somewhere to go in both directions. */
  async function renderQueue() {
    const queue = ["Alpha", "Bravo", "Charlie", "Delta"].map((title, i) =>
      item(`WL-01JBQ50R6TT4YB8H2ZC3D9KQ${i}Z`, title, "proposed", i * 10),
    );
    const spy = spySource();
    spy.setItems(queue);
    render(
      <SourceProvider source={spy.source}>
        <NextView />
      </SourceProvider>,
    );
    await screen.findByText("Delta");
    return { spy, queue };
  }

  const drag = (from: string, onto: string) => {
    fireEvent.dragStart(card(from));
    fireEvent.drop(card(onto));
  };

  const rankCalls = (calls: Call[]) => calls.filter(([name]) => name === "rank");
  const id = (queue: BacklogView[], title: string) =>
    queue.find((i) => i.frontmatter.title === title)!.frontmatter.id;

  it("re-ranks the whole group on a downward drag, index by index", async () => {
    const { spy, queue } = await renderQueue();
    // Alpha lands in Charlie's slot: Bravo, Charlie, Alpha, Delta.
    drag("Alpha", "Charlie");
    expect(rankCalls(spy.calls)).toEqual([
      ["rank", id(queue, "Bravo"), 0],
      ["rank", id(queue, "Charlie"), 1],
      ["rank", id(queue, "Alpha"), 2],
    ]);
  });

  it("re-ranks the whole group on an upward drag, index by index", async () => {
    const { spy, queue } = await renderQueue();
    // Delta lands directly above Bravo: Alpha, Delta, Bravo, Charlie.
    drag("Delta", "Bravo");
    expect(rankCalls(spy.calls)).toEqual([
      ["rank", id(queue, "Delta"), 1],
      ["rank", id(queue, "Bravo"), 2],
      ["rank", id(queue, "Charlie"), 3],
    ]);
  });

  it("merges an item into another one", async () => {
    const spy = await renderNext();
    const panel = await openPanel(PROPOSED.frontmatter.title);
    fireEvent.change(within(panel).getByLabelText("Merge into"), {
      target: { value: ACCEPTED.frontmatter.id },
    });
    pressIn(panel, "Merge");
    expect(spy.calls).toContainEqual([
      "merge",
      PROPOSED.frontmatter.id,
      ACCEPTED.frontmatter.id,
    ]);
  });
});

describe("keyboard", () => {
  it("moves the selection with j and k", async () => {
    await renderNext();
    fireEvent.keyDown(window, { key: "j" });
    expect(card(PROPOSED.frontmatter.title).hasAttribute("data-selected")).toBe(true);
    fireEvent.keyDown(window, { key: "j" });
    expect(card(ACCEPTED.frontmatter.title).hasAttribute("data-selected")).toBe(true);
    expect(card(PROPOSED.frontmatter.title).hasAttribute("data-selected")).toBe(false);
    fireEvent.keyDown(window, { key: "k" });
    expect(card(PROPOSED.frontmatter.title).hasAttribute("data-selected")).toBe(true);
  });

  it("opens the editor on e", async () => {
    await renderNext();
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "e" });
    expect(within(card(PROPOSED.frontmatter.title)).getByLabelText("Title")).toBeDefined();
  });

  it.each([
    ["a", "accept"],
    ["d", "done"],
    ["x", "discard"],
  ] as const)("«%s» calls source.%s on the selected item", async (key, method) => {
    const spy = await renderNext();
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key });
    expect(spy.calls).toContainEqual([method, PROPOSED.frontmatter.id]);
  });

  it("leaves a keystroke inside a field alone", async () => {
    const spy = await renderNext();
    const title = PROPOSED.frontmatter.title;
    press("Edit", title);
    const field = within(card(title)).getByLabelText("Title");
    fireEvent.keyDown(field, { key: "d" });
    expect(spy.calls.some(([name]) => name === "done")).toBe(false);
  });
});

describe("optimistic writes", () => {
  it("paints the new status before the call resolves and reconciles on backlog.changed", async () => {
    // A held-open `done`, so the optimistic paint can be observed before the call resolves. The
    // resolver lives on an object because a `let` assigned only inside the executor narrows to
    // `never` at the call site.
    const gate: { release?: (view: BacklogView) => void } = {};
    const spy = spySource({
      done: () => new Promise<BacklogView>((resolve) => {
        gate.release = resolve;
      }),
    });
    render(
      <SourceProvider source={spy.source}>
        <NextView />
      </SourceProvider>,
    );
    await screen.findByText(PROPOSED.frontmatter.title);
    press("Done", PROPOSED.frontmatter.title);
    // The item has already moved into the Done group while the write is still in flight.
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Done" })).getByRole("listitem", {
          name: PROPOSED.frontmatter.title,
        }),
      ).toBeDefined(),
    );
    gate.release?.({
      ...PROPOSED,
      frontmatter: { ...PROPOSED.frontmatter, status: "done" },
    });

    const reads = () => spy.calls.filter(([name]) => name === "listBacklog").length;
    const before = reads();
    spy.emit({ type: "backlog.changed", id: PROPOSED.frontmatter.id });
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it("rolls back and reports inline when a write is rejected", async () => {
    const spy = spySource({ discard: () => Promise.reject({ code: "read-only" }) });
    render(
      <SourceProvider source={spy.source}>
        <NextView />
      </SourceProvider>,
    );
    await screen.findByText(PROPOSED.frontmatter.title);
    discard(PROPOSED.frontmatter.title);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("read-only");
    // Rolled back: the item is in Proposed again, not in the discarded group.
    expect(
      within(screen.getByRole("list", { name: "Proposed" })).getByRole("listitem", {
        name: PROPOSED.frontmatter.title,
      }),
    ).toBeDefined();
  });
});

describe("a read-only source", () => {
  it("disables every write control and says so", async () => {
    const spy = spySource({ capabilities: { write: false, live: false, provenance: false } });
    render(
      <SourceProvider source={spy.source}>
        <NextView />
      </SourceProvider>,
    );
    await screen.findByText(PROPOSED.frontmatter.title);
    expect(screen.getByText("read-only source")).toBeDefined();
    // The title still opens the panel — reading is not a write — but every control that changes
    // the ledger is disabled rather than hidden, so the reason it cannot be used stays visible.
    const buttons = within(card(PROPOSED.frontmatter.title))
      .getAllByRole("button")
      .filter((button) => button.textContent !== PROPOSED.frontmatter.title);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);

    const panel = await openPanel(PROPOSED.frontmatter.title);
    const writes = within(panel)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-label") !== "Close panel");
    expect(writes.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
