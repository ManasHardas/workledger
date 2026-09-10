import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app.js";
import { formatRelative } from "../src/features/home/format.js";
import { REPOS_REFRESH_MS } from "../src/features/home/live.js";
import { FIXTURE_REPOS } from "../src/lib/fixtures.js";
import { createSource, type AppSource, type LedgerEvent, type Repo } from "../src/lib/ledger-source.js";
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

  it("shows the empty state, still pointing at the wizard, when nothing is tracked", async () => {
    renderHome(machine(() => []).source);
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
});
