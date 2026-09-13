import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AsideHost, AsideSlot } from "../src/components/aside.js";
import { FOCUS_SEARCH_EVENT } from "../src/components/keyboard-help.js";
import { TRANSCRIPT_NOTICE } from "../src/features/ledger/provenance-panel.js";
import { FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import { createSource } from "../src/lib/ledger-source.js";
import type { LedgerEvent, LedgerSource, ParsedSession, SessionQuery } from "../src/lib/ledger-source.js";
import { RepoIdProvider, SourceProvider } from "../src/lib/source-context.js";
import { openFirst } from "../src/features/ledger/session-list.js";
import { LedgerView } from "../src/routes/ledger.js";
import { SessionView } from "../src/routes/session.js";

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

/**
 * The detail is its own destination now (P9): `#/r/<id>/session/<ulid>`. The Ledger renders the
 * list and nothing else, so a detail test mounts the Session view.
 */
function renderSession(source: LedgerSource = createSource("fixture")) {
  return render(
    <RepoIdProvider id={REPO}>
      <SourceProvider source={source}>
        <SessionView />
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

    // The list is grouped by day now, so the cards live across one list per day.
    await screen.findByRole("list", { name: SESSION_LIST });
    const cards = screen
      .getAllByRole("list", { name: /^Sessions/ })
      .flatMap((list) => within(list).getAllByRole("listitem"));
    expect(cards).toHaveLength(FIXTURE_SESSIONS.length);

    const newestFirst = [...FIXTURE_SESSIONS].sort((a, b) =>
      b.frontmatter.started.localeCompare(a.frontmatter.started),
    );
    expect(cards.map((card) => card.textContent)).toEqual(
      newestFirst.map((session) => expect.stringContaining(session.goal!)),
    );
  });

  it("shows goal, status, span, checkpoint count and done/remaining counts on the card (frame 7:46)", async () => {
    renderLedger();
    const card = (await screen.findAllByRole("listitem"))[0]!;
    const { frontmatter } = OPEN_SESSION;

    expect(card.textContent).toContain(OPEN_SESSION.goal!);
    expect(card.textContent).toContain(frontmatter.status);
    // Clocks in UTC, then the duration to the last checkpoint, then the checkpoint count.
    expect(card.textContent).toContain(`08:02 · `);
    expect(card.textContent).toMatch(new RegExp(`${frontmatter.checkpoints.length} checkpoints?`));
    // The row speaks the redesign's vocabulary: outcomes recorded, and what is still open.
    expect(card.textContent).toContain(`${OPEN_SESSION.done.length} outcome`);
    expect(card.textContent).toContain(`${OPEN_SESSION.remaining.length} open`);
    // Who ran it moved to the Selected session module; the card leads with the work.
    expect(card.textContent).not.toContain(frontmatter.author.name);
  });

  it("heads the page with the counts over the sessions on screen, and groups them by UTC day", async () => {
    renderLedger();
    await screen.findByRole("list", { name: SESSION_LIST });
    const done = FIXTURE_SESSIONS.reduce((n, s) => n + s.done.length, 0);
    const remaining = FIXTURE_SESSIONS.reduce((n, s) => n + s.remaining.length, 0);
    expect(screen.getByRole("heading", { name: "Ledger", level: 1 })).toBeDefined();
    expect(
      screen.getByText(`${FIXTURE_SESSIONS.length} sessions · ${done} outcomes · ${remaining} still open`),
    ).toBeDefined();
    expect(screen.getByRole("heading", { name: "9 September", level: 2 })).toBeDefined();
    expect(screen.getByRole("heading", { name: "8 September", level: 2 })).toBeDefined();
  });

  it("focuses the search box when the shell asks (`/`)", async () => {
    renderLedger();
    await screen.findByRole("list", { name: SESSION_LIST });
    act(() => {
      window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT));
    });
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search sessions" }));
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
    expect(document.activeElement?.getAttribute("href")).toBe(`#/r/${REPO}/session/${OPEN_SESSION.frontmatter.id}`);

    fireEvent.keyDown(window, { key: "j" });
    expect(document.activeElement?.getAttribute("href")).toBe(
      `#/r/${REPO}/session/${ENDED_SESSION.frontmatter.id}`,
    );

    fireEvent.keyDown(window, { key: "k" });
    expect(document.activeElement?.getAttribute("href")).toBe(`#/r/${REPO}/session/${OPEN_SESSION.frontmatter.id}`);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(window.location.hash).toBe(`#/r/${REPO}/session/${OPEN_SESSION.frontmatter.id}`);
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
      `#/r/${REPO}/session/${OLDER_OPEN.frontmatter.id}`,
    );
  });
});

/**
 * With the right column on screen (from 1280 px the shell mounts the aside slot), a card is a
 * selection and the "Selected session" module follows it (frame 7:98). The test mounts the slot
 * itself, which is exactly what `useAsideDocked` reads.
 */
describe("ledger with the right column docked", () => {
  function renderDocked(source: LedgerSource = createSource("fixture")) {
    return render(
      <RepoIdProvider id={REPO}>
        <SourceProvider source={source}>
          <AsideHost>
            <LedgerView />
            <aside aria-label="Details">
              <AsideSlot />
            </aside>
          </AsideHost>
        </SourceProvider>
      </RepoIdProvider>,
    );
  }

  const hrefOf = (session: ParsedSession) => `#/r/${REPO}/session/${session.frontmatter.id}`;
  const cardFor = (session: ParsedSession) =>
    screen.getAllByRole("link").find((link) => link.getAttribute("href") === hrefOf(session) && link.closest("li"))!;

  it("selects the first card and summarises it in the module", async () => {
    renderDocked();
    const module = await screen.findByRole("region", { name: "Selected session" });
    expect(cardFor(OPEN_SESSION).getAttribute("aria-current")).toBe("true");

    const { frontmatter } = OPEN_SESSION;
    expect(within(module).getByRole("heading", { name: OPEN_SESSION.goal! })).toBeDefined();
    expect(within(module).getByText(`${frontmatter.author.name} · ${frontmatter.harness} · 9 Sep 08:02 UTC`)).toBeDefined();
    expect(within(module).getByText("What happened")).toBeDefined();
    const point = OPEN_SESSION.done[0]!;
    expect(within(module).getByText(point.text)).toBeDefined();
    expect(within(module).getByText(`cp ${point.cp} · ${point.commit}`)).toBeDefined();
    expect(within(module).getByRole("link", { name: "Open the session" }).getAttribute("href")).toBe(
      hrefOf(OPEN_SESSION),
    );
    expect(within(module).getByText(`${OPEN_SESSION.remaining.length} left open`)).toBeDefined();
  });

  it("selects on click without leaving the page, and opens on double-click or Enter", async () => {
    renderDocked();
    await screen.findByRole("region", { name: "Selected session" });

    fireEvent.click(cardFor(ENDED_SESSION));
    expect(window.location.hash).toBe(`#/r/${REPO}/ledger`);
    expect(cardFor(ENDED_SESSION).getAttribute("aria-current")).toBe("true");
    expect(cardFor(OPEN_SESSION).getAttribute("aria-current")).toBeNull();
    const module = screen.getByRole("region", { name: "Selected session" });
    // The goal is cut at its first ": " for the module's title.
    expect(within(module).getByRole("heading", { name: "Freeze the P2 contracts" })).toBeDefined();
    // Two outcomes with two commits: two points, each naming its own evidence, no-commit none here.
    expect(within(module).getAllByRole("listitem")).toHaveLength(2);
    expect(within(module).getByText("cp 2 · 1ab90d5")).toBeDefined();

    // Enter on another control is that control's: the module's link does not re-open via the list.
    fireEvent.keyDown(within(module).getByRole("link", { name: "Open the session" }), { key: "Enter" });
    expect(window.location.hash).toBe(`#/r/${REPO}/ledger`);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(window.location.hash).toBe(hrefOf(ENDED_SESSION));

    window.location.hash = `#/r/${REPO}/ledger`;
    fireEvent.doubleClick(cardFor(OPEN_SESSION));
    expect(window.location.hash).toBe(hrefOf(OPEN_SESSION));
  });

  it("moves the selection with j and k, starting from the first card", async () => {
    renderDocked();
    await screen.findByRole("region", { name: "Selected session" });

    fireEvent.keyDown(window, { key: "j" });
    expect(document.activeElement?.getAttribute("href")).toBe(hrefOf(ENDED_SESSION));
    expect(cardFor(ENDED_SESSION).getAttribute("aria-current")).toBe("true");

    fireEvent.keyDown(window, { key: "k" });
    expect(document.activeElement?.getAttribute("href")).toBe(hrefOf(OPEN_SESSION));
    expect(
      within(screen.getByRole("region", { name: "Selected session" })).getByRole("heading", {
        name: OPEN_SESSION.goal!,
      }),
    ).toBeDefined();
  });

  it("offers Repair in the module, not under the card, for a crashed session on a writable source", async () => {
    const crashed: ParsedSession = {
      ...ENDED_SESSION,
      frontmatter: { ...ENDED_SESSION.frontmatter, status: "crashed" },
    };
    const base = createSource("fixture");
    const source = Object.assign(Object.create(base) as LedgerSource, {
      capabilities: { ...base.capabilities, write: true },
      listSessions: () => Promise.resolve([crashed]),
    });
    renderDocked(source);

    const module = await screen.findByRole("region", { name: "Selected session" });
    expect(within(module).getByRole("button", { name: "Repair session…" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Repair session…" })).toHaveLength(1);
    cleanup();

    // Undocked, the same session keeps its control under the card.
    renderLedger(source);
    const list = await screen.findByRole("list", { name: SESSION_LIST });
    expect(within(list).getByRole("button", { name: "Repair session…" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Selected session" })).toBeNull();
  });
});

describe("session detail", () => {
  beforeEach(() => {
    window.location.hash = `#/r/${REPO}/ledger/${ENDED_SESSION.frontmatter.id}`;
  });

  it("leads with the goal, then What happened, Left open and Notes, with the notes' [cp n] markers", async () => {
    renderSession();
    // Session frame `2:2`: the goal is the page's heading, then the recap, then what was left open;
    // the notes the frame leaves out follow below in the same style.
    expect(await screen.findByRole("heading", { name: ENDED_SESSION.goal!, level: 1 })).toBeDefined();
    for (const heading of ["What happened", "Left open", "Notes"]) {
      expect(await screen.findByRole("heading", { name: heading, level: 2 })).toBeDefined();
    }

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
    renderSession();
    await screen.findByText(ENDED_SESSION.goal!);
    const header = screen.getByText(/started in/);
    expect(header.textContent).toContain(`started in ${ENDED_SESSION.startedIn}`);
    expect(header.textContent).toContain("about workledger, card-shopify_store");
  });

  it("renders each Left open line with its ref cut as the frame prints it, the whole ref on hover", async () => {
    renderSession();
    for (const line of ENDED_SESSION.remaining) {
      expect(await screen.findByText(line.text)).toBeDefined();
      const ref = screen.getByText(`${line.ref.slice(0, 11)}…`);
      expect(ref.getAttribute("title")).toBe(line.ref);
    }
  });

  it("shows the provenance panel for every checkpoint plus the P3 notice", async () => {
    renderSession();
    expect(await screen.findByRole("heading", { name: "Provenance", level: 2 })).toBeDefined();

    const [first, second] = ENDED_SESSION.frontmatter.checkpoints;
    expect(first!.at).toBe("2026-09-08T09:41:00Z");
    expect(screen.getByText("8 Sep 09:41 UTC")).toBeDefined();
    expect(screen.getByText(/18 turns · bytes · transcript 0 – 41,233 B/)).toBeDefined();
    expect(second!.transcript_offset).toBe(96_400);
    expect(screen.getByText(/37 turns · minutes · transcript 41,233 – 96,400 B/)).toBeDefined();
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
    renderSession(withUnparsed);
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

  it("shows only the gist per outcome; detail, files and verification stay out of the page", async () => {
    renderSession();
    expect(await screen.findByRole("button", { name: new RegExp(DONE.text) })).toBeDefined();
    expect(screen.queryByText(DONE.detail!)).toBeNull();
    for (const file of DONE.files!) expect(screen.queryByText(file)).toBeNull();
    expect(screen.queryByText(DONE.verified!)).toBeNull();
    // The commit is the exception, and a deliberate one: the recap groups outcomes *by* their
    // evidence, so a point names the commit it covers. Everything that commit touched — the
    // detail, the files, whether tests ran — still waits in the drawer (rule 3).
    expect(screen.getAllByText(DONE.commit!).length).toBeGreaterThan(0);
  });

  it("opens a drawer with detail, commit, files, verified and the checkpoint stamp on click", async () => {
    renderSession();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(DONE.text) }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(DONE.detail!)).toBeDefined();
    expect(within(drawer).getByText(DONE.commit!)).toBeDefined();
    for (const file of DONE.files!) expect(within(drawer).getByText(file)).toBeDefined();
    expect(within(drawer).getByText(DONE.verified!)).toBeDefined();
    expect(within(drawer).getByText("[cp 1]")).toBeDefined();
    expect(within(drawer).getByText("2026-09-08 09:41 UTC")).toBeDefined();

    // Escape closes it too, but the panel header's control is the only exit a thumb can see at
    // 375 px, where the panel is a bottom sheet.
    fireEvent.click(within(drawer).getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders a pre-amendment checkpoint's text as the gist and says the drawer has no detail", async () => {
    renderSession(
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
    renderSession();
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
    renderSession(sessionSource((session) => ({ notes: session.notes.filter((n) => n.type !== "discovery") })));
    expect(await screen.findByRole("heading", { name: "Notes", level: 2 })).toBeDefined();
    expect(screen.queryByRole("button", { name: /For agents/ })).toBeNull();
  });

  it("shows a Memory section with each entry and its file badge", async () => {
    renderSession();
    expect(await screen.findByRole("heading", { name: "Memory", level: 2 })).toBeDefined();
    for (const entry of ENDED_SESSION.memory) {
      expect(screen.getByText(entry.text)).toBeDefined();
      if (entry.file) expect(screen.getByText(entry.file)).toBeDefined();
    }
  });

  it("hides Memory when the session has no entries or predates the field", async () => {
    renderSession(sessionSource(() => ({ memory: [] })));
    expect(await screen.findByRole("heading", { name: "Notes", level: 2 })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Memory", level: 2 })).toBeNull();
    cleanup();

    // A daemon older than amendment 11 sends no `memory` key at all; the view must not throw.
    renderSession(sessionSource(() => ({ memory: undefined as unknown as [] })));
    expect(await screen.findByRole("heading", { name: "Notes", level: 2 })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Memory", level: 2 })).toBeNull();
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
    renderSession(source);
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

  it("never links a file path that leaves the repo, with or without an editor", async () => {
    const escaping = "../../../../../../etc/passwd";
    const drawer = await openDrawer(
      linkedSource({
        remote: GITHUB,
        editor: "vscode",
        repoPath: REPO_PATH,
        done: [{ ...DONE, files: [escaping, "/etc/hosts", "packages/server/src/remote.ts"] }],
      }),
    );
    for (const bad of [escaping, "/etc/hosts"]) {
      expect(within(drawer).queryByRole("link", { name: bad })).toBeNull();
      expect(within(drawer).queryByRole("link", { name: `Open ${bad} in the editor` })).toBeNull();
      // Still shown, still copyable — it is what the checkpoint recorded.
      expect(within(drawer).getByText(bad)).toBeDefined();
      expect(within(drawer).getByRole("button", { name: `Copy ${bad}` })).toBeDefined();
    }
    // The well-formed sibling in the same item is unaffected.
    const good = "packages/server/src/remote.ts";
    expect(within(drawer).getByRole("link", { name: good }).getAttribute("href")).toBe(
      `${GITHUB.webBase}/blob/${DONE.commit}/${good}`,
    );
    expect(within(drawer).getByRole("link", { name: `Open ${good} in the editor` })).toBeDefined();
  });

  it("falls back to the plain drawer on a daemon that predates the amendment", async () => {
    const drawer = await openDrawer(createSource("fixture"));
    expect(within(drawer).getByText(DONE.commit!)).toBeDefined();
    expect(within(drawer).queryByRole("link", { name: DONE.commit! })).toBeNull();
    for (const file of DONE.files!) expect(within(drawer).getByText(file)).toBeDefined();
  });
});
