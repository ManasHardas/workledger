/**
 * `createApp` — the whole local server: a read model per served repo, a watcher per repo that
 * invalidates it per file and pushes the matching SSE event, the GET and POST routes of
 * `docs/contracts/p2/api.md` and `p3/api.md` addressed by `?repo=<id>`
 * (`docs/contracts/p8/daemon-and-api.md`), the machine-wide reads, and the static fallback that
 * serves the built `apps/web`.
 *
 * Two modes. `repoRoot` is **single-repo mode** — P2's `serve --repo`, kept for debugging — where
 * `repo` is optional and defaults to the one repo. `repos` is **machine mode** — the P8 daemon —
 * where every listed root is served and `repo` is required on every per-repo route. The list may
 * be empty: a machine with nothing enabled yet is exactly what the onboarding wizard is for, and
 * `addRepo` is how the wizard's `init` joins a repo to a running server.
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
import type { Context } from "hono";
import type { Server } from "node:http";

import { EventBus } from "./events.js";
import { RepoRegistry } from "./repos.js";
import { briefMaxTokens } from "./brief.js";
import { defaultHome } from "./health.js";
import { errorBody } from "./errors.js";
import { eventRoutes } from "./routes/events.js";
import { jobRoutes } from "./routes/jobs.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { readRoutes } from "./routes/read.js";
import { repoRoutes } from "./routes/repos.js";
import { staticHandler } from "./routes/static.js";
import { writeRoutes } from "./routes/write.js";
import type { BacklogOps } from "./ops.js";
import type { JobOps } from "./jobs.js";
import type { OnboardingOps } from "./onboarding.js";
import type { JobWatcher } from "./job-watcher.js";
import type { HealthEnv } from "./health.js";
import type { KeyedMutex } from "./mutex.js";
import type { ReadModel } from "./read-model.js";
import type { RepoContext, ServeMode } from "./repos.js";
import type { Watcher } from "./watcher.js";

/** The only address the server ever binds (api.md preamble). */
export const LOOPBACK = "127.0.0.1";

export interface CreateAppOptions {
  /** Single-repo mode: the one repo whose `.workledger/` is served. Exclusive with `repos`. */
  repoRoot?: string;
  /** Machine mode: every enabled repo to serve, by root. May be empty. Exclusive with `repoRoot`. */
  repos?: string[];
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
  /** The P8 onboarding operations (`./onboarding.ts`), injected like `jobs`; absent → no `/api/onboarding/*`. */
  onboarding?: OnboardingOps;
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
  mode: ServeMode;
  events: EventBus;
  /** Every served repo, and the machinery to add one while the server runs. */
  repos: RepoRegistry;
  /** Start serving `root`; the repo it already serves when the root is held. */
  addRepo(root: string): RepoContext;
  /** Stop serving a repo. `false` when the id was not held. */
  removeRepo(id: string): boolean;
  /**
   * The first served repo's read model, watcher, write lock and job poller — the whole server in
   * single-repo mode, and a convenience for the tests of the per-repo routes. Throws when no
   * repo is held.
   */
  readonly model: ReadModel;
  readonly watcher: Watcher;
  readonly mutex: KeyedMutex;
  readonly jobWatcher: JobWatcher | undefined;
  /** Bind `127.0.0.1`. `port` defaults to 0 — a random high port (api.md preamble). */
  start(options?: { port?: number }): Promise<RunningServer>;
  /** Stop every watcher. Does not touch a server started by {@link ServerApp.start}. */
  close(): void;
}

/** Build the app, load every read model, and start watching. */
export function createApp(options: CreateAppOptions): ServerApp {
  if ((options.repoRoot === undefined) === (options.repos === undefined)) {
    throw new TypeError("createApp takes exactly one of repoRoot (single-repo mode) or repos (machine mode)");
  }
  const mode: ServeMode = options.repoRoot === undefined ? "machine" : "single";
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();

  const bus = new EventBus();
  const registry = new RepoRegistry({
    mode,
    bus,
    jobs: options.jobs,
    debounceMs: options.debounceMs,
    pollMs: options.pollMs,
    jobPollMs: options.jobPollMs,
  });
  for (const root of options.repoRoot === undefined ? (options.repos ?? []) : [options.repoRoot]) {
    registry.add(root);
  }

  const health: HealthEnv = {
    env,
    homeDir,
    home: options.home === undefined ? defaultHome(homeDir) : path.resolve(options.home),
    cli: options.cliVersion ?? "0.0.1",
  };

  /** The repo a request names — daemon-and-api.md's 400 / 404 when it does not. */
  const repo = (c: Context): RepoContext => registry.resolve(c.req.query("repo"));

  const app = new Hono();
  app.route("/api", repoRoutes({ registry, health, jobs: options.jobs }));
  app.route("/api", readRoutes({ repo, maxTokens: briefMaxTokens }));
  app.route("/api", writeRoutes({ repo, ops: options.ops }));
  app.route("/api", eventRoutes({ bus, ...(options.pingMs === undefined ? {} : { pingMs: options.pingMs }) }));

  // The P3 routes exist only when their backend does; see `CreateAppOptions.jobs`.
  if (options.jobs !== undefined) {
    app.route("/api", jobRoutes({ ops: options.jobs, repo, home: health.home }));
  }
  // The onboarding routes are machine-wide (no `repo` parameter — contract amendment 1). In
  // machine mode a repo the wizard just enabled joins the registry at once; single-repo mode
  // serves its one repo and nothing else.
  if (options.onboarding !== undefined) {
    app.route(
      "/api",
      onboardingRoutes({
        ops: options.onboarding,
        ...(mode === "machine" ? { onEnabled: (root: string) => void registry.add(root) } : {}),
      }),
    );
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

  /** The first held repo, for the single-repo conveniences below. */
  function primary(): RepoContext {
    const first = registry.list()[0];
    if (first === undefined) throw new Error("no repo is served");
    return first;
  }

  return {
    app,
    mode,
    events: bus,
    repos: registry,
    addRepo: (root) => registry.add(root),
    removeRepo: (id) => registry.remove(id),
    get model() {
      return primary().model;
    },
    get watcher() {
      return primary().watcher;
    },
    get mutex() {
      return primary().mutex;
    },
    get jobWatcher() {
      return primary().jobWatcher;
    },
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
      registry.close();
    },
  };
}
