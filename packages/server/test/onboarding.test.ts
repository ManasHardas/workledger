/**
 * `/api/onboarding/*` — docs/contracts/p8/daemon-and-api.md §Onboarding endpoints — the part
 * `packages/server` owns.
 *
 * The ops are stubbed for the reason `jobs.test.ts` stubs its ops: this package never reads a
 * harness store or opens `index.sqlite`. What is asserted here is that every documented route
 * exists, hands the op what the contract's query or body carries, 400s a malformed body before
 * the op is reached, refuses `run` without consent, and turns the op's `api-key-required` into
 * the contract's 409. The real ops are asserted in `packages/cli/test/onboarding.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appFor, fakeJob, seedRepo } from "./helpers.js";
import type { ServerApp } from "../src/app.js";
import type {
  DiscoverResult,
  HistoryResult,
  InitInput,
  InitResult,
  OnboardingOps,
  OnboardingStatus,
  PlanInput,
  PlanResult,
  RunInput,
  RunResult,
} from "../src/onboarding.js";
import type { OpCall, TempRepo } from "./helpers.js";

/** A stand-in for `packages/cli/src/commands/onboarding-ops.ts`. */
class FakeOnboardingOps implements OnboardingOps {
  readonly calls: OpCall[] = [];
  /** Thrown by the next op call, if set. */
  next: Error | undefined;

  #record<T>(op: string, args: unknown[], value: T): T {
    this.calls.push({ op, args });
    if (this.next !== undefined) {
      const error = this.next;
      this.next = undefined;
      throw error;
    }
    return value;
  }

  discover = async (roots?: string[]): Promise<DiscoverResult> =>
    this.#record("discover", [roots], {
      known: [{ path: "/r/a", name: "a", hasGit: true, enabled: false, harnessSessions: { "claude-code": 2 }, lastSessionAt: null }],
      found: [],
      roots: roots ?? ["/home/Projects"],
    });
  history = async (repos: string[]): Promise<HistoryResult> =>
    this.#record("history", [repos], {
      windows: { "7d": { sessions: 1, bytes: 10 }, "30d": { sessions: 2, bytes: 20 }, "90d": { sessions: 3, bytes: 30 } },
    });
  init = async (input: InitInput): Promise<InitResult> =>
    this.#record("init", [input], {
      results: input.repos.map((path) => ({ path, ok: path !== "/r/bad", hooksWritten: [".claude/settings.json"], trustSteps: [] })),
    });
  plan = async (input: PlanInput): Promise<PlanResult> =>
    this.#record("plan", [input], { sessions: 3, estimate: { seconds: 68 } });
  run = async (input: RunInput): Promise<RunResult> =>
    this.#record("run", [input], { jobs: [fakeJob({ kind: input.method === "extract" ? "extract" : "repair" })] });
  status = async (): Promise<OnboardingStatus> =>
    this.#record("status", [], { total: 3, done: 1, failed: 0, running: 2, complete: false });
}

let repo: TempRepo;
let ops: FakeOnboardingOps;
let server: ServerApp;

beforeEach(() => {
  repo = seedRepo();
  ops = new FakeOnboardingOps();
  server = appFor(repo, { onboarding: ops });
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
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  return { status: response.status, body: await response.json() };
}

/** A refusal in the shape the CLI's `OnboardingRefusalError` has. */
function refusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("GET /api/onboarding/discover", () => {
  it("passes no roots when none were given, and the csv when they were", async () => {
    const { status, body } = await get("/api/onboarding/discover");
    expect(status).toBe(200);
    expect(body).toEqual(await ops.discover());
    ops.calls.length = 0;

    await get("/api/onboarding/discover?roots=%2Fa%2C%20~%2Fwork%2C");
    expect(ops.calls).toEqual([{ op: "discover", args: [["/a", "~/work"]] }]);
  });
});

describe("GET /api/onboarding/history", () => {
  it("requires repos and forwards them", async () => {
    expect((await get("/api/onboarding/history")).status).toBe(400);
    expect(ops.calls).toEqual([]);

    const { status, body } = await get("/api/onboarding/history?repos=%2Fr%2Fa%2C%2Fr%2Fb");
    expect(status).toBe(200);
    expect((body as HistoryResult).windows["30d"]).toEqual({ sessions: 2, bytes: 20 });
    expect(ops.calls).toEqual([{ op: "history", args: [["/r/a", "/r/b"]] }]);
  });
});

describe("POST /api/onboarding/init", () => {
  it("initialises the listed repos and forwards harnesses", async () => {
    const { status, body } = await post("/api/onboarding/init", { repos: ["/r/a", "/r/bad"], harnesses: ["codex"] });
    expect(status).toBe(200);
    expect((body as InitResult).results.map((r) => r.ok)).toEqual([true, false]);
    expect(ops.calls).toEqual([{ op: "init", args: [{ repos: ["/r/a", "/r/bad"], harnesses: ["codex"] }] }]);
  });

  it("tells the app about every repo it enabled", async () => {
    const enabled: string[] = [];
    const { onboardingRoutes } = await import("../src/routes/onboarding.js");
    const { Hono } = await import("hono");
    const app = new Hono().route("/api", onboardingRoutes({ ops, onEnabled: (path) => void enabled.push(path) }));
    const response = await app.request("/api/onboarding/init", {
      method: "POST",
      body: JSON.stringify({ repos: ["/r/a", "/r/bad"] }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(200);
    expect(enabled).toEqual(["/r/a"]);
  });

  it("400s an empty list, a non-string path, an unknown field and bad harnesses", async () => {
    expect((await post("/api/onboarding/init", { repos: [] })).status).toBe(400);
    expect((await post("/api/onboarding/init", { repos: [1] })).status).toBe(400);
    expect((await post("/api/onboarding/init", { repos: ["/r/a"], nope: true })).status).toBe(400);
    expect((await post("/api/onboarding/init", { repos: ["/r/a"], harnesses: "codex" })).status).toBe(400);
    expect(ops.calls).toEqual([]);
  });
});

describe("POST /api/onboarding/plan", () => {
  it("forwards the three fields and returns the estimate", async () => {
    const { status, body } = await post("/api/onboarding/plan", { repos: ["/r/a"], since: "30d", method: "resume" });
    expect(status).toBe(200);
    expect(body).toEqual({ sessions: 3, estimate: { seconds: 68 } });
    expect(ops.calls).toEqual([{ op: "plan", args: [{ repos: ["/r/a"], since: "30d", method: "resume" }] }]);
  });

  it("400s a window or method outside the contract", async () => {
    expect((await post("/api/onboarding/plan", { repos: ["/r/a"], since: "14d", method: "resume" })).status).toBe(400);
    expect((await post("/api/onboarding/plan", { repos: ["/r/a"], since: "7d", method: "magic" })).status).toBe(400);
    expect((await post("/api/onboarding/plan", { repos: ["/r/a"], since: "7d" })).status).toBe(400);
    expect(ops.calls).toEqual([]);
  });
});

describe("POST /api/onboarding/run", () => {
  it("answers 202 with the queued jobs once consent is given", async () => {
    const { status, body } = await post("/api/onboarding/run", { repos: ["/r/a"], since: "7d", method: "resume", consent: true });
    expect(status).toBe(202);
    expect((body as RunResult).jobs).toHaveLength(1);
    expect(ops.calls).toEqual([{ op: "run", args: [{ repos: ["/r/a"], since: "7d", method: "resume", consent: true }] }]);
  });

  it("refuses without consent — absent, false, or not a boolean — before the op is reached", async () => {
    const absent = await post("/api/onboarding/run", { repos: ["/r/a"], since: "7d", method: "resume" });
    expect(absent.status).toBe(409);
    expect((absent.body as { error: { code: string } }).error.code).toBe("consent-required");
    expect((await post("/api/onboarding/run", { repos: ["/r/a"], since: "7d", method: "resume", consent: false })).status).toBe(409);
    expect((await post("/api/onboarding/run", { repos: ["/r/a"], since: "7d", method: "resume", consent: "true" })).status).toBe(400);
    expect(ops.calls).toEqual([]);
  });

  it("turns the op's api-key-required into the contract's 409", async () => {
    ops.next = refusal("api-key-required", "extraction calls the Anthropic API; set ANTHROPIC_API_KEY first");
    const { status, body } = await post("/api/onboarding/run", { repos: ["/r/a"], since: "7d", method: "extract", consent: true });
    expect(status).toBe(409);
    expect(body).toEqual({ error: { code: "api-key-required", message: expect.stringContaining("ANTHROPIC_API_KEY") as string } });
  });

  it("maps an ordinary op refusal onto its status", async () => {
    ops.next = Object.assign(new Error("/r/a is not an enabled repo; run init first"), { code: "usage", details: [] });
    expect((await post("/api/onboarding/run", { repos: ["/r/a"], since: "7d", method: "resume", consent: true })).status).toBe(400);
  });
});

describe("GET /api/onboarding/status", () => {
  it("returns the counts", async () => {
    const { status, body } = await get("/api/onboarding/status");
    expect(status).toBe(200);
    expect(body).toEqual({ total: 3, done: 1, failed: 0, running: 2, complete: false });
  });
});

describe("a server built without onboarding ops", () => {
  it("404s the routes rather than 500ing them", async () => {
    const plain = appFor(repo);
    try {
      expect((await plain.app.request("/api/onboarding/discover")).status).toBe(404);
      expect((await plain.app.request("/api/onboarding/status")).status).toBe(404);
    } finally {
      plain.close();
    }
  });
});
