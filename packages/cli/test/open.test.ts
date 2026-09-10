/**
 * `workledger open`, `workledger stop`, `serve.json` and machine-mode `serve` —
 * docs/contracts/p8/daemon-and-api.md §CLI.
 *
 * The daemon is never a real child process here: `open` takes a `spawnServer` that runs
 * `serveCommand` in this worker, on the port `open` chose, under an `AbortController` that
 * stands in for the pid. Everything the contract says about the file — written once the server
 * is up, reused while the pid is alive and `/api/health` answers, ignored when stale, removed by
 * `stop` — is asserted against a temp `WORKLEDGER_HOME`, so the developer's own daemon is never
 * touched.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { repoId } from "@workledger/server";

import { openCommand, pickPort, probeHealth } from "../src/commands/open.js";
import { enabledRepos, serveCommand } from "../src/commands/serve.js";
import { stopCommand } from "../src/commands/stop.js";
import { openIndex } from "../src/index/db.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import { DEFAULT_PORT, isPidAlive, readServeState, serveStatePath, writeServeState } from "../src/serve-state.js";
import type { OpenIo } from "../src/commands/open.js";
import type { ServeIo } from "../src/commands/serve.js";

let dir: string;
let home: string;
/** Every in-process daemon started by a test, stopped in `afterEach`. */
const daemons: { stop: AbortController; done: Promise<number> }[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "workledger-open-"));
  home = path.join(dir, "home");
});

afterEach(async () => {
  for (const daemon of daemons.splice(0)) {
    daemon.stop.abort();
    await daemon.done;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** An enabled repo with a git identity. */
function repo(name: string): string {
  const root = path.join(dir, name);
  mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(path.join(root, ".git", "config"), "[user]\n\tname = T\n\temail = t@example.com\n", "utf8");
  return root;
}

/** Record `root` in the index the way `workledger init` does. */
function enable(...roots: string[]): void {
  const db = openIndex({ home });
  try {
    for (const root of roots) db.upsertRepo(root);
  } finally {
    db.close();
  }
}

interface TestIo extends OpenIo {
  out: string[];
  err: string[];
  opened: string[];
  /** The ports `spawnServer` was asked for. */
  spawned: number[];
}

/**
 * The io `open` and `stop` run with. `spawnServer` starts `serveCommand` in this process, in
 * machine mode, on the requested port, and registers it for teardown.
 */
function io(over: Partial<TestIo> = {}): TestIo {
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  const spawned: number[] = [];
  const env = { WORKLEDGER_HOME: home, HOME: dir, PATH: "" };
  return {
    cwd: dir,
    env,
    out,
    err,
    opened,
    spawned,
    stdout: (text) => void out.push(text),
    stderr: (line) => void err.push(line),
    openUrl: (url) => void opened.push(url),
    startTimeoutMs: 10_000,
    spawnServer: (request) => {
      spawned.push(request.port);
      const stop = new AbortController();
      const serveIo: ServeIo = {
        cwd: dir,
        env: request.env,
        stdout: () => {},
        stderr: (line) => void err.push(line),
        openUrl: () => {},
        signal: stop.signal,
      };
      daemons.push({ stop, done: serveCommand({ port: request.port, open: false }, serveIo) });
    },
    ...over,
  };
}

async function json<T>(url: string): Promise<T> {
  return (await (await fetch(url)).json()) as T;
}

describe("workledger open", () => {
  it("starts the daemon, writes serve.json once it answers, prints the URL and opens home", async () => {
    const alpha = repo("alpha");
    enable(alpha);
    const it_ = io();

    expect(await openCommand({}, it_)).toBe(EXIT_OK);

    expect(it_.spawned).toHaveLength(1);
    const url = it_.out[0]!;
    expect(url).toBe(`http://127.0.0.1:${it_.spawned[0]}`);
    expect(it_.opened).toEqual([url]);

    const state = readServeState(home);
    expect(state).toMatchObject({ url, pid: process.pid });
    expect(typeof state!.startedAt).toBe("string");
    expect(typeof state!.version).toBe("string");
    // Written by the daemon, not by `open`, so the file describes a server that is really up.
    expect((await probeHealth(url))?.["repo"]).toBeNull();
    expect((await json<{ path: string }[]>(`${url}/api/repos`)).map((r) => r.path)).toEqual([alpha]);
  });

  it("opens /#/onboarding when the daemon serves no repos yet", async () => {
    const it_ = io();
    expect(await openCommand({}, it_)).toBe(EXIT_OK);
    const url = it_.out[0]!;
    expect(it_.opened).toEqual([`${url}/#/onboarding`]);
    expect(it_.out[1]).toContain("no projects yet");
  });

  it("reuses a live daemon instead of starting a second one, and --no-browser skips the browser", async () => {
    enable(repo("alpha"));
    const first = io();
    expect(await openCommand({}, first)).toBe(EXIT_OK);

    const second = io();
    expect(await openCommand({ browser: false }, second)).toBe(EXIT_OK);
    expect(second.spawned).toEqual([]);
    expect(second.out[0]).toBe(first.out[0]);
    expect(second.opened).toEqual([]);
  });

  it("ignores a stale serve.json whose pid is dead and overwrites it", async () => {
    enable(repo("alpha"));
    // A pid no process can have; the file is a leftover of a daemon that was killed.
    writeServeState(home, { url: "http://127.0.0.1:1", pid: 2 ** 22 - 1, startedAt: "2026-09-09T00:00:00.000Z", version: "0" });
    const it_ = io();

    expect(await openCommand({}, it_)).toBe(EXIT_OK);

    expect(it_.spawned).toHaveLength(1);
    expect(readServeState(home)?.url).toBe(it_.out[0]);
  });

  it("ignores a serve.json whose pid is alive but not answering, and a malformed one", async () => {
    enable(repo("alpha"));
    // This process is alive and is not listening on port 1.
    writeServeState(home, { url: "http://127.0.0.1:1", pid: process.pid, startedAt: "x", version: "0" });
    const it_ = io();
    expect(await openCommand({}, it_)).toBe(EXIT_OK);
    expect(it_.spawned).toHaveLength(1);

    for (const daemon of daemons.splice(0)) {
      daemon.stop.abort();
      await daemon.done;
    }
    writeFileSync(serveStatePath(home), "{ not json", "utf8");
    expect(readServeState(home)).toBeUndefined();
    const again = io();
    expect(await openCommand({}, again)).toBe(EXIT_OK);
    expect(again.spawned).toHaveLength(1);
  });

  it("honours --port and passes WORKLEDGER_HOME to the daemon", async () => {
    enable(repo("alpha"));
    const port = 36567 + (process.pid % 1000);
    const it_ = io();
    expect(await openCommand({ port }, it_)).toBe(EXIT_OK);
    expect(it_.spawned).toEqual([port]);
    expect(it_.out[0]).toBe(`http://127.0.0.1:${port}`);
  });

  it("exits 1 with the log path when the daemon never answers", async () => {
    const it_ = io({ spawnServer: () => {}, startTimeoutMs: 300 });
    expect(await openCommand({ port: 1 }, it_)).toBe(EXIT_USAGE);
    expect(it_.err.join(" ")).toContain("did not answer");
    expect(it_.err.join(" ")).toContain("serve.log");
    expect(it_.opened).toEqual([]);
  });

  it("exits 1 when the daemon cannot be started at all", async () => {
    const it_ = io({
      spawnServer: () => {
        throw new Error("no node here");
      },
    });
    expect(await openCommand({}, it_)).toBe(EXIT_USAGE);
    expect(it_.err.join(" ")).toContain("no node here");
  });

  it("prefers 7419 and falls back to a free port when it is taken", async () => {
    const preferred = 37567 + (process.pid % 1000);
    expect(await pickPort(preferred)).toBe(preferred);
    // Hold the port, then ask again.
    const it_ = io();
    expect(await openCommand({ port: preferred }, it_)).toBe(EXIT_OK);
    const fallback = await pickPort(preferred);
    expect(fallback).not.toBe(preferred);
    expect(fallback).toBeGreaterThan(0);
    expect(DEFAULT_PORT).toBe(7419);
  });
});

describe("workledger stop", () => {
  it("exits 0 when nothing is running", async () => {
    const it_ = io();
    expect(await stopCommand(it_)).toBe(EXIT_OK);
    expect(it_.out[0]).toContain("nothing is running");
  });

  it("removes a stale serve.json and exits 0", async () => {
    writeServeState(home, { url: "http://127.0.0.1:1", pid: 2 ** 22 - 1, startedAt: "x", version: "0" });
    const it_ = io();
    expect(await stopCommand(it_)).toBe(EXIT_OK);
    expect(readServeState(home)).toBeUndefined();
    expect(it_.out[0]).toContain("stale");
  });

  it("signals the daemon, waits for it, and removes serve.json", async () => {
    enable(repo("alpha"));
    const it_ = io();
    expect(await openCommand({}, it_)).toBe(EXIT_OK);
    const url = it_.out[0]!;
    const signals: [number, string][] = [];

    const stopIo = io({
      kill: (pid, signal) => {
        signals.push([pid, signal]);
        // The in-process daemon's SIGTERM is its abort controller.
        for (const daemon of daemons) daemon.stop.abort();
      },
    });
    expect(await stopCommand(stopIo)).toBe(EXIT_OK);

    expect(signals).toEqual([[process.pid, "SIGTERM"]]);
    expect(readServeState(home)).toBeUndefined();
    expect(stopIo.out[0]).toContain(`stopped ${url}`);
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });

  it("exits 1 and keeps the file when the daemon survives SIGTERM", async () => {
    writeServeState(home, { url: "http://127.0.0.1:1", pid: process.pid, startedAt: "x", version: "0" });
    const it_ = io({ kill: () => {}, exitTimeoutMs: 100 });
    expect(await stopCommand(it_)).toBe(EXIT_USAGE);
    expect(readServeState(home)).toBeDefined();
    expect(it_.err.join(" ")).toContain("still running");
  });
});

describe("workledger serve in machine mode", () => {
  it("serves every enabled repo in the index, and none that has lost its ledger", async () => {
    const alpha = repo("alpha");
    const beta = repo("beta");
    const gone = repo("gone");
    enable(alpha, beta, gone);
    rmSync(path.join(gone, ".workledger"), { recursive: true, force: true });
    expect(await enabledRepos(io())).toEqual([alpha, beta]);

    const it_ = io();
    expect(await openCommand({}, it_)).toBe(EXIT_OK);
    const url = it_.out[0]!;

    const repos = await json<{ id: string; path: string; name: string }[]>(`${url}/api/repos`);
    expect(repos.map((r) => r.path)).toEqual([alpha, beta]);
    expect(repos.map((r) => r.name)).toEqual(["alpha", "beta"]);
    expect(repos.map((r) => r.id)).toEqual([repoId(alpha), repoId(beta)]);

    // Both are served, each under its own id; the parameter is required.
    for (const id of repos.map((r) => r.id)) {
      expect((await fetch(`${url}/api/sessions?repo=${id}`)).status).toBe(200);
    }
    const missing = await fetch(`${url}/api/sessions`);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("repo-required");
    expect((await fetch(`${url}/api/sessions?repo=nope`)).status).toBe(404);
    expect(await json<unknown[]>(`${url}/api/notes/all`)).toEqual([]);
    expect(await json<unknown[]>(`${url}/api/jobs/all`)).toEqual([]);
  });

  it("does not need an enabled repo under cwd", async () => {
    const it_ = io();
    expect(await openCommand({}, it_)).toBe(EXIT_OK);
    expect(await json<unknown[]>(`${it_.out[0]!}/api/repos`)).toEqual([]);
  });

  it("picks up a repo enabled after it started, on the next sweep", async () => {
    const alpha = repo("alpha");
    enable(alpha);
    const it_ = io({
      spawnServer: (request) => {
        const stop = new AbortController();
        const serveIo: ServeIo = { cwd: dir, env: request.env, stdout: () => {}, stderr: () => {}, signal: stop.signal };
        daemons.push({ stop, done: serveCommand({ port: request.port, open: false, scanIntervalMs: 30 }, serveIo) });
      },
    });
    expect(await openCommand({}, it_)).toBe(EXIT_OK);
    const url = it_.out[0]!;

    const beta = repo("beta");
    enable(beta);
    await vi.waitFor(async () => {
      expect((await json<{ path: string }[]>(`${url}/api/repos`)).map((r) => r.path)).toEqual([alpha, beta]);
    }, { timeout: 5000 });
  });

  it("removes serve.json on a clean shutdown, but not another daemon's", async () => {
    const it_ = io();
    expect(await openCommand({}, it_)).toBe(EXIT_OK);
    expect(readServeState(home)).toBeDefined();
    // A newer daemon replaced the file while this one was still up.
    writeServeState(home, { url: "http://127.0.0.1:2", pid: 2 ** 22 - 2, startedAt: "x", version: "0" });
    for (const daemon of daemons.splice(0)) {
      daemon.stop.abort();
      expect(await daemon.done).toBe(EXIT_OK);
    }
    expect(readServeState(home)?.pid).toBe(2 ** 22 - 2);
  });
});

describe("serve-state", () => {
  it("writes atomically and reads back what it wrote", () => {
    writeServeState(home, { url: "http://127.0.0.1:7419", pid: 42, startedAt: "2026-09-09T00:00:00.000Z", version: "0.3.0" });
    expect(JSON.parse(readFileSync(serveStatePath(home), "utf8"))).toEqual({
      url: "http://127.0.0.1:7419",
      pid: 42,
      startedAt: "2026-09-09T00:00:00.000Z",
      version: "0.3.0",
    });
    expect(readServeState(home)?.pid).toBe(42);
    writeFileSync(serveStatePath(home), JSON.stringify({ url: "", pid: "42" }), "utf8");
    expect(readServeState(home)).toBeUndefined();
  });

  it("knows a live pid from a dead one", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(2 ** 22 - 1)).toBe(false);
  });
});
