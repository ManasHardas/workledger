/**
 * Every POST method of `LedgerSource` against a minimal Hono route set that echoes back what it
 * was sent, in the shapes of `docs/contracts/p2/api.md` §Endpoints.
 *
 * The routes here are deliberately not `packages/server`'s: the server's POST half is issue #34
 * and lands separately, and blocking this client on it would mean shipping the write methods
 * untested. What these assert is the half that is this package's job — method, path, id escaping,
 * body shape, and the decoding of the response — with the echo standing in for the mutation. When
 * #34 merges, the same assertions run against the real routes without changing.
 */
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";

import { LocalServerSource, READ_ONLY, createSource } from "../src/index.js";
import type { BacklogView, LedgerSource, ParsedSession, SourceCapabilities } from "../src/index.js";

/** What the echo routes record about the request the client made. */
interface Seen {
  method: string;
  path: string;
  body: unknown;
}

const seen: Seen[] = [];
let baseUrl: string;
let server: Server;
let source: LedgerSource;

/** A `BacklogView`-shaped envelope carrying what the route was called with. */
function view(id: string, extra: Record<string, unknown> = {}): BacklogView {
  return { frontmatter: { id, ...extra } as BacklogView["frontmatter"], body: `body of ${id}` };
}

function echoApp(): Hono {
  const app = new Hono();

  const record = async (c: { req: { method: string; url: string; json: () => Promise<unknown> } }): Promise<unknown> => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // A body-less POST sends no content-type; that is the contract for the five transitions.
      body = undefined;
    }
    const path = new URL(c.req.url).pathname;
    seen.push({ method: c.req.method, path, body });
    return body;
  };

  // The contract's 409, so the client's error mapping is exercised on a write and not only a read.
  // Registered before the `:id` routes below, because Hono matches in registration order.
  app.post("/api/backlog/conflict/accept", (c) =>
    c.json({ error: { code: "conflict", message: "already discarded" } }, 409),
  );

  for (const op of ["accept", "discard", "done", "start", "restore"]) {
    app.post(`/api/backlog/:id/${op}`, async (c) => {
      await record(c);
      return c.json(view(c.req.param("id"), { status: op }));
    });
  }

  app.post("/api/backlog/:id/edit", async (c) => {
    const body = (await record(c)) as Record<string, unknown>;
    return c.json(view(c.req.param("id"), body));
  });
  app.post("/api/backlog/:id/assign", async (c) => {
    const body = (await record(c)) as { owner: unknown };
    return c.json(view(c.req.param("id"), { owner: body.owner }));
  });
  app.post("/api/backlog/:id/rank", async (c) => {
    const body = (await record(c)) as { rank: number };
    return c.json(view(c.req.param("id"), { rank: body.rank }));
  });
  app.post("/api/backlog/:id/merge", async (c) => {
    const body = (await record(c)) as { into: string };
    return c.json({ source: view(c.req.param("id")), target: view(body.into) });
  });
  app.post("/api/notes/resolve", async (c) => {
    const body = (await record(c)) as { session: string; cp: number; index: number; decision: string };
    const session: ParsedSession = {
      frontmatter: { id: body.session, resolved: [{ cp: body.cp, index: body.index }] } as ParsedSession["frontmatter"],
      goal: body.decision,
      done: [],
      remaining: [],
      notes: [],
      unparsed: [],
    };
    return c.json(session);
  });

  return app;
}

beforeAll(async () => {
  const app = echoApp();
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    }) as unknown as Server;
  });
  source = createSource("local", { baseUrl });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("backlog transitions", () => {
  it.each(["accept", "discard", "done", "start", "restore"] as const)(
    "POSTs /api/backlog/:id/%s with no body",
    async (op) => {
      seen.length = 0;
      const result = await source[op]("bl-01");
      expect(seen).toEqual([{ method: "POST", path: `/api/backlog/bl-01/${op}`, body: undefined }]);
      expect(result.frontmatter.id).toBe("bl-01");
      expect(result.body).toBe("body of bl-01");
    },
  );

  it("escapes an id into a single path segment", async () => {
    seen.length = 0;
    await source.accept("bl/../evil");
    expect(seen[0]!.path).toBe("/api/backlog/bl%2F..%2Fevil/accept");
  });

  it("maps a 409 onto the contract's conflict code", async () => {
    await expect(source.accept("conflict")).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: "already discarded",
    });
  });
});

describe("backlog mutations with bodies", () => {
  it("sends the edit patch verbatim, null priority included", async () => {
    seen.length = 0;
    const patch = { title: "new title", body: "new body", priority: null, area: ["cli", "core"] };
    const result = await source.edit("bl-02", patch);
    expect(seen[0]).toEqual({ method: "POST", path: "/api/backlog/bl-02/edit", body: patch });
    expect(result.frontmatter).toMatchObject(patch);
  });

  it("wraps the owner in `{ owner }`, including the unassign case", async () => {
    seen.length = 0;
    const owner = { name: "Manas Hardas", email: "manas@example.com" };
    await source.assign("bl-03", owner);
    await source.assign("bl-03", null);
    expect(seen.map((s) => s.body)).toEqual([{ owner }, { owner: null }]);
    expect(seen.every((s) => s.path === "/api/backlog/bl-03/assign")).toBe(true);
  });

  it("wraps the rank in `{ rank }`", async () => {
    seen.length = 0;
    const result = await source.rank("bl-04", 12);
    expect(seen[0]).toEqual({ method: "POST", path: "/api/backlog/bl-04/rank", body: { rank: 12 } });
    expect(result.frontmatter).toMatchObject({ rank: 12 });
  });

  it("merges into a target and decodes both views", async () => {
    seen.length = 0;
    const result = await source.merge("bl-05", "bl-06");
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/api/backlog/bl-05/merge",
      body: { into: "bl-06" },
    });
    expect(result.source.frontmatter.id).toBe("bl-05");
    expect(result.target.frontmatter.id).toBe("bl-06");
  });
});

describe("notes", () => {
  it("flattens the ref and the decision into one body", async () => {
    seen.length = 0;
    const result = await source.resolveNote({ session: "01SESSION", cp: 3, index: 1 }, "shipped it");
    expect(seen[0]).toEqual({
      method: "POST",
      path: "/api/notes/resolve",
      body: { session: "01SESSION", cp: 3, index: 1, decision: "shipped it" },
    });
    expect(result.frontmatter.id).toBe("01SESSION");
    expect(result.goal).toBe("shipped it");
  });
});

describe("read-only sources", () => {
  /** The same server, presented read-only — a kiosk view, or a future replay source. */
  class ReadOnly extends LocalServerSource {
    override readonly capabilities: SourceCapabilities = {
      write: false,
      live: true,
      provenance: false,
    };
  }

  it("rejects every write with { code: \"read-only\" } and sends nothing", async () => {
    const ro = new ReadOnly({ baseUrl });
    seen.length = 0;
    const writes: Promise<unknown>[] = [
      ro.accept("bl-01"),
      ro.discard("bl-01"),
      ro.done("bl-01"),
      ro.start("bl-01"),
      ro.restore("bl-01"),
      ro.edit("bl-01", { title: "x" }),
      ro.assign("bl-01", null),
      ro.rank("bl-01", 1),
      ro.merge("bl-01", "bl-02"),
      ro.resolveNote({ session: "01S", cp: 1, index: 0 }, "no"),
    ];
    for (const write of writes) {
      await expect(write).rejects.toMatchObject({ code: READ_ONLY });
    }
    expect(seen).toEqual([]);
  });

  it("still reads, and still has a no-op unsubscribe when not live", () => {
    const dead = new (class extends LocalServerSource {
      override readonly capabilities: SourceCapabilities = {
        write: false,
        live: false,
        provenance: false,
      };
    })({ baseUrl });
    const unsubscribe = dead.subscribe(() => {
      throw new Error("a non-live source must never emit");
    });
    expect(() => unsubscribe()).not.toThrow();
  });
});
