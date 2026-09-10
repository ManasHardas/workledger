/**
 * The projection onto the wire read models, and the pieces of `/api/health` a seeded temp repo
 * cannot reach: a resolved note, a harness binary on `PATH`, and the 500 branch of the one
 * error shape.
 *
 * These tests read the frozen `test/fixtures/ledger/`, never this repo's own `.workledger/`:
 * dogfooding (CLAUDE.md, DL-14) adds a session file here every session, so a pinned note array
 * over the live ledger turned `main` red with no code change (#121). Even against the fixture
 * nothing is pinned by hand — every count and index below is read back off the fixture file, so
 * growing the fixture cannot break the assertions either. The live ledger keeps one narrow smoke
 * at the bottom: it must still *parse*.
 */
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HTTPException } from "hono/http-exception";

import { ApiError, errorBody } from "../src/errors.js";
import { FIXTURE_LEDGER, appFor, seedFixture, seedRepo } from "./helpers.js";
import { probeHarness } from "../src/health.js";
import { resolvedNotes } from "../src/views.js";
import type { BacklogView, NoteRef, SessionView } from "../src/views.js";
import type { TempRepo } from "./helpers.js";

/** The fixture session the note-resolution test appends to. */
const SESSION = "01JQ8ZK4T000000000000000S1";

/** The note types `GET /api/notes?open=true` keeps — `read-model.ts`'s `OPEN_NOTE_TYPES`. */
const OPEN_TYPES = new Set(["blocker", "question"]);

let repo: TempRepo;

beforeEach(() => {
  repo = seedFixture();
});

afterEach(() => {
  repo.cleanup();
});

/** One `## Notes` line, as much of it as an assertion here needs. */
interface FixtureNote {
  cp: number;
  type: string;
  text: string;
  resolved?: boolean;
}

/**
 * The `## Notes` lines a fixture session already carries, in file order.
 *
 * Read off the fixture rather than written out here so that adding a note to the fixture shifts
 * the expected indices with it instead of failing the test.
 */
function fixtureNotes(session: string): FixtureNote[] {
  const text = readFileSync(path.join(FIXTURE_LEDGER, "sessions", `${session}.md`), "utf8");
  const line = /^- (\w+) \[cp (\d+)\](?: by \w+)?: (.*)$/gm;
  return [...text.matchAll(line)].map((match) => ({
    type: match[1] ?? "",
    cp: Number(match[2]),
    // A `decision` note carries `; reason: …` after its text; the wire model splits that off.
    text: (match[3] ?? "").split("; reason: ")[0] ?? "",
  }));
}

/** The texts `?open=true` must answer for `notes`, in the endpoint's order (checkpoint desc). */
function openTexts(notes: FixtureNote[]): string[] {
  return notes
    .filter((note) => OPEN_TYPES.has(note.type) && note.resolved !== true)
    .sort((a, b) => b.cp - a.cp)
    .map((note) => note.text);
}

/** Append `notes` to the fixture session and stamp `resolved` into its frontmatter. */
function withNotes(notes: string[], resolved: string): void {
  const file = path.join(repo.sessions, `${SESSION}.md`);
  const text = readFileSync(file, "utf8").replace("checkpoint_failures: 0", `checkpoint_failures: 0\n${resolved}`);
  writeFileSync(file, `${text}${notes.join("\n")}\n`, "utf8");
}

describe("note resolution", () => {
  it("flags the note the frontmatter's `resolved` list names, by checkpoint-local index", async () => {
    const existing = fixtureNotes(SESSION);
    // The appended pair land after every note the fixture already carries at checkpoint 1, so the
    // first of them takes that checkpoint's next local index.
    const firstAppended = existing.filter((note) => note.cp === 1).length;
    const appended: FixtureNote[] = [
      { cp: 1, type: "blocker", text: "first blocker", resolved: true },
      { cp: 1, type: "question", text: "second, still open" },
    ];
    withNotes(
      appended.map((note) => `- ${note.type} [cp ${note.cp}]: ${note.text}`),
      `resolved:\n  - cp: 1\n    index: ${firstAppended}`,
    );
    const server = appFor(repo);
    try {
      const session = (await (await server.app.request(`/api/sessions/${SESSION}`)).json()) as SessionView;
      expect(session.notes.map((note) => note.text)).toEqual(
        [...existing, ...appended].map((note) => note.text),
      );
      expect(session.notes.map((note) => note.resolved)).toEqual(
        [...existing, ...appended].map((note) => note.resolved === true),
      );

      const open = (await (await server.app.request("/api/notes?open=true")).json()) as NoteRef[];
      expect(open.every((note) => note.session !== undefined)).toBe(true);
      expect(open.filter((note) => note.session === SESSION).map((note) => note.text)).toEqual(
        openTexts([...existing, ...appended]),
      );
    } finally {
      server.close();
    }
  });

  it("flags the note the fixture's own `resolved` list names, with nothing appended", async () => {
    const other = "01JQ8ZK4T000000000000000S2";
    const server = appFor(repo);
    try {
      const session = (await (await server.app.request(`/api/sessions/${other}`)).json()) as SessionView;
      // The fixture stamps `resolved: [{cp: 1, index: 1}]`, so exactly the second note of
      // checkpoint 1 comes back flagged — derived here, not counted by hand.
      const perCheckpoint = new Map<number, number>();
      const expected = session.notes.map((note) => {
        const index = perCheckpoint.get(note.cp) ?? 0;
        perCheckpoint.set(note.cp, index + 1);
        return note.cp === 1 && index === 1;
      });
      expect(expected.filter(Boolean), "the fixture resolves exactly one note").toHaveLength(1);
      expect(session.notes.map((note) => note.resolved)).toEqual(expected);
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

describe("this repo's own dogfood ledger", () => {
  /**
   * The one test that still reads `<repo>/.workledger` (#121).
   *
   * It pins nothing about the contents — no session count, no note array, no ids — because
   * dogfooding grows that directory every session (CLAUDE.md, DL-14). All it asserts is that
   * whatever is in there today still parses: `problems` is the health endpoint's list of files
   * the reader could not read, so an empty one is the whole claim.
   */
  it("still parses: no file the reader rejected, and every id keeps its shape", async () => {
    const dogfood = seedRepo();
    const server = appFor(dogfood);
    try {
      const health = (await (await server.app.request("/api/health")).json()) as {
        config: { problems: string[] };
      };
      expect(health.config.problems, "every file under .workledger/ parses").toEqual([]);

      const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
      const sessions = (await (await server.app.request("/api/sessions")).json()) as SessionView[];
      expect(sessions.length, "the dogfood ledger has at least one session").toBeGreaterThan(0);
      for (const session of sessions) expect(session.frontmatter.id).toMatch(ulid);

      const backlog = (await (await server.app.request("/api/backlog")).json()) as BacklogView[];
      for (const item of backlog) expect(item.frontmatter.id).toMatch(/^WL-[0-9A-HJKMNP-TV-Z]{26}$/);

      // A count is read back off disk rather than written down, so recording a checkpoint here
      // cannot make this line wrong.
      const onDisk = readdirSync(dogfood.sessions).filter((name) => name.endsWith(".md"));
      expect(sessions).toHaveLength(onDisk.length);
    } finally {
      server.close();
      dogfood.cleanup();
    }
  });
});
