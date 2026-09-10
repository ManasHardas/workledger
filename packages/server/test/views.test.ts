/**
 * The projection onto the wire read models, and the pieces of `/api/health` a seeded temp repo
 * cannot reach: a resolved note, a harness binary on `PATH`, and the 500 branch of the one
 * error shape.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HTTPException } from "hono/http-exception";

import { ApiError, errorBody } from "../src/errors.js";
import { appFor, seedRepo } from "./helpers.js";
import { probeHarness } from "../src/health.js";
import { resolvedNotes } from "../src/views.js";
import type { NoteRef, SessionView } from "../src/views.js";
import type { TempRepo } from "./helpers.js";

const SESSION = "01M2473A9YQ3V9KHYFYC6Q0D2X";

let repo: TempRepo;

beforeEach(() => {
  repo = seedRepo();
});

afterEach(() => {
  repo.cleanup();
});

/** Append `notes` to the dogfood session and stamp `resolved` into its frontmatter. */
function withNotes(notes: string[], resolved: string): void {
  const file = path.join(repo.sessions, `${SESSION}.md`);
  const text = readFileSync(file, "utf8").replace("checkpoint_failures: 0", `checkpoint_failures: 0\n${resolved}`);
  writeFileSync(file, `${text}${notes.join("\n")}\n`, "utf8");
}

describe("note resolution", () => {
  it("flags the note the frontmatter's `resolved` list names, by checkpoint-local index", async () => {
    withNotes(
      ["- blocker [cp 1]: first blocker", "- question [cp 1]: second, still open"],
      "resolved:\n  - cp: 1\n    index: 1",
    );
    const server = appFor(repo);
    try {
      const session = (await (await server.app.request(`/api/sessions/${SESSION}`)).json()) as SessionView;
      // The dogfood ledger grows its own notes, so the assertion is about the two this test
      // appended, found by their text: the frontmatter resolves checkpoint-1-local index 1,
      // which is the blocker (the discovery the file already carries at cp 1 is index 0).
      const flagOf = (text: string) => session.notes.find((note) => note.text === text)?.resolved;
      expect(flagOf("first blocker")).toBe(true);
      expect(flagOf("second, still open")).toBe(false);

      const open = (await (await server.app.request("/api/notes?open=true")).json()) as NoteRef[];
      expect(open.map((note) => note.text)).not.toContain("first blocker");
      const still = open.find((note) => note.text === "second, still open");
      expect(still?.session).toBe(SESSION);
    } finally {
      server.close();
    }
  });

  it("ignores a `resolved` key that is not a list of {cp, index}", () => {
    const frontmatter = { resolved: ["nope", null, { cp: 1 }, { cp: 2, index: 0 }] } as never;
    expect(resolvedNotes(frontmatter)).toEqual([{ cp: 2, index: 0 }]);
    expect(resolvedNotes({} as never)).toEqual([]);
    expect(resolvedNotes({ resolved: "no" } as never)).toEqual([]);
  });
});

describe("probeHarness", () => {
  it("finds an executable named `claude` on PATH and reads the store's metadata", () => {
    const bin = path.join(repo.root, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = path.join(bin, "claude");
    writeFileSync(claude, "#!/bin/sh\necho '2.1.4 (Claude Code)'\n", "utf8");
    chmodSync(claude, 0o755);
    mkdirSync(path.join(repo.root, ".claude", "projects", "a-project"), { recursive: true });

    const probe = probeHarness({ env: { PATH: bin }, homeDir: repo.root, home: repo.root, cli: "0.0.1" });
    expect(probe.binary).toBe(claude);
    expect(probe.version).toBe("2.1.4");
    expect(probe.store_readable).toBe(true);
    expect(probe.projects).toBe(1);
    expect(typeof probe.last_activity).toBe("string");
  });

  it("reports a missing binary and an unreadable store rather than throwing", () => {
    const probe = probeHarness({ env: {}, homeDir: path.join(repo.root, "nowhere"), home: repo.root, cli: "0.0.1" });
    expect(probe.binary).toBeNull();
    expect(probe.version).toBeNull();
    expect(probe.store_readable).toBe(false);
    expect(probe.projects).toBeNull();
    expect(probe.last_activity).toBeNull();
  });
});

describe("error shape", () => {
  it("gives every thrown value the contract's `{error:{code,message}}` body", () => {
    expect(errorBody(new ApiError(409, "conflict", "already discarded"))).toEqual({
      status: 409,
      body: { error: { code: "conflict", message: "already discarded" } },
    });
    // A `HTTPException` Hono itself raised carries no code of its own.
    expect(errorBody(new HTTPException(404, { message: "gone" }))).toEqual({
      status: 404,
      body: { error: { code: "not_found", message: "gone" } },
    });
    expect(errorBody(new HTTPException(400, { message: "bad" })).body.error.code).toBe("bad_request");
    // Anything else is a server fault.
    expect(errorBody(new Error("kaboom"))).toEqual({
      status: 500,
      body: { error: { code: "internal", message: "kaboom" } },
    });
    expect(errorBody("just a string").body.error.message).toBe("just a string");
  });
});

/**
 * P8 amendment 11: a Done entry's specifics live on an indented continuation and `## Memory` is
 * the fifth section. Core parses both (#122); these assert the wire projection carries them, so
 * the session view's drawer and Memory section have something to show on real data.
 */
describe("amendment 11 — done detail and memory reach the wire", () => {
  /** Append a checkpoint-3 Done entry with a continuation and a `## Memory` section. */
  function withGistAndMemory(): void {
    const file = path.join(repo.sessions, `${SESSION}.md`);
    const text = readFileSync(file, "utf8");
    writeFileSync(
      file,
      `${text}\n## Memory\n- [cp 1] gh needs the ManasHardas token prefix file: ~/.claude/MEMORY.md\n` +
        `- [cp 1] Never run a worktree build against the real ~/.workledger\n`,
      "utf8",
    );
  }

  it("carries `detail` on a Done line and the `memory` array onto `SessionView`", async () => {
    const file = path.join(repo.sessions, `${SESSION}.md`);
    const text = readFileSync(file, "utf8").replace(
      "## Remaining",
      "- [cp 1] Buyers can now check out from the cart on their phone\n" +
        "  detail: Checkout control is the link itself · commit: a1b2c3d · files: src/cart/checkout.ts · verified: tests-passed\n" +
        "\n## Remaining",
    );
    writeFileSync(file, text, "utf8");
    withGistAndMemory();

    const server = appFor(repo);
    try {
      const session = (await (await server.app.request(`/api/sessions/${SESSION}`)).json()) as SessionView;

      const gist = session.done.find((line) => line.text === "Buyers can now check out from the cart on their phone");
      expect(gist, "the gist line reached the wire").toBeDefined();
      expect(gist!.detail).toBe("Checkout control is the link itself");
      expect(gist!.commit).toBe("a1b2c3d");
      expect(gist!.files).toEqual(["src/cart/checkout.ts"]);
      expect(gist!.verified).toBe("tests-passed");

      expect(session.memory).toEqual([
        { cp: 1, text: "gh needs the ManasHardas token prefix", file: "~/.claude/MEMORY.md" },
        { cp: 1, text: "Never run a worktree build against the real ~/.workledger" },
      ]);
    } finally {
      server.close();
    }
  });

  it("gives a pre-amendment file no memory and no detail, rather than undefined", async () => {
    const server = appFor(repo);
    try {
      const session = (await (await server.app.request(`/api/sessions/${SESSION}`)).json()) as SessionView;
      expect(session.memory).toEqual([]);
      expect(session.done.every((line) => line.detail === undefined)).toBe(true);
    } finally {
      server.close();
    }
  });
});
