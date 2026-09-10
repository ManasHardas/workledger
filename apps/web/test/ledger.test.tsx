import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TRANSCRIPT_NOTICE } from "../src/features/ledger/provenance-panel.js";
import { FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import { createSource } from "../src/lib/ledger-source.js";
import type { LedgerEvent, LedgerSource, SessionQuery } from "../src/lib/ledger-source.js";
import { RepoIdProvider, SourceProvider } from "../src/lib/source-context.js";
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

/** The Ledger opens on the "Open" scope; most assertions want every fixture session. */
function showAll() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "All" }));
}

beforeEach(() => {
  window.location.hash = `#/r/${REPO}/ledger`;
});

afterEach(cleanup);

describe("ledger list", () => {
  it("renders a card per fixture session, newest first", async () => {
    renderLedger();
    showAll();

    const list = await screen.findByRole("list", { name: /Sessions, newest first/ });
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
    showAll();
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
    showAll();
    await screen.findByRole("list", { name: /Sessions, newest first/ });

    for (const label of ["Author", "Harness", "Status", "Since"]) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }
    fireEvent.change(screen.getByLabelText("Harness"), { target: { value: "cursor" } });
    expect(
      await screen.findByText(/No sessions match/),
    ).toBeDefined();
  });

  it("moves between cards with j/k and opens the focused one with Enter", async () => {
    renderLedger();
    showAll();
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
    await screen.findByRole("list", { name: /Sessions, newest first/ });
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
    for (const line of ENDED_SESSION.notes) {
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
