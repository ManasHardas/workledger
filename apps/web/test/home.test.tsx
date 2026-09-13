import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app.js";
import { resetEmptyMachineRedirect } from "../src/features/onboarding/index.js";
import { formatAgo, formatRelative } from "../src/features/home/format.js";
import { showMoreLabel, splitByWeek } from "../src/features/home/home-view.js";
import { homePath } from "../src/features/home/repo-card.js";
import { ASIDE_QUERY } from "../src/lib/media.js";
import { REPOS_REFRESH_MS, announceReposChanged } from "../src/features/home/live.js";
import { FIXTURE_JOBS_ALL, FIXTURE_REPOS, FIXTURE_WORKSPACES } from "../src/lib/fixtures.js";
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

  it("puts the status groups first and the non-repo folders in a group below", async () => {
    renderHome();
    // The frame's groups first (P9, Home frame `11:2`), then the groups it leaves out, below.
    const title = await screen.findByRole("heading", { level: 1 });
    expect(title.textContent).toBe("Home");
    await screen.findByRole("list", { name: "Folders with sessions" });
    const main = within(screen.getByRole("main"));
    expect(main.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Active this week",
      "Quiet",
    ]);
    expect(main.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Running",
      "Folders with sessions",
    ]);

    const folders = screen.getByRole("list", { name: "Folders with sessions" });
    const rows = within(folders).getAllByRole("listitem");
    expect(rows).toHaveLength(FIXTURE_WORKSPACES.length);
    // No folder pretends to be a project: none of these rows is a link into a ledger.
    expect(within(folders).queryAllByRole("link")).toEqual([]);

    // A folder with transcripts and no repo under it is still listed — that is the operator's
    // rule ("simply because transcripts are found in a folder doesn't mean that folder is a
    // repo"): it belongs here, never in Projects.
    expect(rows[1]!.textContent).toContain(NOTES.path);
    expect(within(rows[1]!).getByText("0 tracked repos")).toBeDefined();
    expect(within(screen.getByRole("list", { name: "Active this week" })).queryByText(NOTES.path)).toBeNull();
  });

  it("states each folder's hooks, sessions and last session", async () => {
    renderHome();
    const folders = await screen.findByRole("list", { name: "Folders with sessions" });
    const first = within(folders).getAllByRole("listitem")[0]!;

    expect(first.textContent).toContain(DOME.name);
    expect(first.textContent).toContain(DOME.path);
    expect(within(first).getByText("no hooks")).toBeDefined();
    expect(within(first).getByText(`${String(DOME.sessions)} sessions`)).toBeDefined();
    expect(within(first).getByText("2 tracked repos")).toBeDefined();
    expect(within(first).getByText(formatAgo(DOME.lastSessionAt, NOW))).toBeDefined();

    const hooked = within(folders).getAllByRole("listitem")[2]!;
    expect(hooked.textContent).toContain(HARD_TALKS.name);
    expect(within(hooked).getByText("hooks")).toBeDefined();
    expect(within(hooked).queryByRole("button", { name: "Install hooks" })).toBeNull();
    expect(within(hooked).getByText("never")).toBeDefined();
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
    // The re-read replaces the action with the installed chip; nothing needs a reload.
    expect(await screen.findByText("hooks")).toBeDefined();
    expect(screen.queryByText("no hooks")).toBeNull();
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
    expect(screen.getByRole("list", { name: "Active this week" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Install hooks" })).toBeDefined();
  });

  it("drops the whole group on a machine whose sessions all start inside repos", async () => {
    renderHome(withWorkspaces([]));
    await screen.findByRole("list", { name: "Active this week" });
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
    await screen.findByRole("list", { name: "Active this week" });
    expect(screen.queryByRole("heading", { name: "Folders with sessions" })).toBeNull();
  });
});

/** Stubs `matchMedia` so the right column exists (1280 px and up): the docked, selecting form. */
function docked(): void {
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

describe("Home", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("heads the page with the machine's totals", async () => {
    renderHome();
    await screen.findByRole("list", { name: "Active this week" });
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("Home");
    // Two projects, three sessions this week, and the open blockers and questions of both.
    expect(header.textContent).toContain("2 projects · 3 sessions this week · 3 waiting on you");
  });

  it("splits the projects into active this week and quiet, most recent first", async () => {
    renderHome();
    const active = await screen.findByRole("list", { name: "Active this week" });
    expect(within(active).getAllByRole("listitem").map((row) => row.getAttribute("aria-label"))).toEqual([
      WORKLEDGER.name,
    ]);
    const quiet = screen.getByRole("list", { name: "Quiet" });
    expect(within(quiet).getAllByRole("listitem").map((row) => row.getAttribute("aria-label"))).toEqual([
      DASHERO.name,
    ]);
    expect(within(screen.getByRole("main")).getByText("1 of 2")).toBeDefined();
    expect(within(screen.getByRole("main")).getByText("1 project · nothing this week")).toBeDefined();

    const splits = splitByWeek([DASHERO, { ...DASHERO, id: "x", name: "late", lastHookAt: "2026-09-10T00:00:00Z" }, WORKLEDGER]);
    expect(splits.active.map((repo) => repo.name)).toEqual(["workledger"]);
    // Never-run projects sort after every project that has run.
    expect(splits.quiet.map((repo) => repo.name)).toEqual(["late", "dashero"]);
  });

  it("carries the frame's card: name, home-relative path, three stats and when it last ran", async () => {
    renderHome();
    const active = await screen.findByRole("list", { name: "Active this week" });
    const card = within(active).getByRole("listitem", { name: WORKLEDGER.name });
    // Without the right column there is nowhere to show a selection, so the card opens the Ledger.
    const link = within(card).getByRole("link");
    expect(link.getAttribute("href")).toBe(repoHref(WORKLEDGER.id, "ledger"));
    expect(link.getAttribute("aria-label")).toBe("workledger — 3 sessions this week, 4 open, 2 need you");
    expect(within(card).getByText("~/Projects/workledger")).toBeDefined();
    expect(within(card).getByText("sessions")).toBeDefined();
    expect(within(card).getByText("need you")).toBeDefined();
    expect(within(card).getByText("1 hour ago")).toBeDefined();

    const quiet = screen.getByRole("list", { name: "Quiet" });
    const row = within(quiet).getByRole("listitem", { name: DASHERO.name });
    expect(row.textContent).toContain("1 open");
    expect(row.textContent).toContain("1 need you");
    expect(row.textContent).toContain("never");

    expect(homePath("/Users/someone/Projects/x")).toBe("~/Projects/x");
    expect(homePath("/home/someone")).toBe("~");
    expect(homePath("/srv/repos/x")).toBe("/srv/repos/x");
  });

  it("shows three quiet projects, then names a never-run one in the way to the rest", () => {
    const hidden = [
      { ...DASHERO, id: "a", name: "alpha", lastHookAt: "2026-09-01T00:00:00Z" },
      { ...DASHERO, id: "b", name: "splitfire", lastHookAt: null },
    ];
    expect(showMoreLabel(hidden)).toBe("Show 2 more, including splitfire, which has never run");
    expect(showMoreLabel(hidden.slice(0, 1))).toBe("Show 1 more");
  });

  it("flags a tracked folder that holds other projects, with the frame’s headline only while it is true", async () => {
    const folder: Repo = { ...WORKLEDGER, id: "folder", name: "Projects", path: "/Users/manas/Projects", openBacklog: 9, openNotes: 5 };
    renderHome(machine(() => [folder, WORKLEDGER, DASHERO]).source);
    const flag = await screen.findByRole("note");
    expect(within(flag).getByText("check this")).toBeDefined();
    expect(flag.textContent).toContain(
      "Projects holds 9 open items and 5 questions — more than every real project combined",
    );
    cleanup();

    // Holding less than the projects under it, it is still a folder, but the headline would be
    // false, so the flag states the counts alone.
    renderHome(machine(() => [{ ...folder, openBacklog: 2 }, WORKLEDGER, DASHERO]).source);
    const plain = await screen.findByRole("note");
    expect(within(plain).getByText("Projects holds 2 open items and 5 questions")).toBeDefined();
    cleanup();

    // No folder among the tracked repos: no flag.
    renderHome(machine(() => [WORKLEDGER, DASHERO]).source);
    await screen.findByRole("list", { name: "Active this week" });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("selects a project into the right column when there is one, and opens it from there", async () => {
    docked();
    renderHome();
    const module = await screen.findByRole("region", { name: `Selected project: ${WORKLEDGER.name}` });
    expect(within(module).getByText("ok")).toBeDefined();
    expect(within(module).getByText("claude-code")).toBeDefined();
    expect(within(module).getByText("Last activity")).toBeDefined();
    await waitFor(() => expect(module.textContent).toContain("3 sessions · "));
    expect(module.textContent).toContain("2 answers");
    expect(within(module).getByRole("link", { name: "Open the ledger" }).getAttribute("href")).toBe(
      repoHref(WORKLEDGER.id, "ledger"),
    );

    const card = within(screen.getByRole("list", { name: "Active this week" })).getByRole("button");
    expect(card.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(screen.getByRole("list", { name: "Quiet" })).getByRole("button"));
    expect(await screen.findByRole("region", { name: `Selected project: ${DASHERO.name}` })).toBeDefined();

    // `j`/`k` walk the same order the page shows: active, then quiet.
    fireEvent.keyDown(window, { key: "k" });
    expect(await screen.findByRole("region", { name: `Selected project: ${WORKLEDGER.name}` })).toBeDefined();
  });

  it("links the wizard and the recovery queue from the groups below the frame", async () => {
    renderHome();
    await screen.findByRole("list", { name: "Active this week" });
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Add projects" }).getAttribute("href")).toBe("#/onboarding");
    expect(
      main.getByRole("link", { name: /jobs running, queued or failed — Jobs$/ }).getAttribute("href"),
    ).toBe("#/jobs");
  });

  /**
   * #138, rule 4: a group whose list is already on the page carries a count that links to the list
   * beneath it, which it moves focus to.
   */
  it("makes the «Folders with sessions» count a link to the list it counts", async () => {
    renderHome();
    const list = await screen.findByRole("list", { name: "Folders with sessions" });
    const main = within(screen.getByRole("main"));
    const count = main.getByRole("link", { name: /— Folders with sessions$/ });
    expect(count.textContent).toBe(String(within(list).getAllByRole("listitem").length));
    fireEvent.click(count);
    expect(document.activeElement).toBe(list.parentElement);
  });

  it("counts the failed rows the Running group shows beneath it", async () => {
    renderHome();
    const running = await screen.findByRole("list", { name: "Running" });
    const rows = within(running).getAllByRole("listitem");
    // The fixture queue is one failed repair and nothing live — the case the count used to miss.
    expect(rows).toHaveLength(FIXTURE_JOBS_ALL.length);
    const count = within(screen.getByRole("main")).getByRole("link", {
      name: /running, queued or failed — Jobs$/,
    });
    expect(count.textContent).toBe(String(rows.length));
  });

  it("shows what is running and what failed, across projects", async () => {
    renderHome();
    const running = await screen.findByRole("list", { name: "Running" });
    const job = FIXTURE_JOBS_ALL[0]!;
    expect(within(running).getByText("failed")).toBeDefined();
    expect(within(running).getByRole("link", { name: job.session_ulid }).getAttribute("href")).toBe(
      repoHref(job.repo.id, "jobs"),
    );
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
    expect(screen.queryByRole("list", { name: "Active this week" })).toBeNull();
    const links = within(screen.getByRole("main")).getAllByRole("link", { name: "Add projects" });
    expect(links.length).toBe(1);
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
    const list = screen.getByRole("list", { name: "Active this week" });
    const sessions = (n: number) =>
      within(list).getByRole("link", {
        name: `${WORKLEDGER.name} — ${String(n)} sessions this week, 4 open, 2 need you`,
      });
    expect(sessions(3)).toBeDefined();
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
    expect(sessions(4)).toBeDefined();
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
    const list = () => screen.getByRole("list", { name: "Quiet" });
    expect(screen.queryByRole("list", { name: "Quiet" })).toBeNull();
    expect(live.reads).toBe(1);

    // The daemon's frame for a repo `init` just enabled: the new card appears without a reload.
    repos = [WORKLEDGER, DASHERO];
    await act(async () => {
      live.emit({ type: "repos.changed", repo: DASHERO.id });
      await vi.advanceTimersByTimeAsync(REPOS_REFRESH_MS + 1);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(live.reads).toBe(2);
    expect(within(list()).getByRole("listitem", { name: DASHERO.name })).toBeDefined();

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
