import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app.js";
import {
  canCancel,
  canRetry,
  elapsed,
  formatBytes,
  formatDuration,
  formatUsd,
  shortId,
} from "../src/features/jobs/format.js";
import { estimateFrom } from "../src/features/jobs/repair-sheet.js";
import { createSource } from "../src/lib/ledger-source.js";
import { RepoIdProvider, SourceProvider } from "../src/lib/source-context.js";
import { JobsView } from "../src/routes/jobs.js";

import type { AppSource, Job, LedgerEvent, LedgerSource } from "../src/lib/ledger-source.js";

/** The first fixture repo, which is where every `#/r/<id>/…` route in this file lives. */
const REPO = "0123456789ab";

/** A `jobs` row in the shape `docs/contracts/p3/cli.md` §Jobs puts on the wire. */
function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "01JOB000000000000000000001",
    kind: "repair",
    session_ulid: "01JBQ4Z8W2K7N3RQ9XMDT5V0AE",
    repo_path: "/repo",
    status: "queued",
    attempts: 1,
    created_at: "2026-09-09T09:00:00.000Z",
    started_at: null,
    finished_at: null,
    heartbeat_at: null,
    error: null,
    cost_estimate_usd: null,
    log_path: null,
    ...overrides,
  };
}

/** A rejection shaped like `ApiClientError` — a `code`, and whatever rode beside it. */
function apiError(code: string, message: string, detail?: Record<string, unknown>) {
  return Object.assign(new Error(message), { code, detail });
}

interface Stub {
  source: AppSource;
  emit: (event: LedgerEvent) => void;
  calls: string[];
  jobs: Job[];
}

/**
 * A source with P3's whole job surface, backed by an array.
 *
 * Built by delegation from the fixture source so the parts this file is not testing (sessions,
 * backlog, health) behave exactly as they do everywhere else, and only the queue is under test.
 */
function stubSource(overrides: Partial<LedgerSource> = {}, initial: Job[] = []): Stub {
  const base = createSource("fixture");
  const handlers = new Set<(event: LedgerEvent) => void>();
  const calls: string[] = [];
  const jobs = [...initial];

  // `Object.create(base)` keeps the fixture's `forRepo() { return this; }`, so a scoped source
  // is this same stub and the overrides apply to the routed views too.
  const source = Object.assign(Object.create(base) as AppSource, {
    capabilities: { write: true, live: true, provenance: true },
    listJobs(status?: string) {
      calls.push(`listJobs:${status ?? "all"}`);
      return Promise.resolve(status === undefined ? jobs : jobs.filter((j) => j.status === status));
    },
    scan() {
      calls.push("scan");
      return Promise.resolve({ orphaned: 2, queued: 2 });
    },
    cancelJob(id: string) {
      calls.push(`cancel:${id}`);
      return Promise.resolve(job({ id, status: "cancelled" }));
    },
    retryJob(id: string) {
      calls.push(`retry:${id}`);
      return Promise.resolve(job({ id, status: "queued", attempts: 2 }));
    },
    subscribe(handler: (event: LedgerEvent) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    ...overrides,
  });

  return {
    source,
    calls,
    jobs,
    emit: (event) => handlers.forEach((handler) => handler(event)),
  };
}

function renderJobs(source: LedgerSource) {
  return render(
    <RepoIdProvider id={REPO}>
      <SourceProvider source={source}>
        <JobsView />
      </SourceProvider>
    </RepoIdProvider>,
  );
}

afterEach(cleanup);

describe("jobs format helpers", () => {
  it("offers cancel only before a job finishes and retry only after it failed", () => {
    expect(["queued", "running"].every(canCancel)).toBe(true);
    expect(["done", "failed", "cancelled"].some(canCancel)).toBe(false);
    expect(["failed", "cancelled"].every(canRetry)).toBe(true);
    expect(["queued", "running", "done"].some(canRetry)).toBe(false);
  });

  it("renders durations, bytes and money the way a human compares them", () => {
    expect(formatDuration(840)).toBe("840ms");
    expect(formatDuration(9_000)).toBe("9s");
    expect(formatDuration(72_000)).toBe("1m 12s");
    expect(formatDuration(3_600_000)).toBe("1h 0m");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_400_000)).toBe("1.4 MB");
    // Below a cent the estimate keeps four decimals: `$0.00` is a number nobody reads.
    expect(formatUsd(0.0033)).toBe("$0.0033");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(shortId("01JOB000000000000000000001")).toBe("…00000001");
  });

  it("measures a running job against now and a finished one against its own end", () => {
    const started = "2026-09-09T09:00:00.000Z";
    const now = Date.parse("2026-09-09T09:01:12.000Z");
    expect(elapsed(job({ status: "running", started_at: started }), now)).toBe("1m 12s");
    expect(
      elapsed(
        job({ status: "done", started_at: started, finished_at: "2026-09-09T09:00:09.000Z" }),
        now,
      ),
    ).toBe("9s");
    expect(elapsed(job(), now)).toBe("—");
  });
});

describe("jobs view", () => {
  it("lists the queue with status, kind, session, attempts, timings and error", async () => {
    const { source } = stubSource({}, [
      job({
        id: "01JOB000000000000000000002",
        kind: "backfill",
        status: "failed",
        attempts: 3,
        started_at: "2026-09-09T09:00:00.000Z",
        finished_at: "2026-09-09T09:00:09.000Z",
        error: "resume exited 1",
      }),
    ]);
    renderJobs(source);

    const row = await screen.findByRole("listitem", { name: /backfill/ });
    expect(row.textContent).toContain("failed");
    expect(row.textContent).toContain("backfill");
    expect(row.textContent).toContain("3 attempts");
    expect(row.textContent).toContain("01JBQ4Z8W2K7N3RQ9XMDT5V0AE");
    expect(row.textContent).toContain("2026-09-09 09:00 UTC");
    expect(row.textContent).toContain("9s");
    expect(row.textContent).toContain("resume exited 1");
    // The session is a link into the Ledger, not 26 characters of text.
    expect(
      within(row).getByRole("link", { name: "01JBQ4Z8W2K7N3RQ9XMDT5V0AE" }).getAttribute("href"),
    ).toBe(`#/r/${REPO}/ledger/01JBQ4Z8W2K7N3RQ9XMDT5V0AE`);
  });

  it("shows an empty state, a loading state and a read failure", async () => {
    renderJobs(stubSource().source);
    expect(screen.getByRole("status").textContent).toContain("Loading…");
    expect(await screen.findByText(/The queue is empty/)).toBeDefined();
    cleanup();

    const broken = stubSource({ listJobs: () => Promise.reject(new Error("index is locked")) });
    renderJobs(broken.source);
    expect((await screen.findByRole("alert")).textContent).toContain("index is locked");
  });

  it("filters through listJobs(status)", async () => {
    const { source, calls } = stubSource({}, [job({ status: "failed" })]);
    renderJobs(source);
    await screen.findByRole("list", { name: "Jobs, newest first" });

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "running" } });
    await waitFor(() => expect(calls).toContain("listJobs:running"));
  });

  it("re-reads the queue on job.changed and on nothing else", async () => {
    const { source, calls, emit } = stubSource({}, [job()]);
    renderJobs(source);
    await screen.findByRole("list", { name: "Jobs, newest first" });
    const before = calls.length;

    await act(async () => {
      emit({ type: "job.changed", id: "01JOB000000000000000000001", status: "running" });
    });
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));

    const after = calls.length;
    await act(async () => {
      emit({ type: "backlog.changed", id: "WL-1" });
    });
    expect(calls.length).toBe(after);
  });

  it("cancels a queued job and retries a failed one", async () => {
    const { source, calls } = stubSource({}, [
      job({ id: "01JOB000000000000000000001", status: "queued" }),
      job({ id: "01JOB000000000000000000002", status: "failed", created_at: "2026-09-09T08:00:00.000Z" }),
    ]);
    renderJobs(source);

    const rows = await screen.findAllByRole("listitem");
    const queuedRow = rows[0]!;
    const failedRow = rows[1]!;

    expect(within(queuedRow).getByRole("button", { name: "Retry" })).toHaveProperty("disabled", true);
    fireEvent.click(within(queuedRow).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls).toContain("cancel:01JOB000000000000000000001"));
    expect(await within(queuedRow).findByText("cancelled")).toBeDefined();

    expect(within(failedRow).getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    fireEvent.click(within(failedRow).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toContain("retry:01JOB000000000000000000002"));
  });

  it("reports a refused write against its own row without dropping the list", async () => {
    const { source } = stubSource(
      { cancelJob: () => Promise.reject(apiError("conflict", "job 01J… is already done")) },
      [job({ status: "running" })],
    );
    renderJobs(source);
    const row = await screen.findByRole("listitem", { name: /repair/ });

    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    expect((await within(row).findByRole("alert")).textContent).toContain("already done");
    expect(screen.getByRole("list", { name: "Jobs, newest first" })).toBeDefined();
  });

  it("runs a scan, reports its counts, and re-reads the queue", async () => {
    const { source, calls } = stubSource();
    renderJobs(source);
    await screen.findByText(/The queue is empty/);
    const before = calls.filter((call) => call.startsWith("listJobs")).length;

    fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByText(/Scan found 2 orphans and queued 2 repairs\./)).toBeDefined();
    await waitFor(() =>
      expect(calls.filter((call) => call.startsWith("listJobs")).length).toBeGreaterThan(before),
    );
  });

  it("reports a failed scan rather than a silent no-op", async () => {
    const { source } = stubSource({ scan: () => Promise.reject(new Error("index is locked")) });
    renderJobs(source);
    fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Scan failed: index is locked");
  });

  it("degrades to a read-only queue on a source that cannot write", async () => {
    renderJobs(createSource("fixture"));
    await screen.findByText(/The queue is empty/);
    expect(screen.getByRole("button", { name: "Scan now" })).toHaveProperty("disabled", true);
    // Backfill spends real time and money; on a read-only source the control is absent, not
    // disabled — there is no queue behind it at all.
    expect(screen.queryByRole("button", { name: "Backfill…" })).toBeNull();
  });

  it("is reachable from the shell's nav", async () => {
    window.location.hash = `#/r/${REPO}/jobs`;
    render(<App source={createSource("fixture")} />);
    expect(await screen.findByRole("heading", { name: "Jobs", level: 2 })).toBeDefined();
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.every((link) => link.getAttribute("href") === `#/r/${REPO}/jobs`)).toBe(true);
    window.location.hash = "";
  });
});

describe("backfill", () => {
  const estimate = { count: 12, bytes: 1_400_000, oldest: "2026-08-26T10:00:00.000Z", seconds: 180 };

  function backfillSource(extra: Partial<LedgerSource> = {}) {
    const seen: { since?: string; consent: boolean }[] = [];
    const stub = stubSource({
      backfill(input: { since?: string; consent: boolean }) {
        seen.push(input);
        return Promise.resolve({ jobs: input.consent ? [job(), job({ id: "b2" })] : [], estimate });
      },
      ...extra,
    });
    return { ...stub, seen };
  }

  it("asks for the dry estimate first and only queues after an explicit confirmation", async () => {
    const { source, seen } = backfillSource();
    renderJobs(source);

    fireEvent.click(await screen.findByRole("button", { name: "Backfill…" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText("12")).toBeDefined();
    expect(within(sheet).getByText("1.4 MB")).toBeDefined();
    expect(within(sheet).getByText("2026-08-26 10:00 UTC")).toBeDefined();
    expect(within(sheet).getByText("3m")).toBeDefined();

    // Exactly one call so far, and it did not consent to anything.
    expect(seen).toEqual([{ since: "14d", consent: false }]);

    fireEvent.click(within(sheet).getByRole("button", { name: "Run backfill" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toEqual({ since: "14d", consent: true });
    expect(await within(sheet).findByText(/Queued 2 jobs/)).toBeDefined();
  });

  it("re-estimates when the since selector changes", async () => {
    const { source, seen } = backfillSource();
    renderJobs(source);
    fireEvent.click(await screen.findByRole("button", { name: "Backfill…" }));
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText("12");

    fireEvent.change(within(sheet).getByLabelText("Since"), { target: { value: "all" } });
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toEqual({ since: "all", consent: false });
    expect(seen.every((call) => !call.consent)).toBe(true);
  });

  it("says so plainly when the build cannot backfill", async () => {
    const { source } = backfillSource({
      backfill: () => Promise.reject(apiError("not_implemented", "backfill is not available")),
    });
    renderJobs(source);
    fireEvent.click(await screen.findByRole("button", { name: "Backfill…" }));
    const sheet = await screen.findByRole("dialog");
    expect((await within(sheet).findByRole("alert")).textContent).toContain(
      "This build of workledger cannot backfill yet",
    );
    expect(within(sheet).getByRole("button", { name: "Run backfill" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("repair and the extraction consent", () => {
  const SESSION = "01JBQ4Z8W2K7N3RQ9XMDT5V0AE";
  const ESTIMATE = { bytes: 812_000, model: "claude-haiku-4-5", usd: 0.0184 };

  function repairSource(repair: LedgerSource["repair"]) {
    return stubSource({ repair });
  }

  /** Open the session detail, which is where the Repair control lives. */
  function renderDetail(source: AppSource) {
    window.location.hash = `#/r/${REPO}/ledger/${SESSION}`;
    return render(<App source={source} />);
  }

  beforeEach(() => {
    window.location.hash = "";
  });

  it("queues a resume repair without any consent step", async () => {
    const seen: unknown[] = [];
    const { source } = repairSource((input) => {
      seen.push(input);
      return Promise.resolve(job());
    });
    renderDetail(source);

    fireEvent.click(await screen.findByRole("button", { name: "Repair…" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Repair by resume" }));

    await waitFor(() => expect(seen).toEqual([{ session: SESSION }]));
    expect(await within(sheet).findByText(/Queued\./)).toBeDefined();
  });

  it("shows the server's estimate before extracting, and only then consents", async () => {
    const seen: { session: string; extract?: boolean; consent?: boolean }[] = [];
    const { source } = repairSource((input) => {
      seen.push(input);
      if (input.extract && input.consent !== true) {
        return Promise.reject(
          apiError("consent-required", "extracting spends tokens", { estimate: ESTIMATE }),
        );
      }
      return Promise.resolve(job({ kind: "extract" }));
    });
    renderDetail(source);

    fireEvent.click(await screen.findByRole("button", { name: "Repair…" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Extract from transcript…" }));

    // The refusal is what carries the number, and the number is on screen before the button that
    // spends it exists.
    expect(await within(sheet).findByText("812.0 kB")).toBeDefined();
    expect(within(sheet).getByText("claude-haiku-4-5")).toBeDefined();
    expect(within(sheet).getByText("$0.02")).toBeDefined();
    expect(seen).toEqual([{ session: SESSION, extract: true }]);

    fireEvent.click(within(sheet).getByRole("button", { name: "Spend ~$0.02 and extract" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toEqual({ session: SESSION, extract: true, consent: true });
  });

  it("still refuses without a price when the build cannot estimate one", async () => {
    const { source } = repairSource((input) =>
      input.consent === true
        ? Promise.resolve(job())
        : Promise.reject(apiError("consent-required", "extracting spends tokens")),
    );
    renderDetail(source);
    fireEvent.click(await screen.findByRole("button", { name: "Repair…" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Extract from transcript…" }));

    expect(await within(sheet).findByText(/could not price the extraction/)).toBeDefined();
    expect(within(sheet).getByRole("button", { name: "Spend tokens and extract" })).toBeDefined();
  });

  it("names extraction as the fallback when the resume is unavailable", async () => {
    const { source } = repairSource(() =>
      Promise.reject(new Error("claude-code cannot resume session hs-…")),
    );
    renderDetail(source);
    fireEvent.click(await screen.findByRole("button", { name: "Repair…" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Repair by resume" }));

    const alert = await within(sheet).findByRole("alert");
    expect(alert.textContent).toContain("Resume is unavailable for this session");
    expect(alert.textContent).toContain("cannot resume");
    expect(within(sheet).getByRole("button", { name: "Extract from transcript…" })).toBeDefined();
  });

  it("reads an estimate off an error body only when it is the whole shape", () => {
    expect(estimateFrom(apiError("consent-required", "x", { estimate: ESTIMATE }))).toEqual(ESTIMATE);
    expect(estimateFrom(apiError("consent-required", "x"))).toBeUndefined();
    expect(estimateFrom(apiError("consent-required", "x", { estimate: { bytes: 1 } }))).toBeUndefined();
    expect(estimateFrom(new Error("x"))).toBeUndefined();
  });

  it("offers repair on the card of a crashed session and on no other card", async () => {
    const base = createSource("fixture");
    const sessions = await base.listSessions();
    const crashed = {
      ...sessions[0]!,
      frontmatter: { ...sessions[0]!.frontmatter, status: "crashed" as const },
    };
    const { source } = stubSource({
      listSessions: () => Promise.resolve([crashed, sessions[1]!]),
      repair: () => Promise.resolve(job()),
    });

    window.location.hash = `#/r/${REPO}/ledger`;
    render(<App source={source} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "All" }));

    const rows = await screen.findAllByRole("listitem");
    expect(within(rows[0]!).getByRole("button", { name: "Repair session…" })).toBeDefined();
    expect(within(rows[1]!).queryByRole("button", { name: "Repair session…" })).toBeNull();
    window.location.hash = "";
  });
});

// The clock behind `elapsed` is real; nothing above waits on it, and this keeps a stray timer from
// leaking into the next file.
afterEach(() => vi.useRealTimers());
