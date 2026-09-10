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

import { CLAUDE_STORE, firstRecord, readFirstLine } from "../commands/backfill.js";
import { isDirectory, slugToPath } from "./session-cwd.js";

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
export interface CodexSession extends CodexMeta {
  file: string;
  bytes: number;
  mtimeMs: number;
}

/** What the first record of a rollout says about the session; each `null` when it does not say. */
export interface CodexMeta {
  /** `session_meta.payload.cwd`. */
  cwd: string | null;
  /** `session_meta.payload.id` — the id `codex exec resume` takes. */
  id: string | null;
  /** `session_meta.payload.timestamp`, when it parses as a date. */
  startedIso: string | null;
}

// Moved to `./session-cwd.ts` (#105 review) so `commands/backfill.ts` can invert slugs without a
// cycle; re-exported so the one import path the tests and `discover.ts` use stays.
export { isDirectory, slugToPath } from "./session-cwd.js";

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

/** One Claude Code transcript, by its metadata: the shape the touched-path attribution scans. */
export interface ClaudeTranscript {
  /** The filename without `.jsonl` — the id `claude --resume` takes. */
  harnessSessionId: string;
  file: string;
  bytes: number;
  mtimeMs: number;
  /**
   * Where the session was started: the first record that carries a `cwd` (#114), else the
   * project slug inverted against the filesystem — a slug is ambiguous (`repo/src` and
   * `repo-src` share one), so the record decides when it can; `undefined` when neither names a
   * directory that exists.
   */
  cwd: string | undefined;
  /** The first record's `timestamp`, or `null`. */
  startedIso: string | null;
}

/**
 * Every transcript in `<homeDir>/.claude/projects`, across every project directory, with the
 * directory it was started in. Metadata and a first line only, like {@link claudeProjects}; the
 * body is left to `touched.ts`, which reads it once and keeps counts.
 */
export function claudeTranscripts(homeDir: string): ClaudeTranscript[] {
  const store = path.join(homeDir, CLAUDE_STORE);
  let slugs: string[];
  try {
    slugs = readdirSync(store, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const transcripts: ClaudeTranscript[] = [];
  for (const slug of slugs) {
    const dir = path.join(store, slug);
    const fromSlug = slugToPath(slug);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(dir, name);
      let stat;
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size === 0) continue;
      const first = firstRecord(file);
      const cwd = first.cwd !== null && isDirectory(first.cwd) ? first.cwd : fromSlug;
      transcripts.push({
        harnessSessionId: name.slice(0, -".jsonl".length),
        file,
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        cwd,
        startedIso: first.startedIso,
      });
    }
  }
  return transcripts;
}

/**
 * The `cwd`, `id` and `timestamp` of a rollout's `session_meta` record.
 *
 * The first line of `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` is
 * `{ "type": "session_meta", "payload": { "id": …, "cwd": …, "timestamp": … } }` (hooks-codex.md).
 * A file whose first line is anything else yields three `null`s, and is counted for no repo.
 */
export function codexMeta(file: string): CodexMeta {
  const none: CodexMeta = { cwd: null, id: null, startedIso: null };
  const line = readFirstLine(file);
  if (line === undefined) return none;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed["type"] !== "session_meta") return none;
    const payload = parsed["payload"];
    if (typeof payload !== "object" || payload === null) return none;
    const text = (key: string): string | null => {
      const value = (payload as Record<string, unknown>)[key];
      return typeof value === "string" && value !== "" ? value : null;
    };
    const at = text("timestamp");
    return {
      cwd: text("cwd"),
      id: text("id"),
      startedIso: at !== null && !Number.isNaN(Date.parse(at)) ? at : null,
    };
  } catch {
    return none;
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
      found.push({ file: child, bytes: stat.size, mtimeMs: stat.mtimeMs, ...codexMeta(child) });
    }
  };
  walk(path.join(homeDir, CODEX_STORE), 0);
  return found;
}
