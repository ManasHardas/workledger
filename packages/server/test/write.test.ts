/**
 * The POST half of `docs/contracts/p2/api.md` — the part `packages/server` owns.
 *
 * The ops are faked here on purpose: this package never imports `backlog-ops.ts` (see
 * `src/ops.ts`), so what these tests assert is that every documented route exists, that it hands
 * the op the arguments the CLI hands it, that a malformed body is a 400 before the op is reached,
 * that `by` comes from git and an empty identity is a 409, and that each refusal class lands on
 * the status api.md gives it. That the resulting *file* matches the one the CLI writes is asserted
 * against the real ops in `packages/cli/test/serve.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeOps, appFor, seedRepo } from "./helpers.js";
import { KeyedMutex } from "../src/mutex.js";
import type { OpErrorCode } from "../src/ops.js";
import type { ServerApp } from "../src/app.js";
import type { TempRepo } from "./helpers.js";

const ID = "WL-01JQ8ZK4T0000000000000000A";
const SESSION = "01JQ8ZK4T0000000000000000A";

let repo: TempRepo;
let ops: FakeOps;
let server: ServerApp;

beforeEach(() => {
  repo = seedRepo();
  ops = new FakeOps(ID);
  server = appFor(repo, { ops });
});

afterEach(() => {
  server.close();
  repo.cleanup();
});

/** A refusal in the shape `backlog-ops.ts` throws. */
function opError(message: string, code: OpErrorCode, details: string[] = []): Error {
  return Object.assign(new Error(message), { code, details });
}

async function post(url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await server.app.request(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  return { status: response.status, body: await response.json() };
}

describe("the status transitions", () => {
  for (const op of ["accept", "discard", "done", "start", "restore"] as const) {
    it(`POST /api/backlog/:id/${op} calls ${op}Item with the git identity and returns a BacklogView`, async () => {
      const { status, body } = await post(`/api/backlog/${ID}/${op}`);

      expect(status).toBe(200);
      expect(ops.calls).toEqual([
        { op, args: [{ repoRoot: repo.root, by: { name: "Ada", email: "ada@example.com" } }, ID] },
      ]);
      expect(Object.keys(body as object).sort()).toEqual(["body", "frontmatter"]);
    });
  }

  it("returns 409 with the legal targets when the transition is illegal", async () => {
    ops.next = opError(`${ID} is discarded; it cannot move to accepted`, "conflict", [
      "legal targets from discarded: proposed",
    ]);

    const { status, body } = await post(`/api/backlog/${ID}/accept`);

    expect(status).toBe(409);
    expect(body).toEqual({
      error: {
        code: "conflict",
        message: `${ID} is discarded; it cannot move to accepted (legal targets from discarded: proposed)`,
      },
    });
  });

  it("returns 404 for an id the ledger does not have", async () => {
    ops.next = opError(`unknown backlog item ${ID}`, "not-found");

    const { status, body } = await post(`/api/backlog/${ID}/done`);

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("returns 404 when the ledger has gone away underneath the server", async () => {
    ops.next = opError("not an enabled repo", "not-enabled");
    expect((await post(`/api/backlog/${ID}/start`)).status).toBe(404);
  });

  it("returns 400 for a refusal that is neither missing nor a state conflict", async () => {
    ops.next = opError("rank must be an integer", "usage");
    expect((await post(`/api/backlog/${ID}/restore`)).status).toBe(400);
  });

  it("passes a non-op failure through as a 500", async () => {
    ops.next = new Error("disk is on fire");
    const { status, body } = await post(`/api/backlog/${ID}/accept`);
    expect(status).toBe(500);
    expect((body as { error: { code: string } }).error.code).toBe("internal");
  });
});

describe("identity", () => {
  it("refuses every write with 409 when git has no user.name or user.email", async () => {
    ops.actor = undefined;

    const { status, body } = await post(`/api/backlog/${ID}/accept`);

    expect(status).toBe(409);
    expect((body as { error: { code: string } }).error.code).toBe("no_identity");
    expect(ops.calls).toEqual([]);
  });

  it("re-reads the identity per request, so setting it fixes a refused write", async () => {
    ops.actor = undefined;
    expect((await post(`/api/backlog/${ID}/accept`)).status).toBe(409);

    ops.actor = { name: "Grace", email: "grace@example.com" };
    expect((await post(`/api/backlog/${ID}/accept`)).status).toBe(200);
    expect((ops.calls[0]?.args[0] as { by: unknown }).by).toEqual({
      name: "Grace",
      email: "grace@example.com",
    });
  });
});

describe("POST /api/backlog/:id/edit", () => {
  it("passes the documented patch through", async () => {
    const patch = { title: "New", body: "Text", priority: "p2", area: ["cli", "server"] };

    const { status } = await post(`/api/backlog/${ID}/edit`, patch);

    expect(status).toBe(200);
    expect(ops.calls[0]?.args[2]).toEqual(patch);
  });

  it("accepts a null priority, which clears the field", async () => {
    await post(`/api/backlog/${ID}/edit`, { priority: null });
    expect(ops.calls[0]?.args[2]).toEqual({ priority: null });
  });

  for (const [label, body] of [
    ["a priority outside the enum", { priority: "p9" }],
    ["a non-string title", { title: 7 }],
    ["a non-string body", { body: [] }],
    ["an area that is not a string list", { area: ["ok", 3] }],
    ["a field the contract does not list", { status: "done" }],
  ] as const) {
    it(`rejects ${label} with 400 before the op runs`, async () => {
      const { status } = await post(`/api/backlog/${ID}/edit`, body);
      expect(status).toBe(400);
      expect(ops.calls).toEqual([]);
    });
  }

  it("rejects a body that is not JSON with 400", async () => {
    const response = await server.app.request(`/api/backlog/${ID}/edit`, {
      method: "POST",
      body: "{nope",
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
  });

  it("rejects a JSON array body with 400", async () => {
    expect((await post(`/api/backlog/${ID}/edit`, [1, 2])).status).toBe(400);
  });

  it("lets the op refuse an empty patch", async () => {
    ops.next = opError(`nothing to edit on ${ID}`, "usage");
    expect((await post(`/api/backlog/${ID}/edit`)).status).toBe(400);
  });
});

describe("POST /api/backlog/:id/assign", () => {
  it("passes an owner through", async () => {
    const owner = { name: "Ada", email: "ada@example.com" };
    expect((await post(`/api/backlog/${ID}/assign`, { owner })).status).toBe(200);
    expect(ops.calls[0]?.args[2]).toEqual(owner);
  });

  it("keeps an explicit null dome_user", async () => {
    await post(`/api/backlog/${ID}/assign`, {
      owner: { name: "Ada", email: "a@e.com", dome_user: null },
    });
    expect(ops.calls[0]?.args[2]).toEqual({ name: "Ada", email: "a@e.com", dome_user: null });
  });

  it("passes null through, which clears the owner", async () => {
    expect((await post(`/api/backlog/${ID}/assign`, { owner: null })).status).toBe(200);
    expect(ops.calls[0]?.args[2]).toBeNull();
  });

  for (const [label, body] of [
    ["a missing owner key", {}],
    ["an owner that is a string", { owner: "Ada <ada@example.com>" }],
    ["an owner with no email", { owner: { name: "Ada" } }],
    ["an owner with a blank name", { owner: { name: " ", email: "a@e.com" } }],
    ["a dome_user that is a number", { owner: { name: "A", email: "a@e.com", dome_user: 1 } }],
  ] as const) {
    it(`rejects ${label} with 400`, async () => {
      expect((await post(`/api/backlog/${ID}/assign`, body)).status).toBe(400);
      expect(ops.calls).toEqual([]);
    });
  }
});

describe("POST /api/backlog/:id/rank", () => {
  it("passes an integer rank through, including a negative one", async () => {
    expect((await post(`/api/backlog/${ID}/rank`, { rank: -3 })).status).toBe(200);
    expect(ops.calls[0]?.args[2]).toBe(-3);
  });

  for (const [label, body] of [
    ["a string rank", { rank: "4" }],
    ["a fractional rank", { rank: 1.5 }],
    ["no rank at all", {}],
  ] as const) {
    it(`rejects ${label} with 400`, async () => {
      expect((await post(`/api/backlog/${ID}/rank`, body)).status).toBe(400);
      expect(ops.calls).toEqual([]);
    });
  }
});

describe("POST /api/backlog/:id/merge", () => {
  const OTHER = "WL-01JQ8ZK4T0000000000000000B";

  it("returns both views under `source` and `target`", async () => {
    const { status, body } = await post(`/api/backlog/${ID}/merge`, { into: OTHER });

    expect(status).toBe(200);
    expect(Object.keys(body as object).sort()).toEqual(["source", "target"]);
    expect(ops.calls[0]?.args.slice(1)).toEqual([ID, OTHER]);
  });

  it("rejects a missing or empty `into` with 400", async () => {
    expect((await post(`/api/backlog/${ID}/merge`, {})).status).toBe(400);
    expect((await post(`/api/backlog/${ID}/merge`, { into: "  " })).status).toBe(400);
    expect(ops.calls).toEqual([]);
  });
});

describe("POST /api/notes/resolve", () => {
  it("rejects every malformed body with 400 before the op runs", async () => {
    const bad = [
      {},
      { session: SESSION, cp: 1, index: 0 },
      { session: SESSION, cp: 0, index: 0, decision: "d" },
      { session: SESSION, cp: 1, index: -1, decision: "d" },
      { session: SESSION, cp: "1", index: 0, decision: "d" },
      { session: SESSION, cp: 1, index: 0, decision: "   " },
    ];
    for (const body of bad) {
      expect((await post("/api/notes/resolve", body)).status).toBe(400);
    }
    expect(ops.calls).toEqual([]);
  });

  it("returns 404 when the op does not know the session", async () => {
    ops.next = opError(`unknown session ${SESSION}`, "not-found");
    const { status } = await post("/api/notes/resolve", {
      session: SESSION,
      cp: 1,
      index: 0,
      decision: "ship it",
    });
    expect(status).toBe(404);
  });

  it("returns 409 when the note is already resolved", async () => {
    ops.next = opError("note #0 at checkpoint 1 is already resolved", "conflict");
    const { status } = await post("/api/notes/resolve", {
      session: SESSION,
      cp: 1,
      index: 0,
      decision: "ship it",
    });
    expect(status).toBe(409);
  });
});

describe("unknown POST paths", () => {
  it("are the contract's 404 body, not the static app shell", async () => {
    const { status, body } = await post(`/api/backlog/${ID}/frobnicate`);
    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  });
});

describe("KeyedMutex", () => {
  it("serializes two writes to one key and releases it afterwards", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const a = mutex.run(["x"], async () => {
      order.push("a:start");
      await first;
      order.push("a:end");
    });
    const b = mutex.run(["x"], async () => void order.push("b:start"));

    // `b` cannot have started: `a` still holds the key. A macrotask is long enough for every
    // microtask the mutex queues, so this is "b never ran", not "b has not run yet".
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["a:start"]);
    releaseFirst();
    await Promise.all([a, b]);

    expect(order).toEqual(["a:start", "a:end", "b:start"]);
    expect(mutex.held).toBe(0);
  });

  it("lets different keys run concurrently", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = mutex.run(["x"], async () => {
      order.push("x");
      await blocked;
    });
    await mutex.run(["y"], async () => void order.push("y"));

    expect(order).toEqual(["x", "y"]);
    release();
    await a;
  });

  it("releases the key when the body throws, and does not fail the next holder", async () => {
    const mutex = new KeyedMutex();
    await expect(
      mutex.run(["x"], () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(mutex.run(["x"], () => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(mutex.held).toBe(0);
  });

  it("takes every key of a multi-key write before waiting, so merges cannot deadlock", async () => {
    const mutex = new KeyedMutex();
    const done: string[] = [];
    await Promise.all([
      mutex.run(["a", "b"], async () => void done.push("ab")),
      mutex.run(["b", "a"], async () => void done.push("ba")),
    ]);
    expect(done.sort()).toEqual(["ab", "ba"]);
    expect(mutex.held).toBe(0);
  });
});
