/**
 * The repos one server serves — docs/contracts/p8/daemon-and-api.md §Repo identity and
 * §Multi-repo endpoints.
 *
 * P2's server was one repo: one read model, one watcher, one mutex. P8 makes it one *machine*:
 * every enabled repo the index knows, each with its own read model, watcher, write lock and job
 * poller, addressed by a `repo` query parameter. This module owns that set. Nothing here reads
 * the index — the CLI reads it and hands the roots in (`CreateAppOptions.repos`), for the same
 * reason `./health.ts` reports the index by path and size rather than opening it.
 *
 * Two modes, because `serve --repo` survives as the debug path: in `single` mode the parameter
 * is optional and defaults to the one repo; in `machine` mode a missing parameter is the
 * contract's 400 `repo-required`. An unknown id is a 404 `repo-not-found` in both.
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";

import { ApiError } from "./errors.js";
import { KeyedMutex } from "./mutex.js";
import { ReadModel } from "./read-model.js";
import { checkConfig, configHarnesses, lastHookAt } from "./health.js";
import { LEDGER_DIR, ledgerId, ledgerPaths } from "./paths.js";
import { startJobWatcher } from "./job-watcher.js";
import { startWatcher } from "./watcher.js";
import type { EventBus } from "./events.js";
import type { JobOps } from "./jobs.js";
import type { JobWatcher } from "./job-watcher.js";
import type { LedgerPaths } from "./paths.js";
import type { Watcher } from "./watcher.js";

/** How the server addresses repos: one implicit repo, or every repo by id. */
export type ServeMode = "single" | "machine";

/**
 * The contract's repo id: "first 12 hex chars of sha256 of the absolute `.workledger` root
 * path" — the ledger directory, `<root>/.workledger`, resolved but with symlinks left alone for
 * the same reason `findRepoRoot` leaves them (the harness reports the path the user works in).
 */
export function repoId(root: string): string {
  const ledger = path.join(path.resolve(root), LEDGER_DIR);
  return createHash("sha256").update(ledger).digest("hex").slice(0, 12);
}

/** `GET /api/repos` element (daemon-and-api.md §Repo identity). */
export interface Repo {
  id: string;
  path: string;
  /** `basename(path)`. */
  name: string;
  /** Always true here: a repo the server holds is one whose `.workledger/` was found. */
  enabled: true;
  /** `harnesses:` from `.workledger/config.yaml`; the schema default when the file has none. */
  harnesses: string[];
  /** Sessions whose `started` is within the last 7 days. */
  sessions7d: number;
  /** Backlog items still `proposed`, `accepted` or `in_progress`. */
  openBacklog: number;
  /** Unresolved blockers and questions. */
  openNotes: number;
  lastHookAt: string | null;
  health: "ok" | "warn" | "broken";
}

/** One served repo: its ledger, its read model and the per-repo machinery around it. */
export interface RepoContext {
  readonly id: string;
  /** The repo root — the directory holding `.workledger/`. */
  readonly root: string;
  readonly paths: LedgerPaths;
  readonly model: ReadModel;
  readonly watcher: Watcher;
  /** The per-id write lock (plans/feature-p2-data-flow.md §Writes), one per repo. */
  readonly mutex: KeyedMutex;
  /** The `job.changed` poller for this repo, or `undefined` when no `jobs` ops were injected. */
  readonly jobWatcher: JobWatcher | undefined;
  /** Stop the watchers. */
  close(): void;
}

export interface RepoRegistryOptions {
  mode: ServeMode;
  bus: EventBus;
  jobs?: JobOps | undefined;
  /** Watcher knobs, for tests that cannot wait 2 s for a poll. */
  debounceMs?: number | undefined;
  pollMs?: number | undefined;
  jobPollMs?: number | undefined;
}

/** Seven days, the window `Repo.sessions7d` counts over. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Backlog statuses that count as open (spec §4.2). */
const OPEN_BACKLOG = "proposed,accepted,in_progress";

/** Every row: the read model's lists cap at 100 by default, and a count must not. */
const UNLIMITED = Number.MAX_SAFE_INTEGER;

/** `true` when `dir` exists and is a directory. */
function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** The served repos, keyed by id. */
export class RepoRegistry {
  readonly mode: ServeMode;
  readonly #options: RepoRegistryOptions;
  readonly #repos = new Map<string, RepoContext>();

  constructor(options: RepoRegistryOptions) {
    this.mode = options.mode;
    this.#options = options;
  }

  /**
   * Start serving `root`: load its ledger, watch it, and (with job ops) poll its jobs.
   * Idempotent — a root already held is returned as it stands rather than watched twice.
   */
  add(root: string): RepoContext {
    const resolved = path.resolve(root);
    const id = repoId(resolved);
    const existing = this.#repos.get(id);
    if (existing !== undefined) return existing;

    const { bus, jobs } = this.#options;
    const paths = ledgerPaths(resolved);
    const model = new ReadModel(paths);
    model.loadAll();

    const watcher = startWatcher({
      paths,
      debounceMs: this.#options.debounceMs,
      pollMs: this.#options.pollMs,
      onChange: (files) => {
        let notesChanged = false;
        for (const file of files) {
          const dir = path.dirname(file);
          const ledgerFile = ledgerId(file);
          if (dir === paths.sessions && ledgerFile !== undefined) {
            model.invalidateSession(ledgerFile);
            bus.emit({ event: "session.changed", data: { ulid: ledgerFile, repo: id } });
            notesChanged = true;
          } else if (dir === paths.backlog && ledgerFile !== undefined) {
            model.invalidateBacklog(ledgerFile);
            bus.emit({ event: "backlog.changed", data: { id: ledgerFile, repo: id } });
          } else if (file === paths.config) {
            bus.emit({ event: "health.changed", data: { repo: id } });
          }
        }
        // Notes live inside session files, so one session write is both events; the notes one
        // is collapsed to a single emission per flush because its payload carries no id.
        if (notesChanged) bus.emit({ event: "notes.changed", data: { repo: id } });
      },
    });

    const jobWatcher =
      jobs === undefined
        ? undefined
        : startJobWatcher({
            ops: jobs,
            repoRoot: resolved,
            repoId: id,
            bus,
            pollMs: this.#options.jobPollMs,
            // A locked or half-migrated index must not take the stream down with it.
            onError: () => {},
          });

    const context: RepoContext = {
      id,
      root: resolved,
      paths,
      model,
      watcher,
      mutex: new KeyedMutex(),
      jobWatcher,
      close: () => {
        watcher.close();
        jobWatcher?.close();
      },
    };
    this.#repos.set(id, context);
    return context;
  }

  /** Stop serving one repo. @returns `false` when the id was not held. */
  remove(id: string): boolean {
    const context = this.#repos.get(id);
    if (context === undefined) return false;
    context.close();
    this.#repos.delete(id);
    return true;
  }

  get(id: string): RepoContext | undefined {
    return this.#repos.get(id);
  }

  /** Every held repo, by path, so `/api/repos` is stable across requests. */
  list(): RepoContext[] {
    return [...this.#repos.values()].sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
  }

  get size(): number {
    return this.#repos.size;
  }

  /**
   * The repo a request addresses, from its `repo` query parameter.
   *
   * @throws {ApiError} 400 `repo-required` when the parameter is absent in machine mode; 404
   * `repo-not-found` when it names nothing held.
   */
  resolve(raw: string | undefined): RepoContext {
    const id = raw?.trim();
    if (id === undefined || id === "") {
      const only = this.list()[0];
      if (this.mode === "single" && only !== undefined) return only;
      throw new ApiError(400, "repo-required", "repo query parameter is required; GET /api/repos lists the ids");
    }
    const found = this.#repos.get(id);
    if (found === undefined) throw new ApiError(404, "repo-not-found", `no repo ${id}; GET /api/repos lists the ids`);
    return found;
  }

  /** The `Repo` row of `/api/repos` for one held repo, computed from its ledger now. */
  describe(context: RepoContext, now: Date = new Date()): Repo {
    const { model, paths } = context;
    const config = checkConfig(paths);
    let health: Repo["health"] = "ok";
    if (!isDirectory(paths.ledger) || !config.valid) health = "broken";
    else if (model.problems.size > 0) health = "warn";
    return {
      id: context.id,
      path: context.root,
      name: path.basename(context.root),
      enabled: true,
      harnesses: configHarnesses(paths),
      sessions7d: model.listSessions({ since: new Date(now.getTime() - WEEK_MS).toISOString(), limit: UNLIMITED })
        .length,
      openBacklog: model.listBacklog({ status: OPEN_BACKLOG, limit: UNLIMITED }).length,
      openNotes: model.listNotes({ open: "true", limit: UNLIMITED }).length,
      lastHookAt: lastHookAt(paths),
      health,
    };
  }

  /** `/api/repos`. */
  describeAll(now: Date = new Date()): Repo[] {
    return this.list().map((context) => this.describe(context, now));
  }

  close(): void {
    for (const context of this.#repos.values()) context.close();
    this.#repos.clear();
  }
}
