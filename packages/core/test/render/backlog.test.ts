import { describe, expect, it } from "vitest";

import {
  type Actor,
  type HistoryEntry,
  type ItemPatch,
  type Provenance,
  ALREADY_DONE,
  BacklogItem as BacklogItemSchema,
  HistoryEntry as HistoryEntrySchema,
  RenderError,
  applyUpdate,
  closeItem,
  createItem,
  editItem,
  parseItem,
} from "../../src/index.js";

/** Golden files are read through `import.meta.glob`, never `node:fs` — the purity fence. */
const goldens = import.meta.glob<string>("../golden/backlog/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function golden(name: string): string {
  const key = Object.keys(goldens).find((path) => path.endsWith(`/${name}.md`));
  if (key === undefined) throw new Error(`golden not found: ${name}.md`);
  return goldens[key]!;
}

const SESSION = "01J9AA00000000000000000000";
const OTHER_SESSION = "01J9BB00000000000000000000";
const WL_SIZE = "WL-01J9AB00000000000000000000";
const WL_OPS = "WL-01J9AC00000000000000000000";

const ADA: Actor = { name: "Ada Lovelace", email: "ada@example.com", dome_user: null };
const GRACE: Actor = { name: "Grace Hopper", email: "grace@example.com", dome_user: null };

const PROVENANCE: Provenance = {
  harness: "claude-code",
  session: SESSION,
  checkpoint: 2,
  author: ADA,
};

const CREATE_INPUT = {
  id: WL_SIZE,
  title: "Add a size limit before upload",
  why: "server rejects >50 MB with no message",
  provenance: PROVENANCE,
  now: "2026-09-09T15:04:40Z",
};

const EDIT_PATCH: ItemPatch = {
  title: "Cap uploads at 50 MB",
  status: "accepted",
  owner: ADA,
  priority: "p1",
  rank: 3,
  area: ["upload"],
  blocked_by: [WL_OPS],
  confirmed_by: { ...GRACE, at: "2026-09-10T09:15:00Z" },
};

describe("createItem", () => {
  it("renders the spec §4.2 shape byte for byte", () => {
    expect(createItem(CREATE_INPUT)).toBe(golden("create.out"));
  });

  it("createItem produces frontmatter valid against BacklogItem", () => {
    const { frontmatter, body } = parseItem(createItem(CREATE_INPUT));
    expect(BacklogItemSchema.safeParse(frontmatter).success).toBe(true);
    expect(frontmatter).toMatchObject({
      schema_version: 1,
      id: WL_SIZE,
      status: "proposed",
      confirmed_by: null,
      owner: null,
      priority: null,
      rank: 0,
      area: [],
      blocked_by: [],
      done_by: null,
      created: CREATE_INPUT.now,
      updated: CREATE_INPUT.now,
    });
    expect(frontmatter.proposed_by).toEqual(PROVENANCE);
    // The body starts as the `why` line from the checkpoint (spec §4.2).
    expect(body).toBe("server rejects >50 MB with no message\n");
  });

  it("records one `create` history entry stamped with the proposing checkpoint", () => {
    const { frontmatter } = parseItem(createItem(CREATE_INPUT));
    expect(frontmatter.history).toHaveLength(1);
    expect(frontmatter.history[0]).toMatchObject({
      at: CREATE_INPUT.now,
      by: { session: SESSION, checkpoint: 2 },
      op: "create",
    });
  });

  it("carries the blockers the checkpoint named", () => {
    const text = createItem({ ...CREATE_INPUT, blockedBy: [WL_OPS] });
    expect(parseItem(text).frontmatter.blocked_by).toEqual([WL_OPS]);
  });

  it("rejects an id, provenance, or timestamp that fails the contract", () => {
    expect(() => createItem({ ...CREATE_INPUT, id: "not-an-id" })).toThrow(RenderError);
    expect(() => createItem({ ...CREATE_INPUT, now: "yesterday" })).toThrow(RenderError);
    expect(() =>
      createItem({
        ...CREATE_INPUT,
        provenance: { ...PROVENANCE, session: "short" } as Provenance,
      }),
    ).toThrow(RenderError);
  });
});

describe("applyUpdate", () => {
  it("renders the update golden byte for byte", () => {
    const result = applyUpdate(golden("update.in"), {
      session: SESSION,
      checkpoint: 3,
      why: "ops confirmed the limit is fixed at 50 MB",
      now: "2026-09-09T15:40:00Z",
    });
    expect(result.text).toBe(golden("update.out"));
    expect(result.history).toMatchObject({
      op: "update",
      by: { session: SESSION, checkpoint: 3 },
      diff: "why: ops confirmed the limit is fixed at 50 MB",
    });
  });

  it("appends the new why to the body under the checkpoint that said it", () => {
    const { body, frontmatter } = parseItem(golden("update.out"));
    expect(body).toBe(
      "server rejects >50 MB with no message\n\n- [cp 3] ops confirmed the limit is fixed at 50 MB\n",
    );
    // Advancing an item is not accepting or starting it: status is the UI's business.
    expect(frontmatter.status).toBe("proposed");
  });
});

describe("closeItem", () => {
  it("renders the close golden byte for byte and sets done_by", () => {
    const result = closeItem(golden("close.in"), {
      session: SESSION,
      checkpoint: 4,
      now: "2026-09-09T16:10:00Z",
    });
    expect(result.text).toBe(golden("close.out"));
    const { frontmatter } = parseItem(result.text);
    expect(frontmatter.status).toBe("done");
    expect(frontmatter.done_by).toEqual({ session: SESSION, checkpoint: 4 });
    expect(result.history.diff).toBe("status: proposed → done");
  });

  it("close on an already-done item is a no-op with diff 'already done'", () => {
    const before = parseItem(golden("close-already-done.in")).frontmatter;
    const result = closeItem(golden("close-already-done.in"), {
      session: OTHER_SESSION,
      checkpoint: 1,
      now: "2026-09-10T09:00:00Z",
    });
    expect(result.text).toBe(golden("close-already-done.out"));
    expect(result.history).toMatchObject({
      op: "close",
      diff: ALREADY_DONE,
      by: { session: OTHER_SESSION, checkpoint: 1 },
    });

    const after = parseItem(result.text).frontmatter;
    // The state does not move — but the attempt is recorded and `updated` moves with it.
    expect(after.status).toBe("done");
    expect(after.done_by).toEqual(before.done_by);
    expect(after.title).toBe(before.title);
    expect(after.updated).toBe("2026-09-10T09:00:00Z");
    expect(after.history).toHaveLength(before.history.length + 1);
  });

  it("is stable under repeated closes: only history and `updated` grow", () => {
    let text = golden("close.out");
    for (let i = 0; i < 3; i += 1) {
      text = closeItem(text, {
        session: OTHER_SESSION,
        checkpoint: i + 1,
        now: `2026-09-1${String(i)}T09:00:00Z`,
      }).text;
    }
    const { frontmatter } = parseItem(text);
    expect(frontmatter.done_by).toEqual({ session: SESSION, checkpoint: 4 });
    expect(frontmatter.history.filter((entry) => entry.diff === ALREADY_DONE)).toHaveLength(3);
  });
});

describe("editItem", () => {
  it("renders the edit golden byte for byte", () => {
    const result = editItem(golden("edit.in"), {
      by: GRACE,
      patch: EDIT_PATCH,
      now: "2026-09-10T09:15:00Z",
    });
    expect(result.text).toBe(golden("edit.out"));
  });

  it("records one history entry per changed field, with the right op", () => {
    const result = editItem(golden("edit.in"), {
      by: GRACE,
      patch: EDIT_PATCH,
      now: "2026-09-10T09:15:00Z",
    });
    expect(result.history.map((entry) => entry.op)).toEqual([
      "edit", // title
      "status",
      "assign", // owner
      "edit", // priority
      "edit", // confirmed_by
      "rank",
      "edit", // area
      "edit", // blocked_by
    ]);
    expect(result.history.map((entry) => entry.diff)).toContain("status: proposed → accepted");
    expect(result.history.map((entry) => entry.diff)).toContain("rank: 0 → 3");
    expect(result.history.map((entry) => entry.diff)).toContain(
      "owner: none → Ada Lovelace <ada@example.com>",
    );
    for (const entry of result.history) expect(entry.by).toEqual(GRACE);
  });

  it("records nothing for a patch that re-sends what is already on disk", () => {
    const once = editItem(golden("edit.in"), {
      by: GRACE,
      patch: EDIT_PATCH,
      now: "2026-09-10T09:15:00Z",
    });
    const twice = editItem(once.text, {
      by: GRACE,
      patch: EDIT_PATCH,
      now: "2026-09-11T09:15:00Z",
    });
    expect(twice.history).toEqual([]);
    expect(twice.text).toBe(once.text);
  });

  it("changes only the fields the patch names", () => {
    const result = editItem(golden("edit.in"), {
      by: GRACE,
      patch: { rank: 9 },
      now: "2026-09-10T09:15:00Z",
    });
    const before = parseItem(golden("edit.in")).frontmatter;
    const after = parseItem(result.text).frontmatter;
    expect(after.rank).toBe(9);
    expect(after.title).toBe(before.title);
    expect(after.status).toBe(before.status);
    expect(result.history).toHaveLength(1);
  });

  it("replaces the body wholesale and records it", () => {
    const result = editItem(golden("edit.in"), {
      by: GRACE,
      patch: { body: "Rewritten rationale.\n" },
      now: "2026-09-10T09:15:00Z",
    });
    expect(parseItem(result.text).body).toBe("Rewritten rationale.\n");
    expect(result.history[0]).toMatchObject({ op: "edit", diff: "body: rewritten" });
  });

  it("leaves done_by alone when a human sets status to done", () => {
    const result = editItem(golden("edit.in"), {
      by: GRACE,
      patch: { status: "done" },
      now: "2026-09-10T09:15:00Z",
    });
    expect(parseItem(result.text).frontmatter.done_by).toBeNull();
  });

  it("clears a nullable field when the patch says null", () => {
    const assigned = editItem(golden("edit.in"), {
      by: GRACE,
      patch: { owner: ADA },
      now: "2026-09-10T09:15:00Z",
    });
    const cleared = editItem(assigned.text, {
      by: GRACE,
      patch: { owner: null },
      now: "2026-09-11T09:15:00Z",
    });
    expect(parseItem(cleared.text).frontmatter.owner).toBeNull();
    expect(cleared.history[0]?.diff).toBe("owner: Ada Lovelace <ada@example.com> → none");
  });

  it("refuses a patch that would make the item invalid", () => {
    expect(() =>
      editItem(golden("edit.in"), {
        by: GRACE,
        patch: { status: "shipped" as ItemPatch["status"] },
        now: "2026-09-10T09:15:00Z",
      }),
    ).toThrow(RenderError);
    expect(() =>
      editItem(golden("edit.in"), {
        by: { name: "x" } as Actor,
        patch: { rank: 1 },
        now: "2026-09-10T09:15:00Z",
      }),
    ).toThrow(RenderError);
  });
});

describe("every mutation", () => {
  const now = "2026-09-12T08:00:00Z";
  const mutations: ReadonlyArray<
    readonly [string, (text: string) => { text: string; history: HistoryEntry | HistoryEntry[] }]
  > = [
    ["applyUpdate", (text) => applyUpdate(text, { session: SESSION, checkpoint: 5, why: "w", now })],
    ["closeItem", (text) => closeItem(text, { session: SESSION, checkpoint: 5, now })],
    ["editItem", (text) => editItem(text, { by: GRACE, patch: { rank: 42 }, now })],
  ];

  it("every mutation appends exactly one history entry and bumps updated", () => {
    const base = createItem(CREATE_INPUT);
    const before = parseItem(base).frontmatter;
    for (const [name, run] of mutations) {
      const result = run(base);
      const after = parseItem(result.text).frontmatter;
      expect(after.history, name).toHaveLength(before.history.length + 1);
      expect(after.updated, name).toBe(now);
      expect(after.created, name).toBe(before.created);
      const appended = Array.isArray(result.history) ? result.history : [result.history];
      expect(appended, name).toHaveLength(1);
      expect(after.history.at(-1), name).toEqual(appended[0]);
      expect(HistoryEntrySchema.safeParse(appended[0]).success, name).toBe(true);
    }
  });

  it("stamps agent-originated changes with a SessionRef and human edits with an Actor", () => {
    const base = createItem(CREATE_INPUT);
    expect(
      applyUpdate(base, { session: SESSION, checkpoint: 5, why: "w", now }).history.by,
    ).toEqual({ session: SESSION, checkpoint: 5 });
    expect(closeItem(base, { session: SESSION, checkpoint: 5, now }).history.by).toEqual({
      session: SESSION,
      checkpoint: 5,
    });
    expect(editItem(base, { by: GRACE, patch: { rank: 42 }, now }).history[0]?.by).toEqual(GRACE);
  });

  it("preserves unknown frontmatter keys and key order", () => {
    const base = createItem(CREATE_INPUT).replace(
      "\nhistory:",
      "\nx_future: kept by additionalProperties\nhistory:",
    );
    for (const [name, run] of mutations) {
      const { text } = run(base);
      expect(text, name).toContain("x_future: kept by additionalProperties");
      const keys = Object.keys(parseItem(text).data);
      expect(keys.indexOf("x_future"), name).toBe(keys.indexOf("history") - 1);
      expect(keys[0], name).toBe("schema_version");
    }
  });

  it("never emits a YAML anchor or alias into a file a human may hand-edit", () => {
    const edited = editItem(golden("edit.in"), {
      by: GRACE,
      patch: EDIT_PATCH,
      now: "2026-09-10T09:15:00Z",
    }).text;
    expect(edited).not.toMatch(/:\s+[&*]\w/);
    for (const name of Object.keys(goldens)) expect(goldens[name]!).not.toMatch(/:\s+[&*]\w/);
  });

  it("refuses a document that is not a backlog item", () => {
    for (const bad of ["no frontmatter here\n", "---\nschema_version: 1\n---\n"]) {
      try {
        parseItem(bad);
        expect.unreachable("expected a RenderError");
      } catch (error) {
        expect((error as RenderError).code).toBe("invalid-document");
      }
    }
  });
});

describe("property: mutations keep the item valid", () => {
  /** Deterministic PRNG so a failure reproduces. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("200 random mutation sequences never throw and never break the schema", () => {
    const rand = mulberry32(4102);
    const statuses = ["proposed", "accepted", "in_progress", "done", "discarded"] as const;
    const nasty = ["plain", "with: a colon", "with → an arrow", "multi\nline", "  padded  "];

    for (let run = 0; run < 200; run += 1) {
      let text = createItem({
        ...CREATE_INPUT,
        title: nasty[Math.floor(rand() * nasty.length)]!,
        why: nasty[Math.floor(rand() * nasty.length)]!,
      });
      let historyCount = 1;

      for (let step = 0; step < 4; step += 1) {
        const roll = rand();
        if (roll < 0.34) {
          text = applyUpdate(text, {
            session: SESSION,
            checkpoint: step + 1,
            why: nasty[Math.floor(rand() * nasty.length)]!,
            now: "2026-09-12T08:00:00Z",
          }).text;
          historyCount += 1;
        } else if (roll < 0.67) {
          text = closeItem(text, {
            session: SESSION,
            checkpoint: step + 1,
            now: "2026-09-12T08:00:00Z",
          }).text;
          historyCount += 1;
        } else {
          const patch: ItemPatch = {
            status: statuses[Math.floor(rand() * statuses.length)]!,
            rank: Math.floor(rand() * 5),
            area: [nasty[Math.floor(rand() * nasty.length)]!],
          };
          const result = editItem(text, { by: GRACE, patch, now: "2026-09-12T08:00:00Z" });
          text = result.text;
          historyCount += result.history.length;
        }
      }

      const { frontmatter } = parseItem(text);
      expect(BacklogItemSchema.safeParse(frontmatter).success).toBe(true);
      expect(frontmatter.history).toHaveLength(historyCount);
      // Every rendered entry survives a round trip through the frozen HistoryEntry schema.
      for (const entry of frontmatter.history) {
        expect(HistoryEntrySchema.safeParse(entry).success).toBe(true);
      }
    }
  });
});
