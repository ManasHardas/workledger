/**
 * The GET half of api.md §Endpoints. Every route serves from the in-memory read model; nothing
 * here touches the ledger directly, and nothing here writes (the POSTs are their own issue).
 */
import { Hono } from "hono";

import { renderBrief } from "../brief.js";
import { buildHealth } from "../health.js";
import { badRequest, notFound } from "../errors.js";
import { parseLimit } from "../read-model.js";
import type { HealthEnv } from "../health.js";
import type { ReadModel } from "../read-model.js";

/** What the read routes need from `createApp`. */
export interface ReadRouteDeps {
  model: ReadModel;
  health: HealthEnv;
  /** `brief.max_tokens` from the repo config, re-read per request so an edit takes effect. */
  maxTokens: () => number;
}

/** `/api/sessions`, `/api/backlog`, `/api/notes`, `/api/brief`, `/api/health`. */
export function readRoutes(deps: ReadRouteDeps): Hono {
  const api = new Hono();

  api.get("/sessions", (c) => {
    const q = c.req.query();
    return c.json(
      deps.model.listSessions({
        author: q["author"],
        harness: q["harness"],
        status: q["status"],
        since: q["since"],
        q: q["q"],
        limit: parseLimit(q["limit"]),
      }),
    );
  });

  api.get("/sessions/:ulid", (c) => {
    const ulid = c.req.param("ulid");
    const session = deps.model.getSession(ulid);
    if (session === undefined) throw notFound("session", ulid);
    return c.json(session);
  });

  api.get("/backlog", (c) => {
    const q = c.req.query();
    return c.json(deps.model.listBacklog({ status: q["status"], limit: parseLimit(q["limit"]) }));
  });

  api.get("/backlog/:id", (c) => {
    const id = c.req.param("id");
    const item = deps.model.getBacklog(id);
    if (item === undefined) throw notFound("backlog item", id);
    return c.json(item);
  });

  api.get("/notes", (c) => {
    const q = c.req.query();
    return c.json(
      deps.model.listNotes({ type: q["type"], open: q["open"], limit: parseLimit(q["limit"]) }),
    );
  });

  api.get("/brief", (c) => {
    const raw = c.req.query("max_tokens");
    const maxTokens = raw === undefined ? deps.maxTokens() : Number(raw);
    if (!Number.isFinite(maxTokens)) throw badRequest("max_tokens must be a number");
    let text: string;
    try {
      text = renderBrief(deps.model, maxTokens);
    } catch (error) {
      // `buildBrief` rejects a budget below its irreducible floor with a RangeError. That is the
      // caller's query, not a server fault, so it is a 400 rather than the 500 `onError` gives.
      if (error instanceof RangeError) throw badRequest(error.message);
      throw error;
    }
    return c.text(text, 200, { "content-type": "text/plain; charset=utf-8" });
  });

  api.get("/health", (c) => c.json(buildHealth(deps.model, deps.health)));

  return api;
}
