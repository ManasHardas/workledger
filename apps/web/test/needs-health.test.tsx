import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import {
  createSource,
  type Health,
  type LedgerSource,
  type NoteRef,
  type ParsedSession,
} from "../src/lib/ledger-source.js";

const fixture = createSource("fixture");

/**
 * A writable, live `LedgerSource` built by delegating every read to the fixture source and letting
 * a test replace only the calls it cares about. The fixture source itself is read-only by design,
 * so it cannot exercise `resolveNote` — but nothing in a view may assume otherwise, which is why
 * both capability shapes are rendered here.
 */
function stubSource(overrides: Partial<LedgerSource> = {}): LedgerSource {
  return {
    capabilities: { write: true, live: true, provenance: false },
    listSessions: (q) => fixture.listSessions(q),
    getSession: (ulid) => fixture.getSession(ulid),
    listBacklog: (q) => fixture.listBacklog(q),
    getBacklogItem: (id) => fixture.getBacklogItem(id),
    listNotes: (q) => fixture.listNotes(q),
    brief: (maxTokens) => fixture.brief(maxTokens),
    health: () => fixture.health(),
    accept: (id) => fixture.accept(id),
    discard: (id) => fixture.discard(id),
    done: (id) => fixture.done(id),
    edit: (id, patch) => fixture.edit(id, patch),
    assign: (id, owner) => fixture.assign(id, owner),
    rank: (id, rank) => fixture.rank(id, rank),
    merge: (id, into) => fixture.merge(id, into),
    resolveNote: (ref, decision) => fixture.resolveNote(ref, decision),
    subscribe: () => () => {},
    ...overrides,
  };
}

function renderAt(route: string, source: LedgerSource) {
  window.location.hash = route;
  return render(<App source={source} />);
}

/**
 * One session whose checkpoint 1 holds two notes, so the `index` the resolve ref carries is 1 and
 * not the 0 that a list position would accidentally produce. `index` is the note's place among the
 * notes of *its checkpoint* (`docs/contracts/p2/backlog-cli.md`), which is exactly what a `NoteRef`
 * from `/api/notes` does not tell the UI.
 */
const BLOCKER = "The watcher drops events when a file is renamed";
const SESSION: ParsedSession = {
  ...FIXTURE_SESSIONS[0]!,
  notes: [
    { cp: 1, raw: "", type: "decision", by: "human", text: "Debounce at 100 ms and move on" },
    { cp: 1, raw: "", type: "blocker", by: "agent", text: BLOCKER },
  ],
};
const NOTES: NoteRef[] = [
  { session: SESSION.frontmatter.id, cp: 1, raw: "", type: "blocker", by: "agent", text: BLOCKER },
];

beforeEach(() => {
  window.location.hash = "";
});

afterEach(cleanup);

describe("Needs you", () => {
  it("renders every open note with its session goal and checkpoint", async () => {
    renderAt("#/needs-you", stubSource({ listNotes: async () => NOTES, listSessions: async () => [SESSION] }));

    expect(await screen.findByText(BLOCKER)).toBeDefined();
    expect(screen.getByText(SESSION.goal[0]!.text)).toBeDefined();
    expect(screen.getByText("[cp 1]")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
  });

  it("resolves a note with the checkpoint-local index and the decision text", async () => {
    const calls: { ref: { session: string; cp: number; index: number }; decision: string }[] = [];
    const source = stubSource({
      listNotes: async () => NOTES,
      listSessions: async () => [SESSION],
      resolveNote: async (ref, decision) => {
        calls.push({ ref, decision });
        return SESSION;
      },
    });
    renderAt("#/needs-you", source);

    fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    fireEvent.change(screen.getByLabelText("Your decision"), {
      target: { value: "Treat a rename as a delete plus a create." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      ref: { session: SESSION.frontmatter.id, cp: 1, index: 1 },
      decision: "Treat a rename as a delete plus a create.",
    });
  });

  it("disables resolving on a read-only source", async () => {
    renderAt("#/needs-you", createSource("fixture"));

    const resolve = await screen.findAllByRole("button", { name: "Resolve" });
    expect(resolve.length).toBeGreaterThan(0);
    expect(resolve.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("Health", () => {
  const HEALTH: Health = {
    cli: "0.0.1",
    repo: "github.com/ManasHardas/workledger",
    harnesses: [
      { harness: "claude-code", hooksInstalled: true, lastSeenAt: "2026-09-09T08:02:00Z", problems: [] },
      { harness: "cursor", hooksInstalled: false, lastSeenAt: null, problems: [] },
      { harness: "codex", hooksInstalled: true, lastSeenAt: "2026-09-08T10:00:00Z", problems: ["hook script exits 1"] },
    ],
    index: { path: "~/.workledger/index.sqlite", bytes: 262_144, openSessions: 1 },
    config: { valid: false, problems: ["repos[0].path is not a directory"] },
    lastHookAt: null,
  };

  const statusOf = async (row: string) =>
    within(await screen.findByRole("listitem", { name: row })).getByText(/^(ok|warn|broken)$/);

  it("badges each row with its reading", async () => {
    renderAt("#/health", stubSource({ health: async () => HEALTH }));

    expect((await statusOf("claude-code")).textContent).toBe("ok");
    expect((await statusOf("cursor")).textContent).toBe("warn");
    expect((await statusOf("codex")).textContent).toBe("broken");
    expect((await statusOf("Index")).textContent).toBe("ok");
    expect((await statusOf("Config")).textContent).toBe("broken");
    expect((await statusOf("Last hook")).textContent).toBe("warn");
  });

  it("shows the doctor detail: problems, open sessions and the last hook", async () => {
    renderAt("#/health", stubSource({ health: async () => HEALTH }));

    expect(await screen.findByText("hook script exits 1")).toBeDefined();
    expect(screen.getByText("repos[0].path is not a directory")).toBeDefined();
    expect(screen.getByText(/1 open session/)).toBeDefined();
    expect(screen.getByText("no hook has fired yet")).toBeDefined();
    expect(screen.getByText("workledger 0.0.1")).toBeDefined();
  });
});

describe("keyboard help", () => {
  it("toggles the shortcut overlay on ?", async () => {
    renderAt("#/ledger", stubSource());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "?" });
    const overlay = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    for (const keys of ["j / k", "e", "a", "d", "x", "/", "?"]) {
      expect(within(overlay).getByText(keys)).toBeDefined();
    }

    fireEvent.keyDown(window, { key: "?" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks the current view to focus its search box on /", () => {
    renderAt("#/ledger", stubSource());
    let asked = 0;
    const listener = () => (asked += 1);
    window.addEventListener("focus-search", listener);

    fireEvent.keyDown(window, { key: "/" });
    window.removeEventListener("focus-search", listener);

    expect(asked).toBe(1);
  });
});
