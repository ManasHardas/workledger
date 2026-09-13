import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { reviewViewOf, withReviewView } from "../src/features/review/view.js";
import { FIXTURE_BACKLOG, FIXTURE_REPOS, FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import {
  createSource,
  type AppSource,
  type BacklogView,
  type LedgerSource,
  type NoteAcrossRepos,
  type NoteRef,
  type Repo,
} from "../src/lib/ledger-source.js";
import { ASIDE_QUERY } from "../src/lib/media.js";
import { repoHref } from "../src/lib/router.js";

const [WORKLEDGER, DASHERO] = FIXTURE_REPOS as [Repo, Repo];

/**
 * Every note in the fixture sessions as `/api/notes` would send it — the fixture source's own
 * `listNotes` carries only the open ones, and Review's history views need the decisions and
 * discoveries too. `index` is the note's position among its checkpoint's notes.
 */
const NOTES: NoteRef[] = FIXTURE_SESSIONS.flatMap((session) =>
  session.notes.map((note) => ({
    ...note,
    session: session.frontmatter.id,
    index: session.notes.filter((other) => other.cp === note.cp).indexOf(note),
  })),
);
const byType = (type: NoteRef["type"]) => NOTES.filter((note) => note.type === type);
const BLOCKER = byType("blocker")[0]!;
const QUESTION = byType("question")[0]!;
const DECISION = byType("decision")[0]!;
const DISCOVERY = byType("discovery")[0]!;
const PROPOSED = FIXTURE_BACKLOG.filter((item) => item.frontmatter.status === "proposed");

/** Each fixture session's notes belong to one repo: the first session to workledger, the second to dashero. */
const NOTES_ALL: NoteAcrossRepos[] = NOTES.map((note) => ({
  ...note,
  repo: note.session === FIXTURE_SESSIONS[0]!.frontmatter.id ? WORKLEDGER : DASHERO,
}));

function filtered<T extends NoteRef>(notes: T[], q?: { type?: NoteRef["type"][]; open?: boolean }): T[] {
  return notes.filter((note) => (q?.type === undefined || q.type.includes(note.type)) && !(q?.open && note.resolved));
}

/**
 * The fixture machine with every note readable, writable per repo, and each `forRepo(id)` its own
 * source recording its writes under its id.
 */
function machine(over: { notes?: NoteRef[] } = {}) {
  const base = createSource("fixture");
  const notes = over.notes ?? NOTES;
  const writes: string[] = [];
  const scoped = new Map<string, LedgerSource>();
  const source = Object.assign(Object.create(base) as AppSource, {
    listNotes: (q?: { type?: NoteRef["type"][]; open?: boolean }) => Promise.resolve(filtered(notes, q)),
    listAllNotes: (q?: { type?: NoteRef["type"][]; open?: boolean }) =>
      Promise.resolve(filtered(NOTES_ALL.filter((note) => notes.includes(NOTES[NOTES_ALL.indexOf(note)]!)), q)),
    forRepo(id: string): LedgerSource {
      let found = scoped.get(id);
      if (found === undefined) {
        found = Object.assign(Object.create(source) as LedgerSource, {
          capabilities: { write: true, live: false, provenance: false },
          accept(itemId: string): Promise<BacklogView> {
            writes.push(`${id}:accept:${itemId}`);
            const item = FIXTURE_BACKLOG.find((entry) => entry.frontmatter.id === itemId)!;
            return Promise.resolve({ ...item, frontmatter: { ...item.frontmatter, status: "accepted" } });
          },
        });
        scoped.set(id, found);
      }
      return found;
    },
  });
  return { source, writes };
}

function renderAt(route: string, source: AppSource = machine().source) {
  window.location.hash = route;
  return render(<App source={source} />);
}

function wide(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === ASIDE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });

/** The tab's count, once the reads behind it are in. */
async function expectCount(name: string, count: number) {
  await waitFor(() => expect(tab(name).textContent).toBe(`${name} ${String(count)}`));
}

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("the view hash", () => {
  it("reads ?view= and falls back to all", () => {
    expect(reviewViewOf("#/review")).toBe("all");
    expect(reviewViewOf("#/review?view=decision")).toBe("decision");
    expect(reviewViewOf("#/r/abc/review?view=nonsense")).toBe("all");
    expect(withReviewView("#/r/abc/review?view=blocker", "question")).toBe("#/r/abc/review?view=question");
  });
});

describe("Review's toolbar, one repo", () => {
  it("renders the six views with counts from the ledger, All selected", async () => {
    renderAt(repoHref(WORKLEDGER.id, "review"));
    await screen.findByRole("tablist", { name: "Review views" });
    expect(screen.getAllByRole("tab").map((node) => node.textContent?.replace(/ \d+$/, ""))).toEqual([
      "All",
      "Blockers",
      "Questions",
      "Proposals",
      "Decisions",
      "Discoveries",
    ]);
    await expectCount("Blockers", 1);
    await expectCount("Questions", 1);
    await expectCount("Proposals", PROPOSED.length);
    await expectCount("Decisions", 1);
    await expectCount("Discoveries", 1);
    await expectCount("All", 2 + PROPOSED.length);
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
    expect(tab("All").className).toContain("bg-selected");
    // All is today's page: the answers, then the proposals and the rest of the backlog.
    expect(await screen.findByRole("heading", { name: "Waiting on an answer" })).toBeDefined();
    expect(await screen.findByRole("heading", { name: "Proposed by agents" })).toBeDefined();
  });

  it("filters the sections on a tab and writes ?view= without a history entry", async () => {
    renderAt(repoHref(WORKLEDGER.id, "review"));
    await screen.findByText(QUESTION.text);
    const before = window.history.length;

    fireEvent.click(tab("Blockers"));
    await waitFor(() => expect(window.location.hash).toBe(`${repoHref(WORKLEDGER.id, "review")}?view=blocker`));
    expect(window.history.length).toBe(before);
    const section = await screen.findByRole("region", { name: "Blockers" });
    expect(within(section).getByText("1 open")).toBeDefined();
    expect(within(section).getByText(BLOCKER.text)).toBeDefined();
    expect(screen.queryByText(QUESTION.text)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Proposed by agents" })).toBeNull();
    expect(tab("Blockers").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(tab("Proposals"));
    expect(await screen.findByRole("heading", { name: "Proposed by agents" })).toBeDefined();
    expect(screen.queryByText(BLOCKER.text)).toBeNull();
    // Only the proposed group: the accepted and in-progress items stay on All.
    expect(screen.queryByRole("heading", { name: "Accepted" })).toBeNull();
    expect(await screen.findByText(PROPOSED[0]!.frontmatter.title)).toBeDefined();
    // The keyboard still walks it.
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() =>
      expect(screen.getByRole("listitem", { name: PROPOSED[0]!.frontmatter.title }).hasAttribute("data-selected")).toBe(true),
    );
  });

  it("opens on the view the hash names, and moves along the tabs with the arrows", async () => {
    renderAt(`${repoHref(WORKLEDGER.id, "review")}?view=question`);
    const section = await screen.findByRole("region", { name: "Questions" });
    expect(await within(section).findByText(QUESTION.text)).toBeDefined();
    expect(tab("Questions").getAttribute("aria-selected")).toBe("true");
    expect(tab("Questions").tabIndex).toBe(0);
    expect(tab("All").tabIndex).toBe(-1);

    fireEvent.keyDown(tab("Questions"), { key: "ArrowRight" });
    await waitFor(() => expect(window.location.hash).toContain("?view=proposal"));
    expect(document.activeElement).toBe(tab("Proposals"));
  });

  it("shows decisions read-only: chip, text, reason, who, and no answer anywhere", async () => {
    wide();
    renderAt(`${repoHref(WORKLEDGER.id, "review")}?view=decision`);
    const section = await screen.findByRole("region", { name: "Decisions" });
    const list = await within(section).findByRole("list", { name: "Decisions, newest first" });
    const card = within(list).getByRole("listitem");
    expect(within(card).getByText("decision").className).toContain("bg-success");
    expect(within(card).getByText(DECISION.text)).toBeDefined();
    expect(within(card).getByText(DECISION.reason!)).toBeDefined();
    expect(within(card).getByText(`by ${DECISION.by!}`)).toBeDefined();
    await waitFor(() =>
      expect(within(card).getByText(`${DECISION.session.slice(0, 11)} · cp ${String(DECISION.cp)} · 8 Sep`)).toBeDefined(),
    );
    expect(within(section).getByText("1")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    expect(screen.queryByLabelText("Your answer")).toBeNull();
    expect(screen.queryByText(DISCOVERY.text)).toBeNull();

    fireEvent.click(tab("Discoveries"));
    const discoveries = await screen.findByRole("region", { name: "Discoveries" });
    const found = within(await within(discoveries).findByRole("list")).getByRole("listitem");
    expect(within(found).getByText("discovery").className).toContain("bg-muted");
    expect(within(found).getByText(DISCOVERY.text)).toBeDefined();
  });

  it("keeps the docked Selected module on Blockers and drops it on the history views", async () => {
    wide();
    renderAt(`${repoHref(WORKLEDGER.id, "review")}?view=blocker`);
    expect(await screen.findByRole("region", { name: BLOCKER.text })).toBeDefined();
    fireEvent.click(tab("Discoveries"));
    await screen.findByRole("region", { name: "Discoveries" });
    expect(screen.queryByRole("region", { name: BLOCKER.text })).toBeNull();
  });

  it("says so when there is nothing recorded", async () => {
    renderAt(`${repoHref(WORKLEDGER.id, "review")}?view=discovery`, machine({ notes: [BLOCKER] }).source);
    expect(await screen.findByText("No discoveries recorded yet.")).toBeDefined();
    fireEvent.click(tab("Decisions"));
    expect(await screen.findByText("No decisions recorded yet.")).toBeDefined();
  });
});

describe("Review's project filter", () => {
  it("moves between a repo's Review and every project's, keeping the view", async () => {
    renderAt(`${repoHref(WORKLEDGER.id, "review")}?view=decision`);
    const select = await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(WORKLEDGER.id));
    // Every repo, sorted by name, after All projects.
    expect([...(select as HTMLSelectElement).options].map((option) => option.textContent)).toEqual([
      "All projects",
      DASHERO.name,
      WORKLEDGER.name,
    ]);

    fireEvent.change(select, { target: { value: "" } });
    expect(window.location.hash).toBe("#/review?view=decision");
    await screen.findByText("Across every project on this machine");
    const machineSelect = screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
    expect(machineSelect.value).toBe("");
    expect(tab("Decisions").getAttribute("aria-selected")).toBe("true");

    fireEvent.change(machineSelect, { target: { value: DASHERO.id } });
    expect(window.location.hash).toBe(`${repoHref(DASHERO.id, "review")}?view=decision`);
  });
});

describe("Review across every project", () => {
  it("counts across projects and names the repo on a decision's foot", async () => {
    renderAt("#/review?view=decision");
    await expectCount("Proposals", PROPOSED.length * FIXTURE_REPOS.length);
    await expectCount("All", 2 + PROPOSED.length * FIXTURE_REPOS.length);
    const card = within(await screen.findByRole("list", { name: "Decisions, newest first" })).getByRole("listitem");
    expect(within(card).getByRole("link", { name: `${DASHERO.name} — Review` }).getAttribute("href")).toBe(
      repoHref(DASHERO.id, "review"),
    );
  });

  it("groups the proposals by repo, each accepting through its own repo", async () => {
    const live = machine();
    renderAt("#/review?view=proposal", live.source);
    expect(await screen.findByRole("heading", { name: "Proposed by agents" })).toBeDefined();
    const title = PROPOSED[0]!.frontmatter.title;
    const dashero = await screen.findByRole("region", { name: DASHERO.name });
    const workledger = screen.getByRole("region", { name: WORKLEDGER.name });
    // Sorted by name: dashero's group comes first.
    expect(dashero.compareDocumentPosition(workledger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(workledger).findByText(title)).toBeDefined();
    const card = await within(dashero).findByRole("listitem", { name: title });
    // The sub-group has no second "Proposed by agents" head of its own.
    expect(screen.getAllByRole("heading", { name: "Proposed by agents" })).toHaveLength(1);
    expect(within(card).getByRole("button", { name: "Discard" })).toBeDefined();

    fireEvent.click(within(card).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(live.writes).toEqual([`${DASHERO.id}:accept:${PROPOSED[0]!.frontmatter.id}`]));

    // No list takes the keyboard when several share the page.
    fireEvent.keyDown(window, { key: "j" });
    expect(document.querySelectorAll("li[data-selected]")).toHaveLength(0);
  });
});

describe("Review tabs — accessible names", () => {
  it("names each tab with its count separated by a space", async () => {
    window.location.hash = "#/review";
    render(<App source={createSource("fixture")} />);
    const tab = await screen.findByRole("tab", { name: /^All \d+$/ });
    expect(tab).toBeDefined();
    cleanup();
  });
});
