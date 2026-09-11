/**
 * `workledger open [--port <n>] [--no-browser]` — and `workledger` with no arguments —
 * docs/contracts/p8/daemon-and-api.md §CLI.
 *
 * Find the machine's daemon or start one, then open the browser at it. "Find" is `serve.json`
 * plus two checks — the pid is alive and `/api/health` answers — because the file outlives a
 * daemon that was killed uncleanly, and a pid can be reused by an unrelated process. "Start" is
 * a detached `workledger serve` whose stdout and stderr go to `serve.log`; this command waits
 * for `/api/health` and never for the child, so it returns the moment the URL is usable.
 *
 * With zero enabled repos the page opened is `/#/onboarding` rather than home: a first run has
 * nothing to show and everything to set up (plans/feature-p8-onboarding-home.md §Scope 3).
 */
import { spawn } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import net from "node:net";
import process from "node:process";

import { EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { REBUILD_COMMAND, resolveHome } from "../index/db.js";
import { openBrowser, processIo } from "./serve.js";
import { DEFAULT_PORT, isPidAlive, readServeState, removeServeState, serveLogPath } from "../serve-state.js";
import type { ServeIo } from "./serve.js";

/** Options commander parses for `open`. */
export interface OpenOptions {
  /** Port to start the daemon on when none is running; the contract's 7419 (else a free one) by default. */
  port?: number;
  /** `--no-browser` sets this false; commander defaults it to true. */
  browser?: boolean;
}

/** What starting the daemon needs. */
export interface SpawnRequest {
  port: number;
  /** Resolved `WORKLEDGER_HOME`, where `serve.log` goes. */
  home: string;
  env: Record<string, string | undefined>;
}

/** Everything the command touches outside itself, so a test can drive it without a browser or a child. */
export interface OpenIo extends ServeIo {
  /** Start the daemon. Replaced in tests; the default spawns a detached `workledger serve`. */
  spawnServer?: (request: SpawnRequest) => void;
  /** How long to wait for `/api/health` after a spawn; 15 s by default. */
  startTimeoutMs?: number;
}

/** How long one health probe may take before it counts as "not up". */
const PROBE_TIMEOUT_MS = 1000;

/** The interval `open` re-probes health at while a fresh daemon boots. */
const PROBE_INTERVAL_MS = 100;

/** How long a freshly spawned daemon gets to answer `/api/health`. */
export const START_TIMEOUT_MS = 15_000;

/** The loopback address the daemon binds — `@workledger/server`'s `LOOPBACK`, restated to avoid loading it. */
const LOOPBACK = "127.0.0.1";

/** `GET <url>/api/health`, parsed, or `undefined` when it does not answer 200 within the probe timeout. */
export async function probeHealth(url: string): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    const body = (await response.json()) as unknown;
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** `GET <url>/api/repos` length, or `undefined` when the call fails — a failure must not hide home. */
async function countRepos(url: string): Promise<number | undefined> {
  try {
    const response = await fetch(`${url}/api/repos`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? body.length : undefined;
  } catch {
    return undefined;
  }
}

/** Can `port` be bound on loopback right now? */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, LOOPBACK, () => {
      probe.close(() => resolve(true));
    });
  });
}

/** A port the OS says is free right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, LOOPBACK, () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** daemon-and-api.md: "default port 7419, else a free port". */
export async function pickPort(preferred: number = DEFAULT_PORT): Promise<number> {
  return (await isPortFree(preferred)) ? preferred : await freePort();
}

/**
 * The default `spawnServer`: this same executable, `serve --port <n> --no-open`, detached, with
 * its output appended to `serve.log`. `process.argv[1]` is the bin shim (or whatever entry
 * launched this process), which is the only thing guaranteed to reach `run()` the way this
 * invocation did.
 */
export function spawnDetachedServer(request: SpawnRequest): void {
  const entry = process.argv[1];
  if (entry === undefined) throw new Error("cannot locate the workledger entry point to start the daemon");
  mkdirSync(request.home, { recursive: true });
  const log = openSync(serveLogPath(request.home), "a");
  try {
    const child = spawn(process.execPath, [entry, "serve", "--port", String(request.port), "--no-open"], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, ...request.env },
    });
    child.unref();
  } finally {
    closeSync(log);
  }
}

/** Current size of `serve.log` in bytes, or 0 when there is no log yet. */
function logSize(home: string): number {
  try {
    return statSync(serveLogPath(home)).size;
  } catch {
    return 0;
  }
}

/**
 * The line the daemon died on, when it died on a divergent index.
 *
 * Only the bytes `serve.log` grew by since the spawn are read — the file is appended to by every
 * daemon this home has ever started, and a stale schema complaint from last week must not be
 * reported as this one's cause. The match is {@link REBUILD_COMMAND}, which every
 * `SchemaDivergenceError` message quotes (daemon-and-api.md amendment 14).
 *
 * @returns the daemon's own line, already prefixed `workledger serve:`, or `undefined`
 */
function schemaFailure(home: string, from: number): string | undefined {
  let text: string;
  try {
    const fd = openSync(serveLogPath(home), "r");
    try {
      const size = fstatSync(fd).size;
      if (size <= from) return undefined;
      const buffer = Buffer.alloc(size - from);
      readSync(fd, buffer, 0, buffer.length, from);
      text = buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes(REBUILD_COMMAND));
}

/** Wait until `/api/health` answers, or `timeoutMs` elapses. @returns whether it answered. */
async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeHealth(url)) !== undefined) return true;
    await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
  }
  return false;
}

/** Print the URL and open the browser — at onboarding when the daemon serves nothing yet. */
async function announce(url: string, options: OpenOptions, io: OpenIo): Promise<void> {
  io.stdout(url);
  const repos = await countRepos(url);
  let target = url;
  if (repos === 0) {
    target = `${url}/#/onboarding`;
    io.stdout(`no projects yet — opening ${target}`);
  }
  if (options.browser !== false) (io.openUrl ?? ((target: string) => openBrowser(target, io)))(target);
}

/**
 * Reuse the running daemon, or start one and wait for it.
 *
 * @returns `0` with the URL printed, `1` when a started daemon never answered `/api/health`.
 */
export async function openCommand(options: OpenOptions = {}, io: OpenIo = processIo()): Promise<number> {
  const home = resolveHome(io.env["WORKLEDGER_HOME"]);

  const state = readServeState(home);
  if (state !== undefined) {
    if (isPidAlive(state.pid) && (await probeHealth(state.url)) !== undefined) {
      await announce(state.url, options, io);
      return EXIT_OK;
    }
    // A dead pid, or a live one that is not our server any more: the file is stale.
    removeServeState(home);
  }

  const port = options.port ?? (await pickPort());
  const url = `http://${LOOPBACK}:${port}`;
  const env: Record<string, string | undefined> = { ...io.env, WORKLEDGER_HOME: home };
  const logBefore = logSize(home);
  try {
    (io.spawnServer ?? spawnDetachedServer)({ port, home, env });
  } catch (error) {
    io.stderr(`workledger open: could not start the server: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }

  if (!(await waitForHealth(url, io.startTimeoutMs ?? START_TIMEOUT_MS))) {
    // A daemon that exited on the index's schema has already said exactly what is wrong and how
    // to fix it; repeating "the server did not answer" over the top of that is what cost an
    // operator an afternoon on 2026-09-10.
    const fatal = schemaFailure(home, logBefore);
    if (fatal !== undefined) {
      io.stderr(fatal);
      return EXIT_USAGE;
    }
    io.stderr(`workledger open: the server did not answer at ${url}; see ${serveLogPath(home)}`);
    return EXIT_USAGE;
  }
  await announce(url, options, io);
  return EXIT_OK;
}
