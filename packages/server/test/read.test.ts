/**
 * The GET half of `docs/contracts/p2/api.md`, read against a temp copy of this repo's dogfood
 * ledger: every documented shape, the orderings, the `q` search, and the one error body.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildBrief } from "@workledger/core/brief";
import { parseItem } from "@workledger/core/render/backlog";
import { parseSessionText } from "@workledger/core/render/session";

import { appFor, seedRepo } from "./helpers.js";
import type { TempRepo } from "./helpers.js";
import type { ServerApp } from "../src/app.js";
import type { BacklogView, NoteRef, SessionView } from "../src/views.js";
import type { Health } from "../src/health.js";

let repo: TempRepo;
let server: ServerApp;

beforeEach(() => {
  repo = seedRepo();
  server = appFor(repo);
});

afterEach(() => {
  server.close();
  repo.cleanup();
});

async function getJson<T>(url: string): Promise<{ status: number; body: T }> {
  const response = await server.app.request(url);
  return { status: response.status, body: (await response.json()) as T };
}

describe("GET /api/sessions", () => {
  it("returns every session in the dogfood ledger, newest `started` first", async () => {
    const { status, body } = await getJson<SessionView[]>("/api/sessions");
    expect(status).toBe(200);
    expect(body.length).toBe(readdirSync(repo.sessions).filter((n) => n.endsWith(".md")).length);
    const started = body.map((s) => s.frontmatter.started);
    expect([...started].sort().reverse()).toEqual(started);
  });

  it("projects a session onto the documented read model", async () => {
    const { body } = await getJson<SessionView[]>("/api/sessions");
    const session = body.find((s) => s.remaining.length > 0);
    expect(session).toBeDefined();
    expect(Object.keys(session!).sort()).toEqual(
      ["done", "frontmatter", "goal", "notes", "remaining", "unparsed"].sort(),
    );
    expect(typeof session!.goal).toBe("string");
    expect(session!.frontmatter.schema_version).toBe(1);
    const remaining = session!.remaining[0]!;
    expect(remaining.ref).toMatch(/^WL-/);
    expect(["new", "updates", "closes"]).toContain(remaining.rel);
    expect(typeof remaining.why).toBe("string");
    // `blockedBy` is core's write-side name; the wire model uses the contract's snake_case.
    expect(remaining).not.toHaveProperty("blockedBy");
    for (const line of session!.done) expect(typeof line.cp).toBe("number");
  });

  it("filters on author, harness, status, since and limit", async () => {
    const all = (await getJson<SessionView[]>("/api/sessions")).body;
    const first = all[0]!.frontmatter;

    expect((await getJson<SessionView[]>(`/api/sessions?harness=${first.harness}`)).body.length).toBe(all.length);
    expect((await getJson<SessionView[]>("/api/sessions?harness=cursor")).body).toEqual([]);
    expect(
      (await getJson<SessionView[]>(`/api/sessions?author=${encodeURIComponent(first.author.email)}`)).body.length,
    ).toBe(all.length);
    expect((await getJson<SessionView[]>("/api/sessions?author=nobody@example.com")).body).toEqual([]);

    const ended = (await getJson<SessionView[]>("/api/sessions?status=ended")).body;
    expect(ended.every((s) => s.frontmatter.status === "ended")).toBe(true);

    expect((await getJson<SessionView[]>("/api/sessions?since=2099-01-01T00:00:00.000Z")).body).toEqual([]);
    expect((await getJson<SessionView[]>("/api/sessions?since=1970-01-01T00:00:00.000Z")).body.length).toBe(all.length);
    expect((await getJson<SessionView[]>("/api/sessions?limit=1")).body.length).toBe(1);
    // A junk limit falls back to the default rather than emptying the list.
    expect((await getJson<SessionView[]>("/api/sessions?limit=abc")).body.length).toBe(all.length);
  });

  it("`q` is a case-insensitive substring over goal, line text and note text", async () => {
    const all = (await getJson<SessionView[]>("/api/sessions")).body;
    const withNote = all.find((s) => s.notes.length > 0)!;
    const needle = withNote.notes[0]!.text.slice(0, 20);

    const hits = (await getJson<SessionView[]>(`/api/sessions?q=${encodeURIComponent(needle.toUpperCase())}`)).body;
    expect(hits.map((s) => s.frontmatter.id)).toContain(withNote.frontmatter.id);
    expect((await getJson<SessionView[]>("/api/sessions?q=zzz-no-such-text")).body).toEqual([]);
  });

  it("serves one session by ulid and 404s an unknown one in the contract's error shape", async () => {
    const all = (await getJson<SessionView[]>("/api/sessions")).body;
    const ulid = all[0]!.frontmatter.id;
    const one = await getJson<SessionView>(`/api/sessions/${ulid}`);
    expect(one.status).toBe(200);
    expect(one.body.frontmatter.id).toBe(ulid);

    const missing = await getJson<{ error: { code: string; message: string } }>("/api/sessions/01ZZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
    expect(typeof missing.body.error.message).toBe("string");
  });
});

describe("GET /api/backlog", () => {
  it("returns `{frontmatter, body}` by rank asc then updated desc, hiding discarded by default", async () => {
    const { status, body } = await getJson<BacklogView[]>("/api/backlog");
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    for (const item of body) {
      expect(Object.keys(item).sort()).toEqual(["body", "frontmatter"]);
      expect(item.frontmatter.status).not.toBe("discarded");
      expect(typeof item.body).toBe("string");
    }
    for (let i = 1; i < body.length; i += 1) {
      const prev = body[i - 1]!.frontmatter;
      const next = body[i]!.frontmatter;
      expect(prev.rank).toBeLessThanOrEqual(next.rank);
      if (prev.rank === next.rank) expect(prev.updated >= next.updated).toBe(true);
    }
  });

  it("honours an explicit `status` comma list, including discarded", async () => {
    const items = readdirSync(repo.backlog).filter((n) => n.endsWith(".md"));
    const target = path.join(repo.backlog, items[0]!);
    const text = readFileSync(target, "utf8").replace("status: proposed", "status: discarded");
    writeFileSync(target, text, "utf8");
    server.model.loadAll();

    const visible = (await getJson<BacklogView[]>("/api/backlog")).body;
    expect(visible.some((i) => i.frontmatter.status === "discarded")).toBe(false);
    const discarded = (await getJson<BacklogView[]>("/api/backlog?status=discarded")).body;
    expect(discarded.length).toBe(1);
    expect(discarded[0]!.frontmatter.status).toBe("discarded");
  });

  it("serves one item by id and 404s an unknown one", async () => {
    const all = (await getJson<BacklogView[]>("/api/backlog")).body;
    const id = all[0]!.frontmatter.id;
    expect((await getJson<BacklogView>(`/api/backlog/${id}`)).body.frontmatter.id).toBe(id);
    const missing = await getJson<{ error: { code: string } }>("/api/backlog/WL-01ZZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });
});

describe("GET /api/notes", () => {
  it("flattens every session's notes with its ulid, newest first", async () => {
    const { status, body } = await getJson<NoteRef[]>("/api/notes");
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    for (const note of body) {
      expect(typeof note.session).toBe("string");
      expect(typeof note.cp).toBe("number");
      expect(["discovery", "decision", "blocker", "question"]).toContain(note.type);
    }
    const sessions = (await getJson<SessionView[]>("/api/sessions")).body.map((s) => s.frontmatter.id);
    const seen = body.map((n) => sessions.indexOf(n.session));
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("filters by type and by `open=true`", async () => {
    const discoveries = (await getJson<NoteRef[]>("/api/notes?type=discovery")).body;
    expect(discoveries.every((n) => n.type === "discovery")).toBe(true);
    // `open` means unresolved blocker/question, so a discovery-only ledger yields nothing.
    const open = (await getJson<NoteRef[]>("/api/notes?open=true")).body;
    expect(open.every((n) => n.type === "blocker" || n.type === "question")).toBe(true);
    expect(open.every((n) => n.resolved !== true)).toBe(true);
  });
});

describe("GET /api/brief", () => {
  it("is text/plain and byte-identical to `buildBrief` over the ledger read straight off disk", async () => {
    const response = await server.app.request("/api/brief");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");

    const backlog = readdirSync(repo.backlog)
      .filter((n) => n.endsWith(".md"))
      .map((n) => ({ frontmatter: parseItem(readFileSync(path.join(repo.backlog, n), "utf8")).frontmatter }));
    const sessions = readdirSync(repo.sessions)
      .filter((n) => n.endsWith(".md"))
      .map((n) => parseSessionText(readFileSync(path.join(repo.sessions, n), "utf8")))
      .map((parsed) => ({
        frontmatter: parsed.frontmatter,
        done: parsed.done.map((line) => line.text),
        notes: parsed.notes.map((line) => ({ type: line.type, text: line.text, cp: line.cp })),
      }));

    // 2000 is `brief.max_tokens` in the dogfood `.workledger/config.yaml`.
    expect(await response.text()).toBe(buildBrief({ backlog, sessions }, { maxTokens: 2000 }));
  });

  it("honours `max_tokens` and rejects a budget below the brief's floor with a 400", async () => {
    const wide = await server.app.request("/api/brief?max_tokens=4000");
    const narrow = await server.app.request("/api/brief?max_tokens=64");
    expect(wide.status).toBe(200);
    expect(narrow.status).toBe(200);
    expect((await narrow.text()).length).toBeLessThanOrEqual((await wide.text()).length);

    const tiny = await server.app.request("/api/brief?max_tokens=1");
    expect(tiny.status).toBe(400);
    expect(((await tiny.json()) as { error: { code: string } }).error.code).toBe("bad_request");

    const junk = await server.app.request("/api/brief?max_tokens=nope");
    expect(junk.status).toBe(400);
  });
});

describe("GET /api/health", () => {
  it("returns the Health read model", async () => {
    const { status, body } = await getJson<Health>("/api/health");
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      ["cli", "config", "harnesses", "index", "lastHookAt", "repo"].sort(),
    );
    expect(body.repo).toBe(repo.root);
    expect(body.harnesses[0]!.harness).toBe("claude-code");
    // `env.PATH` is empty in the test app, so `claude` cannot be found.
    expect(body.harnesses[0]!.binary).toBeNull();
    expect(body.index.path.endsWith("index.sqlite")).toBe(true);
    expect(body.index.bytes).toBe(0);
    expect(body.index.openSessions).toBe(0);
    expect(body.config.valid).toBe(true);
    expect(body.config.problems).toEqual([]);
    expect(typeof body.lastHookAt).toBe("string");
  });

  it("reports an invalid config and an unparsable ledger file as problems", async () => {
    writeFileSync(path.join(repo.ledger, "config.yaml"), "schema_version: nope\n", "utf8");
    writeFileSync(path.join(repo.sessions, "01M2Z00000000000000000000.md"), "not a session file\n", "utf8");
    server.model.loadAll();

    const { body } = await getJson<Health>("/api/health");
    expect(body.config.valid).toBe(false);
    expect(body.config.problems.length).toBeGreaterThanOrEqual(2);
    expect(body.config.problems.some((p) => p.includes("01M2Z00000000000000000000.md"))).toBe(true);
    // The bad file is dropped from the read model rather than taking the endpoint down.
    expect((await getJson<SessionView[]>("/api/sessions")).body.every((s) => s.frontmatter.id !== "01M2Z00000000000000000000")).toBe(true);
  });
});

describe("routing", () => {
  it("404s an unknown /api path in the error shape and never falls through", async () => {
    const response = await server.app.request("/api/nope");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("404s a non-/api path when no staticDir is configured", async () => {
    const response = await server.app.request("/");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});
