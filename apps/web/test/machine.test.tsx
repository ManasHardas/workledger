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

afterEach(cleanup);

describe("Needs you, machine-wide", () => {
  it("lists every open note with its repo, linking to that repo's own Needs you", async () => {
    renderAt("#/needs", machine().source);
    await screen.findByRole("heading", { name: "Needs you", level: 2 });
    for (const note of FIXTURE_NOTES_ALL) {
      expect(await screen.findByText(note.text)).toBeDefined();
    }
    const first = screen.getByRole("link", { name: `${WORKLEDGER.name} — Needs you` });
    expect(first.getAttribute("href")).toBe(repoHref(WORKLEDGER.id, "needs"));
    expect(screen.getByRole("link", { name: `${DASHERO.name} — Needs you` }).getAttribute("href")).toBe(
      repoHref(DASHERO.id, "needs"),
    );
  });

  it("resolves a row through the source of the row's repo", async () => {
    const live = machine();
    renderAt("#/needs", live.source);
    const dashero = FIXTURE_NOTES_ALL.find((note) => note.repo.id === DASHERO.id)!;
    const card = (await screen.findByText(dashero.text)).closest("li")!;

    fireEvent.click(within(card).getByRole("button", { name: "Resolve" }));
    fireEvent.change(within(card).getByLabelText("Your decision"), { target: { value: "Merge it first." } });
    fireEvent.click(within(card).getByRole("button", { name: "Save decision" }));

    await waitFor(() => expect(live.writes).toHaveLength(1));
    expect(live.writes[0]).toBe(
      `${DASHERO.id}:resolveNote:${dashero.session}/${String(dashero.cp)}/${String(dashero.index)}:Merge it first.`,
    );
  });

  it("names authors from each repo's own identities file", async () => {
    const email = FIXTURE_SESSIONS[0]!.frontmatter.author.email;
    const names: Record<string, Identity[]> = {
      [WORKLEDGER.id]: [{ email, name: "Ada Lovelace", dome_user: null }],
      [DASHERO.id]: [{ email, name: "Grace Hopper", dome_user: null }],
    };
    renderAt("#/needs", machine({}, (id) => ({ listIdentities: () => Promise.resolve(names[id] ?? []) })).source);
    await waitFor(() => {
      const shown = screen.getAllByTitle(email).map((node) => node.textContent);
      expect(shown.sort()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    });
  });

  it("re-reads on notes.changed from any repo, and shows the empty state", async () => {
    let notes = FIXTURE_NOTES_ALL;
    const live = machine({ listAllNotes: () => Promise.resolve(notes) });
    renderAt("#/needs", live.source);
    expect(await screen.findByText(FIXTURE_NOTES_ALL[0]!.text)).toBeDefined();

    notes = [];
    live.emit({ type: "notes.changed", repo: DASHERO.id });
    expect(await screen.findByText(/Nothing is waiting on you in any project/)).toBeDefined();
  });
});

describe("Jobs, machine-wide", () => {
  it("lists every repo's jobs with the repo per row and no scan or backfill controls", async () => {
    renderAt("#/jobs", machine().source);
    await screen.findByRole("heading", { name: "Jobs", level: 2 });
    const rows = within(await screen.findByRole("list", { name: "Jobs, newest first" })).getAllByRole("listitem");
    expect(rows).toHaveLength(FIXTURE_JOBS_ALL.length);
    const row = rows[0]!;
    expect(within(row).getByText("failed")).toBeDefined();
    expect(within(row).getByRole("link", { name: `${DASHERO.name} — Jobs` }).getAttribute("href")).toBe(
      repoHref(DASHERO.id, "jobs"),
    );
    // The session link lives under the row's repo, not under whatever repo the shell shows.
    expect(within(row).getByRole("link", { name: FIXTURE_JOBS_ALL[0]!.session_ulid }).getAttribute("href")).toBe(
      repoHref(DASHERO.id, "ledger", FIXTURE_JOBS_ALL[0]!.session_ulid),
    );
    expect(screen.queryByRole("button", { name: "Scan now" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Backfill/ })).toBeNull();
  });

  it("retries a row through the source of the row's repo and reconciles the row", async () => {
    const live = machine();
    renderAt("#/jobs", live.source);
    const row = within(await screen.findByRole("list", { name: "Jobs, newest first" })).getAllByRole("listitem")[0]!;

    fireEvent.click(within(row).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(live.writes).toEqual([`${DASHERO.id}:retryJob:${FIXTURE_JOBS_ALL[0]!.id}`]));
    expect(await within(row).findByText("queued")).toBeDefined();
    // The repo column survives the reconcile: the answer was a bare `Job`, the row keeps its repo.
    expect(within(row).getByRole("link", { name: `${DASHERO.name} — Jobs` })).toBeDefined();
  });

  it("filters by status on the client and re-reads on job.changed", async () => {
    let jobs = FIXTURE_JOBS_ALL;
    const live = machine({ listAllJobs: () => Promise.resolve(jobs) });
    renderAt("#/jobs", live.source);
    await screen.findByRole("list", { name: "Jobs, newest first" });

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "queued" } });
    expect(await screen.findByText("No queued jobs in any project.")).toBeDefined();

    jobs = [{ ...FIXTURE_JOBS_ALL[0]!, id: "01JBQ7FIXTUREJOB000000002", status: "queued", repo: WORKLEDGER }];
    live.emit({ type: "job.changed", id: "01JBQ7FIXTUREJOB000000002", status: "queued", repo: WORKLEDGER.id });
    const list = await screen.findByRole("list", { name: "Jobs, newest first" });
    expect(within(list).getByRole("link", { name: `${WORKLEDGER.name} — Jobs` })).toBeDefined();
  });
});
