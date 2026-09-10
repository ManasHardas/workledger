import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app.js";
import { resetEmptyMachineRedirect } from "../src/features/onboarding/index.js";
import { formatRelative } from "../src/features/home/format.js";
import { REPOS_REFRESH_MS, announceReposChanged } from "../src/features/home/live.js";
import { FIXTURE_REPOS, FIXTURE_WORKSPACES } from "../src/lib/fixtures.js";
import { createSource, type AppSource, type InitInput, type InitResult, type LedgerEvent, type Repo, type Workspace } from "../src/lib/ledger-source.js";
import { repoHref } from "../src/lib/router.js";

const [WORKLEDGER, DASHERO] = FIXTURE_REPOS as [Repo, Repo];

/** `Date.now()` for the relative times: an hour after the first fixture repo's last hook. */
const NOW = Date.parse(WORKLEDGER.lastHookAt!) + 60 * 60_000;

interface Machine {
  source: AppSource;
  emit: (event: LedgerEvent) => void;
  reads: number;
}

/** The fixture source with a controllable repo list and a live stream the test drives. */
function machine(repos: () => Repo[]): Machine {
  const base = createSource("fixture");
  const handlers = new Set<(event: LedgerEvent) => void>();
  const state: Machine = {
    reads: 0,
    emit: (event) => handlers.forEach((handler) => handler(event)),
    source: Object.assign(Object.create(base) as AppSource, {
      capabilities: { write: false, live: true, provenance: false },
      listRepos() {
        state.reads += 1;
        return Promise.resolve(repos());
      },
      subscribe(handler: (event: LedgerEvent) => void) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    }),
  };
  return state;
}

function renderHome(source: AppSource = createSource("fixture")) {
  window.location.hash = "#/";
  return render(<App source={source} />);
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("relative time", () => {
  it("rounds down to the largest unit that fits, and never says a negative", () => {
    const now = Date.parse("2026-09-09T12:00:00Z");
    expect(formatRelative(null, now)).toBe("never");
    expect(formatRelative("2026-09-09T11:59:30Z", now)).toBe("just now");
    expect(formatRelative("2026-09-09T12:00:30Z", now)).toBe("just now");
    expect(formatRelative("2026-09-09T11:15:00Z", now)).toBe("45 min ago");
    expect(formatRelative("2026-09-09T09:10:00Z", now)).toBe("2 h ago");
    expect(formatRelative("2026-09-01T12:00:00Z", now)).toBe("8 d ago");
    expect(formatRelative("not a date", now)).toBe("not a date");
  });
});

/**
 * Amendment 11's second group: the folders `GET /api/workspaces` reports. A fixture source answers
 * `FIXTURE_WORKSPACES`; these override it where the case needs a different machine.
 */
function withWorkspaces(list: Workspace[], init?: (input: InitInput) => Promise<InitResult>): AppSource {
  const base = createSource("fixture");
  return Object.assign(Object.create(base) as AppSource, {
    workspaces: () => Promise.resolve(list),
    ...(init === undefined ? {} : { initRepos: init }),
  });
}

describe("Home — folders with sessions (amendment 11)", () => {
  const [DOME, NOTES, HARD_TALKS] = FIXTURE_WORKSPACES as [Workspace, Workspace, Workspace];

  it("shows the projects first and the non-repo folders in a second group below", async () => {
    renderHome();
    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["Projects", "Folders with sessions"]);

    const folders = screen.getByRole("list", { name: "Folders with sessions" });
    const cards = within(folders).getAllByRole("listitem");
    expect(cards).toHaveLength(FIXTURE_WORKSPACES.length);
    // No folder pretends to be a project: none of these cards is a link into a ledger.
    expect(within(folders).queryAllByRole("link")).toEqual([]);

    // A folder with transcripts and no repo under it is still listed — that is the operator's
    // rule ("simply because transcripts are found in a folder doesn't mean that folder is a
    // repo"): it belongs here, never in Projects.
    expect(cards[1]!.textContent).toContain(NOTES.path);
    expect(within(cards[1]!).getByText("tracked repos").nextElementSibling?.textContent).toBe("0");
    expect(within(screen.getByRole("list", { name: "Projects" })).queryByText(NOTES.path)).toBeNull();
  });

  it("states each folder's hooks, sessions and last session", async () => {
    renderHome();
    const folders = await screen.findByRole("list", { name: "Folders with sessions" });
    const first = within(folders).getAllByRole("listitem")[0]!;

    expect(first.textContent).toContain(DOME.name);
    expect(first.textContent).toContain(DOME.path);
    expect(within(first).getByText("no hooks")).toBeDefined();
    expect(within(first).getByText("sessions").nextElementSibling?.textContent).toBe(String(DOME.sessions));
    expect(within(first).getByText("tracked repos").nextElementSibling?.textContent).toBe("2");
    expect(within(first).getByText("last session").nextElementSibling?.textContent).toBe(
      formatRelative(DOME.lastSessionAt, NOW),
    );

    const hooked = within(folders).getAllByRole("listitem")[2]!;
    expect(hooked.textContent).toContain(HARD_TALKS.name);
    expect(within(hooked).getByText("hooks installed")).toBeDefined();
    expect(within(hooked).getByText("registered")).toBeDefined();
    expect(within(hooked).queryByRole("button", { name: "Install hooks" })).toBeNull();
    expect(within(hooked).getByText("last session").nextElementSibling?.textContent).toBe("never");
  });

  it("installs hooks with POST /api/onboarding/init carrying the folder and no repo, then re-reads", async () => {
    const inits: InitInput[] = [];
    let hooked = false;
    const source = Object.assign(Object.create(createSource("fixture")) as AppSource, {
      workspaces: () => Promise.resolve([{ ...DOME, hooksInstalled: hooked }]),
      initRepos: (input: InitInput) => {
        inits.push(input);
        hooked = true;
        return Promise.resolve({ results: [], workspaces: [{ path: DOME.path, ok: true, hooksWritten: [".claude/settings.json"], trustSteps: [] }] });
      },
    });
    renderHome(source);

    const button = await screen.findByRole("button", { name: "Install hooks" });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(inits).toEqual([{ repos: [], workspaces: [DOME.path] }]);
    // The re-read replaces the action with the installed badge; nothing needs a reload.
    expect(await screen.findByText("hooks installed")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Install hooks" })).toBeNull();
  });

  it("reports an init that answered 200 with ok:false, and keeps the button actionable (#119 review)", async () => {
    // `init` is a per-path batch: the request succeeds and each row carries its own verdict. A
    // folder with no tracked repo under it — which this group lists on purpose — is refused
    // exactly that way, so reading only the promise would make the click a silent no-op.
    const source = withWorkspaces([NOTES], () =>
      Promise.resolve({
        results: [],
        workspaces: [{ path: NOTES.path, ok: false, hooksWritten: [], trustSteps: [], error: `${NOTES.path} holds no tracked repo` }],
      }),
    );
    renderHome(source);
    const button = await screen.findByRole("button", { name: "Install hooks" });

    await act(async () => {
      fireEvent.click(button);
    });

    expect((await screen.findByRole("alert")).textContent).toContain("holds no tracked repo");
    // Still "no hooks", and still clickable: the operator can add a repo under the folder and retry.
    expect(screen.getByText("no hooks")).toBeDefined();
    const retry = screen.getByRole("button", { name: "Install hooks" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports an init that said nothing at all about the folder", async () => {
    const source = withWorkspaces([NOTES], () => Promise.resolve({ results: [] }));
    renderHome(source);
    const button = await screen.findByRole("button", { name: "Install hooks" });

    await act(async () => {
      fireEvent.click(button);
    });

    expect((await screen.findByRole("alert")).textContent).toContain("reported nothing for this folder");
    expect(screen.getByRole("button", { name: "Install hooks" })).toBeDefined();
  });

  it("reports a failed install beside the folder and leaves the rest of Home alone", async () => {
    const source = withWorkspaces([DOME], () => Promise.reject(new Error("hook file is read-only")));
    renderHome(source);
    const button = await screen.findByRole("button", { name: "Install hooks" });

    await act(async () => {
      fireEvent.click(button);
    });

    expect((await screen.findByRole("alert")).textContent).toContain("hook file is read-only");
    expect(screen.getByRole("list", { name: "Projects" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Install hooks" })).toBeDefined();
  });

  it("drops the whole group on a machine whose sessions all start inside repos", async () => {
    renderHome(withWorkspaces([]));
    await screen.findByRole("list", { name: "Projects" });
    expect(screen.queryByRole("heading", { name: "Folders with sessions" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Folders with sessions" })).toBeNull();
  });

  it("reports a folder read that failed rather than hiding the group", async () => {
    const broken = Object.assign(Object.create(createSource("fixture")) as AppSource, {
      workspaces: () => Promise.reject(new Error("index is locked")),
    });
    renderHome(broken);
    await screen.findByRole("heading", { name: "Folders with sessions" });
    expect((await screen.findByRole("alert")).textContent).toContain("index is locked");
  });

  it("renders Home against a source from before amendment 12 with no folder group", async () => {
    const older = Object.assign(Object.create(createSource("fixture")) as AppSource, { workspaces: undefined });
    renderHome(older);
    await screen.findByRole("list", { name: "Projects" });
    expect(screen.queryByRole("heading", { name: "Folders with sessions" })).toBeNull();
  });
});

describe("Home", () => {
  it("renders one card per repo with its counts, health and a link into its Ledger", async () => {
    renderHome();
    await screen.findByRole("heading", { name: "Projects", level: 2 });

    const list = await screen.findByRole("list", { name: "Projects" });
    const cards = within(list).getAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(
      FIXTURE_REPOS.map((repo) => repoHref(repo.id, "ledger")),
    );

    const first = within(list).getByRole("link", { name: WORKLEDGER.name });
    expect(within(first).getByText(WORKLEDGER.path)).toBeDefined();
    expect(within(first).getByText("ok")).toBeDefined();
    expect(within(first).getByText("sessions · 7d").nextElementSibling?.textContent).toBe("3");
    expect(within(first).getByText("open backlog").nextElementSibling?.textContent).toBe("4");
    expect(within(first).getByText("open notes").nextElementSibling?.textContent).toBe("2");
    expect(within(first).getByText("last hook").nextElementSibling?.textContent).toBe("1 h ago");
    expect(within(first).getByText("claude-code")).toBeDefined();

    const second = within(list).getByRole("link", { name: DASHERO.name });
    expect(within(second).getByText("warn")).toBeDefined();
    expect(within(second).getByText("last hook").nextElementSibling?.textContent).toBe("never");
    expect(within(second).getByText("codex")).toBeDefined();
  });

  it("links to the wizard and to the machine-wide tabs", async () => {
    renderHome();
    await screen.findByRole("list", { name: "Projects" });
    expect(screen.getByRole("link", { name: "Add projects" }).getAttribute("href")).toBe("#/onboarding");
    const across = screen.getByRole("navigation", { name: "Across projects" });
    expect(within(across).getByRole("link", { name: "Needs you" }).getAttribute("href")).toBe("#/needs");
    expect(within(across).getByRole("link", { name: "Jobs" }).getAttribute("href")).toBe("#/jobs");
  });

  it("sends a first visit with nothing tracked to the wizard, and shows the empty state after that", async () => {
    resetEmptyMachineRedirect();
    const empty = machine(() => []).source;
    const first = renderHome(empty);
    await waitFor(() => expect(window.location.hash).toBe("#/onboarding"));
    first.unmount();

    // Coming back to Home on purpose (the wizard's own Home link) is not bounced again.
    renderHome(empty);
    expect(await screen.findByText(/No projects are tracked yet/)).toBeDefined();
    expect(screen.queryByRole("list", { name: "Projects" })).toBeNull();
    const links = screen.getAllByRole("link", { name: "Add projects" });
    expect(links.length).toBe(2);
    expect(links.every((link) => link.getAttribute("href") === "#/onboarding")).toBe(true);
  });

  it("reports a source that cannot list repos", async () => {
    const broken = Object.assign(Object.create(createSource("fixture")) as AppSource, {
      listRepos: () => Promise.reject(new Error("daemon is down")),
    });
    renderHome(broken);
    expect((await screen.findByRole("alert")).textContent).toContain("daemon is down");
  });

  it("re-reads the counts on an event for a repo, coalescing a burst into one read", async () => {
    vi.useFakeTimers();
    let sessions7d = 3;
    const live = machine(() => [{ ...WORKLEDGER, sessions7d }, DASHERO]);
    renderHome(live.source);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const list = screen.getByRole("list", { name: "Projects" });
    const card = () => within(list).getByRole("link", { name: WORKLEDGER.name });
    expect(within(card()).getByText("sessions · 7d").nextElementSibling?.textContent).toBe("3");
    expect(live.reads).toBe(1);

    sessions7d = 4;
    await act(async () => {
      // One checkpoint lands as several frames; the list is read once for all of them.
      live.emit({ type: "session.changed", ulid: "01ULID", repo: WORKLEDGER.id });
      live.emit({ type: "backlog.changed", id: "WL-1", repo: WORKLEDGER.id });
      live.emit({ type: "notes.changed", repo: WORKLEDGER.id });
      await vi.advanceTimersByTimeAsync(REPOS_REFRESH_MS + 1);
      // The re-read's promise settles a microtask after the timer fires.
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(live.reads).toBe(2);
    expect(within(card()).getByText("sessions · 7d").nextElementSibling?.textContent).toBe("4");
    vi.useRealTimers();
  });

  it("adds a card on repos.changed, and on the wizard's in-tab announcement (#94)", async () => {
    vi.useFakeTimers();
    let repos: Repo[] = [WORKLEDGER];
    const live = machine(() => repos);
    renderHome(live.source);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const list = () => screen.getByRole("list", { name: "Projects" });
    expect(within(list()).queryByRole("link", { name: DASHERO.name })).toBeNull();
    expect(live.reads).toBe(1);

    // The daemon's frame for a repo `init` just enabled: the new card appears without a reload.
    repos = [WORKLEDGER, DASHERO];
    await act(async () => {
      live.emit({ type: "repos.changed", repo: DASHERO.id });
      await vi.advanceTimersByTimeAsync(REPOS_REFRESH_MS + 1);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(live.reads).toBe(2);
    expect(within(list()).getByRole("link", { name: DASHERO.name })).toBeDefined();

    // The wizard's belt-and-braces refresh from inside the tab schedules the same read.
    await act(async () => {
      announceReposChanged();
      await vi.advanceTimersByTimeAsync(REPOS_REFRESH_MS + 1);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(live.reads).toBe(3);
    vi.useRealTimers();
  });
});
