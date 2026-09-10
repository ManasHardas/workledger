import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import {
  createSource,
  type AppSource,
  type Health,
  type Identity,
  type LedgerEvent,
  type LedgerSource,
  type NoteRef,
  type ParsedSession,
} from "../src/lib/ledger-source.js";

const fixture = createSource("fixture");

/** The first fixture repo: every per-repo route in this file is `#/r/<id>/…` under it. */
const REPO = "0123456789ab";

/**
 * A writable, live `LedgerSource` built by delegating every read to the fixture source and letting
 * a test replace only the calls it cares about. The fixture source itself is read-only by design,
 * so it cannot exercise `resolveNote` — but nothing in a view may assume otherwise, which is why
 * both capability shapes are rendered here.
 */
function stubSource(overrides: Partial<LedgerSource> = {}): AppSource {
  const source: AppSource = {
    capabilities: { write: true, live: true, provenance: false },
    // The machine half (P8): the fixture's repos, and this very stub as every repo's source.
    listRepos: () => fixture.listRepos(),
    listAllNotes: (q) => fixture.listAllNotes(q),
    listAllJobs: () => fixture.listAllJobs(),
    forRepo: () => source,
    // The wizard half (P8, #79): the fixture's canned answers; nothing in this file reaches them.
    discover: (roots) => fixture.discover(roots),
    history: (repos) => fixture.history(repos),
    initRepos: (input) => fixture.initRepos(input),
    plan: (input) => fixture.plan(input),
    run: (input) => fixture.run(input),
    status: () => fixture.status(),
    listSessions: (q) => fixture.listSessions(q),
    getSession: (ulid) => fixture.getSession(ulid),
    listBacklog: (q) => fixture.listBacklog(q),
    getBacklogItem: (id) => fixture.getBacklogItem(id),
    listNotes: (q) => fixture.listNotes(q),
    brief: (maxTokens) => fixture.brief(maxTokens),
    health: () => fixture.health(),
    listIdentities: () => fixture.listIdentities(),
    accept: (id) => fixture.accept(id),
    discard: (id) => fixture.discard(id),
    done: (id) => fixture.done(id),
    start: (id) => fixture.start(id),
    restore: (id) => fixture.restore(id),
    edit: (id, patch) => fixture.edit(id, patch),
    assign: (id, owner) => fixture.assign(id, owner),
    rank: (id, rank) => fixture.rank(id, rank),
    merge: (id, into) => fixture.merge(id, into),
    resolveNote: (ref, decision) => fixture.resolveNote(ref, decision),
    // P3's job surface, delegated like the rest; no view under test reaches for it yet.
    listJobs: (status) => fixture.listJobs(status),
    scan: () => fixture.scan(),
    repair: (input) => fixture.repair(input),
    backfill: (input) => fixture.backfill(input),
    cancelJob: (id) => fixture.cancelJob(id),
    retryJob: (id) => fixture.retryJob(id),
    jobLog: (id) => fixture.jobLog(id),
    excerpt: (ulid, cp) => fixture.excerpt(ulid, cp),
    subscribe: () => () => {},
    ...overrides,
  };
  return source;
}

function renderAt(route: string, source: AppSource) {
  window.location.hash = route;
  return render(<App source={source} />);
}

/**
 * One open blocker that is the *second* note of its checkpoint, so the `index` the resolve ref
 * carries is 1 — a number no position in this one-element list could have produced. It is the
 * `NoteRef` that supplies it (`docs/contracts/p2/api.md`, amended 2026-09-09).
 */
const BLOCKER = "The watcher drops events when a file is renamed";
const SESSION: ParsedSession = {
  ...FIXTURE_SESSIONS[0]!,
  notes: [
    { cp: 1, type: "decision", by: "human", text: "Debounce at 100 ms and move on" },
    { cp: 1, type: "blocker", by: "agent", text: BLOCKER },
  ],
};
const NOTES: NoteRef[] = [
  {
    session: SESSION.frontmatter.id,
    cp: 1,
    index: 1,
    type: "blocker",
    by: "agent",
    text: BLOCKER,
  },
];

beforeEach(() => {
  window.location.hash = "";
});

afterEach(cleanup);

describe("Needs you", () => {
  it("renders every open note with its session goal and checkpoint", async () => {
    renderAt(`#/r/${REPO}/needs`, stubSource({ listNotes: async () => NOTES, getSession: async () => SESSION }));

    expect(await screen.findByText(BLOCKER)).toBeDefined();
    expect(await screen.findByText(SESSION.goal!)).toBeDefined();
    expect(screen.getByText("[cp 1]")).toBeDefined();
    expect(screen.getByText("blocker")).toBeDefined();
  });

  it("resolves a note with the ref the NoteRef carries and the decision text", async () => {
    const calls: { ref: { session: string; cp: number; index: number }; decision: string }[] = [];
    const source = stubSource({
      listNotes: async () => NOTES,
      getSession: async () => SESSION,
      resolveNote: async (ref, decision) => {
        calls.push({ ref, decision });
        return SESSION;
      },
    });
    renderAt(`#/r/${REPO}/needs`, source);

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

  /**
   * docs/contracts/p5/config-and-identities.md, through issue #64. A `NoteRef` carries only
   * api.md's `by: "human" | "agent"` — a kind, not a person — so the address a note is attributed
   * to is its session's `author`, which is what the map has a name for.
   */
  it("names the session author from identities.yaml, with the email as the tooltip", async () => {
    const email = SESSION.frontmatter.author.email;
    renderAt(
      `#/r/${REPO}/needs`,
      stubSource({
        listNotes: async () => NOTES,
        getSession: async () => SESSION,
        // Deliberately not the case the ledger records, so a pass proves the lookup is folded.
        listIdentities: async () => [
          { email: email.toUpperCase(), name: "Ada Lovelace", dome_user: null },
        ],
      }),
    );

    const named = await screen.findByTitle(email);
    expect(named.textContent).toBe("Ada Lovelace");
    // The goal is still its own text; the name is beside it, not spliced into it.
    expect(screen.getByText(SESSION.goal!)).toBeDefined();
  });

  it("falls back to the email when the address is unmapped or the file is absent", async () => {
    const email = SESSION.frontmatter.author.email;
    const reads: Identity[][] = [[], [{ email: "grace@example.com", name: "Grace", dome_user: null }]];

    for (const identities of reads) {
      renderAt(
        `#/r/${REPO}/needs`,
        stubSource({
          listNotes: async () => NOTES,
          getSession: async () => SESSION,
          listIdentities: async () => identities,
        }),
      );
      expect((await screen.findByTitle(email)).textContent).toBe(email);
      // The ledger's own `name` is not the fallback: it is whatever git was configured with, and
      // that is the value the file exists to override.
      expect(screen.queryByText(SESSION.frontmatter.author.name)).toBeNull();
      cleanup();
    }
  });

  it("re-reads identities on health.changed", async () => {
    const email = SESSION.frontmatter.author.email;
    let identities: Identity[] = [];
    const handlers = new Set<(event: LedgerEvent) => void>();
    renderAt(
      `#/r/${REPO}/needs`,
      stubSource({
        listNotes: async () => NOTES,
        getSession: async () => SESSION,
        listIdentities: async () => identities,
        subscribe: (handler) => {
          handlers.add(handler);
          return () => void handlers.delete(handler);
        },
      }),
    );
    expect((await screen.findByTitle(email)).textContent).toBe(email);

    identities = [{ email, name: "Ada Lovelace", dome_user: null }];
    for (const handler of [...handlers]) handler({ type: "health.changed" });
    await waitFor(() => expect(screen.getByTitle(email).textContent).toBe("Ada Lovelace"));
  });

  it("disables resolving on a read-only source", async () => {
    renderAt(`#/r/${REPO}/needs`, createSource("fixture"));

    const resolve = await screen.findAllByRole("button", { name: "Resolve" });
    expect(resolve.length).toBeGreaterThan(0);
    expect(resolve.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("Health", () => {
  /**
   * The three readings a `DoctorEntry` can produce: a probe that matches the contract-tested
   * version, one whose binary is not on PATH, and one that is installed but both off-version and
   * unable to read its store. `/api/health` sends the probe, never a verdict, so the page derives
   * all three from these fields alone.
   */
  const HEALTH: Health = {
    cli: "0.0.1",
    repo: "github.com/ManasHardas/workledger",
    repos: [],
    harnesses: [
      {
        harness: "claude-code",
        binary: "/opt/homebrew/bin/claude",
        version: "2.4.1",
        contract_tested_version: "2.4.x",
        store: "/Users/m/.claude/projects",
        store_readable: true,
        projects: 12,
        last_activity: "2026-09-09T08:02:00Z",
      },
      {
        harness: "cursor",
        binary: null,
        version: null,
        contract_tested_version: "1.7.x",
        store: "/Users/m/.cursor/chats",
        store_readable: true,
        projects: null,
        last_activity: null,
      },
      {
        harness: "codex",
        binary: "/usr/local/bin/codex",
        version: "0.9.2",
        contract_tested_version: "1.2.x",
        store: "/Users/m/.codex/sessions",
        store_readable: false,
        projects: null,
        last_activity: null,
      },
    ],
    index: { path: "~/.workledger/index.sqlite", bytes: 262_144, openSessions: 1 },
    config: { valid: false, problems: ["repos[0].path is not a directory"] },
    lastHookAt: null,
  };

  const statusOf = async (row: string) =>
    within(await screen.findByRole("listitem", { name: row })).getByText(/^(ok|warn|broken)$/);

  it("badges each row with its reading", async () => {
    renderAt(`#/r/${REPO}/health`, stubSource({ health: async () => HEALTH }));

    expect((await statusOf("claude-code")).textContent).toBe("ok");
    // No harness fault reads `broken` — `workledger doctor` grades them all warn-or-ok, and this
    // page must not disagree with the terminal about the same machine.
    expect((await statusOf("cursor")).textContent).toBe("warn");
    expect((await statusOf("codex")).textContent).toBe("warn");
    expect((await statusOf("Index")).textContent).toBe("ok");
    expect((await statusOf("Config")).textContent).toBe("broken");
    expect((await statusOf("Last hook")).textContent).toBe("warn");
  });

  it("shows the doctor detail: the probe, its complaints, open sessions and the last hook", async () => {
    renderAt(`#/r/${REPO}/health`, stubSource({ health: async () => HEALTH }));

    // The real probe fields, not a placeholder summary.
    const claude = within(await screen.findByRole("listitem", { name: "claude-code" }));
    expect(claude.getByText(/\/opt\/homebrew\/bin\/claude/)).toBeDefined();
    expect(claude.getByText(/2\.4\.1 · contract tested against 2\.4\.x/)).toBeDefined();
    expect(claude.getByText(/12 projects/)).toBeDefined();
    expect(claude.getByText(/last activity 2026-09-09T08:02:00Z/)).toBeDefined();

    expect(screen.getByText("`cursor` is not on PATH")).toBeDefined();
    expect(screen.getByText("installed 0.9.2, contract tested against 1.2.x")).toBeDefined();
    expect(screen.getByText("/Users/m/.codex/sessions is not readable")).toBeDefined();

    expect(screen.getByText("repos[0].path is not a directory")).toBeDefined();
    expect(screen.getByText(/1 open session/)).toBeDefined();
    expect(screen.getByText("no hook has fired yet")).toBeDefined();
    expect(screen.getByText("workledger 0.0.1")).toBeDefined();
  });
});

describe("keyboard help", () => {
  it("toggles the shortcut overlay on ?", async () => {
    renderAt(`#/r/${REPO}/ledger`, stubSource());
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
    renderAt(`#/r/${REPO}/ledger`, stubSource());
    let asked = 0;
    const listener = () => (asked += 1);
    window.addEventListener("focus-search", listener);

    fireEvent.keyDown(window, { key: "/" });
    window.removeEventListener("focus-search", listener);

    expect(asked).toBe(1);
  });
});
