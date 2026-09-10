/**
 * `createApp` — the whole read server: a read model over one repo's `.workledger/`, a watcher
 * that invalidates it per file and pushes the matching SSE event, the GET routes of
 * `docs/contracts/p2/api.md`, and the static fallback that serves the built `apps/web`.
 *
 * The listener binds `127.0.0.1` and nothing else. There is no auth because there is no remote
 * caller: plans/feature-p2-data-flow.md §Identity is "no accounts, no sessions, loopback only",
 * and the bind address is the mechanism that makes that true rather than a claim.
 *
 * The write half is injected, not imported: `ops` carries the `backlog-ops.ts` functions the CLI
 * runs, so the POST routes and `workledger backlog …` are the same code rather than two
 * implementations that agree today (see `./ops.ts` for why injection and not a shared package).
 */
import { Hono } from "hono";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { Server } from "node:http";

import { EventBus } from "./events.js";
import { KeyedMutex } from "./mutex.js";
import { ReadModel } from "./read-model.js";
import { briefMaxTokens } from "./brief.js";
import { defaultHome } from "./health.js";
import { errorBody } from "./errors.js";
import { eventRoutes } from "./routes/events.js";
import { jobRoutes } from "./routes/jobs.js";
import { ledgerId, ledgerPaths } from "./paths.js";
import { readRoutes } from "./routes/read.js";
import { staticHandler } from "./routes/static.js";
import { startJobWatcher } from "./job-watcher.js";
import { startWatcher } from "./watcher.js";
import { writeRoutes } from "./routes/write.js";
import type { BacklogOps } from "./ops.js";
import type { JobOps } from "./jobs.js";
import type { JobWatcher } from "./job-watcher.js";
import type { HealthEnv } from "./health.js";
import type { Watcher } from "./watcher.js";

/** The only address the server ever binds (api.md preamble). */
export const LOOPBACK = "127.0.0.1";

export interface CreateAppOptions {
  /** The repo whose `.workledger/` is served. */
  repoRoot: string;
  /**
   * The backlog and note mutations the POST routes call — `packages/cli/src/backlog-ops.ts`,
   * handed in by `workledger serve`.
   */
  ops: BacklogOps;
  /**
   * The index-backed job and excerpt operations of `docs/contracts/p3/api.md`, handed in the
   * same way and for the same reason as `ops` (`./jobs.ts`). Without it the P3 routes are absent
   * and `/api/jobs` is a 404 like any other unrouted path — a P2-only server, which is what a
   * build that predates the injection is.
   */
  jobs?: JobOps;
  /** `~/.workledger` or wherever the index lives; only its path and size are read. */
  home?: string;
  /** The built `apps/web`; without it a non-`/api` path is a 404 rather than the app shell. */
  staticDir?: string;
  /**
   * HTML served for every non-`/api` path when `staticDir` is absent — the placeholder
   * `workledger serve` shows before `apps/web` has been built into `packages/cli/dist/web/`.
   */
  staticHtml?: string;
  /** The `workledger` version reported by `/api/health`. */
  cliVersion?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  /** Watcher knobs, for tests that cannot wait 2 s for a poll. */
  debounceMs?: number;
  pollMs?: number;
  /** SSE keep-alive interval; api.md's 15 s by default. */
  pingMs?: number;
  /** Jobs-table poll interval behind `job.changed`; 2 s by default. */
  jobPollMs?: number;
}

/** A listening server. */
export interface RunningServer {
  /** The port actually bound — the useful half of asking for port 0. */
  port: number;
  close(): Promise<void>;
}

/** What `createApp` hands back. */
export interface ServerApp {
  app: Hono;
  model: ReadModel;
  events: EventBus;
  watcher: Watcher;
  /** The per-id write lock (data-flow §Writes), exposed so a test can observe it. */
  mutex: KeyedMutex;
  /** The `job.changed` poller, or `undefined` when no `jobs` ops were injected. */
  jobWatcher?: JobWatcher;
  /** Bind `127.0.0.1`. `port` defaults to 0 — a random high port (api.md preamble). */
  start(options?: { port?: number }): Promise<RunningServer>;
  /** Stop the watcher. Does not touch a server started by {@link ServerApp.start}. */
  close(): void;
}

/** Build the app, load the read model, and start watching. */
export function createApp(options: CreateAppOptions): ServerApp {
  const repoRoot = path.resolve(options.repoRoot);
  const paths = ledgerPaths(repoRoot);
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();

  const model = new ReadModel(paths);
  model.loadAll();

  const bus = new EventBus();
  const watcher = startWatcher({
    paths,
    debounceMs: options.debounceMs,
    pollMs: options.pollMs,
    onChange: (files) => {
      let notesChanged = false;
      for (const file of files) {
        const dir = path.dirname(file);
        const id = ledgerId(file);
        if (dir === paths.sessions && id !== undefined) {
          model.invalidateSession(id);
          bus.emit({ event: "session.changed", data: { ulid: id } });
          notesChanged = true;
        } else if (dir === paths.backlog && id !== undefined) {
          model.invalidateBacklog(id);
          bus.emit({ event: "backlog.changed", data: { id } });
        } else if (file === paths.config) {
          bus.emit({ event: "health.changed", data: {} });
        }
      }
      // Notes live inside session files, so one session write is both events; the notes one is
      // collapsed to a single emission per flush because its payload carries no id.
      if (notesChanged) bus.emit({ event: "notes.changed", data: {} });
    },
  });

  const health: HealthEnv = {
    env,
    homeDir,
    home: options.home === undefined ? defaultHome(homeDir) : path.resolve(options.home),
    cli: options.cliVersion ?? "0.0.1",
  };

  const mutex = new KeyedMutex();
  const app = new Hono();
  app.route("/api", readRoutes({ model, health, maxTokens: () => briefMaxTokens(paths) }));
  app.route("/api", writeRoutes({ model, ops: options.ops, repoRoot, mutex }));
  app.route("/api", eventRoutes({ bus, ...(options.pingMs === undefined ? {} : { pingMs: options.pingMs }) }));

  // The P3 routes exist only when their backend does; see `CreateAppOptions.jobs`.
  const jobWatcher =
    options.jobs === undefined
      ? undefined
      : startJobWatcher({
          ops: options.jobs,
          repoRoot,
          bus,
          pollMs: options.jobPollMs,
          // A locked or half-migrated index must not take the stream down with it.
          onError: () => {},
        });
  if (options.jobs !== undefined) {
    app.route("/api", jobRoutes({ ops: options.jobs, repoRoot, home: health.home }));
  }

  // Every unmatched `/api` path is a 404 in the contract's shape and must never fall through to
  // the static handler, which would answer it with the app shell.
  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: `no route ${new URL(c.req.url).pathname}` } }, 404));

  if (options.staticDir !== undefined) {
    const root = path.resolve(options.staticDir);
    const serve = staticHandler(root);
    const html = options.staticHtml;
    app.get("*", (c) => serve(c) ?? (html === undefined ? c.notFound() : c.html(html)));
  } else if (options.staticHtml !== undefined) {
    const html = options.staticHtml;
    app.get("*", (c) => c.html(html));
  }

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: `no route ${new URL(c.req.url).pathname}` } }, 404),
  );
  app.onError((error, c) => {
    const { status, body } = errorBody(error);
    return c.json(body, status);
  });

  return {
    app,
    model,
    events: bus,
    watcher,
    mutex,
    ...(jobWatcher === undefined ? {} : { jobWatcher }),
    async start(startOptions = {}): Promise<RunningServer> {
      const { serve } = await import("@hono/node-server");
      return await new Promise<RunningServer>((resolve, reject) => {
        let server: Server;
        try {
          server = serve(
            { fetch: app.fetch, hostname: LOOPBACK, port: startOptions.port ?? 0 },
            (info) => {
              resolve({
                port: info.port,
                close: () =>
                  new Promise<void>((done, fail) => {
                    server.close((error) => (error ? fail(error) : done()));
                  }),
              });
            },
          ) as unknown as Server;
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        server.on("error", reject);
      });
    },
    close(): void {
      watcher.close();
      jobWatcher?.close();
    },
  };
}
