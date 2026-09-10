/**
 * Where a harness session's working directory puts it — the one reckoning every attribution
 * shares (#105 review): discovery, the Claude Code and Codex store enumerations, and the
 * touched-path rule all resolve a cwd to its repo through {@link sessionRepoOf}, so a session
 * started in `<repo>/src` counts for `<repo>` in the wizard's list, in its history windows, in
 * the plan and in `workledger backfill` alike.
 *
 * Also home to the Claude Code project-slug inversion, which the store enumeration needs to find
 * those subdirectory sessions: they live under their own slug, not the repo's.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { findRepoRoot } from "../ledger-fs.js";

/**
 * The repo a working directory belongs to — the nearest `.workledger/` or `.git/` above it — or
 * the directory itself when there is none (a workspace folder, `~`). Always absolute.
 */
export function sessionRepoOf(cwd: string): string {
  return findRepoRoot(cwd) ?? path.resolve(cwd);
}

/** `true` for a directory, following symlinks; `false` for anything else or nothing. */
export function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** The directory name Claude Code gives one working directory: every non-alphanumeric is `-`. */
export function projectSlug(repoPath: string): string {
  return repoPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * The directory a Claude Code project slug stands for, or `undefined`.
 *
 * The slug replaces every character that is not a letter or a digit with `-`, so it cannot be
 * inverted by string work alone: `-Users-x-my-repo` is `/Users/x/my-repo` or `/Users/x/my/repo`
 * or `/Users/x/my_repo`. It can be inverted against the filesystem, though — at each level, the
 * entries whose own slug is a prefix of what remains are the only ways down. One `readdir` per
 * level, the longest matching name tried first so `repo-a` beats `repo` when both exist, and a
 * match that dead-ends backtracks to the next.
 *
 * POSIX paths only: the slug of an absolute path begins with `-`, standing for the root.
 */
export function slugToPath(slug: string): string | undefined {
  if (!slug.startsWith("-") || slug === "-") return undefined;
  return descend("/", slug.slice(1));
}

/** The recursion of {@link slugToPath}: `rest` is the slug still to be matched under `dir`. */
function descend(dir: string, rest: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort((a, b) => b.length - a.length);
  } catch {
    return undefined;
  }
  for (const name of entries) {
    const slug = projectSlug(name);
    if (slug === "") continue;
    const child = path.join(dir, name);
    if (rest === slug) return isDirectory(child) ? child : undefined;
    if (rest.startsWith(`${slug}-`)) {
      const found = descend(child, rest.slice(slug.length + 1));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
