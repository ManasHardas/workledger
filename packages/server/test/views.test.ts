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
      // The dogfood file already carries one discovery at cp 1, so the appended pair are
      // checkpoint-local indices 1 and 2.
      expect(session.notes.map((note) => note.resolved)).toEqual([false, true, false]);

      const open = (await (await server.app.request("/api/notes?open=true")).json()) as NoteRef[];
      expect(open.map((note) => note.text)).toEqual(["second, still open"]);
      expect(open[0]!.session).toBe(SESSION);
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
