import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TRANSCRIPT_NOTICE } from "../src/features/ledger/provenance-panel.js";
import { FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import { createSource } from "../src/lib/ledger-source.js";
import type { LedgerEvent, LedgerSource, ParsedSession, SessionQuery } from "../src/lib/ledger-source.js";
import { RepoIdProvider, SourceProvider } from "../src/lib/source-context.js";
import { openFirst } from "../src/features/ledger/session-list.js";
import { LedgerView } from "../src/routes/ledger.js";

/** The first fixture repo: the Ledger's links and detail route live under `#/r/<id>/ledger`. */
const REPO = "0123456789ab";

const OPEN_SESSION = FIXTURE_SESSIONS.find((s) => s.frontmatter.status === "open")!;
const ENDED_SESSION = FIXTURE_SESSIONS.find((s) => s.frontmatter.status !== "open")!;

/**
 * The fixture source with the one capability it lacks: a live subscription whose events the test
 * controls. Everything else delegates, so the view is exercised against the real fixture data and
 * only the transport is faked.
 */
function liveSource() {
  const base = createSource("fixture");
  const handlers = new Set<(event: LedgerEvent) => void>();
  const reads: SessionQuery[] = [];
  const source = Object.assign(Object.create(base) as LedgerSource, {
    capabilities: { write: false, live: true, provenance: false },
    listSessions(q?: SessionQuery) {
      reads.push(q ?? {});
      return base.listSessions(q);
    },
    subscribe(handler: (event: LedgerEvent) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  });
  return {
    source,
    reads,
    emit: (event: LedgerEvent) => handlers.forEach((handler) => handler(event)),
  };
}

function renderLedger(source: LedgerSource = createSource("fixture")) {
  return render(
    <RepoIdProvider id={REPO}>
      <SourceProvider source={source}>
        <LedgerView />
      </SourceProvider>
    </RepoIdProvider>,
  );
}

/** Amendment 11: one list, no scope tabs — every session is on screen from the first render. */
const SESSION_LIST = /Sessions, open first/;

beforeEach(() => {
  window.location.hash = `#/r/${REPO}/ledger`;
});

afterEach(cleanup);

describe("ledger list", () => {
  it("renders a card per fixture session, newest first, with no Open/All tabs (amendment 11)", async () => {
    renderLedger();

    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.queryByRole("tablist")).toBeNull();

    const list = await screen.findByRole("list", { name: SESSION_LIST });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(FIXTURE_SESSIONS.length);

    const newestFirst = [...FIXTURE_SESSIONS].sort((a, b) =>
      b.frontmatter.started.localeCompare(a.frontmatter.started),
    );
    expect(cards.map((card) => card.textContent)).toEqual(
      newestFirst.map((session) => expect.stringContaining(session.goal!)),
    );
  });

  it("shows goal, author, harness, status, checkpoint count and done/remaining counts", async () => {
    renderLedger();
    const card = (await screen.findAllByRole("listitem"))[0]!;
    const { frontmatter } = OPEN_SESSION;

    expect(card.textContent).toContain(OPEN_SESSION.goal!);
    expect(card.textContent).toContain(frontmatter.author.name);
    expect(card.textContent).toContain(frontmatter.harness);
    expect(card.textContent).toContain(frontmatter.status);
    expect(card.textContent).toContain(`${frontmatter.checkpoints.length} checkpoints`);
    expect(card.textContent).toContain(
      `${OPEN_SESSION.done.length} done · ${OPEN_SESSION.remaining.length} remaining`,
    );
    expect(card.textContent).toContain("Started 2026-09-09 08:02 UTC");
  });

  it("filters the list through listSessions({ q })", async () => {
    const { source, reads } = liveSource();
    renderLedger(source);
    await screen.findByText(ENDED_SESSION.goal!);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), {
      target: { value: "watcher" },
    });

    expect(await screen.findByText(OPEN_SESSION.goal!)).toBeDefined();
    expect(screen.queryByText(ENDED_SESSION.goal!)).toBeNull();
    expect(reads.some((read) => read.q === "watcher")).toBe(true);
  });

  it("offers author, harness, status and since filters", async () => {
    renderLedger();
    await screen.findByRole("list", { name: SESSION_LIST });

    for (const label of ["Author", "Harness", "Status", "Since"]) {
      const control = screen.getByLabelText(label);
      expect(control).toBeDefined();
      // No scope tab pins the status any more; every filter is the operator's to set.
      expect((control as HTMLSelectElement).disabled).toBe(false);
    }
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Harness"), { target: { value: "cursor" } });
    expect(
      await screen.findByText(/No sessions match/),
    ).toBeDefined();
  });

  it("moves between cards with j/k and opens the focused one with Enter", async () => {
    renderLedger();
    await screen.findByText(ENDED_SESSION.goal!);

    fireEvent.keyDown(window, { key: "j" });
    expect(document.activeElement?.getAttribute("href")).toBe(`#/r/${REPO}/ledger/${OPEN_SESSION.frontmatter.id}`);

    fireEvent.keyDown(window, { key: "j" });
    expect(document.activeElement?.getAttribute("href")).toBe(
      `#/r/${REPO}/ledger/${ENDED_SESSION.frontmatter.id}`,
    );

    fireEvent.keyDown(window, { key: "k" });
    expect(document.activeElement?.getAttribute("href")).toBe(`#/r/${REPO}/ledger/${OPEN_SESSION.frontmatter.id}`);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(window.location.hash).toBe(`#/r/${REPO}/ledger/${OPEN_SESSION.frontmatter.id}`);
  });

  it("leaves j and k alone while the search box has focus", async () => {
    renderLedger();
    await screen.findByRole("list", { name: SESSION_LIST });
    const search = screen.getByRole("searchbox", { name: "Search sessions" });
    search.focus();

    fireEvent.keyDown(search, { key: "j" });
    expect(document.activeElement).toBe(search);
  });

  it("re-reads the list when the source reports session.changed", async () => {
    const { source, reads, emit } = liveSource();
    renderLedger(source);
    await screen.findByText(OPEN_SESSION.goal!);
    const before = reads.length;

    await act(async () => {
      emit({ type: "session.changed", ulid: OPEN_SESSION.frontmatter.id });
    });
    await screen.findByText(OPEN_SESSION.goal!);
    expect(reads.length).toBeGreaterThan(before);

    // Only session events move the list; a backlog change is somebody else's refetch.
    const afterSession = reads.length;
    await act(async () => {
      emit({ type: "backlog.changed", id: "WL-01JBQ50R6TT4YB8H2ZC3D9KQ7M" });
    });
    expect(reads.length).toBe(afterSession);
  });
});

/**
 * Amendment 11's ordering, on a ledger where it is visible: an *ended* session started later than
 * the open one. Newest-first alone would bury the running session; open-first must not.
 */
describe("open sessions first, then the rest (amendment 11)", () => {
  const NEWER_ENDED: ParsedSession = {
    ...ENDED_SESSION,
    goal: "an ended session started after the open one",
    frontmatter: { ...ENDED_SESSION.frontmatter, id: "01JBQZZZZZZZZZZZZZZZZZZZZZ", started: "2026-09-09T23:00:00Z" },
  };
  const OLDER_OPEN: ParsedSession = {
    ...OPEN_SESSION,
    frontmatter: { ...OPEN_SESSION.frontmatter, started: "2026-09-09T08:02:00Z" },
  };

  it("partitions without disturbing the newest-first order inside either half", () => {
    expect(openFirst([NEWER_ENDED, OLDER_OPEN]).map((s) => s.frontmatter.id)).toEqual([
      OLDER_OPEN.frontmatter.id,
      NEWER_ENDED.frontmatter.id,
    ]);
    // All open, or none open: the list is handed back untouched.
    expect(openFirst([OLDER_OPEN])).toEqual([OLDER_OPEN]);
    expect(openFirst([NEWER_ENDED])).toEqual([NEWER_ENDED]);
    expect(openFirst([])).toEqual([]);
  });

  it("puts the open session at the top of the one list, and j lands on it first", async () => {
    const base = createSource("fixture");
    const source = Object.assign(Object.create(base) as LedgerSource, {
      listSessions: () => Promise.resolve([NEWER_ENDED, OLDER_OPEN]),
    });
    renderLedger(source);

    const list = await screen.findByRole("list", { name: SESSION_LIST });
    const cards = within(list).getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining(OLDER_OPEN.goal!),
      expect.stringContaining(NEWER_ENDED.goal!),
    ]);

    // The keyboard cursor walks the list as rendered, so `j` reaches the open session first.
    fireEvent.keyDown(window, { key: "j" });
    expect(document.activeElement?.getAttribute("href")).toBe(
      `#/r/${REPO}/ledger/${OLDER_OPEN.frontmatter.id}`,
    );
  });
});

describe("session detail", () => {
  beforeEach(() => {
    window.location.hash = `#/r/${REPO}/ledger/${ENDED_SESSION.frontmatter.id}`;
  });

  it("shows Goal, Done, Remaining and Notes with their [cp n] markers", async () => {
    renderLedger();
    for (const heading of ["Goal", "Done", "Remaining", "Notes"]) {
      expect(await screen.findByRole("heading", { name: heading, level: 3 })).toBeDefined();
    }

    expect(await screen.findByText(ENDED_SESSION.goal!)).toBeDefined();
    for (const line of ENDED_SESSION.done) {
      expect(screen.getByText(line.text)).toBeDefined();
    }
    for (const line of ENDED_SESSION.notes.filter((note) => note.type !== "discovery")) {
      expect(screen.getByText(line.text)).toBeDefined();
    }
    expect(screen.getAllByText("[cp 1]").length).toBeGreaterThan(0);
    expect(screen.getAllByText("[cp 2]").length).toBeGreaterThan(0);
  });

  it("shows where the session started and what it is about in the header (P8 amendment 10)", async () => {
    renderLedger();
    await screen.findByText(ENDED_SESSION.goal!);
    const header = screen.getByText(/started in/);
    expect(header.textContent).toContain(`started in ${ENDED_SESSION.startedIn}`);
    expect(header.textContent).toContain("about workledger, card-shopify_store");
  });

  it("renders each Remaining line as → WL-id (rel)", async () => {
    renderLedger();
    for (const line of ENDED_SESSION.remaining) {
      expect(await screen.findByText(`→ ${line.ref} (${line.rel})`)).toBeDefined();
    }
  });

  it("shows the provenance panel for every checkpoint plus the P3 notice", async () => {
    renderLedger();
    expect(await screen.findByRole("heading", { name: "Provenance", level: 3 })).toBeDefined();

    for (const checkpoint of ENDED_SESSION.frontmatter.checkpoints) {
      expect(screen.getByText(String(checkpoint.turns))).toBeDefined();
      expect(screen.getByText(checkpoint.trigger)).toBeDefined();
    }
    expect(screen.getByText("2026-09-08 09:41 UTC")).toBeDefined();
    expect(screen.getByText("0–41,233 bytes")).toBeDefined();
    expect(screen.getByText("41,233–96,400 bytes")).toBeDefined();
    expect(screen.getByText(TRANSCRIPT_NOTICE)).toBeDefined();
  });

  it("shows unparsed lines in their own muted block", async () => {
    const base = createSource("fixture");
    const withUnparsed = Object.assign(Object.create(base) as LedgerSource, {
      async getSession(ulid: string) {
        const session = await base.getSession(ulid);
        return { ...session, unparsed: [{ section: "notes" as const, line: "- hand-typed line" }] };
      },
    });
    renderLedger(withUnparsed);
    expect(await screen.findByText(/notes: - hand-typed line/)).toBeDefined();
  });
});

/**
 * Amendment 11 (docs/contracts/p8/daemon-and-api.md): the page shows the human gist of each Done
 * item and nothing else inline; the specifics live in a side drawer; discovery notes are for
 * agents and sit behind a disclosure; memory entries get a section of their own.
 */
describe("session detail — gists, drawer, notes split, memory", () => {
  const DONE = ENDED_SESSION.done[0]!;
  const DISCOVERY = ENDED_SESSION.notes.find((note) => note.type === "discovery")!;

  /** The ended session with `getSession` rewritten, so a test can hand the view any shape. */
  function sessionSource(patch: (session: (typeof FIXTURE_SESSIONS)[number]) => object) {
    const base = createSource("fixture");
    return Object.assign(Object.create(base) as LedgerSource, {
      async getSession(ulid: string) {
        const session = await base.getSession(ulid);
        return { ...session, ...patch(session) };
      },
    });
  }

  beforeEach(() => {
    window.location.hash = `#/r/${REPO}/ledger/${ENDED_SESSION.frontmatter.id}`;
  });

  it("shows only the gist per Done item; detail, commit and files stay out of the page", async () => {
    renderLedger();
    expect(await screen.findByRole("button", { name: new RegExp(DONE.text) })).toBeDefined();
    expect(screen.queryByText(DONE.detail!)).toBeNull();
    expect(screen.queryByText(DONE.commit!)).toBeNull();
    for (const file of DONE.files!) expect(screen.queryByText(file)).toBeNull();
    expect(screen.queryByText(DONE.verified!)).toBeNull();
  });

  it("opens a drawer with detail, commit, files, verified and the checkpoint stamp on click", async () => {
    renderLedger();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(DONE.text) }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(DONE.detail!)).toBeDefined();
    expect(within(drawer).getByText(DONE.commit!)).toBeDefined();
    for (const file of DONE.files!) expect(within(drawer).getByText(file)).toBeDefined();
    expect(within(drawer).getByText(DONE.verified!)).toBeDefined();
    expect(within(drawer).getByText("[cp 1]")).toBeDefined();
    expect(within(drawer).getByText("2026-09-08 09:41 UTC")).toBeDefined();

    // Escape closes it too, but the button is the only exit a thumb can see at 375 px.
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders a pre-amendment checkpoint's text as the gist and says the drawer has no detail", async () => {
    renderLedger(
      sessionSource((session) => ({
        done: session.done.map((line) => ({ ...line, detail: undefined })),
      })),
    );
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(DONE.text) }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("heading", { name: DONE.text })).toBeDefined();
    expect(within(drawer).getByText("No detail recorded.")).toBeDefined();
    expect(within(drawer).getByText(DONE.commit!)).toBeDefined();
  });

  it("shows blocker, question and decision notes; discovery waits behind For agents (n)", async () => {
    renderLedger();
    for (const note of ENDED_SESSION.notes.filter((line) => line.type !== "discovery")) {
      expect(await screen.findByText(note.text)).toBeDefined();
    }
    expect(screen.queryByText(DISCOVERY.text)).toBeNull();

    const disclosure = screen.getByRole("button", { name: "For agents (1)" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(DISCOVERY.text)).toBeDefined();
  });

  it("omits the For agents disclosure when no note is a discovery", async () => {
    renderLedger(sessionSource((session) => ({ notes: session.notes.filter((n) => n.type !== "discovery") })));
    expect(await screen.findByRole("heading", { name: "Notes", level: 3 })).toBeDefined();
    expect(screen.queryByRole("button", { name: /For agents/ })).toBeNull();
  });

  it("shows a Memory section with each entry and its file badge", async () => {
    renderLedger();
    expect(await screen.findByRole("heading", { name: "Memory", level: 3 })).toBeDefined();
    for (const entry of ENDED_SESSION.memory) {
      expect(screen.getByText(entry.text)).toBeDefined();
      if (entry.file) expect(screen.getByText(entry.file)).toBeDefined();
    }
  });

  it("hides Memory when the session has no entries or predates the field", async () => {
    renderLedger(sessionSource(() => ({ memory: [] })));
    expect(await screen.findByRole("heading", { name: "Notes", level: 3 })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Memory", level: 3 })).toBeNull();
    cleanup();

    // A daemon older than amendment 11 sends no `memory` key at all; the view must not throw.
    renderLedger(sessionSource(() => ({ memory: undefined as unknown as [] })));
    expect(await screen.findByRole("heading", { name: "Notes", level: 3 })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Memory", level: 3 })).toBeNull();
  });
});

/**
 * Amendment 13 (docs/contracts/p8/daemon-and-api.md): the drawer's commit id and file paths are
 * links out to the repo's host when `origin` resolved to one, an identifier with a copy control
 * when it did not, and — independently of either — an open-in-editor control while the repo's
 * `editor` is not `none`.
 */
describe("session detail — commit and file links (amendment 13)", () => {
  const DONE = ENDED_SESSION.done[0]!;
  const REPO_PATH = "/Users/m/Projects/workledger";
  const GITHUB = {
    host: "github" as const,
    webBase: "https://github.com/ManasHardas/workledger",
    commitUrl: "https://github.com/ManasHardas/workledger/commit/{sha}",
    fileUrl: "https://github.com/ManasHardas/workledger/blob/{ref}/{path}",
  };

  /** The ended session with the amendment's three fields patched onto it. */
  function linkedSource(patch: object) {
    const base = createSource("fixture");
    return Object.assign(Object.create(base) as LedgerSource, {
      async getSession(ulid: string) {
        return { ...(await base.getSession(ulid)), ...patch };
      },
    });
  }

  async function openDrawer(source: LedgerSource) {
    renderLedger(source);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(DONE.text) }));
    return screen.findByRole("dialog");
  }

  beforeEach(() => {
    window.location.hash = `#/r/${REPO}/ledger/${ENDED_SESSION.frontmatter.id}`;
  });

  it("links the commit id and every file at that commit, in a new tab", async () => {
    const drawer = await openDrawer(
      linkedSource({ remote: GITHUB, editor: "none", repoPath: REPO_PATH }),
    );

    const commit = within(drawer).getByRole("link", { name: DONE.commit! });
    expect(commit.getAttribute("href")).toBe(`${GITHUB.webBase}/commit/${DONE.commit}`);
    expect(commit.getAttribute("target")).toBe("_blank");
    expect(commit.getAttribute("rel")).toBe("noreferrer noopener");

    for (const file of DONE.files!) {
      const link = within(drawer).getByRole("link", { name: file });
      expect(link.getAttribute("href")).toBe(`${GITHUB.webBase}/blob/${DONE.commit}/${file}`);
      expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    }
    // `editor: none` means no second control next to a file.
    expect(within(drawer).queryByRole("link", { name: /Open .* in the editor/ })).toBeNull();
  });

  it("links a file at the default branch when the item records no commit", async () => {
    const drawer = await openDrawer(
      linkedSource({
        remote: GITHUB,
        editor: "none",
        repoPath: REPO_PATH,
        done: [{ ...DONE, commit: undefined }],
      }),
    );
    const file = DONE.files![0]!;
    expect(within(drawer).getByRole("link", { name: file }).getAttribute("href")).toBe(
      `${GITHUB.webBase}/blob/HEAD/${file}`,
    );
    expect(within(drawer).getByText("None")).toBeDefined();
  });

  it("shows the identifier with a copy control and no link when the repo has no known remote", async () => {
    const drawer = await openDrawer(
      linkedSource({ remote: null, editor: "none", repoPath: REPO_PATH }),
    );
    expect(within(drawer).queryByRole("link", { name: DONE.commit! })).toBeNull();
    expect(within(drawer).getByText(DONE.commit!)).toBeDefined();
    expect(within(drawer).getByRole("button", { name: `Copy ${DONE.commit}` })).toBeDefined();
    for (const file of DONE.files!) {
      expect(within(drawer).queryByRole("link", { name: file })).toBeNull();
      expect(within(drawer).getByRole("button", { name: `Copy ${file}` })).toBeDefined();
    }
  });

  it("offers an open-in-editor control per file, built from the absolute local path", async () => {
    const drawer = await openDrawer(
      linkedSource({ remote: null, editor: "cursor", repoPath: REPO_PATH }),
    );
    for (const file of DONE.files!) {
      const open = within(drawer).getByRole("link", { name: `Open ${file} in the editor` });
      expect(open.getAttribute("href")).toBe(`cursor://file${REPO_PATH}/${file}`);
    }
  });

  it("falls back to the plain drawer on a daemon that predates the amendment", async () => {
    const drawer = await openDrawer(createSource("fixture"));
    expect(within(drawer).getByText(DONE.commit!)).toBeDefined();
    expect(within(drawer).queryByRole("link", { name: DONE.commit! })).toBeNull();
    for (const file of DONE.files!) expect(within(drawer).getByText(file)).toBeDefined();
  });
});
