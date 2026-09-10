/**
 * The POST half of api.md §Endpoints.
 *
 * Every route does the same four things and nothing else: parse and validate the request body
 * into the arguments the op already takes, resolve `by` from the repo's git config, run the op
 * under the per-id mutex, and project its result onto the read model's `BacklogView` /
 * `SessionView`. The mutation itself is `packages/cli/src/backlog-ops.ts`, injected as
 * {@link BacklogOps} — this file never touches a ledger file (api.md: "the server never writes
 * ledger files directly").
 *
 * Validation lives here rather than in the ops because the two callers disagree about what a bad
 * argument *is*: commander rejects `--rank foo` before `rankItem` ever sees it, so the op takes a
 * `number` and an HTTP caller can hand it a string. Everything this file rejects is therefore
 * api.md's 400 — a body of the wrong shape — while everything the op rejects carries its own
 * class (404 for an unknown id, 409 for an illegal transition, 400 for the rest).
 *
 * After a successful write the changed file is re-read into the read model straight away rather
 * than waiting for the watcher's 100 ms debounce: the response carries the fresh view, and a
 * `GET` issued immediately after the `POST` must not still see the old one.
 */
import { Hono } from "hono";
import type { Context } from "hono";

import { ApiError, badRequest, notFound, toApiError } from "../errors.js";
import { readBody, readInteger, readString } from "./body.js";
import type { BacklogOps, EditPatch, ItemResult, OpContext } from "../ops.js";
import type { BacklogView, SessionView } from "../views.js";
import type { RepoContext } from "../repos.js";
import type { Actor, Priority } from "@workledger/core/schema";

/** What the write routes need from `createApp`. */
export interface WriteRouteDeps {
  /**
   * The repo whose `.workledger/` is written — resolved per request from `?repo=` (P8), with
   * its read model and its per-id mutex (data-flow §Writes) alongside.
   */
  repo: (c: Context) => RepoContext;
  ops: BacklogOps;
}

/** The literals `priority` accepts on the wire; `null` clears it (backlog-cli.md). */
const PRIORITIES: readonly string[] = ["p1", "p2", "p3"];

/** `{ name, email, dome_user? }` — the one owner shape `assign` takes. */
function readActor(value: unknown): Actor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("owner must be an object with name and email, or null");
  }
  const { name, email, dome_user: dome } = value as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") throw badRequest("owner.name must be a non-empty string");
  if (typeof email !== "string" || email.trim() === "") throw badRequest("owner.email must be a non-empty string");
  if (dome !== undefined && dome !== null && typeof dome !== "string") {
    throw badRequest("owner.dome_user must be a string or null");
  }
  const actor: Actor = { name, email };
  if (dome !== undefined) actor.dome_user = dome as string | null;
  return actor;
}

/** `{ title?, body?, priority?, area? }` — api.md's `edit` body. */
function readEditPatch(body: Record<string, unknown>): EditPatch {
  const known = new Set(["title", "body", "priority", "area"]);
  const extra = Object.keys(body).filter((key) => !known.has(key));
  if (extra.length > 0) throw badRequest(`unknown field(s) ${extra.join(", ")}: expected title, body, priority, area`);

  const patch: EditPatch = {};
  if (body["title"] !== undefined) {
    if (typeof body["title"] !== "string") throw badRequest("title must be a string");
    patch.title = body["title"];
  }
  if (body["body"] !== undefined) {
    if (typeof body["body"] !== "string") throw badRequest("body must be a string");
    patch.body = body["body"];
  }
  if (body["priority"] !== undefined) {
    const priority = body["priority"];
    if (priority !== null && (typeof priority !== "string" || !PRIORITIES.includes(priority))) {
      throw badRequest(`priority must be one of ${PRIORITIES.join(", ")}, or null`);
    }
    patch.priority = priority as Priority | null;
  }
  if (body["area"] !== undefined) {
    const area = body["area"];
    if (!Array.isArray(area) || area.some((entry) => typeof entry !== "string")) {
      throw badRequest("area must be an array of strings");
    }
    patch.area = area as string[];
  }
  return patch;
}

/** `/api/backlog/:id/*` and `/api/notes/resolve`. */
export function writeRoutes(deps: WriteRouteDeps): Hono {
  const api = new Hono();

  /**
   * The `OpContext` every write runs with: this repo, and the git identity as it stands *now*.
   *
   * Re-resolved per request rather than captured at startup, so setting `user.email` fixes a
   * refused write without restarting the server.
   *
   * @throws {ApiError} 409 when git has no identity — data-flow §Identity, "the server refuses
   * writes with 409 if either is empty".
   */
  function context(repo: RepoContext): OpContext {
    const by = deps.ops.gitActor(repo.root);
    if (by === undefined) {
      throw new ApiError(
        409,
        "no_identity",
        "git user.name and user.email must be set to record who made this change",
      );
    }
    return { repoRoot: repo.root, by };
  }

  /** Run one write under the repo's mutex, mapping its refusal onto the contract's status. */
  async function write<T>(
    repo: RepoContext,
    keys: readonly string[],
    body: (ctx: OpContext) => Promise<T>,
  ): Promise<T> {
    const ctx = context(repo);
    try {
      return await repo.mutex.run(keys, () => body(ctx));
    } catch (error) {
      throw toApiError(error);
    }
  }

  /** Refresh the read model from the file the op just wrote, and return the fresh view. */
  function refresh(repo: RepoContext, result: ItemResult): BacklogView {
    repo.model.invalidateBacklog(result.id);
    // The op wrote this file a moment ago, so the re-read is what the response carries; the
    // in-hand result is the fallback for a file deleted between the write and the read.
    return repo.model.getBacklog(result.id) ?? { frontmatter: result.item, body: result.body };
  }

  /** The five status transitions, which differ only in the function they call. */
  const TRANSITIONS = {
    accept: (ops: BacklogOps) => ops.acceptItem.bind(ops),
    discard: (ops: BacklogOps) => ops.discardItem.bind(ops),
    done: (ops: BacklogOps) => ops.doneItem.bind(ops),
    start: (ops: BacklogOps) => ops.startItem.bind(ops),
    restore: (ops: BacklogOps) => ops.restoreItem.bind(ops),
  } as const;

  for (const [name, pick] of Object.entries(TRANSITIONS)) {
    api.post(`/backlog/:id/${name}`, async (c) => {
      const repo = deps.repo(c);
      const id = c.req.param("id");
      const result = await write(repo, [id], (ctx) => pick(deps.ops)(ctx, id));
      return c.json(refresh(repo, result));
    });
  }

  api.post("/backlog/:id/edit", async (c) => {
    const repo = deps.repo(c);
    const id = c.req.param("id");
    const patch = readEditPatch(await readBody(c));
    const result = await write(repo, [id], (ctx) => deps.ops.editItem(ctx, id, patch));
    return c.json(refresh(repo, result));
  });

  api.post("/backlog/:id/assign", async (c) => {
    const repo = deps.repo(c);
    const id = c.req.param("id");
    const body = await readBody(c);
    if (!("owner" in body)) throw badRequest("assign takes { owner: Actor | null }");
    const owner = body["owner"] === null ? null : readActor(body["owner"]);
    const result = await write(repo, [id], (ctx) => deps.ops.assignItem(ctx, id, owner));
    return c.json(refresh(repo, result));
  });

  api.post("/backlog/:id/rank", async (c) => {
    const repo = deps.repo(c);
    const id = c.req.param("id");
    const rank = readInteger(await readBody(c), "rank");
    const result = await write(repo, [id], (ctx) => deps.ops.rankItem(ctx, id, rank));
    return c.json(refresh(repo, result));
  });

  api.post("/backlog/:id/merge", async (c) => {
    const repo = deps.repo(c);
    const id = c.req.param("id");
    const into = readString(await readBody(c), "into");
    const merged = await write(repo, [id, into], (ctx) => deps.ops.mergeItems(ctx, id, into));
    return c.json({ source: refresh(repo, merged.source), target: refresh(repo, merged.target) });
  });

  api.post("/notes/resolve", async (c) => {
    const repo = deps.repo(c);
    const body = await readBody(c);
    const session = readString(body, "session");
    const cp = readInteger(body, "cp", 1);
    const index = readInteger(body, "index", 0);
    const decision = readString(body, "decision");

    await write(repo, [session], (ctx) => deps.ops.resolveNote(ctx, session, cp, index, decision));
    repo.model.invalidateSession(session);
    const view: SessionView | undefined = repo.model.getSession(session);
    // The op wrote the file this reads, so the only way it is gone is a delete in between.
    if (view === undefined) throw notFound("session", session);
    return c.json(view);
  });

  return api;
}
