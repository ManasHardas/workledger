/**
 * The wizard's half of the client — docs/contracts/p8/daemon-and-api.md §Onboarding endpoints —
 * against the real `/api/onboarding/*` routes over a stand-in for the CLI's ops: the paths and
 * queries each method sends, the JSON content type every POST carries (the route's write guard
 * answers 415 without it), the 202 on `run`, and the contract's 409 as an `ApiClientError`.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "@workledger/server";

import { ApiClientError, createSource, isSuggested } from "../src/index.js";
import type { OnboardingOps } from "@workledger/server";
import type { FetchLike, Job, RepoCandidate } from "../src/index.js";

const JOB: Job = {
  id: "01JOB000000000000000000001",
  kind: "backfill",
  session_ulid: "01JBQ4Z8W2K7N3RQ9XMDT5V0AE",
  repo_path: "/r/a",
  status: "queued",
  attempts: 1,
  created_at: "2026-09-09T09:00:00.000Z",
  started_at: null,
  finished_at: null,
  heartbeat_at: null,
  error: null,
  cost_estimate_usd: null,
  log_path: null,
    error_code: null,
    retry_after: null,
};

const calls: { op: string; args: unknown[] }[] = [];

const ops: OnboardingOps = {
  discover: async (roots) => {
    calls.push({ op: "discover", args: [roots] });
    return {
      known: [{ path: "/r/a", name: "a", hasGit: true, enabled: false, harnessSessions: { "claude-code": 2 }, lastSessionAt: null }],
      found: [],
      roots: roots ?? ["/home/Projects"],
    };
  },
  history: async (repos) => {
    calls.push({ op: "history", args: [repos] });
    return { windows: { "7d": { sessions: 1, bytes: 10 }, "30d": { sessions: 2, bytes: 20 }, "90d": { sessions: 3, bytes: 30 } } };
  },
  init: async (input) => {
    calls.push({ op: "init", args: [input] });
    return { results: input.repos.map((p) => ({ path: p, ok: true, hooksWritten: [".claude/settings.json"], trustSteps: [] })) };
  },
  plan: async (input) => {
    calls.push({ op: "plan", args: [input] });
    return input.method === "extract"
      ? { sessions: 3, estimate: { tokens: 1000, usd: 0.01, needsApiKey: true }, unsupported: { codex: 1 } }
      : { sessions: 3, estimate: { seconds: 68 } };
  },
  run: async (input) => {
    calls.push({ op: "run", args: [input] });
    if (input.method === "extract") {
      throw Object.assign(new Error("ANTHROPIC_API_KEY is not set"), { code: "api-key-required" });
    }
    return { jobs: [JOB] };
  },
  status: async () => {
    calls.push({ op: "status", args: [] });
    return { total: 3, done: 1, failed: 0, running: 2, waiting: 0, retryAfter: null, complete: false };
  },
};

let dir: string;
let repo: string;
let baseUrl: string;
let stop: () => Promise<void>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "workledger-api-client-onboarding-"));
  repo = path.join(dir, "a");
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  // Machine mode over no repo at all: the shape `workledger open` runs on a first install, which
  // is exactly when the wizard is used.
  const app = createApp({
    repos: [],
    home: path.join(dir, "home"),
    env: { PATH: "" },
    homeDir: dir,
    onboarding: ops,
  });
  const server = await app.start();
  baseUrl = `http://127.0.0.1:${server.port}`;
  stop = async () => {
    app.close();
    await server.close();
  };
});

afterAll(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("OnboardingSource over the real routes", () => {
  it("sends each call to its route with the contract's query and body", async () => {
    const urls: { url: string; method: string; type: string | undefined }[] = [];
    const recording: FetchLike = async (url, init) => {
      urls.push({ url, method: init?.method ?? "GET", type: init?.headers?.["content-type"] });
      return fetch(url, init);
    };
    const source = createSource("local", { baseUrl, fetch: recording });
    calls.length = 0;

    const discovered = await source.discover();
    expect(discovered.roots).toEqual(["/home/Projects"]);
    expect(isSuggested(discovered.known[0]!)).toBe(true);
    await source.discover([dir]);
    await source.history([repo]);
    const init = await source.initRepos({ repos: [repo] });
    expect(init.results[0]).toMatchObject({ path: repo, ok: true });
    const plan = await source.plan({ repos: [repo], since: "7d", method: "resume" });
    expect(plan).toEqual({ sessions: 3, estimate: { seconds: 68 } });
    const extract = await source.plan({ repos: [repo], since: "7d", method: "extract" });
    expect(extract.unsupported).toEqual({ codex: 1 });
    const run = await source.run({ repos: [repo], since: "7d", method: "resume", consent: true });
    expect(run.jobs).toEqual([JOB]);
    const status = await source.status();
    expect(status).toEqual({ total: 3, done: 1, failed: 0, running: 2, waiting: 0, retryAfter: null, complete: false });

    expect(urls.map((u) => u.url.slice(baseUrl.length))).toEqual([
      "/api/onboarding/discover",
      `/api/onboarding/discover?roots=${encodeURIComponent(dir)}`,
      `/api/onboarding/history?repos=${encodeURIComponent(repo)}`,
      "/api/onboarding/init",
      "/api/onboarding/plan",
      "/api/onboarding/plan",
      "/api/onboarding/run",
      "/api/onboarding/status",
    ]);
    for (const post of urls.filter((u) => u.method === "POST")) expect(post.type).toBe("application/json");
    expect(calls.map((c) => c.op)).toEqual(["discover", "discover", "history", "init", "plan", "plan", "run", "status"]);
    expect(calls[1]!.args[0]).toEqual([dir]);
  });

  it("a scoped source still reaches the machine-wide routes without ?repo=", async () => {
    const urls: string[] = [];
    const recording: FetchLike = async (url, init) => {
      urls.push(url);
      return fetch(url, init);
    };
    await createSource("local", { baseUrl, fetch: recording, repo: "0123456789ab" }).status();
    expect(urls).toEqual([`${baseUrl}/api/onboarding/status`]);
  });

  it("surfaces the contract's refusals as ApiClientError with their code and status", async () => {
    const source = createSource("local", { baseUrl });
    const refused = await source.run({ repos: [repo], since: "7d", method: "extract", consent: true }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiClientError);
    expect(refused).toMatchObject({ code: "api-key-required", status: 409 });

    const bad = await source.history(["relative/path"]).catch((e: unknown) => e);
    expect(bad).toMatchObject({ code: "invalid-repo", status: 400 });
  });

  it("reads suggested off the wire and falls back to hasGit for a server from before amendment 2", () => {
    const candidate: RepoCandidate = { path: "/r", name: "r", hasGit: false, enabled: false, harnessSessions: {}, lastSessionAt: null };
    expect(isSuggested(candidate)).toBe(false);
    expect(isSuggested({ ...candidate, suggested: true })).toBe(true);
    expect(isSuggested({ ...candidate, hasGit: true, suggested: false })).toBe(false);
  });
});
