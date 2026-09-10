/**
 * The P3 routes of `docs/contracts/p3/api.md` — the part `packages/server` owns.
 *
 * The ops are faked for the same reason `write.test.ts` fakes the backlog ops: this package never
 * opens `index.sqlite` (see `src/jobs.ts`), so what is asserted here is that every documented
 * route exists, that it hands the op what the CLI command takes, that a malformed body is a 400
 * before the op is reached, that consent is enforced in the direction the contract names, and that
 * `job.changed` reaches the SSE stream when a row moves.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeJobOps, appFor, fakeJob, seedRepo } from "./helpers.js";
import { startJobWatcher } from "../src/job-watcher.js";
import { EventBus } from "../src/events.js";
import type { LedgerEvent } from "../src/events.js";
import type { ServerApp } from "../src/app.js";
import type { TempRepo } from "./helpers.js";

const SESSION = "01JQ8ZK4T0000000000000000A";

let repo: TempRepo;
let jobs: FakeJobOps;
let server: ServerApp;

beforeEach(() => {
  repo = seedRepo();
  jobs = new FakeJobOps();
  server = appFor(repo, { jobs, jobPollMs: 60_000 });
  // `createApp` starts the `job.changed` poller, whose priming read is a real `listJobs` call.
  // These tests assert what the *routes* asked for, so the poller's own traffic is dropped here.
  jobs.calls.length = 0;
});

afterEach(() => {
  server.close();
  repo.cleanup();
});

async function get(url: string): Promise<{ status: number; body: unknown }> {
  const response = await server.app.request(url);
  return { status: response.status, body: await response.json() };
}

async function post(url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await server.app.request(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  return { status: response.status, body: await response.json() };
}

/** A refusal in the shape the injected ops throw (`BacklogOpError`). */
function opError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code, details: [] });
}

describe("GET /api/jobs", () => {
  it("returns the op's rows and passes no status when none was asked for", async () => {
    jobs.rows = [fakeJob({ id: "A" }), fakeJob({ id: "B", status: "done" })];

    const { status, body } = await get("/api/jobs");

    expect(status).toBe(200);
    expect(body).toEqual(jobs.rows);
    expect(jobs.calls).toEqual([{ op: "listJobs", args: [repo.root, undefined] }]);
  });

  it("forwards ?status to the op", async () => {
    await get("/api/jobs?status=running");
    expect(jobs.calls).toEqual([{ op: "listJobs", args: [repo.root, "running"] }]);
  });

  it("rejects a status that is not a job lifecycle state", async () => {
    const { status, body } = await get("/api/jobs?status=sideways");

    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("bad_request");
    expect(jobs.calls).toEqual([]);
  });
});

describe("POST /api/jobs/scan", () => {
  it("returns { orphaned, queued }", async () => {
    const { status, body } = await post("/api/jobs/scan");

    expect(status).toBe(200);
    expect(body).toEqual({ orphaned: 2, queued: 1 });
    expect(jobs.calls).toEqual([{ op: "scan", args: [repo.root] }]);
  });
});

describe("POST /api/jobs/repair", () => {
  it("queues a repair and answers 202 with the Job", async () => {
    const { status, body } = await post("/api/jobs/repair", { session: SESSION });

    expect(status).toBe(202);
    expect(body).toEqual(fakeJob());
    expect(jobs.calls).toEqual([
      { op: "repair", args: [repo.root, { session: SESSION, extract: false, consent: false }] },
    ]);
  });

  it("refuses extract without consent with 409 consent-required and the estimate", async () => {
    jobs.estimateExtract = async () => ({ bytes: 4096, model: "claude-haiku-4-5", usd: 0.02 });

    const { status, body } = await post("/api/jobs/repair", { session: SESSION, extract: true });

    expect(status).toBe(409);
    expect(body).toEqual({
      error: { code: "consent-required", message: expect.stringContaining(SESSION) as string },
      estimate: { bytes: 4096, model: "claude-haiku-4-5", usd: 0.02 },
    });
    // The refusal is the whole response: nothing was queued.
    expect(jobs.calls).toEqual([]);
  });

  it("still refuses extract without consent when the build cannot price it", async () => {
    const { status, body } = await post("/api/jobs/repair", { session: SESSION, extract: true });

    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("consent-required");
    expect(body).not.toHaveProperty("estimate");
    expect(jobs.calls).toEqual([]);
  });

  it("runs the extraction once consent is given", async () => {
    const { status } = await post("/api/jobs/repair", {
      session: SESSION,
      extract: true,
      consent: true,
    });

    expect(status).toBe(202);
    expect(jobs.calls).toEqual([
      { op: "repair", args: [repo.root, { session: SESSION, extract: true, consent: true }] },
    ]);
  });

  it("reads only a real boolean as consent", async () => {
    const { status } = await post("/api/jobs/repair", { session: SESSION, consent: "true" });

    expect(status).toBe(400);
    expect(jobs.calls).toEqual([]);
  });

  it("400s a body with no session and a body with an unknown field", async () => {
    expect((await post("/api/jobs/repair", {})).status).toBe(400);
    expect((await post("/api/jobs/repair", { session: SESSION, nope: 1 })).status).toBe(400);
    expect(jobs.calls).toEqual([]);
  });

  it("maps the op's not-found onto 404", async () => {
    jobs.next = opError(`no session ${SESSION} in this repo`, "not-found");

    const { status, body } = await post("/api/jobs/repair", { session: SESSION });

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  });
});

describe("POST /api/jobs/backfill", () => {
  it("answers 200 with an empty jobs list for the dry estimate", async () => {
    jobs.backfill = async (_root, input) => ({
      jobs: input.consent ? [fakeJob({ kind: "backfill" })] : [],
      estimate: { count: 3, bytes: 900, oldest: "2026-09-01T00:00:00.000Z", seconds: 68 },
    });

    const { status, body } = await post("/api/jobs/backfill", { since: "30d", consent: false });

    expect(status).toBe(200);
    expect(body).toEqual({
      jobs: [],
      estimate: { count: 3, bytes: 900, oldest: "2026-09-01T00:00:00.000Z", seconds: 68 },
    });
  });

  it("answers 202 with the queued jobs once consent is given", async () => {
    jobs.backfill = async () => ({
      jobs: [fakeJob({ kind: "backfill" })],
      estimate: { count: 1, bytes: 10, oldest: null, seconds: 45 },
    });

    const { status, body } = await post("/api/jobs/backfill", { since: "7d", consent: true });

    expect(status).toBe(202);
    expect((body as { jobs: unknown[] }).jobs).toHaveLength(1);
  });

  it("defaults since to the contract's 14d and validates the ones it is given", async () => {
    const seen: unknown[] = [];
    jobs.backfill = async (_root, input) => {
      seen.push(input);
      return { jobs: [], estimate: { count: 0, bytes: 0, oldest: null, seconds: 0 } };
    };

    await post("/api/jobs/backfill", { consent: false });
    expect(seen).toEqual([{ since: "14d", consent: false }]);
    expect((await post("/api/jobs/backfill", { since: "last tuesday", consent: false })).status).toBe(400);
  });

  it("answers 501 when the build has no backfill op", async () => {
    const { status, body } = await post("/api/jobs/backfill", { consent: false });

    expect(status).toBe(501);
    expect((body as { error: { code: string } }).error.code).toBe("not_implemented");
  });
});

describe("POST /api/jobs/:id/{cancel,retry}", () => {
  it("cancels and retries by id", async () => {
    expect(await post("/api/jobs/JOB-1/cancel")).toEqual({
      status: 200,
      body: fakeJob({ id: "JOB-1", status: "cancelled" }),
    });
    expect(await post("/api/jobs/JOB-1/retry")).toEqual({
      status: 200,
      body: fakeJob({ id: "JOB-1", status: "queued" }),
    });
    expect(jobs.calls).toEqual([
      { op: "cancelJob", args: [repo.root, "JOB-1"] },
      { op: "retryJob", args: [repo.root, "JOB-1"] },
    ]);
  });

  it("maps an unknown id to 404 and a wrong state to 409", async () => {
    jobs.next = opError("no job JOB-9", "not-found");
    expect((await post("/api/jobs/JOB-9/cancel")).status).toBe(404);

    jobs.next = opError("job JOB-1 is done; only a queued or running job can be cancelled", "conflict");
    expect((await post("/api/jobs/JOB-1/cancel")).status).toBe(409);
  });
});

describe("job.changed", () => {
  /** The watcher, driven by hand rather than by its 2 s interval. */
  function watcherFor(ops: FakeJobOps): { bus: EventBus; seen: LedgerEvent[]; tick: () => Promise<void>; close: () => void } {
    const bus = new EventBus();
    const seen: LedgerEvent[] = [];
    bus.subscribe((event) => void seen.push(event));
    const watcher = startJobWatcher({ ops, repoRoot: repo.root, bus, pollMs: 60_000 });
    return { bus, seen, tick: () => watcher.tick(), close: () => watcher.close() };
  }

  it("emits { id, status } when a row's status moves, and nothing when it does not", async () => {
    jobs.rows = [fakeJob({ id: "JOB-1", status: "queued" })];
    const watcher = watcherFor(jobs);
    try {
      // The first poll seeds the table, so a server that starts with a backlog of rows does not
      // announce every one of them.
      await watcher.tick();
      expect(watcher.seen).toEqual([]);

      jobs.rows = [fakeJob({ id: "JOB-1", status: "running" })];
      await watcher.tick();
      expect(watcher.seen).toEqual([{ event: "job.changed", data: { id: "JOB-1", status: "running" } }]);

      await watcher.tick();
      expect(watcher.seen).toHaveLength(1);
    } finally {
      watcher.close();
    }
  });

  it("emits for a row that appears after the first poll", async () => {
    const watcher = watcherFor(jobs);
    try {
      await watcher.tick();
      jobs.rows = [fakeJob({ id: "JOB-2", status: "queued" })];
      await watcher.tick();

      expect(watcher.seen).toEqual([{ event: "job.changed", data: { id: "JOB-2", status: "queued" } }]);
    } finally {
      watcher.close();
    }
  });

  it("survives an op that throws and keeps polling", async () => {
    const errors: unknown[] = [];
    const bus = new EventBus();
    const seen: LedgerEvent[] = [];
    bus.subscribe((event) => void seen.push(event));
    const watcher = startJobWatcher({
      ops: jobs,
      repoRoot: repo.root,
      bus,
      pollMs: 60_000,
      onError: (error) => void errors.push(error),
    });
    try {
      await watcher.tick();
      jobs.next = new Error("database is locked");
      await watcher.tick();
      expect(errors).toHaveLength(1);
      expect(seen).toEqual([]);

      jobs.rows = [fakeJob({ id: "JOB-3", status: "failed" })];
      await watcher.tick();
      expect(seen).toEqual([{ event: "job.changed", data: { id: "JOB-3", status: "failed" } }]);
    } finally {
      watcher.close();
    }
  });

  it("reaches an open /api/events stream", async () => {
    const running = await server.app.request("/api/events", { headers: { accept: "text/event-stream" } });
    expect(running.status).toBe(200);
    const reader = running.body!.getReader();
    const decoder = new TextDecoder();

    jobs.rows = [fakeJob({ id: "JOB-4", status: "done" })];
    server.events.emit({ event: "job.changed", data: { id: "JOB-4", status: "done" } });

    let buffer = "";
    for (let i = 0; i < 5 && !buffer.includes("job.changed"); i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    await reader.cancel();

    expect(buffer).toContain("event: job.changed");
    expect(buffer).toContain('{"id":"JOB-4","status":"done"}');
  });
});

describe("a server built without job ops", () => {
  it("404s the P3 routes rather than 500ing them", async () => {
    const p2 = appFor(repo);
    try {
      expect((await p2.app.request("/api/jobs")).status).toBe(404);
      expect((await p2.app.request(`/api/sessions/${SESSION}/excerpt?cp=1`)).status).toBe(404);
      expect(p2.jobWatcher).toBeUndefined();
    } finally {
      p2.close();
    }
  });
});
