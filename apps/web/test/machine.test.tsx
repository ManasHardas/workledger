import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { FIXTURE_JOBS_ALL, FIXTURE_NOTES_ALL, FIXTURE_REPOS, FIXTURE_SESSIONS } from "../src/lib/fixtures.js";
import {
  createSource,
  type AppSource,
  type Identity,
  type Job,
  type LedgerEvent,
  type LedgerSource,
  type Repo,
} from "../src/lib/ledger-source.js";
import { ASIDE_QUERY } from "../src/lib/media.js";
import { repoHref } from "../src/lib/router.js";

const [WORKLEDGER, DASHERO] = FIXTURE_REPOS as [Repo, Repo];

interface Machine {
  source: AppSource;
  /** Every write, as `<repo id>:<method>:<arg>`, in order. */
  writes: string[];
  emit: (event: LedgerEvent) => void;
}

/**
 * A machine source whose `forRepo(id)` hands back a *distinct* scoped source per repo, each one
 * recording its writes under its own id — the thing the machine-wide tabs have to get right is
 * which repo a row's resolve or cancel goes to.
 */
function machine(overrides: Partial<AppSource> = {}, perRepo: (id: string) => Partial<LedgerSource> = () => ({})): Machine {
  const base = createSource("fixture");
  const handlers = new Set<(event: LedgerEvent) => void>();
  const writes: string[] = [];
  const scoped = new Map<string, LedgerSource>();

  const source = Object.assign(Object.create(base) as AppSource, {
    capabilities: { write: true, live: true, provenance: false },
    subscribe(handler: (event: LedgerEvent) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    forRepo(id: string): LedgerSource {
      let found = scoped.get(id);
      if (found === undefined) {
        found = Object.assign(Object.create(base) as LedgerSource, {
          capabilities: { write: true, live: true, provenance: false },
          resolveNote(ref: { session: string; cp: number; index: number }, decision: string) {
            writes.push(`${id}:resolveNote:${ref.session}/${String(ref.cp)}/${String(ref.index)}:${decision}`);
            return Promise.resolve(FIXTURE_SESSIONS[0]!);
          },
          cancelJob(jobId: string): Promise<Job> {
            writes.push(`${id}:cancelJob:${jobId}`);
            return Promise.resolve({ ...FIXTURE_JOBS_ALL[0]!, id: jobId, status: "cancelled" });
          },
          retryJob(jobId: string): Promise<Job> {
            writes.push(`${id}:retryJob:${jobId}`);
            return Promise.resolve({ ...FIXTURE_JOBS_ALL[0]!, id: jobId, status: "queued", attempts: 3 });
          },
          ...perRepo(id),
        });
        scoped.set(id, found);
      }
      return found;
    },
    ...overrides,
  });

  return { source, writes, emit: (event) => handlers.forEach((handler) => handler(event)) };
}

function renderAt(route: string, source: AppSource) {
  window.location.hash = route;
  return render(<App source={source} />);
}

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("Review, machine-wide", () => {
  it("lists every open note with its repo, linking to that repo’s own Review", async () => {
    renderAt("#/review", machine().source);
    await screen.findByRole("heading", { name: "Review", level: 1 });
    expect(screen.getByText("Across every project on this machine")).toBeDefined();
    for (const note of FIXTURE_NOTES_ALL) {
      expect(await screen.findByText(note.text)).toBeDefined();
    }
    // Every project's proposals follow the answers, grouped by repo (operator, 2026-09-13).
    expect(await screen.findByRole("heading", { name: "Proposed by agents" })).toBeDefined();
    expect(await screen.findByRole("region", { name: WORKLEDGER.name })).toBeDefined();
    const first = screen.getByRole("link", { name: `${WORKLEDGER.name} — Review` });
    expect(first.getAttribute("href")).toBe(repoHref(WORKLEDGER.id, "review"));
    expect(screen.getByRole("link", { name: `${DASHERO.name} — Review` }).getAttribute("href")).toBe(
      repoHref(DASHERO.id, "review"),
    );
  });

  it("resolves a row through the source of the row's repo", async () => {
    const live = machine();
    renderAt("#/review", live.source);
    const dashero = FIXTURE_NOTES_ALL.find((note) => note.repo.id === DASHERO.id)!;

    // The row's text opens the panel; the decision is written there (#134, rule 3).
    fireEvent.click(await screen.findByRole("button", { name: dashero.text }));
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByLabelText("Your answer"), { target: { value: "Merge it first." } });
    fireEvent.click(within(panel).getByRole("button", { name: "Answer" }));

    await waitFor(() => expect(live.writes).toHaveLength(1));
    expect(live.writes[0]).toBe(
      `${DASHERO.id}:resolveNote:${dashero.session}/${String(dashero.cp)}/${String(dashero.index)}:Merge it first.`,
    );
  });

  it("appends the repo to each card's foot, and resolves the docked Selected note through its repo", async () => {
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
    const live = machine();
    renderAt("#/review", live.source);
    const dashero = FIXTURE_NOTES_ALL.find((note) => note.repo.id === DASHERO.id)!;
    const list = await screen.findByRole("list", { name: "Open questions and blockers" });
    const card = within(list)
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText(dashero.text) !== null)!;
    const link = within(card).getByRole("link", { name: `${DASHERO.name} — Review` });
    // The checkpoint date arrives with the session read, a tick after the list.
    await waitFor(() =>
      expect(link.closest("p")!.textContent).toMatch(
        new RegExp(`^${dashero.session.slice(0, 11)} · cp ${String(dashero.cp)} · .+ · ${DASHERO.name}$`),
      ),
    );

    fireEvent.click(within(card).getByRole("button", { name: "Answer" }));
    const module = await screen.findByRole("region", { name: dashero.text });
    fireEvent.change(within(module).getByLabelText("Your answer"), { target: { value: "Merge it first." } });
    fireEvent.click(within(module).getByRole("button", { name: "Answer" }));
    await waitFor(() =>
      expect(live.writes).toEqual([
        `${DASHERO.id}:resolveNote:${dashero.session}/${String(dashero.cp)}/${String(dashero.index)}:Merge it first.`,
      ]),
    );
  });

  it("names authors from each repo's own identities file", async () => {
    const email = FIXTURE_SESSIONS[0]!.frontmatter.author.email;
    const names: Record<string, Identity[]> = {
      [WORKLEDGER.id]: [{ email, name: "Ada Lovelace", dome_user: null }],
      [DASHERO.id]: [{ email, name: "Grace Hopper", dome_user: null }],
    };
    renderAt("#/review", machine({}, (id) => ({ listIdentities: () => Promise.resolve(names[id] ?? []) })).source);

    // One panel at a time, so each repo's mapping is checked against its own row.
    const shown: string[] = [];
    for (const note of FIXTURE_NOTES_ALL) {
      fireEvent.click(await screen.findByRole("button", { name: note.text }));
      const panel = await screen.findByRole("dialog");
      await waitFor(() => expect(within(panel).getByTitle(email)).toBeDefined());
      shown.push(within(panel).getByTitle(email).textContent ?? "");
    }
    expect(shown.sort()).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("re-reads on notes.changed from any repo, and shows the empty state", async () => {
    let notes = FIXTURE_NOTES_ALL;
    const live = machine({ listAllNotes: () => Promise.resolve(notes) });
    renderAt("#/review", live.source);
    expect(await screen.findByText(FIXTURE_NOTES_ALL[0]!.text)).toBeDefined();

    notes = [];
    live.emit({ type: "notes.changed", repo: DASHERO.id });
    expect(await screen.findByText(/Nothing is waiting on you in any project/)).toBeDefined();
  });
});

describe("Jobs, machine-wide", () => {
  it("lists every repo's jobs with the repo per row and no scan or backfill controls", async () => {
    renderAt("#/jobs", machine().source);
    await screen.findByRole("heading", { name: "Jobs", level: 1 });
    const rows = within(await screen.findByRole("list", { name: "Finished, newest first" })).getAllByRole("listitem");
    expect(rows).toHaveLength(FIXTURE_JOBS_ALL.length);
    const row = rows[0]!;
    expect(within(row).getByText("failed")).toBeDefined();
    expect(within(row).getByRole("link", { name: `${DASHERO.name} — Jobs` }).getAttribute("href")).toBe(
      repoHref(DASHERO.id, "jobs"),
    );
    // The session link lives under the row's repo, not under whatever repo the shell shows — and
    // it is in the panel now, where the rest of the job's evidence is (#134, rule 3).
    fireEvent.click(within(row).getByRole("button", { name: FIXTURE_JOBS_ALL[0]!.session_ulid }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("link", { name: FIXTURE_JOBS_ALL[0]!.session_ulid }).getAttribute("href")).toBe(
      repoHref(DASHERO.id, "session", FIXTURE_JOBS_ALL[0]!.session_ulid),
    );
    expect(screen.queryByRole("button", { name: "Scan now" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Backfill/ })).toBeNull();
  });

  it("retries a row through the source of the row's repo and reconciles the row", async () => {
    const live = machine();
    renderAt("#/jobs", live.source);
    const row = within(await screen.findByRole("list", { name: "Finished, newest first" })).getAllByRole("listitem")[0]!;

    fireEvent.click(within(row).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(live.writes).toEqual([`${DASHERO.id}:retryJob:${FIXTURE_JOBS_ALL[0]!.id}`]));
    // Retried, it is queued again — in flight, not finished.
    const flying = await screen.findByRole("list", { name: "In flight, running first" });
    const [retried] = within(flying).getAllByRole("listitem");
    expect(within(retried!).getByText("queued")).toBeDefined();
    // The repo column survives the reconcile: the answer was a bare `Job`, the row keeps its repo.
    expect(within(retried!).getByRole("link", { name: `${DASHERO.name} — Jobs` })).toBeDefined();
  });

  it("filters by status on the client and re-reads on job.changed", async () => {
    let jobs = FIXTURE_JOBS_ALL;
    const live = machine({ listAllJobs: () => Promise.resolve(jobs) });
    renderAt("#/jobs", live.source);
    await screen.findByRole("list", { name: "Finished, newest first" });

    fireEvent.click(screen.getByRole("tab", { name: /^In flight/ }));
    expect(await screen.findByText("Nothing in flight in any project.")).toBeDefined();

    jobs = [{ ...FIXTURE_JOBS_ALL[0]!, id: "01JBQ7FIXTUREJOB000000002", status: "queued", repo: WORKLEDGER }];
    live.emit({ type: "job.changed", id: "01JBQ7FIXTUREJOB000000002", status: "queued", repo: WORKLEDGER.id });
    const list = await screen.findByRole("list", { name: "Jobs, newest first" });
    expect(within(list).getByRole("link", { name: `${WORKLEDGER.name} — Jobs` })).toBeDefined();
  });
});
