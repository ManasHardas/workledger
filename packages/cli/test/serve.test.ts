/**
 * `workledger serve` and the POST endpoints against the *real* `backlog-ops.ts` (#34).
 *
 * The acceptance criterion is "every POST produces files identical to the CLI command", so every
 * write test here runs twice over two ledgers seeded from the same bytes — once through
 * `app.request('POST …')` and once through `backlogCommand` / `noteCommand` — and compares the
 * two files byte for byte. That is a stronger claim than "both wrote something plausible": the
 * frontmatter key order, the history entry, the `updated` stamp and the body all have to match.
 *
 * `Date` is faked (and only `Date` — the watcher's timers stay real) so the two runs stamp the
 * same instant. Without that the comparison could only ever be made after blanking the
 * timestamps, which is exactly the field most likely to drift between the two callers.
 *
 * These tests live in `packages/cli` rather than in `packages/server` because they are the only
 * ones that need both implementations in reach: the server is handed its writer
 * (`packages/server/src/ops.ts`) and never imports one.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "@workledger/server";
import { parseFrontmatter, stringifyFrontmatter } from "@workledger/core/frontmatter";
import { createItem, parseItem } from "@workledger/core/render/backlog";
import { appendCheckpoint, createSessionText } from "@workledger/core/render/session";

import * as ops from "../src/backlog-ops.js";
import { backlogCommand } from "../src/commands/backlog.js";
import { noteCommand } from "../src/commands/note.js";
import { hasWebBuild, placeholderHtml, serveCommand, webDir } from "../src/commands/serve.js";
import { EXIT_NOT_ENABLED, EXIT_OK } from "../src/exit-codes.js";
import { backlogFile, sessionFile } from "../src/ledger-fs.js";

import type { ServerApp } from "@workledger/server";
import type { CommandIo } from "../src/commands/backlog.js";
import type { ServeIo } from "../src/commands/serve.js";

const SESSION = "01JQ8ZK4T0000000000000000A";
const ID_PREFIX = "WL-01JQ8ZK4T000000000000000";
const A = `${ID_PREFIX}0A`;
const B = `${ID_PREFIX}0B`;
const NOW = "2026-09-09T12:00:00.000Z";
const LATER = new Date("2026-09-10T09:30:00.000Z");
const BY = { name: "Ada Lovelace", email: "ada@example.com" };
const AUTHOR = { name: "Agent", email: "agent@example.com" };

const apps: ServerApp[] = [];

beforeEach(() => {
  // Only `Date`: the watcher and the SSE ping run on real timers, and faking those would hang
  // `app.close()`.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LATER);
});

afterEach(() => {
  for (const app of apps.splice(0)) app.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** A temp repo with a git identity and an empty `.workledger/`. */
function repo(options: { enabled?: boolean; identity?: boolean } = {}): string {
  const enabled = options.enabled ?? true;
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-serve-"));
  const root = path.join(dir, "repo");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(
    path.join(root, ".git", "config"),
    (options.identity ?? true)
      ? `[user]\n\tname = ${BY.name}\n\temail = ${BY.email}\n`
      : "[core]\n\tbare = false\n",
    "utf8",
  );
  if (enabled) {
    mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
    mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  }
  return root;
}

/** Seed one backlog item, overriding the frontmatter the ops cannot produce. */
function seedItem(root: string, id: string, over: Record<string, unknown> = {}): void {
  const text = createItem({
    id,
    title: `Item ${id.slice(-1)}`,
    why: `Because ${id.slice(-1)} matters.`,
    provenance: { harness: "claude-code", session: SESSION, checkpoint: 1, author: AUTHOR },
    now: NOW,
  });
  const parsed = parseFrontmatter(text);
  writeFileSync(backlogFile(root, id), stringifyFrontmatter({ ...parsed.data, ...over }, parsed.body), "utf8");
}

/** Seed the session digest with one blocker note at checkpoint 1. */
function seedSession(root: string): void {
  const base = createSessionText({
    schema_version: 1,
    id: SESSION,
    harness: "claude-code",
    harness_session_id: "abc",
    repo: "github.com/o/r",
    branch: "main",
    author: AUTHOR,
    started: NOW,
    status: "open",
    private: false,
    source: "live",
    model: null,
    needs_repair: false,
    checkpoint_failures: 0,
    checkpoints: [],
  });
  const { text } = appendCheckpoint(
    base,
    {
      goal: "Ship the P2 write endpoints",
      done: [],
      remaining: [],
      notes: [{ type: "blocker", text: "The API is undecided" }],
    },
    { n: 1, at: NOW, turns: 1, transcript_offset: 0, trigger: "manual" },
  );
  writeFileSync(sessionFile(root, SESSION), text, "utf8");
}

/** A pair of ledgers seeded identically: one driven over HTTP, one driven through the CLI. */
interface Twin {
  http: string;
  cli: string;
  app: ServerApp;
  io: CommandIo & { out: string[]; err: string[] };
}

function twin(seed: (root: string) => void): Twin {
  const http = repo();
  const cli = repo();
  seed(http);
  seed(cli);
  const app = createApp({ repoRoot: http, ops, env: {}, homeDir: http, home: path.join(http, "home") });
  apps.push(app);
  const out: string[] = [];
  const err: string[] = [];
  return {
    http,
    cli,
    app,
    io: {
      cwd: cli,
      env: {},
      out,
      err,
      stdout: (text) => void out.push(text),
      stderr: (line) => void err.push(line),
    },
  };
}

async function post(app: ServerApp, url: string, body?: unknown): Promise<Response> {
  return app.app.request(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

/** The two ledgers' copies of one file, for a byte comparison. */
function bytes(twins: Twin, file: (root: string) => string): [string, string] {
  return [readFileSync(file(twins.http), "utf8"), readFileSync(file(twins.cli), "utf8")];
}

describe("every POST writes the bytes its CLI command writes", () => {
  /**
   * The five status transitions plus the three field edits, each as the HTTP request and the
   * argv that must produce the same file.
   */
  const CASES = [
    { name: "accept", status: "proposed", url: `/api/backlog/${A}/accept`, argv: ["accept", A] },
    { name: "discard", status: "proposed", url: `/api/backlog/${A}/discard`, argv: ["discard", A] },
    { name: "done", status: "proposed", url: `/api/backlog/${A}/done`, argv: ["done", A] },
    { name: "start", status: "accepted", url: `/api/backlog/${A}/start`, argv: ["start", A] },
    { name: "restore from discarded", status: "discarded", url: `/api/backlog/${A}/restore`, argv: ["restore", A] },
    { name: "restore from done", status: "done", url: `/api/backlog/${A}/restore`, argv: ["restore", A] },
    {
      name: "edit",
      status: "proposed",
      url: `/api/backlog/${A}/edit`,
      body: { title: "Renamed", body: "New body.\n", priority: "p1", area: ["cli", "server"] },
      argv: ["edit", A, "--title", "Renamed", "--body", "New body.\n", "--priority", "p1", "--area", "cli,server"],
    },
    {
      name: "edit clearing the priority",
      status: "proposed",
      url: `/api/backlog/${A}/edit`,
      body: { priority: null },
      argv: ["edit", A, "--priority", "none"],
    },
    {
      name: "assign",
      status: "proposed",
      url: `/api/backlog/${A}/assign`,
      body: { owner: { name: "Grace Hopper", email: "grace@example.com" } },
      argv: ["assign", A, "--owner", "Grace Hopper <grace@example.com>"],
    },
    {
      name: "assign clearing the owner",
      status: "accepted",
      url: `/api/backlog/${A}/assign`,
      body: { owner: null },
      argv: ["assign", A, "--none"],
    },
    { name: "rank", status: "proposed", url: `/api/backlog/${A}/rank`, body: { rank: 7 }, argv: ["rank", A, "7"] },
  ] as const;

  for (const testCase of CASES) {
    it(`${testCase.name}`, async () => {
      const twins = twin((root) => seedItem(root, A, { status: testCase.status }));

      const response = await post(twins.app, testCase.url, (testCase as { body?: unknown }).body);
      expect(await backlogCommand([...testCase.argv], twins.io)).toBe(EXIT_OK);

      expect(response.status).toBe(200);
      const [served, wrote] = bytes(twins, (root) => backlogFile(root, A));
      expect(served).toBe(wrote);

      // …and the response body is the item as it now stands on disk, so the UI need not re-GET.
      const view = (await response.json()) as { frontmatter: { id: string; updated: string } };
      expect(view.frontmatter.id).toBe(A);
      expect(served).toContain(`updated: ${view.frontmatter.updated}`);
    });
  }

  it("merge, on both files", async () => {
    const twins = twin((root) => {
      seedItem(root, A, { status: "proposed" });
      seedItem(root, B, { status: "accepted" });
    });

    const response = await post(twins.app, `/api/backlog/${A}/merge`, { into: B });
    expect(await backlogCommand(["merge", A, "--into", B], twins.io)).toBe(EXIT_OK);

    expect(response.status).toBe(200);
    const [sourceServed, sourceWrote] = bytes(twins, (root) => backlogFile(root, A));
    const [targetServed, targetWrote] = bytes(twins, (root) => backlogFile(root, B));
    expect(sourceServed).toBe(sourceWrote);
    expect(targetServed).toBe(targetWrote);

    const body = (await response.json()) as { source: { frontmatter: { status: string } }; target: unknown };
    expect(body.source.frontmatter.status).toBe("discarded");
    expect(targetServed).toContain(`Merged from ${A}:`);
  });

  it("notes/resolve, on the session file", async () => {
    const twins = twin(seedSession);

    const response = await post(twins.app, "/api/notes/resolve", {
      session: SESSION,
      cp: 1,
      index: 0,
      decision: "We picked Hono",
    });
    expect(await noteCommand(["resolve", SESSION, "1", "0", "--decision", "We picked Hono"], twins.io)).toBe(EXIT_OK);

    expect(response.status).toBe(200);
    const [served, wrote] = bytes(twins, (root) => sessionFile(root, SESSION));
    expect(served).toBe(wrote);
    expect(served).toContain("resolves blocker #0");

    // The response is the re-parsed session, with the note now marked resolved.
    const view = (await response.json()) as { notes: { type: string; resolved?: boolean }[] };
    expect(view.notes.find((note) => note.type === "blocker")?.resolved).toBe(true);
  });
});

describe("the error statuses of api.md", () => {
  it("404s an id the ledger does not have", async () => {
    const twins = twin(() => undefined);
    const response = await post(twins.app, `/api/backlog/${A}/accept`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("404s an unknown session on notes/resolve", async () => {
    const twins = twin(() => undefined);
    const response = await post(twins.app, "/api/notes/resolve", {
      session: SESSION,
      cp: 1,
      index: 0,
      decision: "d",
    });
    expect(response.status).toBe(404);
  });

  it("409s an illegal transition, listing the legal targets", async () => {
    const twins = twin((root) => seedItem(root, A, { status: "discarded" }));

    const response = await post(twins.app, `/api/backlog/${A}/accept`);

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("legal targets from discarded: proposed");
    // Nothing was written: the CLI refuses the same move with exit 1.
    expect(readFileSync(backlogFile(twins.http, A), "utf8")).toContain("status: discarded");
  });

  it("409s a note that is already resolved", async () => {
    const twins = twin(seedSession);
    const body = { session: SESSION, cp: 1, index: 0, decision: "once" };
    expect((await post(twins.app, "/api/notes/resolve", body)).status).toBe(200);
    expect((await post(twins.app, "/api/notes/resolve", body)).status).toBe(409);
  });

  it("409s every write when git has no identity", async () => {
    const root = repo({ identity: false });
    // `gitInfo` falls back to the user's global config, which on a developer machine does have
    // an identity; point HOME at an empty directory so the fixture is the only config in reach.
    const home = mkdtempSync(path.join(os.tmpdir(), "workledger-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));
    seedItem(root, A);
    const app = createApp({ repoRoot: root, ops, env: {}, homeDir: root, home: path.join(root, "home") });
    apps.push(app);

    const response = await post(app, `/api/backlog/${A}/accept`);

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("no_identity");
  });

  it("400s an id that is not a WL-<ulid>", async () => {
    const twins = twin(() => undefined);
    expect((await post(twins.app, "/api/backlog/nope/accept")).status).toBe(400);
  });

  it("400s a malformed body before anything is written", async () => {
    const twins = twin((root) => seedItem(root, A));
    expect((await post(twins.app, `/api/backlog/${A}/rank`, { rank: "seven" })).status).toBe(400);
    expect(readFileSync(backlogFile(twins.http, A), "utf8")).toContain("rank: 0");
  });
});

describe("the per-id mutex", () => {
  it("keeps both history entries when two writes to one item overlap", async () => {
    const twins = twin((root) => seedItem(root, A, { status: "proposed" }));

    // Concurrent, not sequential: without the mutex the second op would re-read the file before
    // the first wrote it, and its write would drop the first's history entry.
    const [first, second] = await Promise.all([
      post(twins.app, `/api/backlog/${A}/edit`, { title: "One" }),
      post(twins.app, `/api/backlog/${A}/rank`, { rank: 3 }),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    const item = parseItem(readFileSync(backlogFile(twins.http, A), "utf8")).frontmatter;
    expect(item.title).toBe("One");
    expect(item.rank).toBe(3);
    // Both entries survived: the loser of the race re-read the file *after* the winner wrote it.
    expect(item.history.map((entry) => entry.diff)).toEqual([
      "created [cp 1]",
      "title: Item A → One",
      "rank: 0 → 3",
    ]);
  });
});

describe("workledger serve", () => {
  /** The io a serve test drives, with a controller standing in for Ctrl-C. */
  function serveIo(cwd: string): ServeIo & { out: string[]; err: string[]; stop: AbortController; opened: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    const opened: string[] = [];
    const stop = new AbortController();
    return {
      cwd,
      env: {},
      out,
      err,
      opened,
      stop,
      signal: stop.signal,
      stdout: (text) => void out.push(text),
      stderr: (line) => void err.push(line),
      openUrl: (url) => void opened.push(url),
    };
  }

  it("exits 4 outside an enabled repo, without binding a port", async () => {
    const root = repo({ enabled: false });
    const io = serveIo(root);

    expect(await serveCommand({ open: false }, io)).toBe(EXIT_NOT_ENABLED);

    expect(io.out).toEqual([]);
    expect(io.err.join(" ")).toContain("is not an enabled repo");
  });

  it("prints a loopback URL, serves the API on it, and stays up until it is stopped", async () => {
    const root = repo();
    seedItem(root, A);
    const io = serveIo(root);

    const running = serveCommand({ open: false }, io);
    // The URL is the first line, and it is printed before the command starts waiting.
    await vi.waitFor(() => expect(io.out[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/), { timeout: 5000 });

    const url = io.out[0]!;
    const health = await fetch(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as { repo: string }).repo).toBe(root);

    // `--no-open` means no browser, and the placeholder page stands in for the unbuilt UI.
    expect(io.opened).toEqual([]);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("workledger is serving");

    io.stop.abort();
    expect(await running).toBe(EXIT_OK);
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });

  it("binds the port it is given and opens the browser by default", async () => {
    const root = repo();
    const io = serveIo(root);

    const running = serveCommand({}, io);
    await vi.waitFor(() => expect(io.opened.length).toBe(1), { timeout: 5000 });

    expect(io.opened[0]).toBe(io.out[0]);
    io.stop.abort();
    expect(await running).toBe(EXIT_OK);
  });

  it("resolves the repo from --repo rather than from cwd", async () => {
    const root = repo();
    const elsewhere = repo({ enabled: false });
    const io = serveIo(elsewhere);

    const running = serveCommand({ repo: root, open: false }, io);
    await vi.waitFor(() => expect(io.out[0]).toMatch(/^http:/), { timeout: 5000 });

    const health = await fetch(`${io.out[0]!}/api/health`);
    expect(((await health.json()) as { repo: string }).repo).toBe(root);
    io.stop.abort();
    expect(await running).toBe(EXIT_OK);
  });

  it("has no web build in a source tree, so it serves the placeholder", () => {
    expect(hasWebBuild(webDir())).toBe(false);
    expect(placeholderHtml("/tmp/<repo>")).toContain("&lt;repo&gt;");
  });
});
