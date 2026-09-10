/**
 * The harness stores as the wizard reads them: which repos they hold sessions for, and how many.
 *
 * Metadata only, the P3 rule (plans/feature-p3-data-flow.md §Backfill): a directory name, a
 * `stat`, and the first line of a file. Claude Code names its project directory after the
 * working directory and Codex writes the working directory into its first record, and those two
 * facts are all the discovery step needs. No transcript body is ever read here.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { CLAUDE_STORE, projectSlug, readFirstLine } from "../commands/backfill.js";

/** Where Codex keeps its rollouts, relative to the home directory (hooks-codex.md §Headless resume). */
export const CODEX_STORE = path.join(".codex", "sessions");

/** `YYYY/MM/DD` under {@link CODEX_STORE}: the deepest directory a rollout sits in. */
const CODEX_STORE_DEPTH = 3;

/** One project directory of the Claude Code store, by its metadata. */
export interface ClaudeProject {
  /** The directory name — the slugified working directory. */
  slug: string;
  /** The working directory it stands for, or `undefined` when nothing on disk matches. */
  cwd: string | undefined;
  /** `.jsonl` transcripts in it. */
  sessions: number;
  /** Newest transcript mtime, ms since epoch; `0` for an empty directory. */
  newestMs: number;
}

/** One Codex rollout, by its metadata and its `session_meta` record. */
export interface CodexSession {
  file: string;
  bytes: number;
  mtimeMs: number;
  /** `session_meta.payload.cwd`, or `null` when the first record does not carry one. */
  cwd: string | null;
}

/**
 * The directory a Claude Code project slug stands for, or `undefined`.
 *
 * The slug replaces every character that is not a letter or a digit with `-` (`projectSlug`), so
 * it cannot be inverted by string work alone: `-Users-x-my-repo` is `/Users/x/my-repo` or
 * `/Users/x/my/repo` or `/Users/x/my_repo`. It can be inverted against the filesystem, though —
 * at each level, the entries whose own slug is a prefix of what remains are the only ways down.
 * One `readdir` per level, the longest matching name tried first so `repo-a` beats `repo` when
 * both exist, and a match that dead-ends backtracks to the next.
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

/** `true` for a directory, following symlinks; `false` for anything else or nothing. */
export function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** Every project directory in `<homeDir>/.claude/projects`, resolved to the path it names. */
export function claudeProjects(homeDir: string): ClaudeProject[] {
  const store = path.join(homeDir, CLAUDE_STORE);
  let slugs: string[];
  try {
    slugs = readdirSync(store, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const projects: ClaudeProject[] = [];
  for (const slug of slugs) {
    const dir = path.join(store, slug);
    let sessions = 0;
    let newestMs = 0;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      try {
        const stat = statSync(path.join(dir, name));
        if (!stat.isFile() || stat.size === 0) continue;
        sessions += 1;
        newestMs = Math.max(newestMs, stat.mtimeMs);
      } catch {
        continue;
      }
    }
    projects.push({ slug, cwd: slugToPath(slug), sessions, newestMs });
  }
  return projects;
}

/**
 * The `cwd` of a rollout's `session_meta` record.
 *
 * The first line of `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` is
 * `{ "type": "session_meta", "payload": { "cwd": …, "timestamp": … } }` (hooks-codex.md). A file
 * whose first line is anything else yields `null`, and is counted for no repo.
 */
export function codexCwd(file: string): string | null {
  const line = readFirstLine(file);
  if (line === undefined) return null;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed["type"] !== "session_meta") return null;
    const payload = parsed["payload"];
    if (typeof payload !== "object" || payload === null) return null;
    const cwd = (payload as Record<string, unknown>)["cwd"];
    return typeof cwd === "string" && cwd !== "" ? cwd : null;
  } catch {
    return null;
  }
}

/** Every rollout in `<homeDir>/.codex/sessions`, at most three directories deep. */
export function codexSessions(homeDir: string): CodexSession[] {
  const found: CodexSession[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < CODEX_STORE_DEPTH) walk(child, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      let stat;
      try {
        stat = statSync(child);
      } catch {
        continue;
      }
      if (stat.size === 0) continue;
      found.push({ file: child, bytes: stat.size, mtimeMs: stat.mtimeMs, cwd: codexCwd(child) });
    }
  };
  walk(path.join(homeDir, CODEX_STORE), 0);
  return found;
}
