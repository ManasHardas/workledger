/**
 * `workledger serve [--repo <path>] [--port <n>] [--no-open]` — docs/contracts/p2/api.md, and
 * P8's two modes (docs/contracts/p8/daemon-and-api.md §CLI): without `--repo` it is the
 * machine's daemon, serving every enabled repo the index knows and announcing itself in
 * `~/.workledger/serve.json` for `workledger open` and `stop`; with `--repo` it is P2's
 * single-repo server, kept for debugging.
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
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { BacklogOpError } from "../backlog-ops.js";
import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { resolveHome } from "../index/db.js";
import { cancelJob, enqueueJob, getJob, listJobs, retryJob } from "../jobs/queue.js";
import { findRepoRoot, isEnabled, readTextFile } from "../ledger-fs.js";
import { removeServeState, writeServeState } from "../serve-state.js";
import type { IndexDb } from "../index/db.js";
import type {
  BackfillEstimate,
  BackfillInput,
  ExcerptSpan,
  ExtractEstimate,
  Job,
  JobOps,
  ScanSummary,
} from "@workledger/server";

/**
 * How often `serve` runs the orphan sweep — docs/contracts/p3/cli.md §scan: "and every 5 minutes
 * inside `serve`".
 *
 * The sweep is `stat`-only and budgeted at 200 ms for 500 open sessions
 * (plans/feature-p3-data-flow.md §Budgets), so it costs nothing to keep running; what it buys is
 * that a session whose harness died while the UI was open turns from a stale `open` row into a
 * `crashed` one with a repair queued, without anybody typing a command.
 */
export const SCAN_INTERVAL_MS = 5 * 60_000;

/** Options commander parses for `serve`. */
export interface ServeOptions {
  /**
   * One repo to serve — single-repo mode (P2's shape, now the debug path). Without it the
   * server is the machine's daemon over every enabled repo in the index.
   */
  repo?: string;
  /** Port to bind on `127.0.0.1`; defaults to a random high port (api.md preamble). */
  port?: number;
  /** `--no-open` sets this false; commander defaults it to true. */
  open?: boolean;
  /** Orphan-sweep cadence in ms; the contract's 5 minutes by default. Tests pass a short one. */
  scanIntervalMs?: number;
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
export function placeholderHtml(what: string): string {
  const escaped = what.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><meta charset="utf-8"><title>workledger</title><body style="font:14px system-ui;margin:2rem"><p>workledger is serving <code>${escaped}</code>. The UI is not built yet — the API is at <a href="/api/health">/api/health</a>.</p>`;
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

/**
 * The index-backed half of the server, per `docs/contracts/p3/api.md`.
 *
 * This is the same injection `ops` is, for the same reason: `@workledger/server` must not import
 * `better-sqlite3` (it is the package that deliberately reports the index by path and size rather
 * than opening it), and it cannot import `packages/cli` at all without a cycle. So the server
 * declares the shape (`JobOps`) and this function satisfies it — which makes a drift a `tsc`
 * error here rather than a 500 at runtime.
 *
 * Each call opens and closes its own connection. A long-lived one would be cheaper, but it would
 * also hold a SQLite handle across the whole life of a `serve` process while `workledger repair`
 * and `backfill` write the same file from other processes; the connection-per-call keeps the
 * `BEGIN IMMEDIATE` windows short and lets `openIndex` re-run migrations another process applied.
 *
 * `backfill` and `estimateExtract` are the same functions the CLI commands run, for the same
 * reason `ops` is: `POST /api/jobs/backfill` and `workledger backfill` must not be two
 * implementations that agree today. Both are wired here rather than reimplemented — the dry
 * estimate is `planBackfill` over `enumerateStore`, and the wet call creates the ledger sessions
 * and enqueues their repairs exactly as `runBackfill` does before it drains the queue.
 *
 * @param startRepair what a queued resume repair hands off to. Injectable because the default
 * spawns the harness, which a test must be able to decline without also declining the queueing
 * this function is responsible for.
 * @param startDrain what a consented backfill hands its queue off to, injectable for the same
 * reason: draining it resumes every backfilled session in a child process.
 */
export function jobOps(
  io: ServeIo,
  startRepair: (ulid: string) => void = (ulid) => void runQueuedRepair(ulid, io),
  startDrain: (input: BackfillInput, concurrency: number, repoRoot: string) => void = (
    input,
    concurrency,
    repoRoot,
  ) => startBackfill(input, concurrency, repoRoot, io),
): JobOps {
  const home = io.env["WORKLEDGER_HOME"]?.trim();

  async function withDb<T>(body: (db: IndexDb) => Promise<T> | T): Promise<T> {
    const { openIndex } = await import("../index/db.js");
    const db = openIndex(home ? { home } : {});
    try {
      return await body(db);
    } finally {
      db.close();
    }
  }

  return {
    listJobs: (repoRoot, status) =>
      withDb((db) => {
        const rows = listJobs(db, repoRoot) as Job[];
        return status === undefined ? rows : rows.filter((job) => job.status === status);
      }),

    scan: (repoRoot) =>
      withDb(async (db): Promise<ScanSummary> => {
        const [{ runScan }, { newSessionId }] = await Promise.all([
          import("./scan.js"),
          import("@workledger/core/ids"),
        ]);
        const result = await runScan({ db, root: repoRoot, now: () => new Date(), newId: newSessionId });
        return { orphaned: result.orphans.length, queued: result.queued };
      }),

    repair: (repoRoot, input) =>
      withDb(async (db): Promise<Job> => {
        const session = db.getSessionByUlid(input.session);
        if (session === undefined || session.repo_path !== repoRoot) {
          throw new BacklogOpError(`no session ${input.session} in this repo`, "not-found");
        }
        const { newSessionId } = await import("@workledger/core/ids");
        // With consent, an extraction is its own kind of job: the resume path cannot produce the
        // digest (that is why the caller reached for `--extract`), and #54's runner claims
        // `extract` rows. Without it, this is the ordinary resume repair.
        const kind = input.extract && input.consent ? "extract" : "repair";
        const { job } = enqueueJob(db, {
          kind,
          sessionUlid: input.session,
          repoPath: repoRoot,
          newId: newSessionId,
          now: new Date(),
        });
        // 202 means "queued", so the response is sent before the harness runs. The resume is
        // started here and deliberately not awaited; its outcome lands on the job row, which the
        // server's poller turns into `job.changed`.
        if (kind === "repair") startRepair(input.session);
        return job as Job;
      }),

    cancelJob: (repoRoot, id) =>
      withDb((db) => {
        const result = cancelJob(db, id, new Date());
        if ("message" in result) throw asJobOpError(result.message, id);
        return result as Job;
      }),

    retryJob: (repoRoot, id) =>
      withDb((db) => {
        const result = retryJob(db, id);
        if ("message" in result) throw asJobOpError(result.message, id);
        // Re-queued is not re-run: nothing else in `serve` drains the queue, so a retry from the
        // Jobs view that only flipped the row would sit `queued` until a CLI command happened to
        // claim it (#97). The resume path is handed off the way `repair` hands it off.
        if (result.kind === "repair") startRepair(result.session_ulid);
        return result as Job;
      }),

    jobLog: (repoRoot, id) =>
      withDb((db) => {
        const job = getJob(db, id);
        if (job === undefined || job.repo_path !== repoRoot || job.log_path === null) return undefined;
        return readTextFile(job.log_path);
      }),

    estimateExtract: (repoRoot, ulid) =>
      withDb(async (db): Promise<ExtractEstimate> => {
        const session = db.getSessionByUlid(ulid);
        if (session === undefined || session.repo_path !== repoRoot) {
          throw new BacklogOpError(`no session ${ulid} in this repo`, "not-found");
        }
        const { estimateFor } = await import("../extract/run.js");
        const estimate = estimateFor(session, repoRoot);
        // A session that cannot be extracted from is not a consent question, so the reason is
        // raised rather than priced: a dialog offering to spend money on a transcript that is not
        // on this machine is worse than the error that says so.
        if ("error" in estimate) throw new BacklogOpError(estimate.error, "conflict");
        // `ExtractEstimate` here is the wire's three fields; the CLI's carries `from`,
        // `inputTokens` and `outputTokens` too, and api.md forwards them unchanged.
        return estimate;
      }),

    /**
     * `POST /api/jobs/backfill`, dry and wet.
     *
     * Dry (`consent: false`) is `--dry-run`: it plans and prices and writes nothing at all, which
     * is what makes the estimate safe to fetch every time the UI's lookback selector moves.
     *
     * Wet returns *before* the work happens, because the contract's 202 says "queued", not
     * "done": a backfill of thirty sessions takes minutes and no HTTP request should be held open
     * for it. So the sessions and their job rows are created synchronously — they are what the
     * 202 carries — and the queue is drained afterwards by a `runBackfill` this function does not
     * await. That second pass re-plans and finds nothing fresh (the rows now exist), sees the
     * outstanding jobs and runs them; every outcome lands on a job row, which is the channel
     * `job.changed` is already watching.
     */
    backfill: (repoRoot, input) =>
      withDb(async (db): Promise<{ jobs: Job[]; estimate: BackfillEstimate }> => {
        const [{ createBackfilledSession, enumerateStore, planBackfill }, { SINCE_WINDOWS, loadConfig }, { claudeCodeAdapter }, { newSessionId }] =
          await Promise.all([
            import("./backfill.js"),
            import("../config.js"),
            import("../adapters/claude-code.js"),
            import("@workledger/core/ids"),
          ]);
        if (!(SINCE_WINDOWS as readonly string[]).includes(input.since)) {
          throw new BacklogOpError(
            `since must be one of ${SINCE_WINDOWS.join(", ")}; got ${input.since}`,
            "usage",
          );
        }
        const config = loadConfig(repoRoot);
        const concurrency = input.concurrency ?? config.backfill.concurrency;
        const homeDir = harnessStoreHome(io);
        const plan = planBackfill(enumerateStore(homeDir, repoRoot), {
          db,
          harness: claudeCodeAdapter.harness,
          since: input.since,
          now: new Date(),
          concurrency,
          secondsPerSession: config.backfill.seconds_per_session,
        });
        const estimate: BackfillEstimate = {
          count: plan.fresh.length,
          bytes: plan.totalBytes,
          oldest: plan.oldest,
          seconds: plan.estimateSeconds,
        };
        if (!input.consent) return { jobs: [], estimate };

        const created: Job[] = [];
        for (const found of plan.fresh) {
          const ulid = await createBackfilledSession(found, {
            db,
            root: repoRoot,
            adapter: claudeCodeAdapter,
            homeDir,
            stdout: io.stderr,
            stderr: io.stderr,
            now: () => new Date(),
            newId: newSessionId,
            ...(home === undefined ? {} : { home }),
          });
          const { job } = enqueueJob(db, {
            kind: "repair",
            sessionUlid: ulid,
            repoPath: repoRoot,
            newId: newSessionId,
            now: new Date(),
          });
          created.push(job as Job);
        }
        startDrain(input, concurrency, repoRoot);
        return { jobs: created, estimate };
      }),

    excerptSpan: (repoRoot, ulid, cp) =>
      withDb((db): ExcerptSpan | undefined => {
        const session = db.getSessionByUlid(ulid);
        if (session === undefined || session.repo_path !== repoRoot) return undefined;
        const path_ = session.transcript_path;
        if (path_ === null || path_ === "") return undefined;

        // `[offset(n-1), offset(n))` — data-flow §Excerpts. Checkpoint 1 starts at byte 0 because
        // there is no checkpoint 0; a `cp` past the end of the list is not a checkpoint at all.
        const checkpoints = db.listCheckpoints(ulid);
        const end = checkpoints.find((row) => row.n === cp);
        if (end === undefined) return undefined;
        const start = checkpoints.find((row) => row.n === cp - 1);
        return {
          transcriptPath: path_,
          from: start?.transcript_offset ?? 0,
          to: end.transcript_offset,
        };
      }),
  };
}

/**
 * `queue.ts` reports a refused cancel/retry as a message rather than a throw. The server needs
 * the class instead: an unknown id is the contract's 404, and a job in the wrong state is its 409.
 */
function asJobOpError(message: string, id: string): BacklogOpError {
  return new BacklogOpError(message, message === `no job ${id}` ? "not-found" : "conflict");
}

/**
 * Where the harness keeps its transcripts — `~/.claude/projects` and its siblings.
 *
 * Read from the injected environment first and only then from `os.homedir()`, so a test can point
 * the store enumeration at a fixture directory the way every other injected dependency in this
 * file can be pointed somewhere else. In a real process the two are the same value.
 */
function harnessStoreHome(io: ServeIo): string {
  return io.env["HOME"]?.trim() || os.homedir();
}

/**
 * Drain the backfill jobs the route just created, in the background.
 *
 * `runBackfill` is re-entered rather than reimplemented: its plan finds nothing fresh (the route
 * has already created those rows), its outstanding-jobs check finds the queue the route filled,
 * and from there it is the same code `workledger backfill --yes` runs — including the extraction
 * fallback, which is why `extractFallback` is forwarded rather than dropped. Nothing is thrown out
 * of here: an unhandled rejection would take the whole `serve` process down over one backfill, and
 * every failure is already recorded on the job row the UI is watching.
 */
function startBackfill(
  input: BackfillInput,
  concurrency: number,
  repoRoot: string,
  io: ServeIo,
): void {
  void (async () => {
    try {
      const [{ runBackfill }, { claudeCodeAdapter }, ids, { openIndex }] = await Promise.all([
        import("./backfill.js"),
        import("../adapters/claude-code.js"),
        import("@workledger/core/ids"),
        import("../index/db.js"),
      ]);
      const home = io.env["WORKLEDGER_HOME"]?.trim();
      const db = openIndex(home ? { home } : {});
      try {
        await runBackfill(
          {
            repo: repoRoot,
            since: input.since,
            concurrency,
            yes: true,
            ...(input.extractFallback === true ? { extractFallback: true } : {}),
          },
          {
            db,
            root: repoRoot,
            adapter: claudeCodeAdapter,
            homeDir: harnessStoreHome(io),
            stdout: io.stderr,
            stderr: io.stderr,
            now: () => new Date(),
            newId: ids.newSessionId,
            newBacklogId: ids.newBacklogId,
            apiKey: () => io.env["ANTHROPIC_API_KEY"],
            ...(home === undefined ? {} : { home }),
          },
        );
      } finally {
        db.close();
      }
    } catch (error) {
      io.stderr(`serve: backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
}

/**
 * Run the repair the route just queued, in the background.
 *
 * `runRepair` re-enqueues idempotently (`jobs_active_per_session` is unique while not done), so it
 * claims the very row the route returned rather than adding a second one. Its own failures are
 * already recorded on that row, which is the channel the UI is watching, so nothing is thrown out
 * of here — an unhandled rejection would take the whole `serve` process down over one repair.
 */
async function runQueuedRepair(ulid: string, io: ServeIo): Promise<void> {
  try {
    const [{ runRepair }, { claudeCodeAdapter }, { newSessionId }, { openIndex }] = await Promise.all([
      import("./repair.js"),
      import("../adapters/claude-code.js"),
      import("@workledger/core/ids"),
      import("../index/db.js"),
    ]);
    const home = io.env["WORKLEDGER_HOME"]?.trim();
    const db = openIndex(home ? { home } : {});
    try {
      const session = db.getSessionByUlid(ulid);
      if (session === undefined) return;
      await runRepair(
        ulid,
        { force: true },
        {
          db,
          root: session.repo_path,
          adapter: claudeCodeAdapter,
          stdout: io.stderr,
          stderr: io.stderr,
          now: () => new Date(),
          newId: newSessionId,
        },
      );
    } finally {
      db.close();
    }
  } catch (error) {
    io.stderr(`serve: repair ${ulid} failed to start: ${error instanceof Error ? error.message : String(error)}`);
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
 * Every enabled repo the index knows, by root — daemon-and-api.md's "machine mode over every
 * enabled repo in the index". `isEnabled` is the filter `doctor` and `scan --all` apply: the
 * index is a cache, and a row whose `.workledger/` is gone names nothing to serve.
 */
export async function enabledRepos(io: ServeIo): Promise<string[]> {
  const { openIndex } = await import("../index/db.js");
  const home = io.env["WORKLEDGER_HOME"]?.trim();
  const db = openIndex(home ? { home } : {});
  try {
    return db
      .listRepos()
      .filter((repo) => repo.enabled !== 0 && isEnabled(repo.repo_path))
      .map((repo) => repo.repo_path);
  } finally {
    db.close();
  }
}

/**
 * Start the local server and stay up until `SIGINT`.
 *
 * @returns `0` after a clean shutdown, `4` when `--repo` names a repo that is not enabled
 * (cli.md's exit-code table), `1` when the port cannot be bound.
 */
export async function serveCommand(
  options: ServeOptions = {},
  io: ServeIo = processIo(),
): Promise<number> {
  const [{ LOOPBACK, createApp }, ops, { VERSION }, { onboardingOps }] = await Promise.all([
    import("@workledger/server"),
    import("../backlog-ops.js"),
    import("../main.js"),
    import("./onboarding-ops.js"),
  ]);

  // Which repos. `--repo` is single-repo mode; without it, the machine.
  let single: string | undefined;
  let roots: string[];
  if (options.repo !== undefined) {
    const root = findRepoRoot(options.repo);
    if (root === undefined || !isEnabled(root)) {
      io.stderr(`workledger serve: ${root ?? options.repo} is not an enabled repo; run \`workledger init\``);
      return EXIT_NOT_ENABLED;
    }
    single = root;
    roots = [root];
    io.stderr("workledger serve: single-repo mode; run `workledger open` for all projects");
  } else {
    try {
      roots = await enabledRepos(io);
    } catch (error) {
      io.stderr(`workledger serve: could not read the index: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT_USAGE;
    }
  }

  const dir = webDir();
  const built = hasWebBuild(dir);
  const home = io.env["WORKLEDGER_HOME"];
  const jobs = jobOps(io);
  const app = createApp({
    ...(single === undefined ? { repos: roots } : { repoRoot: single }),
    ops,
    jobs,
    onboarding: onboardingOps(io),
    cliVersion: VERSION,
    env: io.env,
    ...(home ? { home } : {}),
    ...(built ? { staticDir: dir } : {}),
    staticHtml: placeholderHtml(single ?? `${roots.length} enabled repo(s)`),
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

  // The daemon's calling card, for `open` and `stop` (daemon-and-api.md §CLI). Only the machine
  // daemon writes it: a `--repo` server is a debugging aid, not the one `open` should find.
  const stateHome = single === undefined ? resolveHome(io.env["WORKLEDGER_HOME"]) : undefined;
  if (stateHome !== undefined) {
    writeServeState(stateHome, { url, pid: process.pid, startedAt: new Date().toISOString(), version: VERSION });
  }

  // cli.md §scan: "and every 5 minutes inside `serve`", over every served repo. A sweep that
  // throws — a locked index, a ledger deleted underneath the process — is reported and
  // skipped, never fatal: the server is serving, and one missed sweep is caught by the next
  // one. In machine mode the same tick re-reads the index, so a repo enabled by a `workledger
  // init` in another terminal joins the running daemon without a restart.
  const sweep = setInterval(() => {
    void (async () => {
      if (single === undefined) for (const root of await enabledRepos(io)) app.addRepo(root);
      for (const context of app.repos.list()) await jobs.scan(context.root);
    })().catch((error: unknown) => {
      io.stderr(`workledger serve: scan failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, options.scanIntervalMs ?? SCAN_INTERVAL_MS);
  // A pending interval must not be what keeps the process alive; the listener already is.
  sweep.unref?.();

  await untilStopped(io);
  clearInterval(sweep);
  if (stateHome !== undefined) removeServeState(stateHome, process.pid);
  await server.close();
  app.close();
  return EXIT_OK;
}
