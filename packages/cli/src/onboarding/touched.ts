/**
 * The touched-path scanner — docs/contracts/p8/daemon-and-api.md amendment 8 (#105).
 *
 * A session started in a workspace folder (`~/Projects/dome_workspace`, itself not a repo) does
 * its work in the repos below it, and nothing about where it *started* says which. What does say
 * is the transcript's tool inputs: every `Read`, `Edit`, `Bash` and `cd` names a path. This
 * module reads a transcript once, front to back, and counts — per candidate root — how many tool
 * inputs named a path under it and how many of those wrote there. The rule that turns the counts
 * into an attribution is {@link meetsRule}: at least {@link MIN_REFERENCES} references, or one
 * write.
 *
 * Two constraints shape the reading:
 *
 * - **Streaming.** Transcripts run to 20 MB with single lines near 1 MB (a tool result). The file
 *   is read line by line through `readline`; only the lines that can carry a tool call are parsed
 *   as JSON, and nothing but the counts survives a line.
 * - **Inputs only.** Tool *results* are not read: a `cat` of a file that mentions a repo a
 *   thousand times is not a thousand references. A user prompt is not read either. Only what the
 *   agent asked a tool to do counts, which is also the only text that names paths on purpose.
 *
 * Nothing read here is written anywhere but the per-root counts in `transcript_touches` (via
 * {@link touchedRoots}), keyed by the file's mtime and size so an unchanged transcript is never
 * scanned twice. Transcript excerpts never enter the repo or the index (CLAUDE.md).
 */
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import type { IndexDb, TouchCount } from "../index/db.js";

/** A transcript counts for a root at this many references (amendment 8), or at one write. */
export const MIN_REFERENCES = 5;

/** What one transcript did under one root. */
export interface TouchTally {
  /** Tool inputs naming a path under the root. */
  refs: number;
  /** Of those, the ones that wrote under it. */
  writes: number;
}

/** The rule: "references that root at least 5 times or has one write under it". */
export function meetsRule(tally: TouchTally): boolean {
  return tally.refs >= MIN_REFERENCES || tally.writes >= 1;
}

/** What {@link scanTranscript} needs beyond the file. */
export interface ScanOptions {
  /** The session's start directory, when the store knows it; the first recorded cwd otherwise. */
  cwd?: string | undefined;
  /** What `~` expands to in a tool input. */
  homeDir: string;
}

/** What one scan found. */
export interface TranscriptScan {
  /** One tally per candidate root, keyed by the root as given. Every root asked is present. */
  roots: Map<string, TouchTally>;
  /** The first working directory the transcript recorded, or `undefined` when it recorded none. */
  cwd: string | undefined;
}

/** Tools whose named path is written. `MultiEdit` is the older batch form of `Edit`. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Input keys that carry one path. */
const PATH_KEYS = ["file_path", "notebook_path", "path"] as const;

/** A shell segment that writes: a redirection, `tee`, or a `git commit` (amendment 8, #105). */
const SHELL_WRITE = /(?:^|[^<>&\d])>(?!&)|\btee\b|\bgit\s+commit\b/;

/** Where one shell command splits into segments: separators and newlines. */
const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\||\n)\s*/;

/** A word that is a URL or a scheme, never a path. */
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Where a path lands among the candidate roots: the deepest root it is under, or `undefined`.
 * Deepest, so a repo nested under another candidate (a `~/Projects` that is itself a git repo)
 * gets its own references rather than losing them upward.
 */
function rootOf(absolute: string, roots: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    if (absolute === root || absolute.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`)) {
      if (best === undefined || root.length > best.length) best = root;
    }
  }
  return best;
}

/** `~` and `~/x` expanded, a relative path resolved against `cwd`, everything normalized. */
function resolvePath(given: string, cwd: string, homeDir: string): string {
  if (given === "~") return homeDir;
  if (given.startsWith("~/")) return path.join(homeDir, given.slice(2));
  return path.resolve(cwd, given);
}

/** The tallies, with one entry per root from the start so an untouched root reads as zero. */
class Tallies {
  readonly roots: Map<string, TouchTally>;
  private readonly keys: readonly string[];
  private readonly homeDir: string;

  constructor(roots: readonly string[], homeDir: string) {
    this.keys = roots.map((root) => path.resolve(root));
    this.roots = new Map(roots.map((root) => [root, { refs: 0, writes: 0 }]));
    this.homeDir = homeDir;
  }

  /** Count one path, resolved against `cwd`. Returns the root it landed in, if any. */
  touch(given: string, cwd: string, write: boolean): string | undefined {
    const absolute = resolvePath(given, cwd, this.homeDir);
    const key = rootOf(absolute, this.keys);
    if (key === undefined) return undefined;
    const root = [...this.roots.keys()][this.keys.indexOf(key)] as string;
    const tally = this.roots.get(root) as TouchTally;
    tally.refs += 1;
    if (write) tally.writes += 1;
    return root;
  }

  /** A write with no path of its own — `git commit` — lands where the shell was. */
  writeAt(cwd: string): void {
    const key = rootOf(path.resolve(cwd), this.keys);
    if (key === undefined) return;
    const root = [...this.roots.keys()][this.keys.indexOf(key)] as string;
    (this.roots.get(root) as TouchTally).writes += 1;
  }

  /**
   * One shell command: every word that looks like a path is a reference, a `cd` moves the
   * working directory for the words after it, and a writing segment marks its paths — or, with
   * none, its working directory — as written. Returns the working directory the shell ended in.
   */
  shell(command: string, cwd: string): string {
    let current = cwd;
    for (const segment of command.split(SEGMENT_SPLIT)) {
      const words = segment
        .split(/\s+/)
        .map((word) => word.replace(/^["'`(]+|["'`),:]+$/g, ""))
        .filter((word) => word !== "");
      // Leading `FOO=bar` assignments are not the command.
      let start = 0;
      while (start < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start] as string)) start += 1;
      const write = SHELL_WRITE.test(segment);
      const head = words[start];
      if (head === "cd") {
        const target = words[start + 1];
        if (target === undefined || target === "~") current = this.homeDir;
        else if (target !== "-") {
          this.touch(target, current, false);
          current = resolvePath(target, current, this.homeDir);
        }
        continue;
      }
      let named = false;
      for (const word of words.slice(start)) {
        if (word.startsWith("-") || SCHEME.test(word)) continue;
        const candidate = word.includes("=") && !word.startsWith("/") ? (word.split("=").pop() as string) : word;
        if (!(candidate.startsWith("/") || candidate.startsWith("~") || candidate.startsWith(".") || candidate.includes("/"))) continue;
        if (candidate.startsWith(".") && candidate !== "." && candidate !== ".." && !candidate.startsWith("./") && !candidate.startsWith("../")) continue;
        if (this.touch(candidate, current, write) !== undefined) named = true;
      }
      if (write && !named) this.writeAt(current);
    }
    return current;
  }

  /** One tool call by its harness-neutral shape: a tool name and its input object. */
  toolCall(name: string, input: Record<string, unknown>, cwd: string): void {
    const write = WRITE_TOOLS.has(name);
    for (const key of PATH_KEYS) {
      const value = input[key];
      if (typeof value === "string" && value !== "") this.touch(value, cwd, write);
    }
    const pattern = input["pattern"];
    if (typeof pattern === "string" && pattern.startsWith("/")) {
      // The literal prefix of an absolute glob: `/repo/src/**/*.ts` names `/repo/src`.
      const literal = pattern.split(/[*?[{]/, 1)[0] as string;
      this.touch(literal.endsWith("/") ? literal.slice(0, -1) : path.dirname(literal), cwd, false);
    }
    const command = input["command"];
    if (typeof command === "string" && command !== "") this.shell(command, cwd);
  }

  /** A Codex `apply_patch` body: `*** Update File: <path>` and its siblings are writes. */
  patch(text: string, cwd: string): void {
    for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      this.touch((match[1] as string).trim(), cwd, true);
    }
  }
}

/**
 * A Codex `command` as one shell string: `["bash", "-lc", "<script>"]` is the script itself —
 * the shell wrapper would otherwise hide a leading `cd` behind the word `bash` — and any other
 * argv is its words joined.
 */
function commandText(command: unknown): string | undefined {
  if (typeof command === "string") return command;
  if (!Array.isArray(command)) return undefined;
  const words = command.map(String);
  if (words.length >= 3 && /^-l?c$/.test(words[1] as string)) return words.slice(2).join(" ");
  return words.join(" ");
}

/** A JSON object, or `undefined` for anything else (including a parse failure). */
function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The `"cwd":"…"` of a record without parsing the whole line — the line may be a 1 MB tool result. */
const CWD_FIELD = /"cwd":"((?:[^"\\]|\\.)*)"/;

/** A record's cwd, decoded, or `undefined`. */
function cwdOf(line: string): string | undefined {
  const match = CWD_FIELD.exec(line);
  if (match === null) return undefined;
  try {
    return JSON.parse(`"${match[1] as string}"`) as string;
  } catch {
    return undefined;
  }
}

/** Claude Code: `{ type: "assistant", cwd, message: { content: [{ type: "tool_use", name, input }] } }`. */
function claudeLine(line: string, tallies: Tallies, cwd: string): void {
  const record = parseObject(line);
  if (record === undefined) return;
  const message = record["message"];
  if (message === null || typeof message !== "object") return;
  const content = (message as Record<string, unknown>)["content"];
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (item === null || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (block["type"] !== "tool_use" || typeof block["name"] !== "string") continue;
    const input = block["input"];
    if (input === null || typeof input !== "object") continue;
    tallies.toolCall(block["name"], input as Record<string, unknown>, cwd);
  }
}

/** The `exec_command({...})` object inside a Codex `exec` tool's JavaScript input. */
const EXEC_COMMAND = /exec_command\((\{[\s\S]*\})\)/;

/**
 * Codex: `{ type: "response_item", payload: { type: "function_call" | "custom_tool_call", … } }`.
 * A `function_call` carries `arguments` as a JSON string (`command`, `workdir`); a
 * `custom_tool_call` named `exec` carries a JavaScript `input` around an `exec_command({ cmd,
 * workdir })` object, and one named `apply_patch` carries the patch text.
 */
function codexLine(line: string, tallies: Tallies, cwd: string): void {
  const record = parseObject(line);
  const payload = record?.["payload"];
  if (payload === null || typeof payload !== "object") return;
  const item = payload as Record<string, unknown>;
  const kind = item["type"];
  if (kind === "function_call") {
    const args = typeof item["arguments"] === "string" ? parseObject(item["arguments"]) : undefined;
    if (args === undefined) return;
    const workdir = typeof args["workdir"] === "string" ? args["workdir"] : cwd;
    const text = commandText(args["command"] ?? args["cmd"]);
    if (item["name"] === "apply_patch" && typeof args["input"] === "string") tallies.patch(args["input"], workdir);
    else if (text !== undefined) tallies.shell(text, workdir);
    else tallies.toolCall(String(item["name"] ?? ""), args, workdir);
    return;
  }
  if (kind !== "custom_tool_call" || typeof item["input"] !== "string") return;
  const input = item["input"];
  if (item["name"] === "apply_patch") {
    tallies.patch(input, cwd);
    return;
  }
  const match = EXEC_COMMAND.exec(input);
  const call = match === null ? undefined : parseObject(match[1] as string);
  if (call === undefined) {
    tallies.shell(input, cwd);
    return;
  }
  const workdir = typeof call["workdir"] === "string" ? call["workdir"] : cwd;
  const cmd = commandText(call["cmd"] ?? call["command"]);
  if (cmd !== undefined) tallies.shell(cmd, workdir);
}

/**
 * Read one transcript and tally its references per candidate root.
 *
 * Both harness formats are recognized on the same pass — a line says which it is — so the caller
 * never has to. A file that cannot be opened, or a line that is not JSON, contributes nothing;
 * the scan never throws over a transcript's content.
 */
export async function scanTranscript(
  file: string,
  roots: readonly string[],
  options: ScanOptions,
): Promise<TranscriptScan> {
  const tallies = new Tallies(roots, options.homeDir);
  let recorded: string | undefined;
  let cwd = options.cwd;

  let stream;
  try {
    stream = createReadStream(file, { encoding: "utf8" });
  } catch {
    return { roots: tallies.roots, cwd: recorded };
  }
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.includes('"session_meta"') || line.includes('"turn_context"')) {
        const seen = cwdOf(line);
        if (seen !== undefined) {
          recorded ??= seen;
          cwd = seen;
        }
        continue;
      }
      if (line.includes('"response_item"')) {
        if (!line.includes('"function_call"') && !line.includes('"custom_tool_call"')) continue;
        if (line.includes('"custom_tool_call_output"') || line.includes('"function_call_output"')) continue;
        codexLine(line, tallies, cwd ?? options.homeDir);
        continue;
      }
      const seen = cwdOf(line);
      if (seen !== undefined) {
        recorded ??= seen;
        cwd = seen;
      }
      if (!line.includes('"tool_use"')) continue;
      claudeLine(line, tallies, cwd ?? options.homeDir);
    }
  } catch {
    // A read error mid-file: what was tallied so far stands, and the file is not retried here.
  } finally {
    lines.close();
    stream.destroy();
  }
  return { roots: tallies.roots, cwd: recorded };
}

/**
 * {@link scanTranscript} through the index's `transcript_touches` cache.
 *
 * A row per (transcript, root) at the file's current mtime and size answers without a read; the
 * roots with no such row are scanned in one pass and added beside the rows that were kept. Rows
 * from a different mtime or size are stale — the file has grown, as a live session's does — and
 * every root asked is scanned again. A file that cannot be stat'd yields zero for every root and
 * caches nothing.
 */
export async function touchedRoots(
  db: IndexDb,
  file: string,
  roots: readonly string[],
  options: ScanOptions,
): Promise<Map<string, TouchTally>> {
  const result = new Map<string, TouchTally>(roots.map((root) => [root, { refs: 0, writes: 0 }]));
  let stamp: { mtimeMs: number; size: number };
  try {
    const stat = statSync(file);
    stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return result;
  }

  const kept = db
    .listTranscriptTouches(file)
    .filter((row) => row.mtime_ms === stamp.mtimeMs && row.size === stamp.size);
  const cached = new Map(kept.map((row) => [row.root, row]));
  const missing = roots.filter((root) => !cached.has(root));
  if (missing.length > 0) {
    const scan = await scanTranscript(file, missing, options);
    const rows: TouchCount[] = kept.map((row) => ({ root: row.root, refs: row.refs, writes: row.writes }));
    for (const [root, tally] of scan.roots) {
      rows.push({ root, ...tally });
      cached.set(root, { transcript_path: file, root, ...tally, mtime_ms: stamp.mtimeMs, size: stamp.size });
    }
    db.replaceTranscriptTouches(file, stamp, rows);
  }
  for (const root of roots) {
    const row = cached.get(root);
    if (row !== undefined) result.set(root, { refs: row.refs, writes: row.writes });
  }
  return result;
}
