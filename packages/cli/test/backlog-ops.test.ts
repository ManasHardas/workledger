/**
 * `backlog-ops.ts` and the `backlog` / `note` commands — docs/contracts/p2/backlog-cli.md,
 * plans/feature-p2-data-flow.md §Writes and §Notes resolution (#32).
 *
 * Everything runs against a temp ledger built here rather than against `test/fixtures`: the
 * status machine needs an item seeded at each of the five statuses, and a subcommand can only
 * reach four of them from `proposed`, so the fixture writes the frontmatter itself.
 *
 * Two layers are asserted, because the contract fixes both. The pure functions are driven
 * directly — that is the surface `packages/server` (#34) calls — and the commands are driven
 * through their own parsers for the exit codes (`0` · `1` · `4`), the `--json` shapes, and the
 * refusal when git has no identity to attribute a write to.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseFrontmatter, stringifyFrontmatter } from "@workledger/core/frontmatter";
import { createItem, parseItem } from "@workledger/core/render/backlog";
import { appendCheckpoint, createSessionText, parseSessionText } from "@workledger/core/render/session";

import * as ops from "../src/backlog-ops.js";
import { backlogCommand } from "../src/commands/backlog.js";
import { noteCommand } from "../src/commands/note.js";
import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import { backlogFile, sessionFile } from "../src/ledger-fs.js";
import { run } from "../src/main.js";

import type { BacklogStatus } from "@workledger/core/schema";
import type { CommandIo } from "../src/commands/backlog.js";

const SESSION = "01JQ8ZK4T0000000000000000A";
/** Item ids are this prefix plus one character, so they stay valid ULIDs and sort. */
const ID_PREFIX = "WL-01JQ8ZK4T000000000000000";
const A = `${ID_PREFIX}0A`;
const B = `${ID_PREFIX}0B`;
const NOW = "2026-09-09T12:00:00.000Z";
const LATER = "2026-09-10T09:30:00.000Z";
const BY = { name: "Ada Lovelace", email: "ada@example.com" };
const AUTHOR = { name: "Agent", email: "agent@example.com" };

/** A temp repo whose git config carries an identity, and an empty HOME to read no other one. */
interface Fixture {
  root: string;
  /** A home directory with no `.gitconfig`, so the host's identity never leaks into a test. */
  home: string;
  io: CommandIo & { out: string[]; err: string[] };
}

function fixture(options: { enabled?: boolean; identity?: boolean } = {}): Fixture {
  const enabled = options.enabled ?? true;
  const identity = options.identity ?? true;
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-backlog-"));
  const root = path.join(dir, "repo");
  const home = path.join(dir, "home");
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(
    path.join(root, ".git", "config"),
    identity ? `[user]\n\tname = ${BY.name}\n\temail = ${BY.email}\n` : "[core]\n\tbare = false\n",
    "utf8",
  );
  if (enabled) {
    mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
    mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  }

  const out: string[] = [];
  const err: string[] = [];
  return {
    root,
    home,
    io: {
      cwd: root,
      env: {},
      out,
      err,
      stdout: (text) => void out.push(text),
      stderr: (line) => void err.push(line),
    },
  };
}

/** Seed one backlog item, optionally overriding frontmatter the ops cannot produce. */
function seedItem(
  root: string,
  id: string,
  over: Record<string, unknown> = {},
  body?: string,
): void {
  const text = createItem({
    id,
    title: `Item ${id.slice(-1)}`,
    why: `Because ${id.slice(-1)} matters.`,
    provenance: { harness: "claude-code", session: SESSION, checkpoint: 1, author: AUTHOR },
    now: NOW,
  });
  const parsed = parseFrontmatter(text);
  writeFileSync(
    backlogFile(root, id),
    stringifyFrontmatter({ ...parsed.data, ...over }, body ?? parsed.body),
    "utf8",
  );
}

/** Seed the session digest with three notes at checkpoint 1: blocker, question, discovery. */
function seedSession(root: string): void {
  const base = createSessionText({
    schema_version: 1,
    id: SESSION,
    harness: "claude-code",
    harness_session_id: "abc",
    repo: "github.com/o/r",
    branch: "main",
    author: AUTHOR,
    started: NOW,
    status: "open",
    private: false,
    source: "live",
    model: null,
    needs_repair: false,
    checkpoint_failures: 0,
    checkpoints: [],
  });
  const { text } = appendCheckpoint(
    base,
    {
      goal: "Ship the P2 backlog commands",
      done: [],
      remaining: [],
      notes: [
        { type: "blocker", text: "Waiting on the schema freeze" },
        { type: "question", text: "Do we keep uploads synchronous?" },
        { type: "discovery", text: "The index is only a cache" },
      ],
    },
    { n: 1, at: NOW, turns: 1, transcript_offset: 0, trigger: "manual" },
  );
  writeFileSync(sessionFile(root, SESSION), text, "utf8");
}

function readOnDisk(root: string, id: string) {
  return parseItem(readFileSync(backlogFile(root, id), "utf8"));
}

/** The context the ops take, with the fixed clock the assertions are written against. */
function ctx(root: string, now = LATER): ops.OpContext {
  return { repoRoot: root, by: BY, now };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("gitActor", () => {
  it("reads user.name and user.email out of the repo config", () => {
    const { root, home } = fixture();
    expect(ops.gitActor(root, home)).toEqual(BY);
  });

  it("returns undefined when git has no identity to attribute a write to", () => {
    const { root, home } = fixture({ identity: false });
    expect(ops.gitActor(root, home)).toBeUndefined();
  });
});

describe("the status machine", () => {
  /** The four subcommands that ask for one fixed `status`, and the target each asks for. */
  const MOVES = {
    accept: "accepted",
    discard: "discarded",
    done: "done",
    start: "in_progress",
  } as const;
  const STATUSES: BacklogStatus[] = [
    "proposed",
    "accepted",
    "in_progress",
    "done",
    "discarded",
  ];

  it("states every transition the contract fixes", () => {
    expect(ops.TRANSITIONS).toEqual({
      proposed: ["accepted", "discarded", "done"],
      accepted: ["in_progress", "done", "discarded"],
      in_progress: ["accepted", "done", "discarded"],
      done: ["accepted"],
      discarded: ["proposed"],
    });
  });

  for (const [action, target] of Object.entries(MOVES)) {
    for (const from of STATUSES) {
      const legal = ops.TRANSITIONS[from].includes(target);
      it(`${legal ? "allows" : "refuses"} ${action} on a ${from} item`, async () => {
        const { root } = fixture();
        seedItem(root, A, { status: from });
        const call = ops[`${action}Item` as "acceptItem"](ctx(root), A);

        if (legal) {
          const result = await call;
          expect(result.item.status).toBe(target);
          expect(result.item.updated).toBe(LATER);
          expect(readOnDisk(root, A).frontmatter.status).toBe(target);
          return;
        }
        await expect(call).rejects.toBeInstanceOf(ops.BacklogOpError);
        await call.catch((error: ops.BacklogOpError) => {
          expect(error.code).toBe("usage");
          // The refusal names the targets that *are* legal, per the contract's exit-1 rule.
          expect(error.details.join(" ")).toContain(ops.TRANSITIONS[from].join(", "));
        });
        // Nothing was written.
        expect(readOnDisk(root, A).frontmatter.status).toBe(from);
      });
    }
  }
});

describe("restoreItem", () => {
  /** `restore`'s target is a property of where the item is, so it gets its own table. */
  const CASES = [
    { from: "discarded", to: "proposed" },
    { from: "done", to: "accepted" },
  ] as const;

  for (const { from, to } of CASES) {
    it(`moves a ${from} item back to ${to}`, async () => {
      const { root } = fixture();
      seedItem(root, A, { status: from });

      const result = await ops.restoreItem(ctx(root), A);

      expect(result.item.status).toBe(to);
      expect(result.history[0]?.diff).toBe(`status: ${from} → ${to}`);
      expect(readOnDisk(root, A).frontmatter.status).toBe(to);
    });
  }

  it("refuses an item that was never closed, listing the targets that are legal", async () => {
    const { root } = fixture();
    seedItem(root, A, { status: "in_progress" });

    await expect(ops.restoreItem(ctx(root), A)).rejects.toThrow(/only a discarded or a done item/);
    await ops.restoreItem(ctx(root), A).catch((error: ops.BacklogOpError) => {
      expect(error.code).toBe("usage");
      expect(error.details.join(" ")).toContain("legal targets from in_progress: accepted, done, discarded");
    });
    expect(readOnDisk(root, A).frontmatter.status).toBe("in_progress");
  });
});

describe("acceptItem", () => {
  it("stamps confirmed_by with the human who accepted and records the status history", async () => {
    const { root } = fixture();
    seedItem(root, A);

    const result = await ops.acceptItem(ctx(root), A);

    expect(result.item.confirmed_by).toEqual({ ...BY, at: LATER });
    expect(result.history.map((entry) => entry.op)).toEqual(["status", "edit"]);
    expect(result.history[0]?.diff).toBe("status: proposed → accepted");
    expect(result.history[0]?.by).toEqual(BY);
    expect(result.item.history).toHaveLength(3);
  });
});

describe("doneItem", () => {
  it("leaves done_by null: a human closing an item is not a checkpoint", async () => {
    const { root } = fixture();
    seedItem(root, A, { status: "accepted" });

    const result = await ops.doneItem(ctx(root), A);

    expect(result.item.status).toBe("done");
    expect(result.item.done_by ?? null).toBeNull();
  });
});

describe("editItem", () => {
  it("changes the title, body, priority and area with one history entry each", async () => {
    const { root } = fixture();
    seedItem(root, A);

    const result = await ops.editItem(ctx(root), A, {
      title: "Renamed",
      body: "New body.\n",
      priority: "p1",
      area: ["cli", "ui"],
    });

    expect(result.item.title).toBe("Renamed");
    expect(result.item.priority).toBe("p1");
    expect(result.item.area).toEqual(["cli", "ui"]);
    expect(result.body).toBe("New body.\n");
    expect(result.history).toHaveLength(4);
  });

  it("clears the priority when the patch carries null", async () => {
    const { root } = fixture();
    seedItem(root, A, { priority: "p2" });

    const result = await ops.editItem(ctx(root), A, { priority: null });

    expect(result.item.priority).toBeNull();
  });

  it("records nothing when every field already holds the value sent", async () => {
    const { root } = fixture();
    seedItem(root, A);
    const before = readFileSync(backlogFile(root, A), "utf8");

    const result = await ops.editItem(ctx(root), A, { title: "Item A" });

    expect(result.history).toEqual([]);
    expect(readFileSync(backlogFile(root, A), "utf8")).toBe(before);
  });

  it("refuses an empty patch", async () => {
    const { root } = fixture();
    seedItem(root, A);
    await expect(ops.editItem(ctx(root), A, {})).rejects.toThrow(/nothing to edit/);
  });
});

describe("assignItem and rankItem", () => {
  it("sets and clears the owner", async () => {
    const { root } = fixture();
    seedItem(root, A);
    const owner = { name: "Grace Hopper", email: "grace@example.com" };

    const assigned = await ops.assignItem(ctx(root), A, owner);
    expect(assigned.item.owner).toEqual(owner);
    expect(assigned.history[0]?.op).toBe("assign");

    const cleared = await ops.assignItem(ctx(root), A, null);
    expect(cleared.item.owner).toBeNull();
  });

  it("sets the rank and refuses a non-integer", async () => {
    const { root } = fixture();
    seedItem(root, A);

    const result = await ops.rankItem(ctx(root), A, 7);
    expect(result.item.rank).toBe(7);
    expect(result.history[0]?.op).toBe("rank");

    await expect(ops.rankItem(ctx(root), A, 1.5)).rejects.toThrow(/integer/);
  });
});

describe("mergeItems", () => {
  it("discards the source and folds its title and body into the target", async () => {
    const { root } = fixture();
    seedItem(root, A, { status: "accepted" }, "Source rationale.\n");
    seedItem(root, B, {}, "Target rationale.\n");

    const merged = await ops.mergeItems(ctx(root), A, B);

    expect(merged.source.item.status).toBe("discarded");
    expect(merged.source.history).toEqual([
      { at: LATER, by: BY, op: "merge", diff: `merged into ${B}` },
    ]);
    expect(merged.target.item.status).toBe("proposed");
    expect(merged.target.history[0]?.op).toBe("merge");
    expect(merged.target.history[0]?.diff).toBe(`merged from ${A}`);
    expect(merged.target.body).toBe(
      `Target rationale.\n\nMerged from ${A}: Item A\nSource rationale.\n`,
    );

    // Both files, not just the returned views.
    expect(readOnDisk(root, A).frontmatter.status).toBe("discarded");
    expect(readOnDisk(root, B).body).toContain(`Merged from ${A}: Item A`);
    expect(readOnDisk(root, B).frontmatter.updated).toBe(LATER);
  });

  it("refuses to merge an item into itself and to merge away a done item", async () => {
    const { root } = fixture();
    seedItem(root, A, { status: "done" });
    seedItem(root, B);

    await expect(ops.mergeItems(ctx(root), A, A)).rejects.toThrow(/into itself/);
    await expect(ops.mergeItems(ctx(root), A, B)).rejects.toThrow(/cannot move to discarded/);
    // The target was not touched by the refused merge.
    expect(readOnDisk(root, B).body).not.toContain("Merged from");
  });
});

describe("readItem and listItems", () => {
  it("refuses an id that is not a WL-<ulid> and one that names no file", () => {
    const { root } = fixture();
    expect(() => ops.readItem(root, "../../etc/passwd")).toThrow(/not a backlog id/);
    expect(() => ops.readItem(root, A)).toThrow(/unknown backlog item/);
  });

  it("reports a repo with no ledger as not-enabled", () => {
    const { root } = fixture({ enabled: false });
    try {
      ops.listItems(root);
      expect.unreachable("listItems should refuse a repo with no .workledger/");
    } catch (error) {
      expect((error as ops.BacklogOpError).code).toBe("not-enabled");
    }
  });

  it("orders by rank then id, filters by status, and skips a file that does not parse", () => {
    const { root } = fixture();
    seedItem(root, A, { rank: 5 });
    seedItem(root, B, { rank: 1, status: "done" });
    writeFileSync(path.join(root, ".workledger", "backlog", "junk.md"), "not a ledger file", "utf8");

    expect(ops.listItems(root).map((entry) => entry.id)).toEqual([B, A]);
    expect(ops.listItems(root, ["done"]).map((entry) => entry.id)).toEqual([B]);
    expect(ops.listItems(root, [])).toHaveLength(2);
  });
});

describe("resolveNote", () => {
  it("appends the decision line and records the pair in the resolved list", async () => {
    const { root } = fixture();
    seedSession(root);

    const result = await ops.resolveNote(ctx(root), SESSION, 1, 0, "Freeze it as it stands");

    expect(result.type).toBe("blocker");
    expect(result.line).toBe(
      "- decision [cp 1] by human: Freeze it as it stands; reason: resolves blocker #0",
    );
    expect(result.resolved).toEqual([{ cp: 1, index: 0 }]);

    const parsed = parseSessionText(readFileSync(sessionFile(root, SESSION), "utf8"));
    expect(parsed.data["resolved"]).toEqual([{ cp: 1, index: 0 }]);
    // The decision joins the foot of the section; the indices of the notes before it do not move.
    expect(parsed.notes.map((note) => note.type)).toEqual([
      "blocker",
      "question",
      "discovery",
      "decision",
    ]);
    expect(parsed.notes[3]?.reason).toBe("resolves blocker #0");
    expect(parsed.notes[3]?.by).toBe("human");
  });

  it("resolves a second note without disturbing the first", async () => {
    const { root } = fixture();
    seedSession(root);

    await ops.resolveNote(ctx(root), SESSION, 1, 0, "Freeze it");
    const second = await ops.resolveNote(ctx(root), SESSION, 1, 1, "Yes, synchronous");

    expect(second.type).toBe("question");
    expect(second.resolved).toEqual([
      { cp: 1, index: 0 },
      { cp: 1, index: 1 },
    ]);
  });

  it("refuses a second resolution, a note that is never open, and an index that names none", async () => {
    const { root } = fixture();
    seedSession(root);
    await ops.resolveNote(ctx(root), SESSION, 1, 0, "Freeze it");

    await expect(ops.resolveNote(ctx(root), SESSION, 1, 0, "again")).rejects.toThrow(
      /already resolved/,
    );
    await expect(ops.resolveNote(ctx(root), SESSION, 1, 2, "nope")).rejects.toThrow(
      /is a discovery, which is never open/,
    );
    await expect(ops.resolveNote(ctx(root), SESSION, 1, 9, "nope")).rejects.toThrow(
      /has no note #9/,
    );
  });

  it("refuses a malformed session id, checkpoint, index or decision, and an unknown session", async () => {
    const { root } = fixture();
    seedSession(root);

    await expect(ops.resolveNote(ctx(root), "nope", 1, 0, "x")).rejects.toThrow(/session ULID/);
    await expect(ops.resolveNote(ctx(root), SESSION, 0, 0, "x")).rejects.toThrow(/checkpoint/);
    await expect(ops.resolveNote(ctx(root), SESSION, 1, -1, "x")).rejects.toThrow(/index/);
    await expect(ops.resolveNote(ctx(root), SESSION, 1, 0, "  ")).rejects.toThrow(/--decision/);
    await expect(
      ops.resolveNote(ctx(root), "01JQ8ZK4T0000000000000000B", 1, 0, "x"),
    ).rejects.toThrow(/unknown session/);
  });
});

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

describe("workledger backlog", () => {
  it("round-trips every mutating subcommand over one ledger and exits 0", async () => {
    const { root, io } = fixture();
    seedItem(root, A);
    seedItem(root, B);

    const calls: string[][] = [
      ["accept", A],
      ["start", A],
      ["edit", A, "--title", "Renamed", "--priority", "p1", "--area", "cli, ui"],
      ["assign", A, "--owner", "Grace Hopper <grace@example.com>"],
      ["rank", A, "3"],
      ["done", A],
      ["restore", A],
      ["discard", B],
      ["restore", B],
    ];
    for (const call of calls) {
      expect(await backlogCommand(call, io), call.join(" ")).toBe(EXIT_OK);
    }

    const item = readOnDisk(root, A).frontmatter;
    // accept → start → … → done → restore lands a reopened item back on `accepted`.
    expect(item.status).toBe("accepted");
    expect(item.title).toBe("Renamed");
    expect(item.priority).toBe("p1");
    expect(item.area).toEqual(["cli", "ui"]);
    expect(item.owner).toEqual({ name: "Grace Hopper", email: "grace@example.com" });
    expect(item.rank).toBe(3);
    // …and a restored `discarded` item back on `proposed`.
    expect(readOnDisk(root, B).frontmatter.status).toBe("proposed");
    expect(io.err).toEqual([]);
    expect(io.out.at(-1)).toContain(`${B}: status: discarded → proposed`);
  });

  it("clears the owner with --none and refuses --owner together with it", async () => {
    const { root, io } = fixture();
    seedItem(root, A, { owner: { name: "Grace Hopper", email: "grace@example.com" } });

    expect(await backlogCommand(["assign", A, "--none"], io)).toBe(EXIT_OK);
    expect(readOnDisk(root, A).frontmatter.owner).toBeNull();

    expect(await backlogCommand(["assign", A, "--none", "--owner", "G <g@e.com>"], io)).toBe(
      EXIT_USAGE,
    );
    expect(io.err.join(" ")).toContain("exactly one of --owner and --none");
  });

  it("merges through the CLI, writing both items", async () => {
    const { root, io } = fixture();
    seedItem(root, A, {}, "Source rationale.\n");
    seedItem(root, B, {}, "Target rationale.\n");

    expect(await backlogCommand(["merge", A, "--into", B], io)).toBe(EXIT_OK);

    expect(readOnDisk(root, A).frontmatter.status).toBe("discarded");
    expect(readOnDisk(root, B).body).toContain(`Merged from ${A}: Item A`);
    expect(io.out.join("\n")).toContain(`merged into ${B}`);
  });

  it("emits JSON that parses for show and list", async () => {
    const { root, io } = fixture();
    seedItem(root, A, { rank: 2 });
    seedItem(root, B, { rank: 1, status: "done" });

    expect(await backlogCommand(["show", A, "--json"], io)).toBe(EXIT_OK);
    const shown = JSON.parse(io.out.join("\n")) as { id: string; item: { title: string }; body: string };
    expect(shown.id).toBe(A);
    expect(shown.item.title).toBe("Item A");
    expect(shown.body).toContain("Because A matters.");

    io.out.length = 0;
    expect(await backlogCommand(["list", "--json", "--status", "done"], io)).toBe(EXIT_OK);
    const listed = JSON.parse(io.out.join("\n")) as { id: string }[];
    expect(listed.map((entry) => entry.id)).toEqual([B]);
  });

  it("prints a human-readable show and list without --json", async () => {
    const { root, io } = fixture();
    seedItem(root, A, {
      rank: 2,
      priority: "p2",
      area: ["cli"],
      owner: { name: "Grace Hopper", email: "grace@example.com" },
    });
    seedItem(root, B);

    expect(await backlogCommand(["show", A], io)).toBe(EXIT_OK);
    expect(io.out[0]).toContain(A);
    expect(io.out.join("\n")).toContain("owner: Grace Hopper <grace@example.com>");
    expect(io.out.join("\n")).toContain("area: cli");

    io.out.length = 0;
    expect(await backlogCommand(["list"], io)).toBe(EXIT_OK);
    expect(io.out).toHaveLength(2);
  });

  it("exits 1 for an unknown id, an illegal transition, and a bad flag value", async () => {
    const { root, io } = fixture();
    seedItem(root, A, { status: "done" });

    expect(await backlogCommand(["accept", `${ID_PREFIX}0Z`], io)).toBe(EXIT_USAGE);
    expect(io.err.join(" ")).toContain("unknown backlog item");

    io.err.length = 0;
    expect(await backlogCommand(["discard", A], io)).toBe(EXIT_USAGE);
    expect(io.err.join(" ")).toContain("legal targets from done: accepted");

    io.err.length = 0;
    expect(await backlogCommand(["start", A], io)).toBe(EXIT_USAGE);
    expect(io.err.join(" ")).toContain("legal targets from done: accepted");

    io.err.length = 0;
    seedItem(root, B, { status: "proposed" });
    expect(await backlogCommand(["restore", B], io)).toBe(EXIT_USAGE);
    expect(io.err.join(" ")).toContain("only a discarded or a done item can be restored");

    io.err.length = 0;
    expect(await backlogCommand(["edit", A, "--priority", "p9"], io)).toBe(EXIT_USAGE);
    expect(io.err.join(" ")).toContain("expected one of p1, p2, p3, none");

    io.err.length = 0;
    expect(await backlogCommand(["list", "--status", "nope"], io)).toBe(EXIT_USAGE);
    expect(io.err.join(" ")).toContain("unknown status");

    io.err.length = 0;
    expect(await backlogCommand(["assign", A, "--owner", "Grace Hopper"], io)).toBe(EXIT_USAGE);
    expect(io.err.join(" ")).toContain("Name <email>");

    io.err.length = 0;
    expect(await backlogCommand(["rank", A, "half"], io)).toBe(EXIT_USAGE);
    expect(await backlogCommand(["frobnicate", A], io)).toBe(EXIT_USAGE);
  });

  it("exits 4 when the repo is not enabled", async () => {
    const { io } = fixture({ enabled: false });
    expect(await backlogCommand(["list"], io)).toBe(EXIT_NOT_ENABLED);
    expect(io.err.join(" ")).toContain("not an enabled repo");
  });

  it("refuses a write with exit 1 when git has no identity", async () => {
    const { root, home, io } = fixture({ identity: false });
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));
    seedItem(root, A);

    expect(await backlogCommand(["accept", A], io)).toBe(EXIT_USAGE);
    expect(io.err.join(" ")).toContain("user.name and user.email");
    // A read does not need one.
    expect(await backlogCommand(["list"], io)).toBe(EXIT_OK);
  });
});

describe("workledger note resolve", () => {
  it("resolves a note and exits 0", async () => {
    const { root, io } = fixture();
    seedSession(root);

    expect(
      await noteCommand(["resolve", SESSION, "1", "1", "--decision", "Yes, synchronous"], io),
    ).toBe(EXIT_OK);

    expect(io.out[0]).toBe(
      "- decision [cp 1] by human: Yes, synchronous; reason: resolves question #1",
    );
    const parsed = parseSessionText(readFileSync(sessionFile(root, SESSION), "utf8"));
    expect(parsed.data["resolved"]).toEqual([{ cp: 1, index: 1 }]);
  });

  it("exits 1 on an unknown session, a bad index, and a missing --decision", async () => {
    const { root, io } = fixture();
    seedSession(root);

    expect(await noteCommand(["resolve", SESSION, "1", "9", "--decision", "x"], io)).toBe(
      EXIT_USAGE,
    );
    expect(await noteCommand(["resolve", SESSION, "1", "0"], io)).toBe(EXIT_USAGE);
    expect(await noteCommand(["resolve", SESSION, "1", "x", "--decision", "y"], io)).toBe(
      EXIT_USAGE,
    );
    expect(await noteCommand(["nope"], io)).toBe(EXIT_USAGE);
  });

  it("exits 4 when the repo is not enabled", async () => {
    const { io } = fixture({ enabled: false });
    expect(
      await noteCommand(["resolve", SESSION, "1", "0", "--decision", "x"], io),
    ).toBe(EXIT_NOT_ENABLED);
  });
});

describe("main.ts pass-through", () => {
  /** Run the program with stdout and stderr captured, rooted at `root`. */
  async function invoke(root: string, argv: string[]): Promise<{ code: number; out: string }> {
    let out = "";
    vi.stubEnv("CLAUDE_PROJECT_DIR", root);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      return { code: await run(argv), out };
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  }

  it("hands `backlog` its own flags rather than parsing them itself", async () => {
    const { root } = fixture();
    seedItem(root, A);

    const { code, out } = await invoke(root, ["backlog", "show", A, "--json"]);

    expect(code).toBe(EXIT_OK);
    expect((JSON.parse(out) as { id: string }).id).toBe(A);
  });

  it("hands `note` its own flags and reports the exit code the action produced", async () => {
    const { root } = fixture();
    seedSession(root);

    const resolved = await invoke(root, [
      "note",
      "resolve",
      SESSION,
      "1",
      "0",
      "--decision",
      "Freeze it",
    ]);
    expect(resolved.code).toBe(EXIT_OK);
    expect(resolved.out).toContain("resolves blocker #0");

    const again = await invoke(root, [
      "note",
      "resolve",
      SESSION,
      "1",
      "0",
      "--decision",
      "Freeze it",
    ]);
    expect(again.code).toBe(EXIT_USAGE);
  });
});
