/**
 * Filesystem access to the ledger — the durable store under `.workledger/`.
 *
 * The ledger is the source of truth and the index is a cache (CLAUDE.md), so every write here is
 * a temp-file-plus-rename: a crash mid-write leaves the previous file intact rather than a
 * half-rendered one (plans/feature-p1-data-flow.md §3). `packages/core` renders the text; this
 * module is the only place that puts it on disk.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { parseItem } from "@workledger/core";

/** The ledger directory inside an enabled repo. */
export const LEDGER_DIR = ".workledger";

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
 * Walk up from `start` to the nearest directory containing `.workledger/` or `.git/`
 * (docs/contracts/p1/cli.md preamble).
 *
 * A `.workledger/` directory wins over a `.git/` in the same directory only in the sense that
 * either one stops the walk: the caller decides whether the repo is *enabled*, which is a
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
    if (isDirectory(path.join(dir, LEDGER_DIR)) || isDirectory(path.join(dir, ".git"))) return dir;
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

/** `true` when the repo has a `.workledger/` directory — the enabled-repo marker (exit `4`). */
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
export function listOpenBacklogIds(root: string): string[] {
  const dir = ledgerPaths(root).backlog;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
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
