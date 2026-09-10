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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeOps, appFor, fakeJob, seedRepo } from "./helpers.js";
import { createApp } from "../src/app.js";
import { repoId } from "../src/repos.js";
import type { ServerApp } from "../src/app.js";
import type { LedgerEvent } from "../src/events.js";
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
      known: [{ path: "/r/a", name: "a", hasGit: true, enabled: false, suggested: true, harnessSessions: { "claude-code": 2 }, lastSessionAt: null, startedIn: ["/r"], touchedSessions: 1 }],
      found: [],
      roots: roots ?? ["/home/Projects"],
      workspaces: [],
    });
  history = async (repos: string[]): Promise<HistoryResult> =>
    this.#record("history", [repos], {
      windows: { "7d": { sessions: 1, bytes: 10 }, "30d": { sessions: 2, bytes: 20 }, "90d": { sessions: 3, bytes: 30 }, all: { sessions: 4, bytes: 40 } },
    });
  init = async (input: InitInput): Promise<InitResult> =>
    this.#record("init", [input], {
      results: input.repos.map((path) => ({ path, ok: !path.endsWith("/bad"), hooksWritten: [".claude/settings.json"], trustSteps: [] })),
      ...(input.workspaces === undefined
        ? {}
        : { workspaces: input.workspaces.map((path) => ({ path, ok: true, hooksWritten: [".claude/settings.json"], trustSteps: [] })) }),
    });
  plan = async (input: PlanInput): Promise<PlanResult> =>
    this.#record("plan", [input], { sessions: 3, estimate: { seconds: 68 } });
  run = async (input: RunInput): Promise<RunResult> =>
    this.#record("run", [input], { jobs: [fakeJob({ kind: input.method === "extract" ? "extract" : "repair" })] });
  status = async (): Promise<OnboardingStatus> =>
    this.#record("status", [], { total: 3, done: 1, failed: 0, running: 2, waiting: 0, retryAfter: null, complete: false });
}

let repo: TempRepo;
let ops: FakeOnboardingOps;
let server: ServerApp;
/** Real directories, because the routes check the paths a body names before the op sees them. */
let dir: string;
let repoA: string;
let repoBad: string;

beforeEach(() => {
  repo = seedRepo();
  ops = new FakeOnboardingOps();
  server = appFor(repo, { onboarding: ops });
  dir = mkdtempSync(path.join(os.tmpdir(), "workledger-onboarding-routes-"));
  repoA = path.join(dir, "a");
  repoBad = path.join(dir, "bad");
  mkdirSync(path.join(repoA, ".git"), { recursive: true });
  mkdirSync(path.join(repoBad, ".git"), { recursive: true });
});

afterEach(() => {
  server.close();
  repo.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function get(url: string): Promise<{ status: number; body: unknown }> {
  const response = await server.app.request(url);
  return { status: response.status, body: await response.json() };
}

/** A same-origin JSON POST — what the wizard sends. `headers` overrides the defaults. */
async function post(url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const response = await server.app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

/** `body.error.code`. */
function code(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

/** A url-encoded `?repos=` list. */
function q(...paths: string[]): string {
  return encodeURIComponent(paths.join(","));
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

    await get(`/api/onboarding/discover?roots=${q(dir, ` ${repoA}`, "")}`);
    expect(ops.calls).toEqual([{ op: "discover", args: [[dir, repoA]] }]);
  });

  it("400s invalid-root for a relative, missing or non-directory root", async () => {
    for (const root of ["Projects", path.join(dir, "nowhere"), path.join(dir, "file.txt")]) {
      const { status, body } = await get(`/api/onboarding/discover?roots=${q(root)}`);
      expect([status, code(body)]).toEqual([400, "invalid-root"]);
    }
    expect(ops.calls).toEqual([]);
  });
});

describe("GET /api/onboarding/history", () => {
  it("requires repos and forwards them", async () => {
    expect((await get("/api/onboarding/history")).status).toBe(400);
    expect(ops.calls).toEqual([]);

    const { status, body } = await get(`/api/onboarding/history?repos=${q(repoA, repoBad)}`);
    expect(status).toBe(200);
    expect((body as HistoryResult).windows["30d"]).toEqual({ sessions: 2, bytes: 20 });
    expect(ops.calls).toEqual([{ op: "history", args: [[repoA, repoBad]] }]);
  });

  it("400s invalid-repo for a path that is not a git repository", async () => {
    const { status, body } = await get(`/api/onboarding/history?repos=${q(repoA, "a")}`);
    expect([status, code(body)]).toEqual([400, "invalid-repo"]);
    expect(ops.calls).toEqual([]);
  });
});

describe("POST /api/onboarding/init", () => {
  it("initialises the listed repos and forwards harnesses", async () => {
    const { status, body } = await post("/api/onboarding/init", { repos: [repoA, repoBad], harnesses: ["codex"] });
    expect(status).toBe(200);
    expect((body as InitResult).results.map((r) => r.ok)).toEqual([true, false]);
    expect(ops.calls).toEqual([{ op: "init", args: [{ repos: [repoA, repoBad], harnesses: ["codex"] }] }]);
  });

  it("400s invalid-repo for a relative path, a missing one, a plain directory and a symlink to one", async () => {
    const plain = path.join(dir, "plain");
    mkdirSync(plain);
    const link = path.join(dir, "link");
    symlinkSync(plain, link);
    for (const given of ["a", path.join(dir, "missing"), plain, link]) {
      // The valid repo first: the whole request is refused, not just the bad entry.
      const bodies: Record<string, unknown> = {
        init: { repos: [repoA, given] },
        plan: { repos: [repoA, given], since: "7d", method: "none" },
        run: { repos: [repoA, given], since: "7d", method: "none", consent: true },
      };
      for (const [route, request] of Object.entries(bodies)) {
        const { status, body } = await post(`/api/onboarding/${route}`, request);
        expect([route, given, status, code(body)]).toEqual([route, given, 400, "invalid-repo"]);
      }
    }
    expect(ops.calls).toEqual([]);
  });

  it("tells the app about every repo it enabled", async () => {
    const enabled: string[] = [];
    const { onboardingRoutes } = await import("../src/routes/onboarding.js");
    const { Hono } = await import("hono");
    const app = new Hono().route("/api", onboardingRoutes({ ops, onEnabled: (path) => void enabled.push(path) }));
    const response = await app.request("/api/onboarding/init", {
      method: "POST",
      body: JSON.stringify({ repos: [repoA, repoBad] }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(200);
    expect(enabled).toEqual([repoA]);
  });

  it("in machine mode serves each enabled repo at once and emits repos.changed for it (#94)", async () => {
    const machine = createApp({ repos: [], ops: new FakeOps("WL-unset"), onboarding: ops, env: { PATH: "" }, homeDir: repo.root });
    const events: LedgerEvent[] = [];
    machine.events.subscribe((event) => void events.push(event));
    try {
      const response = await machine.app.request("/api/onboarding/init", {
        method: "POST",
        body: JSON.stringify({ repos: [repoA, repoBad] }),
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(200);
      // The one that `init` enabled is watched now, not at the next start; the failed one is not.
      const id = repoId(repoA);
      expect(machine.repos.get(id)?.root).toBe(repoA);
      expect(machine.repos.size).toBe(1);
      expect(events).toEqual([{ event: "repos.changed", data: { repo: id } }]);

      // A second init of a served repo changes nothing and says nothing.
      await machine.app.request("/api/onboarding/init", {
        method: "POST",
        body: JSON.stringify({ repos: [repoA] }),
        headers: { "content-type": "application/json" },
      });
      expect(events).toHaveLength(1);
    } finally {
      machine.close();
    }
  });

  it("forwards workspaces (amendment 8) and 400s one that is not a directory", async () => {
    const { status, body } = await post("/api/onboarding/init", { repos: [repoA], workspaces: [dir] });
    expect(status).toBe(200);
    expect((body as InitResult).workspaces).toEqual([{ path: dir, ok: true, hooksWritten: [".claude/settings.json"], trustSteps: [] }]);
    expect(ops.calls).toEqual([{ op: "init", args: [{ repos: [repoA], workspaces: [dir] }] }]);

    const missing = await post("/api/onboarding/init", { repos: [repoA], workspaces: [path.join(dir, "nope")] });
    expect(missing.status).toBe(400);
    expect(code(missing.body)).toBe("invalid-root");
    expect((await post("/api/onboarding/init", { repos: [repoA], workspaces: "x" })).status).toBe(400);
    expect(ops.calls).toHaveLength(1);
  });

  it("400s an empty list, a non-string path, an unknown field and bad harnesses", async () => {
    expect((await post("/api/onboarding/init", { repos: [] })).status).toBe(400);
    expect((await post("/api/onboarding/init", { repos: [1] })).status).toBe(400);
    expect((await post("/api/onboarding/init", { repos: [repoA], nope: true })).status).toBe(400);
    expect((await post("/api/onboarding/init", { repos: [repoA], harnesses: "codex" })).status).toBe(400);
    expect(ops.calls).toEqual([]);
  });
});

describe("POST /api/onboarding/plan", () => {
  it("forwards the three fields and returns the estimate", async () => {
    const { status, body } = await post("/api/onboarding/plan", { repos: [repoA], since: "30d", method: "resume" });
    expect(status).toBe(200);
    expect(body).toEqual({ sessions: 3, estimate: { seconds: 68 } });
    expect(ops.calls).toEqual([{ op: "plan", args: [{ repos: [repoA], since: "30d", method: "resume" }] }]);
    // Amendment 9: `all` is a window everywhere `7d | 30d | 90d | none` is.
    expect((await post("/api/onboarding/plan", { repos: [repoA], since: "all", method: "resume" })).status).toBe(200);
    expect(ops.calls.at(-1)).toEqual({ op: "plan", args: [{ repos: [repoA], since: "all", method: "resume" }] });
  });

  it("400s a window or method outside the contract", async () => {
    expect((await post("/api/onboarding/plan", { repos: [repoA], since: "14d", method: "resume" })).status).toBe(400);
    expect((await post("/api/onboarding/plan", { repos: [repoA], since: "7d", method: "magic" })).status).toBe(400);
    expect((await post("/api/onboarding/plan", { repos: [repoA], since: "7d" })).status).toBe(400);
    expect(ops.calls).toEqual([]);
  });
});

describe("POST /api/onboarding/run", () => {
  it("answers 202 with the queued jobs once consent is given", async () => {
    const { status, body } = await post("/api/onboarding/run", { repos: [repoA], since: "7d", method: "resume", consent: true });
    expect(status).toBe(202);
    expect((body as RunResult).jobs).toHaveLength(1);
    expect(ops.calls).toEqual([{ op: "run", args: [{ repos: [repoA], since: "7d", method: "resume", consent: true }] }]);
  });

  it("refuses without consent — absent, false, or not a boolean — before the op is reached", async () => {
    const absent = await post("/api/onboarding/run", { repos: [repoA], since: "7d", method: "resume" });
    expect(absent.status).toBe(409);
    expect(code(absent.body)).toBe("consent-required");
    expect((await post("/api/onboarding/run", { repos: [repoA], since: "7d", method: "resume", consent: false })).status).toBe(409);
    expect((await post("/api/onboarding/run", { repos: [repoA], since: "7d", method: "resume", consent: "true" })).status).toBe(400);
    expect(ops.calls).toEqual([]);
  });

  it("turns the op's api-key-required into the contract's 409", async () => {
    ops.next = refusal("api-key-required", "extraction calls the Anthropic API; set ANTHROPIC_API_KEY first");
    const { status, body } = await post("/api/onboarding/run", { repos: [repoA], since: "7d", method: "extract", consent: true });
    expect(status).toBe(409);
    expect(body).toEqual({ error: { code: "api-key-required", message: expect.stringContaining("ANTHROPIC_API_KEY") as string } });
  });

  it("maps an ordinary op refusal onto its status", async () => {
    ops.next = Object.assign(new Error(`${repoA} is not an enabled repo; run init first`), { code: "usage", details: [] });
    expect((await post("/api/onboarding/run", { repos: [repoA], since: "7d", method: "resume", consent: true })).status).toBe(400);
  });

  it("turns the op's invalid-repo into a 400", async () => {
    ops.next = refusal("invalid-repo", `${repoA} is not a git repository (no .git)`);
    const { status, body } = await post("/api/onboarding/run", { repos: [repoA], since: "7d", method: "resume", consent: true });
    expect([status, code(body)]).toEqual([400, "invalid-repo"]);
  });
});

describe("the write guard on POST /api/onboarding/*", () => {
  const body = { repos: [] as string[] };

  it("403s forbidden-origin for an Origin that is not the server's own, before the body is read", async () => {
    for (const origin of ["https://evil.example", "http://127.0.0.1:1", "null"]) {
      const { status, body: answer } = await post("/api/onboarding/init", body, { origin, host: "127.0.0.1:7419" });
      expect([origin, status, code(answer)]).toEqual([origin, 403, "forbidden-origin"]);
    }
    expect(ops.calls).toEqual([]);
  });

  it("allows the server's own origin and a request with no Origin at all", async () => {
    const own = await post("/api/onboarding/init", { repos: [repoA] }, { origin: "http://127.0.0.1:7419", host: "127.0.0.1:7419" });
    expect(own.status).toBe(200);
    expect((await post("/api/onboarding/init", { repos: [repoA] })).status).toBe(200);
    expect(ops.calls).toHaveLength(2);
  });

  it("415s content-type-required without application/json, and accepts a charset suffix", async () => {
    const response = await server.app.request("/api/onboarding/init", { method: "POST", body: JSON.stringify({ repos: [repoA] }) });
    expect([response.status, code(await response.json())]).toEqual([415, "content-type-required"]);
    expect((await post("/api/onboarding/init", { repos: [repoA] }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("/api/onboarding/init", { repos: [repoA] }, { "content-type": "application/json; charset=utf-8" })).status).toBe(200);
    expect(ops.calls).toHaveLength(1);
  });

  it("leaves the GET routes alone", async () => {
    const response = await server.app.request("/api/onboarding/status", { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(200);
  });
});

describe("GET /api/onboarding/status", () => {
  it("returns the counts", async () => {
    const { status, body } = await get("/api/onboarding/status");
    expect(status).toBe(200);
    expect(body).toEqual({ total: 3, done: 1, failed: 0, running: 2, waiting: 0, retryAfter: null, complete: false });
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
