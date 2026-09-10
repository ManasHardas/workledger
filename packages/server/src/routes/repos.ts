/**
 * The machine-wide reads of docs/contracts/p8/daemon-and-api.md §Multi-repo endpoints:
 * `/api/repos`, `/api/health`, `/api/notes/all` and `/api/jobs/all`.
 *
 * These are the routes a `repo` parameter is *not* required on, even in machine mode: they are
 * how a client learns which repos exist in the first place, and `workledger open` waits on
 * `/api/health` before it has any id to name. `/api/health` still accepts one — a per-repo
 * report is the P2 shape, and the Health view keeps asking for it.
 */
import { Hono } from "hono";

import { buildHealth, buildMachineHealth } from "../health.js";
import { badRequest } from "../errors.js";
import type { HealthEnv } from "../health.js";
import type { Job, JobOps } from "../jobs.js";
import type { Repo, RepoRegistry } from "../repos.js";
import type { NoteRef } from "../views.js";

export interface RepoRouteDeps {
  registry: RepoRegistry;
  health: HealthEnv;
  /** Absent on a build without the P3 backend; `/api/jobs/all` is then an empty list. */
  jobs?: JobOps | undefined;
}

/** `/api/notes/all` element. */
export type NoteAcrossRepos = NoteRef & { repo: Repo };

/** `/api/jobs/all` element. */
export type JobAcrossRepos = Job & { repo: Repo };

/** Every row: the read model's lists cap at 100 by default; an aggregate is the client's to cut. */
const UNLIMITED = Number.MAX_SAFE_INTEGER;

export function repoRoutes(deps: RepoRouteDeps): Hono {
  const { registry } = deps;
  const api = new Hono();

  api.get("/repos", (c) => c.json(registry.describeAll()));

  api.get("/health", (c) => {
    const raw = c.req.query("repo");
    // Machine mode without a repo is the machine-wide report; single mode without one is the
    // one repo, as it was in P2. A named repo is that repo's report in either mode.
    if (raw === undefined && registry.mode === "machine") {
      return c.json(buildMachineHealth(registry, deps.health));
    }
    const repo = registry.resolve(raw);
    return c.json(buildHealth(repo.model, deps.health, registry.describeAll()));
  });

  api.get("/notes/all", (c) => {
    const q = c.req.query();
    const out: NoteAcrossRepos[] = [];
    for (const context of registry.list()) {
      const repo = registry.describe(context);
      for (const note of context.model.listNotes({ type: q["type"], open: q["open"], limit: UNLIMITED })) {
        out.push({ ...note, repo });
      }
    }
    return c.json(out);
  });

  api.get("/jobs/all", async (c) => {
    if (c.req.query("status") !== undefined) throw badRequest("jobs/all takes no status filter");
    const out: JobAcrossRepos[] = [];
    if (deps.jobs !== undefined) {
      for (const context of registry.list()) {
        const repo = registry.describe(context);
        for (const job of await deps.jobs.listJobs(context.root)) out.push({ ...job, repo });
      }
    }
    // Newest first across repos, the order `GET /api/jobs` already gives within one.
    out.sort((a, b) => (a.created_at === b.created_at ? 0 : a.created_at < b.created_at ? 1 : -1));
    return c.json(out);
  });

  return api;
}
