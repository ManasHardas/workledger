/**
 * `workledger index rebuild` — docs/contracts/p8/daemon-and-api.md §Amendment 14.
 *
 * The recovery path for an index this build refuses to open. The ledger under `.workledger/` is
 * the durable store and the index is a cache (plans/feature-p1-data-flow.md §1), so recovery is
 * never a hand-edited `schema_version`: move the file aside under a timestamped name, open a
 * fresh one at this build's schema, and rebuild every enabled repo's sessions and checkpoints
 * from its ledger.
 *
 * Two things the ledgers cannot supply. The list of enabled repos and the workspace folders live
 * only in the index, so they are read straight out of the file being replaced, without migrating
 * it ({@link readRegistrations}); and the repair queue is index-only state with no ledger behind
 * it, so job history is gone. The command says so in as many words rather than leaving the
 * operator to notice.
 */
import { closeSync, existsSync, openSync, renameSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { INDEX_FILENAME, openIndex, readRegistrations, resolveHome } from "../index/db.js";
import { isEnabled, ledgerPaths } from "../ledger-fs.js";
import { rebuildIndex } from "../index/rebuild.js";

/** Everything the command touches outside itself, so a test can drive it. */
export interface IndexRebuildIo {
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

/** The real environment. */
export function processIo(): IndexRebuildIo {
  return {
    env: process.env,
    stdout: (text) => void process.stdout.write(`${text}\n`),
    stderr: (line) => void process.stderr.write(`${line}\n`),
  };
}

/** The timestamp a moved-aside index is named after: `20260910T193000Z`. */
export function backupStamp(at: Date = new Date()): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/**
 * How many same-second backups one home will hold before the command gives up. A rebuild is
 * seconds of work, so reaching this means something is looping, and silently picking name 1001
 * would be worse than saying so.
 */
const MAX_BACKUPS_PER_SECOND = 100;

/**
 * Claim an unused backup name for `file`, atomically.
 *
 * The stamp has one-second resolution and a rebuild takes well under a second, so two rebuilds
 * back to back produce the same stamp — and a bare `renameSync` onto an existing name replaces
 * it silently. That destroys the previous backup, which is precisely the one that matters when
 * the rebuild being retried is a rebuild that was interrupted (#141 review).
 *
 * `wx` is an exclusive create: it fails with `EEXIST` rather than truncating, so the name is
 * either ours or somebody else's, never quietly shared. The empty placeholder it leaves is what
 * the rename then replaces — our own file, so nothing of the operator's is overwritten.
 *
 * @returns the claimed path, e.g. `index.sqlite.20260910T193000Z.bak`, then `…Z-2.bak`
 */
function claimBackupName(file: string, stamp: string): string {
  for (let attempt = 1; attempt <= MAX_BACKUPS_PER_SECOND; attempt += 1) {
    const target = `${file}.${stamp}${attempt === 1 ? "" : `-${attempt}`}.bak`;
    try {
      closeSync(openSync(target, "wx"));
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(
    `${MAX_BACKUPS_PER_SECOND} backups of ${file} already exist for ${stamp}; move some away first`,
  );
}

/**
 * Move `file` and its WAL sidecars aside under one claimed name.
 *
 * The `-wal` goes with it: a SQLite database separated from its write-ahead log is missing
 * whatever had not been checkpointed, and the point of keeping the old file at all is that the
 * operator can still open it. The sidecar names derive from the claimed one, so they cannot
 * collide either.
 *
 * @returns the new path of the database itself, or `undefined` when there was no file to move
 */
function moveAside(file: string, stamp: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const target = claimBackupName(file, stamp);
  renameSync(file, target);
  for (const sidecar of ["-wal", "-shm"]) {
    if (existsSync(`${file}${sidecar}`)) renameSync(`${file}${sidecar}`, `${target}${sidecar}`);
  }
  return target;
}

/** English for a count and its noun, so the summary reads like a sentence. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Rebuild the index under `WORKLEDGER_HOME` from the ledgers.
 *
 * @returns `0` once a working index is in place, `1` when the old file could not be moved aside
 * or the fresh one could not be opened — the two failures that leave nothing usable behind.
 */
export async function indexRebuildCommand(io: IndexRebuildIo = processIo()): Promise<number> {
  const home = resolveHome(io.env["WORKLEDGER_HOME"]);
  const file = path.join(home, INDEX_FILENAME);
  const say = (line: string): void => void io.stdout(`workledger index rebuild: ${line}`);

  // Read the registrations before the move: `readRegistrations` opens read-only and never
  // migrates, so it works on exactly the file this build has just refused to open normally.
  const { repos, workspaces } = existsSync(file)
    ? readRegistrations(file)
    : { repos: [], workspaces: [] };

  let moved: string | undefined;
  try {
    moved = moveAside(file, backupStamp());
  } catch (error) {
    io.stderr(
      `workledger index rebuild: could not move ${file} aside: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT_USAGE;
  }
  say(
    moved === undefined
      ? `no index at ${file} yet; building a fresh one`
      : `moved the old index aside; the backup is at ${moved}`,
  );

  let db;
  try {
    db = openIndex({ home });
  } catch (error) {
    io.stderr(
      `workledger index rebuild: could not open a fresh index at ${file}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT_USAGE;
  }

  let sessions = 0;
  let checkpoints = 0;
  let rebuilt = 0;
  try {
    for (const root of repos) {
      if (!isEnabled(root)) {
        io.stderr(`workledger index rebuild: skipping ${root}; it has no .workledger/ any more`);
        continue;
      }
      db.upsertRepo(root);
      const result = rebuildIndex(db, root, ledgerPaths(root).sessions);
      sessions += result.sessions;
      checkpoints += result.checkpoints;
      rebuilt += 1;
      for (const problem of result.problems) {
        io.stderr(`workledger index rebuild: ${problem.file}: ${problem.message}`);
      }
    }
    for (const workspace of workspaces) db.upsertWorkspace(workspace);
  } finally {
    db.close();
  }

  say(`rebuilt ${plural(rebuilt, "repo")}, ${plural(sessions, "session")}, ${plural(checkpoints, "checkpoint")}`);
  if (workspaces.length > 0) say(`re-registered ${plural(workspaces.length, "workspace")}`);
  if (moved !== undefined && repos.length === 0) {
    say("the old index listed no enabled repos; run `workledger init` or `workledger onboard` to add them");
  }
  say("job history is not recoverable — queued, running and finished repair jobs are gone");
  return EXIT_OK;
}
