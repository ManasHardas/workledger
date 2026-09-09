/**
 * The three git facts a session's frontmatter carries: `repo`, `branch` and `author`.
 *
 * Read out of git's own files rather than by shelling out to `git`. `SessionStart` has a 300 ms
 * budget (plans/feature-p1-data-flow.md §6) and three `git config` invocations are three process
 * spawns; `.git/config` and `.git/HEAD` are two small file reads. This is a *reader*, not a
 * reimplementation of git's config resolution: it understands the plain INI that `git config`
 * writes, repo config overriding the user's global one, and nothing else. Everything it cannot
 * read degrades to a documented fallback, because a session record with an approximate author is
 * worth more than no session record.
 */
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/** A `[section "sub"]` INI mapping: `section.key` (and `section.sub.key`) to its last value. */
type Ini = Map<string, string>;

/** What the session frontmatter needs about the repo. */
export interface GitInfo {
  /** First remote's `host/path` without scheme or `.git`, else the directory basename. */
  repo: string;
  /** Current branch, or `null` on a detached HEAD or a directory that is not a git repo. */
  branch: string | null;
  /** `user.name` / `user.email`, repo config first, then the global one. */
  author: { name: string; email: string };
}

/** Read a UTF-8 file, or `undefined` when it is missing or unreadable. */
function read(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Parse the INI subset `git config` writes: `[section]`, `[section "sub"]`, `key = value`. */
export function parseIni(text: string): Ini {
  const out: Ini = new Map();
  let prefix = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[([A-Za-z0-9.-]+)(?:\s+"([^"]*)")?\]$/.exec(line);
    if (section) {
      prefix = section[2] === undefined ? `${section[1]}.` : `${section[1]}.${section[2]}.`;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0 || prefix === "") continue;
    out.set(`${prefix}${line.slice(0, eq).trim()}`, line.slice(eq + 1).trim());
  }
  return out;
}

/**
 * The `.git` directory for `root`, following the `gitdir: …` pointer file a worktree or a
 * submodule uses. `undefined` when `root` is not a git working tree at all — an enabled repo
 * does not have to be one.
 */
export function gitDir(root: string): string | undefined {
  const dotGit = path.join(root, ".git");
  let stat;
  try {
    stat = statSync(dotGit);
  } catch {
    return undefined;
  }
  if (stat.isDirectory()) return dotGit;
  const pointer = /^gitdir:\s*(.+)$/m.exec(read(dotGit) ?? "");
  if (!pointer) return undefined;
  const target = pointer[1]!.trim();
  return path.isAbsolute(target) ? target : path.resolve(root, target);
}

/** Git's global config files, in the order git reads them (later wins). */
function globalConfigFiles(home: string): string[] {
  const xdg = process.env["XDG_CONFIG_HOME"]?.trim();
  return [
    path.join(xdg && xdg !== "" ? xdg : path.join(home, ".config"), "git", "config"),
    path.join(home, ".gitconfig"),
  ];
}

/**
 * `https://github.com/o/r.git` and `git@github.com:o/r.git` both become `github.com/o/r` — the
 * shape SessionFrontmatter's `repo` is described in (schema.ts): host and path, no scheme, no
 * `.git`.
 */
export function normalizeRemote(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (trimmed === "") return undefined;
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(trimmed);
  if (scp && !trimmed.includes("://")) return `${scp[1]}/${scp[2]!.replace(/^\/+/, "")}`;
  const url_ = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?(.+)$/i.exec(trimmed);
  if (url_) return url_[1];
  return trimmed;
}

/** The first `remote.<name>.url` in file order — `origin` has no special standing in the INI. */
function firstRemoteUrl(ini: Ini): string | undefined {
  for (const [key, value] of ini) {
    if (/^remote\..+\.url$/.test(key)) return value;
  }
  return undefined;
}

/**
 * Collect {@link GitInfo} for `root`.
 *
 * @param home overrides the user's home directory, so a test never reads the real `~/.gitconfig`.
 */
export function gitInfo(root: string, home: string = os.homedir()): GitInfo {
  const dir = gitDir(root);
  const repoIni = dir === undefined ? new Map<string, string>() : parseIni(read(path.join(dir, "config")) ?? "");

  const globalIni: Ini = new Map();
  for (const file of globalConfigFiles(home)) {
    const text = read(file);
    if (text === undefined) continue;
    for (const [key, value] of parseIni(text)) globalIni.set(key, value);
  }

  const setting = (key: string): string | undefined => repoIni.get(key) ?? globalIni.get(key);

  const head = dir === undefined ? undefined : read(path.join(dir, "HEAD"));
  const ref = head === undefined ? null : /^ref:\s*refs\/heads\/(.+)$/m.exec(head);

  const remote = firstRemoteUrl(repoIni);
  return {
    repo: (remote === undefined ? undefined : normalizeRemote(remote)) ?? path.basename(root),
    branch: ref ? ref[1]!.trim() : null,
    author: {
      // The ledger records who was at the keyboard; `init` refuses to enable a repo with no git
      // identity (cli.md §init), so these fallbacks only appear for a hand-made `.workledger/`.
      name: setting("user.name") ?? "unknown",
      email: setting("user.email") ?? "unknown",
    },
  };
}
