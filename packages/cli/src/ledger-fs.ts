/**
 * Filesystem access to the ledger — the durable store under `.workledger/`.
 *
 * The ledger is the source of truth and the index is a cache (CLAUDE.md), so every write here is
 * a temp-file-plus-rename: a crash mid-write leaves the previous file intact rather than a
 * half-rendered one (plans/feature-p1-data-flow.md §3). `packages/core` renders the text; this
 * module is the only place that puts it on disk.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/** The ledger directory inside an enabled repo. */
export const LEDGER_DIR = ".workledger";

/** The file `init` writes into `.workledger/` — the marker that the directory is a repo's ledger. */
export const LEDGER_CONFIG = "config.yaml";

/** Backlog statuses that make an item a legal target for `ref` + `rel` (spec §4.2). */
const OPEN_BACKLOG_STATUS = new Set(["proposed", "accepted", "in_progress"]);

/** The paths one enabled repo's ledger is made of. */
export interface LedgerPaths {
  /** The repo root — the directory holding `.workledger/`. */
  readonly root: string;
  /** `<root>/.workledger`. */
  readonly ledger: string;
  /** `<root>/.workledger/sessions`. */
  readonly sessions: string;
  /** `<root>/.workledger/backlog`. */
  readonly backlog: string;
}

/** `true` when `dir` exists and is a directory. Any other stat failure is "not a directory". */
function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `WORKLEDGER_HOME`, else `~/.workledger` — the daemon's index home, which is *not* a ledger.
 *
 * `packages/cli/src/index/db.ts` owns the same resolution for the database it opens; this is a
 * deliberate two-line copy rather than an import, because `ledger-fs.ts` is loaded by every hook
 * on every turn and `db.ts` pulls in `better-sqlite3` (hook-timing.test.ts holds the budget).
 */
function workledgerHome(): string {
  const fromEnv = process.env["WORKLEDGER_HOME"]?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".workledger");
}

/**
 * True when `dir` is a repo root: it has `.git/`, or a `.workledger/config.yaml` of its own
 * (docs/contracts/p1/cli.md preamble).
 *
 * The marker is the **config file**, never the bare `.workledger/` directory. The daemon's index
 * home defaults to `~/.workledger`, so a directory test made `$HOME` itself read as a repo root:
 * every folder under `~` then resolved to `~`, and amendment 12's `GET /api/workspaces` dropped
 * exactly the folders it exists to list — a start folder with transcripts and no repo under it
 * (#119 review). `~/.workledger` holds `index.sqlite` and `serve.json`, never a `config.yaml`, so
 * the file test tells a ledger from the index. The resolved home is refused outright as well, in
 * case an operator ever points `WORKLEDGER_HOME` at a directory that does hold one.
 */
function isRepoRoot(dir: string): boolean {
  if (isDirectory(path.join(dir, ".git"))) return true;
  const ledger = path.join(dir, LEDGER_DIR);
  return ledger !== workledgerHome() && existsSync(path.join(ledger, LEDGER_CONFIG));
}

/**
 * Walk up from `start` to the nearest repo root — a directory with `.git/` or its own
 * `.workledger/config.yaml` ({@link isRepoRoot}).
 *
 * Either marker stops the walk: the caller decides whether the repo is *enabled*, which is a
 * different question and a different exit code (`4`).
 *
 * @param start defaults to `CLAUDE_PROJECT_DIR`, else the process working directory.
 * @returns the absolute repo root, or `undefined` when the walk reaches the filesystem root
 * without finding either marker.
 */
export function findRepoRoot(start?: string): string | undefined {
  const from = start ?? process.env["CLAUDE_PROJECT_DIR"]?.trim() ?? process.cwd();
  // Absolute, so the string handed to `listOpenSessions` as `repo_path` is the same one the
  // hooks recorded regardless of where the command was invoked from. Symlinks are deliberately
  // *not* resolved: the harness reports the path the user is working in, and rewriting it here
  // would fork one repo into two index keys.
  let dir = path.resolve(from);
  for (;;) {
    if (isRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The ledger paths for one repo root. Does not check that any of them exist. */
export function ledgerPaths(root: string): LedgerPaths {
  const ledger = path.join(root, LEDGER_DIR);
  return {
    root,
    ledger,
    sessions: path.join(ledger, "sessions"),
    backlog: path.join(ledger, "backlog"),
  };
}

/**
 * `true` when the repo has a `.workledger/` directory — the enabled-repo marker (exit `4`).
 *
 * Still the directory, unlike {@link findRepoRoot}: this is only ever asked of a path already
 * known to be a repo root, and a half-scaffolded ledger must read as enabled so `init` reports
 * "already enabled" rather than rewriting it.
 */
export function isEnabled(root: string): boolean {
  return isDirectory(path.join(root, LEDGER_DIR));
}

/** Absolute path of `.workledger/sessions/<ulid>.md`. */
export function sessionFile(root: string, ulid: string): string {
  return path.join(ledgerPaths(root).sessions, `${ulid}.md`);
}

/** Absolute path of `.workledger/backlog/<id>.md`. */
export function backlogFile(root: string, id: string): string {
  return path.join(ledgerPaths(root).backlog, `${id}.md`);
}

/**
 * The `.md` files in one ledger directory, absolute and sorted by filename — which for a
 * directory of ULID-named files is creation order.
 *
 * A directory that does not exist is empty, not an error: `.workledger/backlog/` is created by
 * the first item, so a freshly enabled repo has none.
 */
export function ledgerFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => path.join(dir, name));
}

/** Read a UTF-8 ledger file, or `undefined` when it does not exist. */
export function readTextFile(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Write `text` to `file` atomically: a temp file in the *same directory* (so `rename` never
 * crosses a filesystem and can stay atomic), then `rename` over the target.
 *
 * The temp name carries the process id and a counter rather than a fixed suffix, so two
 * concurrent `workledger checkpoint` invocations cannot clobber each other's scratch file — the
 * same rule CLAUDE.md states for agents sharing `/tmp`.
 */
export function writeFileAtomic(file: string, text: string): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  tempCounter += 1;
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${tempCounter}.tmp`);
  try {
    writeFileSync(temp, text, { encoding: "utf8", mode: 0o644 });
    renameSync(temp, file);
  } catch (error) {
    // A failed write must not leave scratch files in the ledger; the rename either happened or
    // it did not, and `force` makes the already-renamed case a no-op rather than a second throw.
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Distinguishes temp files written by one process within the same millisecond. */
let tempCounter = 0;

/** Byte size of `file`, or `undefined` when it cannot be measured. */
export function fileSize(file: string): number | undefined {
  try {
    return statSync(file).size;
  } catch {
    return undefined;
  }
}

/**
 * The ids of every backlog item a checkpoint may reference with `ref` + `rel`: status
 * `proposed`, `accepted`, or `in_progress`, sorted so the usage error lists them in a stable
 * order.
 *
 * A file that does not parse as a `BacklogItem` is skipped rather than thrown on: the list exists
 * to tell an agent which ids it may use, and one corrupt file must not make every checkpoint in
 * the repo fail. `doctor` is where a corrupt ledger file is reported.
 */
export async function listOpenBacklogIds(root: string): Promise<string[]> {
  const dir = ledgerPaths(root).backlog;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  // Imported here rather than at the top of the file: `parseItem` reaches `yaml` through
  // core's frontmatter module, ~29 ms of module-init the `hook Stop` allow path cannot afford
  // (plans/feature-p1-data-flow.md §6). Only the callers that actually read the backlog pay it,
  // and the deep specifier keeps the barrel's zod schemas out of it entirely.
  const { parseItem } = await import("@workledger/core/render/backlog");

  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const text = readTextFile(path.join(dir, entry));
    if (text === undefined) continue;
    try {
      const item = parseItem(text);
      if (OPEN_BACKLOG_STATUS.has(item.frontmatter.status)) ids.push(item.frontmatter.id);
    } catch {
      continue;
    }
  }
  return ids.sort();
}
