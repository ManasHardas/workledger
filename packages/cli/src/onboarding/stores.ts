/**
 * The harness stores as the wizard reads them: which repos they hold sessions for, and how many.
 *
 * Metadata only, the P3 rule (plans/feature-p3-data-flow.md §Backfill): a directory name, a
 * `stat`, and the first line of a file. Claude Code names its project directory after the
 * working directory and Codex writes the working directory into its first record, and those two
 * facts are all the discovery step needs. No transcript body is ever read here.
 */
import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type Database from "better-sqlite3";

import { CLAUDE_STORE, firstRecord, readFirstLine } from "../commands/backfill.js";
import { isDirectory, slugToPath } from "./session-cwd.js";

/**
 * `better-sqlite3` through `createRequire`, like `index/db.ts`: it is a native addon esbuild
 * cannot inline, and a static import would put it in the eager graph of every command that
 * reaches this module.
 */
const nodeRequire = createRequire(import.meta.url);
let DatabaseCtor: typeof Database | undefined;
function databaseConstructor(): typeof Database {
  DatabaseCtor ??= nodeRequire("better-sqlite3") as typeof Database;
  return DatabaseCtor;
}

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

// ---------------------------------------------------------------------------
// OpenCode — a SQLite store, not a directory of transcripts
// ---------------------------------------------------------------------------

/**
 * Where OpenCode keeps its data, relative to the home directory (opencode 1.18.x).
 *
 * Unlike the other three harnesses, OpenCode has no per-session JSONL transcript: sessions,
 * messages and parts live in one SQLite database, `opencode.db`, in WAL mode. This enumeration
 * opens it **read-only** and never migrates it; a store it cannot open reads as no sessions.
 */
export const OPENCODE_STORE = path.join(".local", "share", "opencode");

/** The SQLite database OpenCode writes sessions and message parts into. */
export const OPENCODE_DB = "opencode.db";

/**
 * One tool call of an OpenCode session, normalized to the harness-neutral shape `touched.ts`
 * reads: OpenCode's tool names are lower-case (`write`, `read`, `bash`) and its path argument is
 * `filePath`, where the scanner expects `Write`/`file_path`.
 */
export interface OpencodeToolCall {
  name: string;
  input: Record<string, unknown>;
  cwd: string;
}

/** One OpenCode session, by its metadata and the tool calls its parts carry. */
export interface OpencodeSession {
  /** `session.id` — the `ses_…` id `opencode run --session` resumes. */
  harnessSessionId: string;
  /** The SQLite database path; there is no per-session transcript file. */
  file: string;
  /** Synthetic: the summed byte length of the session's tool parts. */
  bytes: number;
  /** `session.time_updated`, ms since epoch. */
  mtimeMs: number;
  /** `session.directory`, where the session was started. */
  cwd: string;
  /** `session.time_created`, ISO 8601. */
  startedIso: string | null;
  /** The parent session id when this is a subagent session, else `null`. */
  parentId: string | null;
  title: string;
  toolCalls: OpencodeToolCall[];
}

/** A one-level normalized tool call, or `undefined` for a tool that names no path. */
function normalizeOpencodeCall(tool: unknown, input: unknown, cwd: string): OpencodeToolCall | undefined {
  if (typeof tool !== "string" || input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const args = input as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof args[key] === "string" && args[key] !== "" ? (args[key] as string) : undefined;
  switch (tool) {
    case "write":
    case "edit":
    case "multiedit": {
      const file = text("filePath") ?? text("path");
      return file === undefined ? undefined : { name: "Write", input: { file_path: file }, cwd };
    }
    case "read":
    case "list":
    case "ls": {
      const file = text("filePath") ?? text("path");
      return file === undefined ? undefined : { name: "Read", input: { file_path: file }, cwd };
    }
    case "bash": {
      const command = text("command");
      return command === undefined ? undefined : { name: "Bash", input: { command }, cwd };
    }
    case "grep":
    case "glob": {
      const normalized: Record<string, unknown> = {};
      const pattern = text("pattern");
      if (pattern !== undefined) normalized["pattern"] = pattern;
      const dir = text("path");
      if (dir !== undefined) normalized["path"] = dir;
      return { name: "Grep", input: normalized, cwd };
    }
    default:
      return undefined;
  }
}

/**
 * Every session in `<homeDir>/.local/share/opencode/opencode.db`, with the tool calls its parts
 * carry. Metadata and tool inputs only — assistant text and reasoning are never read here.
 *
 * `parent_id` marks a subagent's child session; those are returned too (the caller decides
 * whether to record them), but they are not what a repo's history is about.
 */
export function opencodeSessions(homeDir: string): OpencodeSession[] {
  const file = path.join(homeDir, OPENCODE_STORE, OPENCODE_DB);
  let db: Database.Database;
  try {
    db = new (databaseConstructor())(file, { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }
  try {
    const sessions = db
      .prepare("SELECT id, directory, parent_id, title, time_created, time_updated FROM session")
      .all() as Array<{
      id: unknown;
      directory: unknown;
      parent_id: unknown;
      title: unknown;
      time_created: unknown;
      time_updated: unknown;
    }>;
    const parts = db
      .prepare("SELECT session_id, data FROM part WHERE json_extract(data, '$.type') = 'tool'")
      .all() as Array<{ session_id: unknown; data: unknown }>;

    const bySession = new Map<string, { bytes: number; calls: OpencodeToolCall[] }>();
    for (const row of parts) {
      if (typeof row.session_id !== "string" || typeof row.data !== "string") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data) as unknown;
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== "object") continue;
      const record = parsed as Record<string, unknown>;
      const state = record["state"];
      const input = state !== null && typeof state === "object" ? (state as Record<string, unknown>)["input"] : undefined;
      const entry = bySession.get(row.session_id) ?? { bytes: 0, calls: [] };
      entry.bytes += row.data.length;
      // The cwd is the session directory; patched onto every call below, where it is known.
      const call = normalizeOpencodeCall(record["tool"], input, "");
      if (call !== undefined) entry.calls.push(call);
      bySession.set(row.session_id, entry);
    }

    const found: OpencodeSession[] = [];
    for (const session of sessions) {
      if (typeof session.id !== "string" || typeof session.directory !== "string" || session.directory === "") {
        continue;
      }
      const meta = bySession.get(session.id);
      found.push({
        harnessSessionId: session.id,
        file,
        bytes: meta?.bytes ?? 0,
        mtimeMs: typeof session.time_updated === "number" ? session.time_updated : 0,
        cwd: session.directory,
        startedIso:
          typeof session.time_created === "number" ? new Date(session.time_created).toISOString() : null,
        parentId: typeof session.parent_id === "string" ? session.parent_id : null,
        title: typeof session.title === "string" ? session.title : "",
        toolCalls: (meta?.calls ?? []).map((call) => ({ ...call, cwd: session.directory as string })),
      });
    }
    return found;
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // A close failure on a read-only handle is not worth reporting.
    }
  }
}
