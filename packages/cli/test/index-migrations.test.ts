/**
 * The index's migration history, the divergence it detects, and `workledger index rebuild` —
 * docs/contracts/p8/daemon-and-api.md amendment 14, issue #108.
 *
 * The incident this file is about: on 2026-09-10 a worktree build applied a migration it had
 * numbered `0006_workspaces`; the branch that merged numbered the same change `0007_workspaces`,
 * so the merged build skipped six migrations it thought were done and tried to create a table
 * the file already had. `workledger serve` died with "table workspaces already exists" and
 * `workledger open` reported only "the server did not answer". Recovery was a backup, a manual
 * `DROP TABLE` and a hand-edited `schema_version`.
 *
 * Both shapes of that index are built here from the real migration files — one that records the
 * foreign migration by name, one from before the history table existed — and every assertion runs
 * against a temp `WORKLEDGER_HOME` under `os.tmpdir()`. Nothing here may touch the real one.
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openCommand } from "../src/commands/open.js";
import { indexRebuildCommand } from "../src/commands/index-rebuild.js";
import { serveCommand } from "../src/commands/serve.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import {
  INDEX_FILENAME,
  REBUILD_COMMAND,
  SchemaDivergenceError,
  appliedMigrations,
  openIndex,
  migrate,
  readMigrations,
  readRegistrations,
  schemaVersion,
} from "../src/index/db.js";
import { serveLogPath } from "../src/serve-state.js";
import type { IndexRebuildIo } from "../src/commands/index-rebuild.js";
import type { OpenIo } from "../src/commands/open.js";
import type { ServeIo } from "../src/commands/serve.js";

const FIXTURE_SESSIONS = path.join(import.meta.dirname, "fixtures", "sessions");
const BUNDLED = path.join(import.meta.dirname, "..", "src", "index", "migrations");

/** The foreign migration's name — what the pre-rebase worktree build called the change. */
const FOREIGN = "0006_workspaces.sql";

let dir: string;
let home: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "workledger-schema-"));
  home = path.join(dir, "home");
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The index file under the test's temp home. */
function indexFile(): string {
  return path.join(home, INDEX_FILENAME);
}

/**
 * The migration set the pre-rebase worktree build shipped: 0001–0005 verbatim, then the
 * workspaces change numbered 0006 instead of 0007.
 */
function foreignMigrations(): string {
  const foreign = path.join(dir, "foreign-migrations");
  mkdirSync(foreign, { recursive: true });
  for (const name of readdirSync(BUNDLED).sort()) {
    if (!/^000[1-5]_/.test(name)) continue;
    copyFileSync(path.join(BUNDLED, name), path.join(foreign, name));
  }
  copyFileSync(path.join(BUNDLED, "0007_workspaces.sql"), path.join(foreign, FOREIGN));
  return foreign;
}

/**
 * Build the index the incident left behind: migrated by the foreign set, so it has a
 * `workspaces` table at schema version 6.
 *
 * @param withHistory `false` drops `schema_migrations`, which is what an index written before
 * this feature looks like — the shape the operator actually had.
 */
function divergentIndex(withHistory = true): void {
  const db = openIndex({ home });
  try {
    // Start from an empty file at this build's SQLite settings, then run the foreign set over it.
    db.connection.pragma("foreign_keys = OFF");
    const tables = db.connection
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    for (const { name } of tables) db.connection.exec(`DROP TABLE IF EXISTS "${name}"`);
    expect(migrate(db.connection, foreignMigrations())).toHaveLength(6);
    expect(schemaVersion(db.connection)).toBe(6);
    if (!withHistory) db.connection.exec("DROP TABLE schema_migrations");
  } finally {
    db.close();
  }
}

/** An enabled repo whose ledger holds the three fixture sessions. */
function repoWithLedger(name: string): string {
  const root = path.join(dir, name);
  const sessions = path.join(root, ".workledger", "sessions");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(path.join(root, ".workledger", "config.yaml"), "version: 1\n", "utf8");
  for (const file of readdirSync(FIXTURE_SESSIONS)) {
    copyFileSync(path.join(FIXTURE_SESSIONS, file), path.join(sessions, file));
  }
  return root;
}

/** The io `index rebuild` runs with. */
function rebuildIo(): IndexRebuildIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    env: { WORKLEDGER_HOME: home },
    out,
    err,
    stdout: (text) => void out.push(text),
    stderr: (line) => void err.push(line),
  };
}

describe("schema history", () => {
  it("records every bundled migration with its name and hash on a fresh index", () => {
    const db = openIndex({ home });
    try {
      const bundled = readMigrations();
      const applied = appliedMigrations(db.connection);

      expect(applied.map((row) => row.name)).toEqual(bundled.map((m) => m.name));
      expect(applied.map((row) => row.version)).toEqual(bundled.map((m) => m.version));
      expect(applied.every((row) => /^[0-9a-f]{64}$/.test(row.sha256))).toBe(true);
      expect(schemaVersion(db.connection)).toBe(bundled.at(-1)!.version);
    } finally {
      db.close();
    }
  });

  it("adopts a current index from before the history table without rebuilding it", () => {
    // The upgrade path every existing `~/.workledger/index.sqlite` takes on first run.
    const first = openIndex({ home });
    first.upsertRepo("/repos/alpha");
    const version = schemaVersion(first.connection);
    first.connection.exec("DROP TABLE schema_migrations");
    first.close();

    const second = openIndex({ home });
    try {
      const applied = appliedMigrations(second.connection);
      expect(applied.map((row) => row.name)).toEqual(readMigrations().map((m) => m.name));
      // Adopted, not re-run: the version is untouched and the rows are still there.
      expect(schemaVersion(second.connection)).toBe(version);
      expect(second.listRepos().map((repo) => repo.repo_path)).toEqual(["/repos/alpha"]);
    } finally {
      second.close();
    }
  });

  it("detects a recorded hash that no longer matches the bundled file", () => {
    const first = openIndex({ home });
    first.connection
      .prepare<[string]>("UPDATE schema_migrations SET sha256 = ? WHERE version = 5")
      .run("0".repeat(64));
    first.close();

    expect(() => openIndex({ home })).toThrow(SchemaDivergenceError);
    try {
      openIndex({ home });
      expect.unreachable("the divergent index must not open");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaDivergenceError);
      const divergence = error as SchemaDivergenceError;
      expect(divergence.migration).toBe("0005_job_retry_after.sql");
      expect(divergence.message).toContain("different SQL than this build ships");
      expect(divergence.message).toContain(indexFile());
      expect(divergence.message).toContain(REBUILD_COMMAND);
    }
  });

  it("names the foreign migration recorded at a number this build spends on another change", () => {
    divergentIndex();

    try {
      openIndex({ home });
      expect.unreachable("the divergent index must not open");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaDivergenceError);
      const divergence = error as SchemaDivergenceError;
      expect(divergence.migration).toBe(FOREIGN);
      expect(divergence.message).toContain(`migration 6 ran here as "${FOREIGN}"`);
      expect(divergence.message).toContain("0006_session_repo_key.sql");
      expect(divergence.message).toContain(REBUILD_COMMAND);
    }
  });

  it("names the colliding migration on an index from before the history table", () => {
    // No history to compare, so the collision itself is the evidence: this is byte-for-byte the
    // failure the operator hit — `CREATE TABLE workspaces` against a file that already has one.
    divergentIndex(false);

    try {
      openIndex({ home });
      expect.unreachable("the divergent index must not open");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaDivergenceError);
      const divergence = error as SchemaDivergenceError;
      expect(divergence.migration).toBe("0007_workspaces.sql");
      expect(divergence.message).toContain("table workspaces already exists");
      expect(divergence.message).toContain(REBUILD_COMMAND);
    }
  });

  it("names a migration applied by a build newer than this one", () => {
    const db = openIndex({ home });
    db.connection
      .prepare<[number, string, string, string]>(
        "INSERT INTO schema_migrations (version, name, sha256, applied_at) VALUES (?, ?, ?, ?)",
      )
      .run(99, "0099_agents.sql", "f".repeat(64), new Date().toISOString());
    db.close();

    try {
      openIndex({ home });
      expect.unreachable("the divergent index must not open");
    } catch (error) {
      expect((error as SchemaDivergenceError).migration).toBe("0099_agents.sql");
      expect((error as Error).message).toContain("this build does not ship it");
    }
  });

  it("leaves a partial migration directory alone, which is an index mid-upgrade", () => {
    // Versions the bundled set has not reached are not divergence — applying them is the point.
    const ahead = path.join(dir, "ahead");
    mkdirSync(ahead);
    writeFileSync(path.join(ahead, "0010_tenth.sql"), "CREATE TABLE tenth (x TEXT);", "utf8");
    const db = openIndex({ home });
    try {
      expect(migrate(db.connection, ahead)).toEqual(["0010_tenth.sql"]);
      expect(appliedMigrations(db.connection).at(-1)).toMatchObject({ version: 10, name: "0010_tenth.sql" });
    } finally {
      db.close();
    }
  });
});

describe("workledger serve on a divergent index", () => {
  it("exits non-zero naming the migration and the way out", async () => {
    divergentIndex();
    const err: string[] = [];
    const io: ServeIo = {
      cwd: dir,
      env: { WORKLEDGER_HOME: home },
      stdout: () => {},
      stderr: (line) => void err.push(line),
      openUrl: () => {},
    };

    expect(await serveCommand({ open: false }, io)).toBe(EXIT_USAGE);
    const said = err.join("\n");
    expect(said).toContain("workledger serve:");
    expect(said).toContain(FOREIGN);
    expect(said).toContain(REBUILD_COMMAND);
    expect(said).not.toContain("could not read the index:");
  });
});

describe("workledger open on a divergent index", () => {
  it("prints the daemon's schema message instead of 'the server did not answer'", async () => {
    divergentIndex();
    const err: string[] = [];
    const out: string[] = [];
    // Stale noise from an older daemon in the same home, which must not be mistaken for this run.
    appendFileSync(serveLogPath(home), "workledger serve: something from last week\n", "utf8");

    const io: OpenIo = {
      cwd: dir,
      env: { WORKLEDGER_HOME: home },
      stdout: (text) => void out.push(text),
      stderr: (line) => void err.push(line),
      openUrl: () => {},
      startTimeoutMs: 300,
      // A real detached daemon writes its stderr to `serve.log` and exits; that is all `open` sees.
      spawnServer: (request) => {
        const serveIo: ServeIo = {
          cwd: dir,
          env: request.env,
          stdout: () => {},
          stderr: (line) => void appendFileSync(serveLogPath(request.home), `${line}\n`, "utf8"),
          openUrl: () => {},
        };
        void serveCommand({ port: request.port, open: false }, serveIo);
      },
    };

    expect(await openCommand({ browser: false }, io)).toBe(EXIT_USAGE);
    const said = err.join("\n");
    expect(said).toContain(FOREIGN);
    expect(said).toContain(REBUILD_COMMAND);
    expect(said).not.toContain("did not answer");
    expect(said).not.toContain("last week");
  });
});

describe("workledger index rebuild", () => {
  it("moves the divergent index aside and rebuilds it from the ledgers", async () => {
    const alpha = repoWithLedger("alpha");
    const workspace = path.join(dir, "workspace");
    mkdirSync(workspace, { recursive: true });
    // Register the repo and the workspace the way `init` does, then diverge the file.
    divergentIndex();
    // Seed `repos`/`workspaces` straight into the divergent file, which is where `init` put them.
    seedRegistrations(alpha, workspace);

    const io = rebuildIo();
    expect(await indexRebuildCommand(io)).toBe(EXIT_OK);

    const said = io.out.join("\n");
    expect(said).toContain("the backup is at");
    expect(said).toContain("job history is not recoverable");
    const backups = readdirSync(home).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^index\.sqlite\.\d{8}T\d{6}Z\.bak$/);
    expect(said).toContain(path.join(home, backups[0]!));

    // The rebuilt index opens, and lists the same repos and sessions the ledgers hold.
    const db = openIndex({ home });
    try {
      expect(db.listRepos().map((repo) => repo.repo_path)).toEqual([alpha]);
      expect(db.listWorkspaces().map((row) => row.path)).toEqual([workspace]);
      expect(db.listOpenSessions(alpha).map((row) => row.ulid)).toEqual([
        "01JQ8ZK4T0000000000000000A",
        "01JQ8ZK4T0000000000000000C",
      ]);
      expect(db.listCheckpoints("01JQ8ZK4T0000000000000000A")).toHaveLength(2);
      expect(appliedMigrations(db.connection).map((row) => row.name)).toEqual(
        readMigrations().map((m) => m.name),
      );
    } finally {
      db.close();
    }
  });

  it("never overwrites an earlier backup, even two rebuilds inside one second", async () => {
    // The stamp has one-second resolution and a rebuild is milliseconds of work, so this is the
    // ordinary case, not a race: re-running after an interrupted rebuild is exactly when the
    // earlier backup is the only copy of the pre-rebuild index (#141 review).
    const alpha = repoWithLedger("alpha");
    divergentIndex();
    seedRegistrations(alpha, path.join(dir, "workspace"));
    mark("first");

    const first = rebuildIo();
    expect(await indexRebuildCommand(first)).toBe(EXIT_OK);
    mark("second");
    const second = rebuildIo();
    expect(await indexRebuildCommand(second)).toBe(EXIT_OK);

    const backups = readdirSync(home).filter((name) => name.endsWith(".bak")).sort();
    expect(backups).toHaveLength(2);
    expect(new Set(backups).size).toBe(2);
    // Each run named the file it actually wrote, and each backup still holds its own marker.
    for (const [io, name] of [
      [first, backups.find((b) => marker(b) === "first")],
      [second, backups.find((b) => marker(b) === "second")],
    ] as const) {
      expect(name, io.out.join("\n")).toBeDefined();
      expect(io.out.join("\n")).toContain(path.join(home, name!));
    }
    expect(existsSync(indexFile())).toBe(true);
  });

  it("builds a fresh index when there is none, and says so", async () => {
    const io = rebuildIo();
    expect(await indexRebuildCommand(io)).toBe(EXIT_OK);
    expect(io.out.join("\n")).toContain("no index at");
    expect(existsSync(indexFile())).toBe(true);
    expect(readdirSync(home).filter((name) => name.endsWith(".bak"))).toEqual([]);
  });

  it("skips a registered repo whose ledger is gone rather than failing the rebuild", async () => {
    const alpha = repoWithLedger("alpha");
    divergentIndex();
    seedRegistrations(alpha, path.join(dir, "absent-workspace"));
    rmSync(path.join(alpha, ".workledger"), { recursive: true, force: true });

    const io = rebuildIo();
    expect(await indexRebuildCommand(io)).toBe(EXIT_OK);
    expect(io.err.join("\n")).toContain("no .workledger/ any more");
    const db = openIndex({ home });
    try {
      expect(db.listRepos()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

/** A `better-sqlite3` handle on a raw index file, for the writes `openIndex` would refuse. */
function raw(file: string): import("better-sqlite3").Database {
  const require_ = createRequire(import.meta.url);
  const Database = require_("better-sqlite3") as typeof import("better-sqlite3");
  return new Database(file);
}

/** Stamp the live index with a marker table, so a backup can be told from every other backup. */
function mark(text: string): void {
  const db = raw(indexFile());
  try {
    db.exec("CREATE TABLE IF NOT EXISTS rebuild_marker (tag TEXT)");
    db.exec("DELETE FROM rebuild_marker");
    db.prepare<[string]>("INSERT INTO rebuild_marker (tag) VALUES (?)").run(text);
  } finally {
    db.close();
  }
}

/** The marker inside one backup file, or `undefined` when it carries none. */
function marker(backup: string): string | undefined {
  const db = raw(path.join(home, backup));
  try {
    return db.prepare<[], { tag: string }>("SELECT tag FROM rebuild_marker").get()?.tag;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

/** Write `repos` and `workspaces` rows straight into the divergent file, as `init` would have. */
function seedRegistrations(repoPath: string, workspacePath: string): void {
  const now = new Date().toISOString();
  // The file cannot be opened through `openIndex` any more, which is the whole point; the
  // registrations still have to come out of it, so they go in the same way they will come out.
  const db = raw(path.join(home, INDEX_FILENAME));
  try {
    db.prepare("INSERT INTO repos (path, enabled, added_at, updated_at) VALUES (?, 1, ?, ?)").run(
      repoPath,
      now,
      now,
    );
    db.prepare("INSERT INTO workspaces (path, created_at) VALUES (?, ?)").run(workspacePath, now);
  } finally {
    db.close();
  }
  expect(readRegistrations(path.join(home, INDEX_FILENAME))).toEqual({
    repos: [repoPath],
    workspaces: [workspacePath],
  });
}
