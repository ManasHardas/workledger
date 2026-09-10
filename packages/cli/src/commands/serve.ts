/**
 * `workledger serve [--repo <path>] [--port <n>] [--no-open]` — docs/contracts/p2/api.md.
 *
 * This is the one place the two halves of P2 are joined. `@workledger/server` owns the HTTP
 * surface and the read model but deliberately owns no writer: api.md says every POST calls "the
 * same function the CLI command calls", so this command hands it `src/backlog-ops.ts` as its
 * `ops`. The alternative — the server importing the CLI — is a dependency cycle, and the CLI
 * ships as a single bundled `dist/main.js` with no exports map, so there would be nothing to
 * import. Injecting here also means `tsc` checks the two against each other at this line rather
 * than at a 500.
 *
 * Like every other command body, it is reached by `await import()` from `main.ts`: a static
 * import would put hono, the read model and zod into the bundle's top level, which the Stop
 * hook's p95 < 100 ms budget pays for on every invocation (plans/feature-p1-data-flow.md §6).
 */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { findRepoRoot, isEnabled } from "../ledger-fs.js";

/** Options commander parses for `serve`. */
export interface ServeOptions {
  /** Repo to serve; defaults to the repo root found by walking up from `cwd`. */
  repo?: string;
  /** Port to bind on `127.0.0.1`; defaults to a random high port (api.md preamble). */
  port?: number;
  /** `--no-open` sets this false; commander defaults it to true. */
  open?: boolean;
}

/** Everything the command touches outside itself, so a test can drive it without a browser. */
export interface ServeIo {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  /** Open the UI. Replaced in tests; the default shells out to the platform opener. */
  openUrl?: (url: string) => void;
  /**
   * Shuts the server down, in place of `SIGINT`. The command listens for both, so a test never
   * has to raise a signal in the worker process.
   */
  signal?: AbortSignal;
}

/** The real environment. */
export function processIo(): ServeIo {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => void process.stdout.write(`${text}\n`),
    stderr: (line) => void process.stderr.write(`${line}\n`),
  };
}

/**
 * The built `apps/web`, which `scripts/bundle-cli.mjs` copies next to the bundle.
 *
 * Resolved against this module rather than against `cwd`, so it is `packages/cli/dist/web` from
 * `dist/main.js` and `packages/cli/src/web` (which does not exist) from `src/` under vitest —
 * the same trick `src/index/db.ts` uses for the migrations. A run from source therefore gets the
 * placeholder, which is the honest answer: there is no built UI in a source tree.
 */
export function webDir(): string {
  return fileURLToPath(new URL("./web/", import.meta.url));
}

/** Is `dir` a directory with an `index.html` in it? */
export function hasWebBuild(dir: string): boolean {
  try {
    return statSync(path.join(dir, "index.html")).isFile();
  } catch {
    return false;
  }
}

/**
 * What every non-`/api` path serves until `apps/web` has been built into `dist/web/`.
 *
 * A page rather than a 404 because the URL is the first thing this command prints: opening it and
 * getting "not found" reads as a broken server, and the API underneath it is not broken at all.
 */
export function placeholderHtml(repoRoot: string): string {
  const repo = repoRoot.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><meta charset="utf-8"><title>workledger</title><body style="font:14px system-ui;margin:2rem"><p>workledger is serving <code>${repo}</code>. The UI is not built yet — the API is at <a href="/api/health">/api/health</a>.</p>`;
}

/** The platform's "open this URL" command, or `undefined` where there is not one. */
function opener(platform: string): { command: string; args: string[] } | undefined {
  if (platform === "darwin") return { command: "open", args: [] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", ""] };
  if (platform === "linux") return { command: "xdg-open", args: [] };
  return undefined;
}

/**
 * Open `url` in the user's browser, printing the URL instead when that cannot be done.
 *
 * Every failure mode falls back to printing rather than to an error: an unknown platform, no
 * opener on `PATH` (`spawn` reports that asynchronously, hence the `error` listener), a
 * `spawn` that throws outright. None of them is a reason to refuse to serve — the server is
 * already up and the user has the URL.
 */
export function openBrowser(url: string, io: ServeIo, platform: string = process.platform): void {
  const found = opener(platform);
  if (found === undefined) {
    io.stdout(`open ${url} in your browser`);
    return;
  }
  try {
    const child = spawn(found.command, [...found.args, url], { stdio: "ignore", detached: true });
    child.on("error", () => io.stdout(`open ${url} in your browser`));
    child.unref();
  } catch {
    io.stdout(`open ${url} in your browser`);
  }
}

/** Resolve when the process is asked to stop: `SIGINT`, `SIGTERM`, or `io.signal`. */
function untilStopped(io: ServeIo): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const stop = (): void => {
      if (done) return;
      done = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    if (io.signal !== undefined) {
      if (io.signal.aborted) stop();
      else io.signal.addEventListener("abort", stop, { once: true });
    }
  });
}

/**
 * Start the local server and stay up until `SIGINT`.
 *
 * @returns `0` after a clean shutdown, `4` outside an enabled repo (cli.md's exit-code table),
 * `1` when the port cannot be bound.
 */
export async function serveCommand(
  options: ServeOptions = {},
  io: ServeIo = processIo(),
): Promise<number> {
  const start = options.repo ?? io.env["CLAUDE_PROJECT_DIR"]?.trim() ?? io.cwd;
  const root = findRepoRoot(start);
  if (root === undefined || !isEnabled(root)) {
    io.stderr(`workledger serve: ${root ?? start} is not an enabled repo; run \`workledger init\``);
    return EXIT_NOT_ENABLED;
  }

  const [{ LOOPBACK, createApp }, ops, { VERSION }] = await Promise.all([
    import("@workledger/server"),
    import("../backlog-ops.js"),
    import("../main.js"),
  ]);

  const dir = webDir();
  const built = hasWebBuild(dir);
  const app = createApp({
    repoRoot: root,
    ops,
    cliVersion: VERSION,
    env: io.env,
    ...(built ? { staticDir: dir } : {}),
    staticHtml: placeholderHtml(root),
  });

  let server;
  try {
    server = await app.start(options.port === undefined ? {} : { port: options.port });
  } catch (error) {
    app.close();
    io.stderr(`workledger serve: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }

  const url = `http://${LOOPBACK}:${server.port}`;
  io.stdout(url);
  if (!built) io.stdout("workledger serve: no built UI yet — serving a placeholder page");
  if (options.open !== false) (io.openUrl ?? ((target: string) => openBrowser(target, io)))(url);

  await untilStopped(io);
  await server.close();
  app.close();
  return EXIT_OK;
}
