/**
 * Machine mode — docs/contracts/p8/daemon-and-api.md §Repo identity and §Multi-repo endpoints:
 * two temp repos behind one server, `/api/repos`, the required `repo` parameter and its two
 * refusals, the aggregate reads, the `repo` field on every SSE event, and the machine-wide
 * `/api/health`. Single-repo mode is asserted alongside so the debug path (`serve --repo`) keeps
 * P2's "no parameter needed" behaviour.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { EventBus } from "../src/events.js";
import { LEDGER_DIR } from "../src/paths.js";
import { RepoRegistry, repoId } from "../src/repos.js";
import { FakeJobOps, FakeOps, fakeJob, seedRepo } from "./helpers.js";
import type { LedgerEvent } from "../src/events.js";
import type { Health } from "../src/health.js";
import type { Repo } from "../src/repos.js";
import type { ServerApp } from "../src/app.js";
import type { TempRepo } from "./helpers.js";
import type { JobAcrossRepos, NoteAcrossRepos } from "../src/routes/repos.js";
import type { NoteRef, SessionView } from "../src/views.js";

interface ErrorBody {
  error: { code: string; message: string };
}

let alpha: TempRepo;
let beta: TempRepo;
let jobs: FakeJobOps;
let server: ServerApp;

beforeEach(() => {
  alpha = seedRepo();
  beta = seedRepo();
  jobs = new FakeJobOps();
  server = createApp({
    repos: [alpha.root, beta.root],
    ops: new FakeOps("WL-unset"),
    jobs,
    home: path.join(alpha.root, "home"),
    env: { PATH: "" },
    homeDir: alpha.root,
    jobPollMs: 60_000,
  });
});

afterEach(() => {
  server.close();
  alpha.cleanup();
  beta.cleanup();
});

async function getJson<T>(url: string): Promise<{ status: number; body: T }> {
  const response = await server.app.request(url);
  return { status: response.status, body: (await response.json()) as T };
}

describe("repoId", () => {
  it("is the first 12 hex of sha256 over the absolute .workledger path", () => {
    const expected = createHash("sha256")
      .update(path.join(alpha.root, LEDGER_DIR))
      .digest("hex")
      .slice(0, 12);
    expect(repoId(alpha.root)).toBe(expected);
    expect(repoId(alpha.root)).toMatch(/^[0-9a-f]{12}$/);
    expect(repoId(alpha.root)).not.toBe(repoId(beta.root));
    // Resolved, so a relative spelling of the same root is the same repo.
    expect(repoId(path.relative(process.cwd(), alpha.root))).toBe(repoId(alpha.root));
  });
});

describe("GET /api/repos", () => {
  it("lists both repos in the contract's shape, by path", async () => {
    const { status, body } = await getJson<Repo[]>("/api/repos");
    expect(status).toBe(200);
    expect(body.map((r) => r.path)).toEqual([alpha.root, beta.root].sort());
    for (const repo of body) {
      expect(Object.keys(repo).sort()).toEqual(
        ["enabled", "harnesses", "health", "id", "lastHookAt", "name", "openBacklog", "openNotes", "path", "sessions7d"].sort(),
      );
      expect(repo.id).toBe(repoId(repo.path));
      expect(repo.name).toBe(path.basename(repo.path));
      expect(repo.enabled).toBe(true);
      expect(repo.harnesses.length).toBeGreaterThan(0);
      expect(repo.health).toBe("ok");
      expect(typeof repo.sessions7d).toBe("number");
      expect(typeof repo.lastHookAt).toBe("string");
    }
    // Counts come from the ledger, so they agree with the per-repo reads.
    const first = body[0]!;
    const notes = await getJson<NoteRef[]>(`/api/notes?open=true&repo=${first.id}`);
    expect(first.openNotes).toBe(notes.body.length);
  });

  it("reports a broken repo when its ledger directory is gone", async () => {
    rmSync(alpha.ledger, { recursive: true, force: true });
    const { body } = await getJson<Repo[]>("/api/repos");
    expect(body.find((r) => r.path === alpha.root)?.health).toBe("broken");
  });

  it("reports warn when a ledger file will not parse", async () => {
    writeFileSync(path.join(beta.sessions, "01ZZZZZZZZZZZZZZZZZZZZZZZZ.md"), "not a session\n", "utf8");
    server.repos.get(repoId(beta.root))!.model.loadAll();
    const { body } = await getJson<Repo[]>("/api/repos");
    expect(body.find((r) => r.path === beta.root)?.health).toBe("warn");
  });
});

describe("the repo parameter in machine mode", () => {
  it("400s every per-repo route without it", async () => {
    for (const url of ["/api/sessions", "/api/backlog", "/api/notes", "/api/brief", "/api/identities", "/api/jobs"]) {
      const { status, body } = await getJson<ErrorBody>(url);
      expect(status, url).toBe(400);
      expect(body.error.code, url).toBe("repo-required");
    }
    const post = await server.app.request("/api/backlog/WL-01M246Y97SPQKRBJJYNX141QB5/accept", { method: "POST" });
    expect(post.status).toBe(400);
    expect(((await post.json()) as ErrorBody).error.code).toBe("repo-required");
  });

  it("404s an id it does not hold", async () => {
    const { status, body } = await getJson<ErrorBody>("/api/sessions?repo=000000000000");
    expect(status).toBe(404);
    expect(body.error.code).toBe("repo-not-found");
  });

  it("serves each repo's own ledger under its id", async () => {
    const id = "WL-01M246Y97SPQKRBJJYNX141QB6";
    const source = path.join(beta.backlog, "WL-01M246Y97SPQKRBJJYNX141QB5.md");
    writeFileSync(path.join(beta.backlog, `${id}.md`), readFileSync(source, "utf8").replace("WL-01M246Y97SPQKRBJJYNX141QB5", id), "utf8");
    server.repos.get(repoId(beta.root))!.model.loadAll();

    expect((await getJson(`/api/backlog/${id}?repo=${repoId(beta.root)}`)).status).toBe(200);
    expect((await getJson(`/api/backlog/${id}?repo=${repoId(alpha.root)}`)).status).toBe(404);

    const sessions = await getJson<SessionView[]>(`/api/sessions?repo=${repoId(alpha.root)}&limit=1`);
    expect(sessions.status).toBe(200);
    expect(sessions.body).toHaveLength(1);
  });

  it("scopes the job routes to the named repo", async () => {
    jobs.rows = [fakeJob({ id: "JOB-1" })];
    const { status } = await getJson(`/api/jobs?repo=${repoId(beta.root)}`);
    expect(status).toBe(200);
    expect(jobs.calls.at(-1)).toEqual({ op: "listJobs", args: [beta.root, undefined] });
  });

  it("keeps one write lock per repo", () => {
    expect(server.repos.get(repoId(alpha.root))!.mutex).not.toBe(server.repos.get(repoId(beta.root))!.mutex);
  });
});

describe("aggregates", () => {
  it("GET /api/notes/all carries every repo's notes with the repo on each row", async () => {
    const { status, body } = await getJson<NoteAcrossRepos[]>("/api/notes/all");
    expect(status).toBe(200);
    const perRepo = await Promise.all(
      [alpha, beta].map((repo) => getJson<NoteRef[]>(`/api/notes?limit=100000&repo=${repoId(repo.root)}`)),
    );
    expect(body.length).toBe(perRepo[0]!.body.length + perRepo[1]!.body.length);
    expect(body.length).toBeGreaterThan(0);
    for (const note of body) {
      expect(note.repo.id).toBe(repoId(note.repo.path));
      expect([alpha.root, beta.root]).toContain(note.repo.path);
      expect(typeof note.session).toBe("string");
    }
    // The filters are the P2 ones, applied per repo.
    const blockers = await getJson<NoteAcrossRepos[]>("/api/notes/all?type=blocker");
    expect(blockers.body.every((note) => note.type === "blocker")).toBe(true);
    const open = await getJson<NoteAcrossRepos[]>("/api/notes/all?open=true");
    expect(open.body.every((note) => note.resolved !== true && ["blocker", "question"].includes(note.type))).toBe(true);
  });

  it("GET /api/jobs/all lists every repo's jobs newest first with the repo on each row", async () => {
    jobs.rows = [fakeJob({ id: "JOB-old", created_at: "2026-09-09T09:00:00.000Z" }), fakeJob({ id: "JOB-new", created_at: "2026-09-09T10:00:00.000Z" })];
    const { status, body } = await getJson<JobAcrossRepos[]>("/api/jobs/all");
    expect(status).toBe(200);
    // The fake answers the same two rows for each repo.
    expect(body).toHaveLength(4);
    expect(body.map((job) => job.id)).toEqual(["JOB-new", "JOB-new", "JOB-old", "JOB-old"]);
    expect(new Set(body.map((job) => job.repo.path))).toEqual(new Set([alpha.root, beta.root]));
    // One `listJobs` per repo for the aggregate (the earlier calls are the pollers priming).
    expect(jobs.calls.slice(-2).map((call) => call.args[0]).sort()).toEqual([alpha.root, beta.root].sort());
  });

  it("GET /api/jobs/all is an empty list on a build without job ops", async () => {
    const plain = createApp({ repos: [alpha.root], ops: new FakeOps("x"), env: { PATH: "" }, homeDir: alpha.root });
    try {
      expect((await plain.app.request("/api/jobs/all").then((r) => r.json())) as unknown).toEqual([]);
    } finally {
      plain.close();
    }
  });
});

describe("GET /api/health in machine mode", () => {
  it("is machine-wide without a repo: null repo, folded counts, every repo listed", async () => {
    const { status, body } = await getJson<Health>("/api/health");
    expect(status).toBe(200);
    expect(body.repo).toBeNull();
    expect(body.repos.map((r) => r.path)).toEqual([alpha.root, beta.root].sort());
    const each = await Promise.all(
      [alpha, beta].map((repo) => getJson<Health>(`/api/health?repo=${repoId(repo.root)}`)),
    );
    expect(body.index.openSessions).toBe(each[0]!.body.index.openSessions + each[1]!.body.index.openSessions);
    expect(body.config.valid).toBe(true);
    expect(body.lastHookAt).toBe([each[0]!.body.lastHookAt, each[1]!.body.lastHookAt].sort().at(-1));
  });

  it("is one repo's report with a repo, still listing every repo", async () => {
    const { body } = await getJson<Health>(`/api/health?repo=${repoId(beta.root)}`);
    expect(body.repo).toBe(beta.root);
    expect(body.repos).toHaveLength(2);
  });

  it("prefixes a repo's config problem with its name", async () => {
    writeFileSync(path.join(alpha.ledger, "config.yaml"), "thresholds: [nope\n", "utf8");
    const { body } = await getJson<Health>("/api/health");
    expect(body.config.valid).toBe(false);
    expect(body.config.problems.some((line) => line.startsWith(`${path.basename(alpha.root)}: `))).toBe(true);
  });
});

describe("SSE", () => {
  it("stamps each repo's id on its own events", async () => {
    const seen: LedgerEvent[] = [];
    server.events.subscribe((event) => void seen.push(event));

    // Drive both watchers' `onChange` through the registry rather than the filesystem: the
    // events test already proves the watcher fires; this asserts what it stamps.
    const bus = new EventBus();
    const registry = new RepoRegistry({ mode: "machine", bus, jobs, debounceMs: 5, pollMs: 50, jobPollMs: 60_000 });
    const events: LedgerEvent[] = [];
    bus.subscribe((event) => void events.push(event));
    const a = registry.add(alpha.root);
    const b = registry.add(beta.root);
    try {
      jobs.rows = [fakeJob({ id: "JOB-9", status: "queued" })];
      await a.jobWatcher!.tick();
      jobs.rows = [fakeJob({ id: "JOB-9", status: "running" })];
      await a.jobWatcher!.tick();
      await b.jobWatcher!.tick();
      // alpha's poller saw the row appear and then move; beta's saw it appear.
      const changed = events.filter((event) => event.event === "job.changed");
      expect(changed.map((event) => event.data.repo)).toEqual([a.id, a.id, b.id]);
      expect(a.id).toBe(repoId(alpha.root));
    } finally {
      registry.close();
    }
  });
});

describe("single-repo mode", () => {
  let single: ServerApp;
  beforeEach(() => {
    single = createApp({ repoRoot: alpha.root, ops: new FakeOps("x"), env: { PATH: "" }, homeDir: alpha.root });
  });
  afterEach(() => single.close());

  it("does not need the parameter, accepts its own id, and 404s another", async () => {
    expect(single.mode).toBe("single");
    expect((await single.app.request("/api/sessions")).status).toBe(200);
    expect((await single.app.request(`/api/sessions?repo=${repoId(alpha.root)}`)).status).toBe(200);
    const other = await single.app.request(`/api/sessions?repo=${repoId(beta.root)}`);
    expect(other.status).toBe(404);
    expect(((await other.json()) as ErrorBody).error.code).toBe("repo-not-found");
    const health = (await single.app.request("/api/health").then((r) => r.json())) as Health;
    expect(health.repo).toBe(alpha.root);
    expect(health.repos.map((r) => r.id)).toEqual([repoId(alpha.root)]);
  });
});

describe("createApp", () => {
  it("refuses both or neither of repoRoot and repos", () => {
    const ops = new FakeOps("x");
    expect(() => createApp({ ops })).toThrow(TypeError);
    expect(() => createApp({ ops, repoRoot: alpha.root, repos: [] })).toThrow(TypeError);
  });

  it("serves nothing in machine mode until a repo is added, then serves it", async () => {
    const empty = createApp({ repos: [], ops: new FakeOps("x"), env: { PATH: "" }, homeDir: alpha.root });
    try {
      expect(empty.mode).toBe("machine");
      expect((await empty.app.request("/api/repos").then((r) => r.json())) as unknown).toEqual([]);
      expect(() => empty.model).toThrow(/no repo/);
      const added = empty.addRepo(alpha.root);
      expect(added.id).toBe(repoId(alpha.root));
      expect(empty.addRepo(alpha.root)).toBe(added);
      expect((await empty.app.request(`/api/sessions?repo=${added.id}`)).status).toBe(200);
      expect(empty.removeRepo(added.id)).toBe(true);
      expect(empty.removeRepo(added.id)).toBe(false);
      expect((await empty.app.request(`/api/sessions?repo=${added.id}`)).status).toBe(404);
    } finally {
      empty.close();
    }
  });

  it("tolerates a repo root that does not exist yet", () => {
    const missing = path.join(alpha.root, "nope");
    mkdirSync(missing);
    const app = createApp({ repos: [missing], ops: new FakeOps("x"), env: { PATH: "" }, homeDir: alpha.root });
    try {
      expect(app.repos.describeAll()[0]?.health).toBe("broken");
    } finally {
      app.close();
    }
  });
});
