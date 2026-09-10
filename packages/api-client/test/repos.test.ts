/**
 * The P8 half of the client — docs/contracts/p8/daemon-and-api.md §Multi-repo endpoints —
 * against a real machine-mode server over two temp repos: `listRepos`, the repo-scoped source
 * (`repo` option and `forRepo`) and the `?repo=` it adds to every call, the two refusals an
 * unscoped or mis-scoped call gets back, the aggregates, and the `repo` stamp on SSE frames
 * with the scoped source's filter.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { repoId } from "@workledger/server";

import { ApiClientError, LocalServerSource, createSource, toLedgerEvent } from "../src/index.js";
import { sseSource, startMachineHarness, waitFor } from "./helpers.js";
import type { MachineHarness } from "./helpers.js";
import type { FetchLike, LedgerEvent, Repo } from "../src/index.js";

let harness: MachineHarness;
let machine: ReturnType<typeof createSource>;
let repos: Repo[];

beforeAll(async () => {
  harness = await startMachineHarness();
  machine = createSource("local", { baseUrl: harness.baseUrl, EventSource: sseSource });
  repos = await machine.listRepos();
});

afterAll(async () => {
  await harness.stop();
});

describe("listRepos", () => {
  it("lists both repos in the contract's shape", () => {
    expect(repos.map((r) => r.path)).toEqual(harness.roots);
    for (const repo of repos) {
      expect(repo.id).toBe(repoId(repo.path));
      expect(repo.name).toBe(path.basename(repo.path));
      expect(repo.enabled).toBe(true);
      expect(repo.health).toBe("ok");
      expect(Array.isArray(repo.harnesses)).toBe(true);
    }
  });
});

describe("the repo-scoped source", () => {
  it("adds ?repo=<id> to every per-repo call, GET and POST, with or without a query already there", async () => {
    const urls: string[] = [];
    const recording: FetchLike = async (url, init) => {
      urls.push(url);
      return globalThis.fetch(url, init as RequestInit);
    };
    const scoped = new LocalServerSource({ baseUrl: harness.baseUrl, fetch: recording, repo: repos[0]!.id });

    await scoped.listSessions({ limit: 1 });
    await scoped.listBacklog();
    await scoped.health();
    await scoped.brief();
    await scoped.listIdentities();
    await scoped.accept("WL-01M246Y97SPQKRBJJYNX141QB5").catch(() => undefined);
    await scoped.listJobs().catch(() => undefined);

    const param = `repo=${repos[0]!.id}`;
    expect(urls.every((url) => url.includes(param))).toBe(true);
    expect(urls[0]).toBe(`${harness.baseUrl}/api/sessions?limit=1&${param}`);
    expect(urls[1]).toBe(`${harness.baseUrl}/api/backlog?${param}`);
    expect(urls.find((url) => url.includes("/accept"))).toBe(`${harness.baseUrl}/api/backlog/WL-01M246Y97SPQKRBJJYNX141QB5/accept?${param}`);
  });

  it("reads that repo's ledger, and health is that repo's report", async () => {
    const first = machine.forRepo(repos[0]!.id);
    expect(first.repo).toBe(repos[0]!.id);
    const sessions = await first.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const health = await first.health();
    expect(health.repo).toBe(repos[0]!.path);
    expect(health.repos.map((r) => r.id)).toEqual(repos.map((r) => r.id));
  });

  it("is what createSource gives when `repo` is passed", async () => {
    const direct = createSource("local", { baseUrl: harness.baseUrl, repo: repos[1]!.id });
    expect((await direct.health()).repo).toBe(repos[1]!.path);
  });

  it("surfaces the daemon's two refusals as ApiClientError codes", async () => {
    await expect(machine.listSessions()).rejects.toMatchObject({ code: "repo-required", status: 400 });
    await expect(machine.forRepo("000000000000").listSessions()).rejects.toMatchObject({
      code: "repo-not-found",
      status: 404,
    });
    await expect(machine.listSessions()).rejects.toBeInstanceOf(ApiClientError);
  });

  it("machine-wide health is the null-repo report with every repo", async () => {
    const health = await machine.health();
    expect(health.repo).toBeNull();
    expect(health.repos).toHaveLength(2);
  });
});

describe("aggregates", () => {
  it("listAllNotes carries the repo on every row and applies the P2 filters", async () => {
    const all = await machine.listAllNotes();
    expect(all.length).toBeGreaterThan(0);
    for (const note of all) {
      expect(repos.map((r) => r.id)).toContain(note.repo.id);
      expect(typeof note.session).toBe("string");
    }
    const blockers = await machine.listAllNotes({ type: ["blocker"], open: true });
    expect(blockers.every((note) => note.type === "blocker" && note.resolved !== true)).toBe(true);
  });

  it("listAllJobs is a list (empty on a server without job ops)", async () => {
    expect(await machine.listAllJobs()).toEqual([]);
  });
});

describe("SSE", () => {
  it("passes the repo stamp through, and a scoped source only sees its own repo's events", async () => {
    const everything: LedgerEvent[] = [];
    const onlyA: LedgerEvent[] = [];
    const scopedA = machine.forRepo(repos[0]!.id);
    const unsubscribeAll = machine.subscribe((event) => void everything.push(event));
    const unsubscribeA = scopedA.subscribe((event) => void onlyA.push(event));
    try {
      // Give both streams a moment to connect before the write that should reach them.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const backlogB = path.join(repos[1]!.path, ".workledger", "backlog");
      mkdirSync(backlogB, { recursive: true });
      const id = "WL-01M246Y97SPQKRBJJYNX141QB7";
      const source = path.join(backlogB, "WL-01M246Y97SPQKRBJJYNX141QB5.md");
      writeFileSync(path.join(backlogB, `${id}.md`), readFileSync(source, "utf8").replace("WL-01M246Y97SPQKRBJJYNX141QB5", id), "utf8");

      await waitFor(
        () => everything.some((event) => event.type === "backlog.changed" && event.id === id),
        8000,
        "backlog.changed for repo b",
      );
      const seen = everything.find((event) => event.type === "backlog.changed" && event.id === id)!;
      expect(seen.repo).toBe(repos[1]!.id);
      expect(onlyA.some((event) => event.type === "backlog.changed" && event.id === id)).toBe(false);
    } finally {
      unsubscribeAll();
      unsubscribeA();
    }
  });

  it("toLedgerEvent keeps the stamp when present and omits it when absent", () => {
    expect(toLedgerEvent("notes.changed", '{"repo":"abc"}')).toEqual({ type: "notes.changed", repo: "abc" });
    expect(toLedgerEvent("notes.changed", "{}")).toEqual({ type: "notes.changed" });
    expect(toLedgerEvent("job.changed", '{"id":"J","status":"done","repo":"abc"}')).toEqual({
      type: "job.changed",
      id: "J",
      status: "done",
      repo: "abc",
    });
  });
});
