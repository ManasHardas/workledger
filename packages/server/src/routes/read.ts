/**
 * The GET half of api.md §Endpoints. Every route serves from the in-memory read model of the
 * repo the request names (P8: `?repo=<id>`, resolved by `deps.repo`); nothing here touches the
 * ledger directly, and nothing here writes (the POSTs are their own file).
 *
 * `/api/health` is not here: it is the one read that has a machine-wide answer, so it lives with
 * `/api/repos` in `./repos.ts`.
 */
import { Hono } from "hono";
import type { Context } from "hono";

import { renderBrief } from "../brief.js";
import { configEditor } from "../health.js";
import { listIdentities } from "../identities.js";
import { repoRemote } from "../remote.js";
import { badRequest, notFound } from "../errors.js";
import { parseLimit } from "../read-model.js";
import type { LedgerPaths } from "../paths.js";
import type { RepoContext } from "../repos.js";
import type { SessionDetailView } from "../views.js";

/** What the read routes need from `createApp`. */
export interface ReadRouteDeps {
  /** The repo a request addresses; throws the contract's 400 / 404 when it names none or nothing held. */
  repo: (c: Context) => RepoContext;
  /** `brief.max_tokens` from the repo config, re-read per request so an edit takes effect. */
  maxTokens: (paths: LedgerPaths) => number;
}

/** `/api/sessions`, `/api/backlog`, `/api/notes`, `/api/brief`, `/api/identities`. */
export function readRoutes(deps: ReadRouteDeps): Hono {
  const api = new Hono();

  api.get("/sessions", (c) => {
    const q = c.req.query();
    return c.json(
      deps.repo(c).model.listSessions({
        author: q["author"],
        harness: q["harness"],
        status: q["status"],
        since: q["since"],
        q: q["q"],
        limit: parseLimit(q["limit"]),
      }),
    );
  });

  /**
   * One session, plus the repo facts its Done items' links are built from — P8 amendment 13.
   * Both are read per request rather than cached: an operator who adds an `origin` or changes
   * `editor:` while `serve` is running gets the links on the next open, not after a restart.
   */
  api.get("/sessions/:ulid", (c) => {
    const ulid = c.req.param("ulid");
    const repo = deps.repo(c);
    const session = repo.model.getSession(ulid);
    if (session === undefined) throw notFound("session", ulid);
    const view: SessionDetailView = {
      ...session,
      remote: repoRemote(repo.root),
      editor: configEditor(repo.paths),
      repoPath: repo.root,
    };
    return c.json(view);
  });

  api.get("/backlog", (c) => {
    const q = c.req.query();
    return c.json(deps.repo(c).model.listBacklog({ status: q["status"], limit: parseLimit(q["limit"]) }));
  });

  api.get("/backlog/:id", (c) => {
    const id = c.req.param("id");
    const item = deps.repo(c).model.getBacklog(id);
    if (item === undefined) throw notFound("backlog item", id);
    return c.json(item);
  });

  api.get("/notes", (c) => {
    const q = c.req.query();
    return c.json(
      deps.repo(c).model.listNotes({ type: q["type"], open: q["open"], limit: parseLimit(q["limit"]) }),
    );
  });

  api.get("/brief", (c) => {
    const repo = deps.repo(c);
    const raw = c.req.query("max_tokens");
    const maxTokens = raw === undefined ? deps.maxTokens(repo.paths) : Number(raw);
    if (!Number.isFinite(maxTokens)) throw badRequest("max_tokens must be a number");
    let text: string;
    try {
      text = renderBrief(repo.model, maxTokens);
    } catch (error) {
      // `buildBrief` rejects a budget below its irreducible floor with a RangeError. That is the
      // caller's query, not a server fault, so it is a 400 rather than the 500 `onError` gives.
      if (error instanceof RangeError) throw badRequest(error.message);
      throw error;
    }
    return c.text(text, 200, { "content-type": "text/plain; charset=utf-8" });
  });

  /**
   * `.workledger/identities.yaml`, read per request rather than cached.
   *
   * The file is a handful of lines and the client re-reads it only on `health.changed`, so a
   * cache would buy nothing and cost the one thing that matters here: a name added by hand while
   * `serve` is running has to show up without a restart.
   */
  api.get("/identities", (c) => c.json(listIdentities(deps.repo(c).paths)));

  return api;
}
