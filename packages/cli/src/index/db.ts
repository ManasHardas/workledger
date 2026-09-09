/**
 * The local SQLite index — a rebuildable cache, never a source of truth.
 *
 * The ledger under `.workledger/` is the durable store (plans/feature-p1-data-flow.md §1);
 * everything here can be reconstructed by `rebuildIndex` from session frontmatter plus the
 * transcript file sizes. Losing this file costs at most one extra or one missed checkpoint
 * block, which is why nothing in it is written with `synchronous = FULL`.
 *
 * All paths derive from `WORKLEDGER_HOME` (docs/contracts/p1/cli.md §Global environment) so a
 * test can point the whole CLI at a temp directory and never touch the real `$HOME`.
 */
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

/** Basename of the index inside `WORKLEDGER_HOME`. */
export const INDEX_FILENAME = "index.sqlite";

/** `schema_meta` key holding the numeric id of the last applied migration. */
export const SCHEMA_VERSION_KEY = "schema_version";

/**
 * How long a writer waits for another writer's `BEGIN IMMEDIATE` before giving up with
 * `SQLITE_BUSY`. A Stop hook has a 5 s budget end to end (data-flow §6), so waiting longer than
 * this would turn contention into a hook timeout rather than a reported error.
 */
export const DEFAULT_BUSY_TIMEOUT_MS = 3000;

/**
 * Migration directory, resolved relative to *this module*, which makes the same expression work
 * from `src/index/db.ts` under vitest (`src/index/migrations/`) and from the published bundle
 * `dist/main.js` (`dist/migrations/`, written by scripts/bundle-cli.mjs).
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

/** A `sessions` row, one per harness session. Column set frozen at P1 Wave 0. */
export interface SessionRow {
  ulid: string;
  repo_path: string;
  harness: string;
  harness_session_id: string;
  transcript_path: string | null;
  status: string;
  /** SQLite has no boolean type; 0 or 1. */
  private: number;
  last_offset: number;
  /** Cumulative Stop events seen in this session. */
  turns_total: number;
  turns_since_checkpoint: number;
  last_checkpoint_at: string | null;
  last_block_turn: number | null;
  last_block_trigger: string | null;
  blocks_since_checkpoint: number;
  last_attempt_at: string | null;
  last_attempt_exit: number | null;
  /** The stderr text of the last failed `checkpoint`; field paths only, never values. */
  last_attempt_errors: string | null;
  updated_at: string;
}

/** The columns a caller may supply to `insertSession`; the rest take their DDL defaults. */
export type NewSession = Pick<
  SessionRow,
  "ulid" | "repo_path" | "harness" | "harness_session_id" | "status"
> &
  Partial<Omit<SessionRow, "ulid">>;

/** A `checkpoints` row. `(session_ulid, n)` is the idempotency key (data-flow §3). */
export interface CheckpointRow {
  session_ulid: string;
  n: number;
  at: string;
  transcript_offset: number;
  /** `turns_total` at the time of the checkpoint — cumulative, not a delta. */
  turns: number;
  trigger: string;
}

/** Everything but `n`, which `appendCheckpoint` allocates inside the write transaction. */
export type CheckpointDraft = Omit<CheckpointRow, "session_ulid" | "n">;

/** What `checkpoint` records when validation or the secret scan rejects a payload. */
export interface AttemptRecord {
  at: string;
  exit: number;
  errors: string | null;
}

/** The counter reset shared by a successful checkpoint and the Stop hook's give-up rule. */
export interface CounterReset {
  /** Transcript size to resume measuring `bytes_since` from. */
  offset: number;
  at: string;
}

/** Options for {@link openIndex}. */
export interface OpenIndexOptions {
  /** Overrides `WORKLEDGER_HOME`, which itself overrides `~/.workledger`. */
  home?: string;
  /** Overrides {@link DEFAULT_BUSY_TIMEOUT_MS}. */
  busyTimeoutMs?: number;
}

/** A migration file: its numeric id, its filename, and its SQL. */
interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** A migrations directory whose filenames do not follow `<digits>_<name>.sql`. */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Resolve `WORKLEDGER_HOME`: the explicit option, else the environment variable, else
 * `~/.workledger`. An empty or whitespace-only variable is treated as unset rather than as the
 * current directory, which is what a `WORKLEDGER_HOME=` line in a shell profile produces.
 */
export function resolveHome(home?: string): string {
  const explicit = home?.trim();
  if (explicit) return path.resolve(explicit);
  const fromEnv = process.env.WORKLEDGER_HOME?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".workledger");
}

/** Read `migrations/*.sql` in filename order, rejecting a directory this runner cannot order. */
export function readMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new MigrationError(`no .sql migrations found in ${dir}`);
  }

  const migrations: Migration[] = [];
  for (const name of files) {
    const match = /^(\d+)_[^/]*\.sql$/.exec(name);
    if (!match?.[1]) {
      throw new MigrationError(`migration "${name}" must be named <digits>_<name>.sql`);
    }
    const version = Number(match[1]);
    const previous = migrations.at(-1);
    if (previous && version <= previous.version) {
      throw new MigrationError(
        `migration "${name}" has version ${version}, which does not follow "${previous.name}"`,
      );
    }
    migrations.push({ version, name, sql: readFileSync(path.join(dir, name), "utf8") });
  }
  return migrations;
}

/** `true` when the database already has a `schema_meta` table to read a version out of. */
function hasSchemaMeta(db: Database.Database): boolean {
  const row = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
    )
    .get();
  return row !== undefined;
}

/** The last applied migration id, or 0 for a database no migration has touched. */
export function schemaVersion(db: Database.Database): number {
  if (!hasSchemaMeta(db)) return 0;
  const row = db
    .prepare<[string], { value: string }>("SELECT value FROM schema_meta WHERE key = ?")
    .get(SCHEMA_VERSION_KEY);
  return row ? Number(row.value) : 0;
}

/**
 * Apply every migration newer than the recorded version, in filename order, each one with its
 * `schema_meta` bump in the same transaction: a crash mid-migration leaves the version pointing
 * at the last migration that fully committed, so the re-run resumes rather than double-applies.
 *
 * Forward only. There is no `down`; the recovery path for a bad index is to delete the file and
 * let `rebuildIndex` reconstruct it from the ledger.
 *
 * @returns the migration names applied by this call — empty when the database was current.
 */
export function migrate(db: Database.Database, dir: string = MIGRATIONS_DIR): string[] {
  const current = schemaVersion(db);
  const applied: string[] = [];
  for (const migration of readMigrations(dir)) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare<[string, string]>(
        "INSERT INTO schema_meta (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(SCHEMA_VERSION_KEY, String(migration.version));
    }).immediate();
    applied.push(migration.name);
  }
  return applied;
}

/** Columns `updateSession` is allowed to write, so a patch key can never reach SQL unchecked. */
const UPDATABLE_COLUMNS = new Set<keyof SessionRow>([
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
]);

/** A value SQLite can bind directly. */
type Bindable = string | number | null;

/** The open index: typed accessors over the cache, plus the handle for ad-hoc work. */
export interface IndexDb {
  /** Resolved `WORKLEDGER_HOME`. */
  readonly home: string;
  /** Absolute path of the SQLite file. */
  readonly path: string;
  /** The underlying better-sqlite3 handle — for `doctor` and for tests. */
  readonly connection: Database.Database;

  getSessionByUlid(ulid: string): SessionRow | undefined;
  getSessionByHarnessId(harness: string, harnessSessionId: string): SessionRow | undefined;
  /** Open sessions for one repo, oldest first, which is the order a usage error lists them in. */
  listOpenSessions(repoPath: string): SessionRow[];
  insertSession(session: NewSession): SessionRow;
  /** Partial update by ulid. Returns the stored row, or `undefined` when the ulid is unknown. */
  updateSession(ulid: string, patch: Partial<Omit<SessionRow, "ulid">>): SessionRow | undefined;
  /** Delete a repo's sessions and their checkpoints. The scope of one `rebuildIndex` run. */
  clearRepo(repoPath: string): void;

  /** `max(n) + 1` for a session. Only meaningful inside the write transaction that uses it. */
  nextCheckpointNumber(ulid: string): number;
  insertCheckpoint(row: CheckpointRow): void;
  /**
   * Allocate `n` and insert the checkpoint under one `BEGIN IMMEDIATE`, so two concurrent
   * `workledger checkpoint` invocations for one session serialize and the second sees `n + 1`
   * (data-flow §3). `draft` is called with the allocated `n` inside the transaction.
   */
  appendCheckpoint(ulid: string, draft: (n: number) => CheckpointDraft): CheckpointRow;
  listCheckpoints(ulid: string): CheckpointRow[];

  /** Cache a failed `checkpoint` so the next Stop hook can choose BLOCK #2 over a retry block. */
  recordAttempt(ulid: string, attempt: AttemptRecord): void;
  /** Counter reset after a checkpoint lands: the attempt is on record as having succeeded. */
  resetAfterCheckpoint(ulid: string, reset: CounterReset): void;
  /** The Stop hook's give-up reset: thresholds must re-accumulate before another block. */
  giveUp(ulid: string, reset: CounterReset): void;

  /** Run `fn` under `BEGIN IMMEDIATE`. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

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
] as const satisfies ReadonlyArray<keyof SessionRow>;

/** Fill a `NewSession` out to a full row so one INSERT statement covers every column. */
function completeSession(session: NewSession): SessionRow {
  return {
    transcript_path: null,
    private: 0,
    last_offset: 0,
    turns_total: 0,
    turns_since_checkpoint: 0,
    last_checkpoint_at: null,
    last_block_turn: null,
    last_block_trigger: null,
    blocks_since_checkpoint: 0,
    last_attempt_at: null,
    last_attempt_exit: null,
    last_attempt_errors: null,
    updated_at: new Date().toISOString(),
    ...session,
  };
}

/**
 * Open (creating if needed) the index under `WORKLEDGER_HOME` and bring it up to the latest
 * migration. Safe to call repeatedly: migrations are keyed on `schema_meta`, so a second call on
 * an up-to-date database runs no SQL and leaves the recorded version alone.
 */
export function openIndex(options: OpenIndexOptions = {}): IndexDb {
  const home = resolveHome(options.home);
  mkdirSync(home, { recursive: true });
  const file = path.join(home, INDEX_FILENAME);

  const db = new Database(file);
  // WAL lets `brief` and `doctor` read while a Stop hook writes; without it every reader would
  // contend with the writer and the 5 s hook budget would be spent waiting.
  db.pragma("journal_mode = WAL");
  // NORMAL is the documented companion to WAL: it can only lose the most recent transactions on
  // a power cut, which for a rebuildable cache costs at most one missed checkpoint block.
  db.pragma("synchronous = NORMAL");
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);

  migrate(db);

  const insertColumns = SESSION_COLUMNS.join(", ");
  const insertPlaceholders = SESSION_COLUMNS.map((c) => `@${c}`).join(", ");
  const selectByUlid = db.prepare<[string], SessionRow>("SELECT * FROM sessions WHERE ulid = ?");
  const selectByHarness = db.prepare<[string, string], SessionRow>(
    "SELECT * FROM sessions WHERE harness = ? AND harness_session_id = ?",
  );
  const selectOpen = db.prepare<[string], SessionRow>(
    "SELECT * FROM sessions WHERE repo_path = ? AND status = 'open' ORDER BY ulid",
  );
  const insertSessionStmt = db.prepare<SessionRow>(
    `INSERT INTO sessions (${insertColumns}) VALUES (${insertPlaceholders})`,
  );
  const deleteCheckpointsForRepo = db.prepare<[string]>(
    "DELETE FROM checkpoints WHERE session_ulid IN (SELECT ulid FROM sessions WHERE repo_path = ?)",
  );
  const deleteSessionsForRepo = db.prepare<[string]>("DELETE FROM sessions WHERE repo_path = ?");

  const selectNextN = db.prepare<[string], { next: number }>(
    "SELECT COALESCE(MAX(n), 0) + 1 AS next FROM checkpoints WHERE session_ulid = ?",
  );
  const insertCheckpointStmt = db.prepare<CheckpointRow>(
    "INSERT INTO checkpoints (session_ulid, n, at, transcript_offset, turns, trigger) " +
      "VALUES (@session_ulid, @n, @at, @transcript_offset, @turns, @trigger)",
  );
  const selectCheckpoints = db.prepare<[string], CheckpointRow>(
    "SELECT * FROM checkpoints WHERE session_ulid = ? ORDER BY n",
  );

  function updateSession(
    ulid: string,
    patch: Partial<Omit<SessionRow, "ulid">>,
  ): SessionRow | undefined {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<
      [keyof SessionRow, Bindable]
    >;
    for (const [column] of entries) {
      if (!UPDATABLE_COLUMNS.has(column)) {
        throw new TypeError(`updateSession: "${column}" is not an updatable sessions column`);
      }
    }
    if (entries.length === 0) return selectByUlid.get(ulid);

    const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
    db.prepare(`UPDATE sessions SET ${assignments} WHERE ulid = ?`).run(
      ...entries.map(([, value]) => value),
      ulid,
    );
    return selectByUlid.get(ulid);
  }

  const appendTx = db.transaction(
    (ulid: string, draft: (n: number) => CheckpointDraft): CheckpointRow => {
      const n = selectNextN.get(ulid)?.next ?? 1;
      const row: CheckpointRow = { session_ulid: ulid, n, ...draft(n) };
      insertCheckpointStmt.run(row);
      return row;
    },
  );

  const clearRepoTx = db.transaction((repoPath: string) => {
    deleteCheckpointsForRepo.run(repoPath);
    deleteSessionsForRepo.run(repoPath);
  });

  return {
    home,
    path: file,
    connection: db,

    getSessionByUlid: (ulid) => selectByUlid.get(ulid),
    getSessionByHarnessId: (harness, harnessSessionId) =>
      selectByHarness.get(harness, harnessSessionId),
    listOpenSessions: (repoPath) => selectOpen.all(repoPath),

    insertSession(session) {
      const row = completeSession(session);
      insertSessionStmt.run(row);
      return row;
    },

    updateSession,

    clearRepo: (repoPath) => {
      clearRepoTx.immediate(repoPath);
    },

    nextCheckpointNumber: (ulid) => selectNextN.get(ulid)?.next ?? 1,
    insertCheckpoint: (row) => {
      insertCheckpointStmt.run(row);
    },
    appendCheckpoint: (ulid, draft) => appendTx.immediate(ulid, draft),
    listCheckpoints: (ulid) => selectCheckpoints.all(ulid),

    recordAttempt(ulid, attempt) {
      updateSession(ulid, {
        last_attempt_at: attempt.at,
        last_attempt_exit: attempt.exit,
        last_attempt_errors: attempt.errors,
        updated_at: attempt.at,
      });
    },

    resetAfterCheckpoint(ulid, reset) {
      // `last_attempt_*` describe the attempt that just succeeded: exit 0 and no errors. Leaving
      // a stale failure behind would make the next Stop hook read `last_attempt_exit != 0` and
      // raise BLOCK #2 for a checkpoint that has already landed (data-flow §2).
      updateSession(ulid, {
        turns_since_checkpoint: 0,
        blocks_since_checkpoint: 0,
        last_offset: reset.offset,
        last_checkpoint_at: reset.at,
        last_attempt_at: reset.at,
        last_attempt_exit: 0,
        last_attempt_errors: null,
        updated_at: reset.at,
      });
    },

    giveUp(ulid, reset) {
      // Deliberately does not touch `last_attempt_*`: no attempt happened. The thresholds are
      // reset so a block is never immediately repeated (data-flow §2, give-up rule).
      updateSession(ulid, {
        blocks_since_checkpoint: 0,
        turns_since_checkpoint: 0,
        last_offset: reset.offset,
        last_checkpoint_at: reset.at,
        updated_at: reset.at,
      });
    },

    transaction: <T>(fn: () => T): T => db.transaction(fn).immediate(),
    close: () => db.close(),
  };
}
