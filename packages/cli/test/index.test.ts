/**
 * The whole file runs against a temp `WORKLEDGER_HOME`. Nothing here may touch the real `$HOME`:
 * `openIndex` is only ever called with an explicit `home`, or with the environment variable set
 * to a directory under `os.tmpdir()`, and the last test asserts that the resolver never falls
 * back to the home directory while the variable is set.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_BUSY_TIMEOUT_MS,
  INDEX_FILENAME,
  MigrationError,
  SCHEMA_VERSION_KEY,
  migrate,
  openIndex,
  readMigrations,
  resolveHome,
  schemaVersion,
} from "../src/index/db.js";
import type { IndexDb, NewSession } from "../src/index/db.js";
import { rebuildIndex } from "../src/index/rebuild.js";

const FIXTURE_SESSIONS = path.join(import.meta.dirname, "fixtures", "sessions");
const REPO = "/repos/workledger";

/** Column list of `sessions`, verbatim from the frozen DDL, in declaration order. */
const SESSION_COLUMNS = [
  "ulid",
  "repo_path",
  "harness",
  "harness_session_id",
  "transcript_path",
  "status",
  "private",
  "last_offset",
  "turns_total",
  "turns_since_checkpoint",
  "last_checkpoint_at",
  "last_block_turn",
  "last_block_trigger",
  "blocks_since_checkpoint",
  "last_attempt_at",
  "last_attempt_exit",
  "last_attempt_errors",
  "updated_at",
];

/** Column list of `checkpoints`, verbatim from the frozen DDL, in declaration order. */
const CHECKPOINT_COLUMNS = ["session_ulid", "n", "at", "transcript_offset", "turns", "trigger"];

let home: string;
const opened: IndexDb[] = [];

/** Open an index under the test's temp home and register it for teardown. */
function open(options: { busyTimeoutMs?: number } = {}): IndexDb {
  const db = openIndex({ home, ...options });
  opened.push(db);
  return db;
}

function session(overrides: Partial<NewSession> = {}): NewSession {
  return {
    ulid: "01JQ8ZK4T0000000000000000A",
    repo_path: REPO,
    harness: "claude-code",
    harness_session_id: "hsess-aaaaaaaaaaaaaaaa",
    status: "open",
    ...overrides,
  };
}

function columnsOf(db: IndexDb, table: string): string[] {
  const rows = db.connection.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "workledger-index-"));
  process.env.WORKLEDGER_HOME = home;
});

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
  delete process.env.WORKLEDGER_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("openIndex", () => {
  it("migrates an empty database to the frozen DDL", () => {
    const db = open();

    expect(existsSync(path.join(home, INDEX_FILENAME))).toBe(true);
    expect(columnsOf(db, "sessions")).toEqual(SESSION_COLUMNS);
    expect(columnsOf(db, "checkpoints")).toEqual(CHECKPOINT_COLUMNS);
    expect(columnsOf(db, "schema_meta")).toEqual(["key", "value"]);
  });

  it("creates WORKLEDGER_HOME when it does not exist yet", () => {
    const nested = path.join(home, "nested", "workledger");
    const db = openIndex({ home: nested });
    opened.push(db);

    expect(existsSync(path.join(nested, INDEX_FILENAME))).toBe(true);
    expect(db.home).toBe(nested);
    expect(db.path).toBe(path.join(nested, INDEX_FILENAME));
  });

  it("opens in WAL mode with a busy timeout", () => {
    const db = open();

    expect(db.connection.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.connection.pragma("busy_timeout", { simple: true })).toBe(DEFAULT_BUSY_TIMEOUT_MS);
  });

  it("enforces UNIQUE (harness, harness_session_id)", () => {
    const db = open();
    db.insertSession(session());

    expect(() =>
      db.insertSession(session({ ulid: "01JQ8ZK4T0000000000000000Z" })),
    ).toThrow(/UNIQUE constraint failed: sessions.harness, sessions.harness_session_id/);
  });
});

describe("migrations", () => {
  it("re-running the runner is idempotent", () => {
    const db = open();
    const before = schemaVersion(db.connection);

    expect(before).toBeGreaterThan(0);
    expect(migrate(db.connection)).toEqual([]);
    expect(schemaVersion(db.connection)).toBe(before);

    // A second `openIndex` on the same file is the real-world re-run: two CLI invocations.
    const again = open();
    expect(schemaVersion(again.connection)).toBe(before);
    expect(columnsOf(again, "sessions")).toEqual(SESSION_COLUMNS);
  });

  it("records the applied version under schema_meta", () => {
    const db = open();
    const row = db.connection
      .prepare<[string], { value: string }>("SELECT value FROM schema_meta WHERE key = ?")
      .get(SCHEMA_VERSION_KEY);

    expect(row?.value).toBe("1");
  });

  it("applies each migration exactly once, in filename order", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-migrations-"));
    writeFileSync(path.join(dir, "0002_second.sql"), "CREATE TABLE b (x TEXT);");
    writeFileSync(path.join(dir, "0001_first.sql"), "CREATE TABLE a (x TEXT);");
    const db = open();

    // The real 0001 is already applied at version 1, so only 0002 is new.
    expect(migrate(db.connection, dir)).toEqual(["0002_second.sql"]);
    expect(schemaVersion(db.connection)).toBe(2);
    expect(migrate(db.connection, dir)).toEqual([]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a migrations directory it cannot order", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-migrations-"));

    expect(() => readMigrations(dir)).toThrow(MigrationError);

    writeFileSync(path.join(dir, "init.sql"), "SELECT 1;");
    expect(() => readMigrations(dir)).toThrow(/must be named <digits>_<name>\.sql/);

    rmSync(path.join(dir, "init.sql"));
    writeFileSync(path.join(dir, "0001_a.sql"), "SELECT 1;");
    writeFileSync(path.join(dir, "0001_b.sql"), "SELECT 1;");
    expect(() => readMigrations(dir)).toThrow(/does not follow "0001_a\.sql"/);

    rmSync(dir, { recursive: true, force: true });
  });

  it("ships a migration next to the module that reads it", () => {
    expect(readMigrations().map((m) => m.name)).toEqual(["0001_init.sql"]);
  });
});

describe("session accessors", () => {
  it("round-trips a session and applies the DDL defaults", () => {
    const db = open();
    const inserted = db.insertSession(session());

    expect(db.getSessionByUlid(inserted.ulid)).toEqual(inserted);
    expect(db.getSessionByHarnessId("claude-code", "hsess-aaaaaaaaaaaaaaaa")).toEqual(inserted);
    expect(inserted).toMatchObject({
      private: 0,
      last_offset: 0,
      turns_total: 0,
      turns_since_checkpoint: 0,
      blocks_since_checkpoint: 0,
      last_checkpoint_at: null,
      last_attempt_exit: null,
    });
    expect(db.getSessionByUlid("01JQ8ZK4T000000000000000ZZ")).toBeUndefined();
    expect(db.getSessionByHarnessId("claude-code", "nope")).toBeUndefined();
  });

  it("lists only the open sessions of one repo, oldest first", () => {
    const db = open();
    db.insertSession(session({ ulid: "01JQ8ZK4T0000000000000000C", harness_session_id: "c" }));
    db.insertSession(session({ ulid: "01JQ8ZK4T0000000000000000A", harness_session_id: "a" }));
    db.insertSession(
      session({ ulid: "01JQ8ZK4T0000000000000000B", harness_session_id: "b", status: "ended" }),
    );
    db.insertSession(
      session({ ulid: "01JQ8ZK4T0000000000000000D", harness_session_id: "d", repo_path: "/other" }),
    );

    expect(db.listOpenSessions(REPO).map((row) => row.ulid)).toEqual([
      "01JQ8ZK4T0000000000000000A",
      "01JQ8ZK4T0000000000000000C",
    ]);
    expect(db.listOpenSessions("/nowhere")).toEqual([]);
  });

  it("patches only the columns it is given and refuses unknown ones", () => {
    const db = open();
    const inserted = db.insertSession(session());

    const patched = db.updateSession(inserted.ulid, { status: "ended", turns_total: 12 });
    expect(patched).toMatchObject({ status: "ended", turns_total: 12, repo_path: REPO });

    // An empty patch is a read, not a no-op UPDATE with no assignments (invalid SQL).
    expect(db.updateSession(inserted.ulid, {})).toEqual(patched);
    expect(db.updateSession(inserted.ulid, { last_block_turn: undefined })).toEqual(patched);
    expect(db.updateSession("01JQ8ZK4T000000000000000ZZ", { status: "ended" })).toBeUndefined();
    expect(() =>
      db.updateSession(inserted.ulid, { ulid: "x" } as unknown as { status: string }),
    ).toThrow(TypeError);
  });
});

describe("checkpoint numbering", () => {
  const draft = { at: "2026-09-09T12:00:00Z", transcript_offset: 100, turns: 3, trigger: "manual" };

  it("allocates n from 1 upwards per session", () => {
    const db = open();
    db.insertSession(session());
    db.insertSession(session({ ulid: "01JQ8ZK4T0000000000000000B", harness_session_id: "b" }));

    expect(db.nextCheckpointNumber("01JQ8ZK4T0000000000000000A")).toBe(1);
    const first = db.appendCheckpoint("01JQ8ZK4T0000000000000000A", (n) => ({ ...draft, turns: n }));
    const second = db.appendCheckpoint("01JQ8ZK4T0000000000000000A", (n) => ({
      ...draft,
      turns: n,
    }));

    expect([first.n, second.n]).toEqual([1, 2]);
    // A second session numbers independently.
    expect(db.nextCheckpointNumber("01JQ8ZK4T0000000000000000B")).toBe(1);
    expect(db.listCheckpoints("01JQ8ZK4T0000000000000000A").map((row) => row.n)).toEqual([1, 2]);
  });

  it("rejects a duplicate (session_ulid, n)", () => {
    const db = open();
    db.insertSession(session());
    const row = { session_ulid: "01JQ8ZK4T0000000000000000A", n: 1, ...draft };
    db.insertCheckpoint(row);

    expect(() => db.insertCheckpoint(row)).toThrow(/UNIQUE constraint failed/);
  });

  it("serializes two concurrent callers so the second sees n + 1", () => {
    // Two connections to one file are two `workledger checkpoint` processes. `appendCheckpoint`
    // runs under BEGIN IMMEDIATE, so while A holds the write lock B cannot start its own
    // transaction and fails with SQLITE_BUSY rather than reading a stale `max(n)`.
    const a = open({ busyTimeoutMs: 50 });
    const b = open({ busyTimeoutMs: 50 });
    a.insertSession(session());

    let blocked: unknown;
    const first = a.appendCheckpoint("01JQ8ZK4T0000000000000000A", (n) => {
      expect(n).toBe(1);
      try {
        b.appendCheckpoint("01JQ8ZK4T0000000000000000A", () => draft);
      } catch (error) {
        blocked = error;
      }
      return draft;
    });

    expect(first.n).toBe(1);
    expect((blocked as { code?: string })?.code).toBe("SQLITE_BUSY");
    // A has committed, so B's retry now reads the committed max(n) and allocates 2.
    expect(b.appendCheckpoint("01JQ8ZK4T0000000000000000A", () => draft).n).toBe(2);
    expect(a.listCheckpoints("01JQ8ZK4T0000000000000000A").map((row) => row.n)).toEqual([1, 2]);
  });
});

describe("counter accessors", () => {
  it("recordAttempt caches the failed attempt for the next Stop hook", () => {
    const db = open();
    db.insertSession(session({ blocks_since_checkpoint: 1, turns_since_checkpoint: 4 }));

    db.recordAttempt("01JQ8ZK4T0000000000000000A", {
      at: "2026-09-09T12:30:00Z",
      exit: 1,
      errors: "done.0.commit: expected a git object name",
    });

    expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000A")).toMatchObject({
      last_attempt_at: "2026-09-09T12:30:00Z",
      last_attempt_exit: 1,
      last_attempt_errors: "done.0.commit: expected a git object name",
      updated_at: "2026-09-09T12:30:00Z",
      // A failed attempt writes nothing else: the block state must survive for BLOCK #2.
      blocks_since_checkpoint: 1,
      turns_since_checkpoint: 4,
    });
  });

  it("resetAfterCheckpoint zeroes the counters and clears the failed attempt", () => {
    const db = open();
    db.insertSession(
      session({
        blocks_since_checkpoint: 2,
        turns_since_checkpoint: 7,
        turns_total: 21,
        last_offset: 100,
        last_attempt_at: "2026-09-09T12:30:00Z",
        last_attempt_exit: 3,
        last_attempt_errors: "secret detected at notes.0.text (github-token)",
      }),
    );

    db.resetAfterCheckpoint("01JQ8ZK4T0000000000000000A", {
      offset: 4096,
      at: "2026-09-09T12:45:00Z",
    });

    expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000A")).toMatchObject({
      turns_since_checkpoint: 0,
      blocks_since_checkpoint: 0,
      last_offset: 4096,
      last_checkpoint_at: "2026-09-09T12:45:00Z",
      last_attempt_at: "2026-09-09T12:45:00Z",
      last_attempt_exit: 0,
      last_attempt_errors: null,
      // Cumulative, so it survives the reset.
      turns_total: 21,
    });
  });

  it("giveUp resets the thresholds without touching the attempt record", () => {
    const db = open();
    db.insertSession(
      session({
        blocks_since_checkpoint: 2,
        turns_since_checkpoint: 9,
        last_offset: 100,
        last_attempt_at: "2026-09-09T12:30:00Z",
        last_attempt_exit: 1,
        last_attempt_errors: "goal: required at checkpoint 1",
      }),
    );

    db.giveUp("01JQ8ZK4T0000000000000000A", { offset: 8192, at: "2026-09-09T13:00:00Z" });

    expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000A")).toMatchObject({
      blocks_since_checkpoint: 0,
      turns_since_checkpoint: 0,
      last_offset: 8192,
      last_checkpoint_at: "2026-09-09T13:00:00Z",
      last_attempt_at: "2026-09-09T12:30:00Z",
      last_attempt_exit: 1,
      last_attempt_errors: "goal: required at checkpoint 1",
    });
  });
});

describe("rebuildIndex", () => {
  it("reconstructs three fixture sessions with counters zeroed", () => {
    const db = open();
    const result = rebuildIndex(db, REPO, FIXTURE_SESSIONS);

    expect(result).toMatchObject({ sessions: 3, checkpoints: 3, problems: [] });
    expect(db.listOpenSessions(REPO).map((row) => row.ulid)).toEqual([
      "01JQ8ZK4T0000000000000000A",
      "01JQ8ZK4T0000000000000000C",
    ]);

    const withCheckpoints = db.getSessionByUlid("01JQ8ZK4T0000000000000000A");
    expect(withCheckpoints).toMatchObject({
      repo_path: REPO,
      harness: "claude-code",
      harness_session_id: "hsess-aaaaaaaaaaaaaaaa",
      status: "open",
      private: 0,
      transcript_path: null,
      // last_offset is the last checkpoint's transcript_offset; turns_total its cumulative turns.
      last_offset: 131904,
      turns_total: 15,
      last_checkpoint_at: "2026-09-09T12:41:57Z",
      turns_since_checkpoint: 0,
      blocks_since_checkpoint: 0,
      last_block_turn: null,
      last_block_trigger: null,
      last_attempt_at: null,
      last_attempt_exit: null,
      last_attempt_errors: null,
    });
    expect(db.listCheckpoints("01JQ8ZK4T0000000000000000A")).toEqual([
      {
        session_ulid: "01JQ8ZK4T0000000000000000A",
        n: 1,
        at: "2026-09-09T12:14:03Z",
        transcript_offset: 48213,
        turns: 6,
        trigger: "bytes",
      },
      {
        session_ulid: "01JQ8ZK4T0000000000000000A",
        n: 2,
        at: "2026-09-09T12:41:57Z",
        transcript_offset: 131904,
        turns: 15,
        trigger: "minutes",
      },
    ]);

    expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000B")).toMatchObject({
      status: "ended",
      private: 1,
      last_offset: 20480,
      turns_total: 9,
    });
    // No checkpoints: nothing to restore the offset or the turn count from.
    expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000C")).toMatchObject({
      last_offset: 0,
      turns_total: 0,
      last_checkpoint_at: null,
    });
    expect(db.listCheckpoints("01JQ8ZK4T0000000000000000C")).toEqual([]);
  });

  it("is idempotent and replaces only this repo's rows", () => {
    const db = open();
    db.insertSession(
      session({ ulid: "01JQ8ZK4T0000000000000000D", harness_session_id: "d", repo_path: "/other" }),
    );
    db.insertSession(
      session({ ulid: "01JQ8ZK4T000000000000000ST", harness_session_id: "stale" }),
    );

    rebuildIndex(db, REPO, FIXTURE_SESSIONS);
    const second = rebuildIndex(db, REPO, FIXTURE_SESSIONS);

    expect(second).toMatchObject({ sessions: 3, checkpoints: 3, problems: [] });
    // The stale row for this repo is gone; the other repo's row is untouched.
    expect(db.getSessionByUlid("01JQ8ZK4T000000000000000ST")).toBeUndefined();
    expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000D")).toBeDefined();
    expect(db.listCheckpoints("01JQ8ZK4T0000000000000000A")).toHaveLength(2);
  });

  it("rebuilds to zero rows when the sessions directory does not exist", () => {
    const db = open();

    expect(rebuildIndex(db, REPO, path.join(home, "no-such-dir"))).toEqual({
      sessions: 0,
      checkpoints: 0,
      problems: [],
    });
  });

  it("reports an unusable file instead of losing every other session", () => {
    const dir = path.join(home, "sessions");
    mkdirSync(dir);
    // The good sessions come from the committed fixtures, so this test measures only what the
    // three added files do to the result.
    for (const name of readdirSync(FIXTURE_SESSIONS)) {
      copyFileSync(path.join(FIXTURE_SESSIONS, name), path.join(dir, name));
    }
    writeFileSync(path.join(dir, "no-frontmatter.md"), "just a body\n");
    writeFileSync(path.join(dir, "wrong-shape.md"), "---\nschema_version: 1\nid: nope\n---\n");
    writeFileSync(path.join(dir, "not-markdown.txt"), "ignored\n");

    const db = open();
    const result = rebuildIndex(db, REPO, dir);

    expect(result.sessions).toBe(3);
    expect(result.problems.map((p) => path.basename(p.file)).sort()).toEqual([
      "no-frontmatter.md",
      "wrong-shape.md",
    ]);
    expect(result.problems[0]?.message).toMatch(/frontmatter|---/);
    expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000A")).toBeDefined();
  });
});

describe("WORKLEDGER_HOME", () => {
  it("is the only source of the index path while it is set", () => {
    expect(resolveHome()).toBe(home);
    expect(resolveHome("  ")).toBe(home);
    expect(resolveHome("./relative")).toBe(path.resolve("./relative"));
    expect(open().path.startsWith(home)).toBe(true);
    // The real home directory is never consulted while the variable is set.
    expect(resolveHome()).not.toBe(path.join(os.homedir(), ".workledger"));
  });

  it("falls back to ~/.workledger when the variable is unset or blank", () => {
    const fallback = path.join(os.homedir(), ".workledger");

    delete process.env.WORKLEDGER_HOME;
    expect(resolveHome()).toBe(fallback);

    process.env.WORKLEDGER_HOME = "   ";
    expect(resolveHome()).toBe(fallback);

    // Resolving a path must not create it; only `openIndex` may, and it is not called here.
    process.env.WORKLEDGER_HOME = home;
  });
});
