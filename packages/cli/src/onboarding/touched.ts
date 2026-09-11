/**
 * The touched-path scanner and the context inference — docs/contracts/p8/daemon-and-api.md
 * amendments 8 (#105) and 10 (#116, DL-20).
 *
 * Where a session was *started* says where its transcript is stored and where a resume must
 * run, and nothing else: the session is about whatever its content is about, and that is what
 * decides where its checkpoints are filed. What says it is the transcript's tool inputs: every
 * `Read`, `Edit`, `Bash` and `cd` names a path. This module reads a transcript once, front to
 * back, and counts — per candidate root — how many tool inputs named a path under it, how many
 * of those wrote there, and how many were *path inputs*: a non-Bash tool's
 * `file_path`/`path`/`notebook_path`, or a Bash `cd` into the root. The rule that turns the
 * counts into a context repo is {@link meetsRule}: one write, or at least {@link MIN_REFERENCES}
 * references of which at least one is a path input (#110). Bash command text alone — a `grep`
 * that names the root twenty times — never qualifies: the orchestrator's own session in
 * `~/Projects` was attributed to a card repo that way.
 *
 * **Whole transcript versus span (#130).** {@link rankContext} is the rule everyone applies; what
 * differs is how much of the transcript is scored. Discovery, history, the backfill and the repair
 * job score the **whole** file through {@link inferContext} — they describe a finished session, and
 * that is what it was about. The **live Stop hook** scores only the **span since the last
 * checkpoint** (`commands/hook-context.ts`), because that is what its block asks for; a repo the
 * span carries no evidence for is not listed, whatever the bytes before it said.
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
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { configFile } from "../config.js";
import type { IndexDb, TouchCount } from "../index/db.js";

/**
 * A transcript counts for a root at this many references when one of them is a path input
 * (amendment 8, #110), or at one write.
 */
export const MIN_REFERENCES = 5;

/** What one transcript did under one root. */
export interface TouchTally {
  /** Tool inputs naming a path under the root. */
  references: number;
  /** Of those, the ones that wrote under it. */
  writes: number;
  /** Of those, the non-Bash path inputs (`file_path`/`path`/`notebook_path`) and the `cd`s into it. */
  pathInputs: number;
}

/** A tally of nothing. */
export function emptyTally(): TouchTally {
  return { references: 0, writes: 0, pathInputs: 0 };
}

/**
 * The rule: one write under the root, or at least {@link MIN_REFERENCES} references of which at
 * least one is a path input. Bash text mentions alone never attribute.
 */
export function meetsRule(tally: TouchTally): boolean {
  return tally.writes >= 1 || (tally.references >= MIN_REFERENCES && tally.pathInputs >= 1);
}

/** `dir` is strictly below `parent`. Both must already be resolved. */
function below(dir: string, parent: string): boolean {
  return dir !== parent && dir.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
}

/** `file` with symlinks resolved, or as given when it cannot be. */
function realOr(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** A git repo, or an enabled ledger — what a session can be about. */
export function isRepoRoot(dir: string): boolean {
  return existsSync(path.join(dir, ".git")) || existsSync(configFile(dir));
}

/**
 * The nearest repo at or above `dir` ({@link isRepoRoot}), or `undefined`. Not `findRepoRoot`:
 * that one also stops at a bare `.workledger/` directory, and `~/.workledger` is the index
 * home, which would make `~` a repo every session started there is about.
 */
export function repoAbove(dir: string): string | undefined {
  let current = path.resolve(dir);
  for (;;) {
    if (isRepoRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * The repo a session's start directory is inside — the fallback context of amendment 10 — or
 * `undefined` for a start directory outside any repo. `startDir` is a repo root itself (its own
 * `.git`), or lies below the nearest repo above it ({@link repoAbove}). A start directory with
 * no `.git` of its own that holds one of `candidates` is a workspace folder, outside any repo
 * whatever its git ancestors: `~/Projects/dome_workspace` under a `~/Projects` that is itself a
 * repo is where its sessions start, not a corner of `~/Projects`. This is the workspace rule of
 * `discover.ts`, and the one place discovery, the backfill and the Stop hook decide it.
 */
export function startRepoOf(startDir: string, candidates: readonly string[]): string | undefined {
  const start = path.resolve(startDir);
  if (existsSync(path.join(start, ".git"))) return start;
  if (candidates.some((root) => below(path.resolve(root), start))) return undefined;
  return repoAbove(start);
}

/** Whether a session that started in `cwd` started inside a repo — {@link startRepoOf} as a test. */
export function startedInRepo(cwd: string, roots: readonly string[]): boolean {
  return startRepoOf(cwd, roots) !== undefined;
}

/**
 * Whether a tally qualifies a root as a context repo. The full rule ({@link meetsRule}) is for
 * the repo the session started in and for every root of a session started outside any repo — a
 * workspace folder; a root other than the start directory's own repo qualifies only with a
 * write, because reading or `cd`-ing into a sibling project from inside another one is routine
 * (#110; amendment 10: "the write rule stays for roots other than the fallback").
 */
export function attributes(tally: TouchTally, otherRepo: boolean): boolean {
  return otherRepo ? tally.writes >= 1 : meetsRule(tally);
}

/** One context repo of a session: the root and the score that qualified it. */
export interface ContextRepo extends TouchTally {
  /** The candidate root, spelled as the caller gave it. */
  root: string;
  /**
   * `true` when nothing qualified and this is the repo containing the start directory — a
   * session that only talked (amendment 10). Absent for a root the content qualified.
   */
  fallback?: true;
}

/**
 * The context repos a set of tallies implies, best first — the pure half of
 * {@link inferContext}, shared with the Stop hook, which accumulates its tallies across Stops.
 *
 * `startRepo` is the repo containing the start directory as spelled among the tallies' roots,
 * or `undefined` when it is not one of them; `inRepo` says whether the session started inside
 * a repo at all (it did when `startRepo` is given, and may have when it is not: a repo the
 * caller did not ask about). A root qualifies by {@link attributes}; the order is writes, then
 * path inputs, then references — the score of amendment 10 — with the start directory's repo
 * winning a tie and the path deciding the rest. When nothing qualifies, `startRepo` is the one
 * context repo, marked `fallback`; a session with nothing qualifying and no `startRepo` among
 * the roots has no context here at all.
 */
export function rankContext(
  tallies: ReadonlyMap<string, TouchTally>,
  startRepo: string | undefined,
  inRepo: boolean = startRepo !== undefined,
): ContextRepo[] {
  const qualified: ContextRepo[] = [];
  for (const [root, tally] of tallies) {
    if (attributes(tally, inRepo && root !== startRepo)) qualified.push({ root, ...tally });
  }
  qualified.sort(
    (a, b) =>
      b.writes - a.writes ||
      b.pathInputs - a.pathInputs ||
      b.references - a.references ||
      Number(b.root === startRepo) - Number(a.root === startRepo) ||
      a.root.localeCompare(b.root),
  );
  if (qualified.length > 0 || startRepo === undefined) return qualified;
  const own = tallies.get(startRepo);
  return own === undefined ? [] : [{ root: startRepo, ...own, fallback: true }];
}

/** What {@link inferContext} found. */
export interface ContextInference {
  /** The start directory, as given. */
  startDir: string;
  /**
   * The candidate the start directory is inside, spelled as the caller gave it, or `undefined`
   * when the session started outside every candidate — a workspace folder, or a repo the caller
   * did not ask about.
   */
  startRepo: string | undefined;
  /** The context repos, best first; empty only for a workspace session with no evidence. */
  contextRepos: ContextRepo[];
  /** Every candidate's tally, whether or not it qualified. */
  tallies: Map<string, TouchTally>;
}

/**
 * The inference of amendment 10, for one transcript: which of `candidates` the session is about.
 *
 * The transcript is scored against every candidate through the index cache
 * ({@link touchedRoots}), the repo containing `startDir` is found among the candidates by
 * resolved path ({@link startRepoOf}), and {@link rankContext} turns the two into the context
 * repos. Discovery, history, the backfill and the repair job call exactly this — the whole
 * transcript, which is what they are about; the live Stop hook does not: it scans the span since
 * the session's last checkpoint and calls {@link rankContext} on what that span accumulated (#130).
 */
export async function inferContext(
  transcriptPath: string,
  candidates: readonly string[],
  startDir: string,
  io: { db: IndexDb; homeDir: string },
): Promise<ContextInference> {
  const tallies = await touchedRoots(io.db, transcriptPath, candidates, { cwd: startDir, homeDir: io.homeDir });
  const own = startRepoOf(startDir, candidates);
  const ownKey = own === undefined ? undefined : realOr(own);
  const startRepo = ownKey === undefined ? undefined : candidates.find((root) => realOr(root) === ownKey);
  return { startDir, startRepo, contextRepos: rankContext(tallies, startRepo, own !== undefined), tallies };
}

/** What {@link scanTranscript} needs beyond the file. */
export interface ScanOptions {
  /** The session's start directory, when the store knows it; the first recorded cwd otherwise. */
  cwd?: string | undefined;
  /** What `~` expands to in a tool input. */
  homeDir: string;
  /**
   * Byte offset to read from — the workspace Stop hook scans only the bytes since its last scan
   * (`sessions.scan_offset`, `0007_workspaces`). Must sit on a line boundary; a caller that
   * starts mid-file also passes the `cwd` the skipped lines would have established.
   */
  start?: number | undefined;
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
 * gets its own references rather than losing them upward. `roots` may carry two spellings of
 * one root; the caller maps either back to the root.
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

/**
 * `absolute` with symlinks resolved, remembering the answer: a path that is not on disk any
 * more resolves through its directory, and one whose directory is gone too stays as given. The
 * harness records paths as the shell spelled them (`/var/…` on macOS for `/private/var/…`),
 * and a candidate root is compared resolved, so the two spellings must meet somewhere.
 */
function realpathMemo(absolute: string, memo: Map<string, string>): string {
  const known = memo.get(absolute);
  if (known !== undefined) return known;
  let real: string;
  try {
    real = realpathSync(absolute);
  } catch {
    try {
      real = path.join(realpathSync(path.dirname(absolute)), path.basename(absolute));
    } catch {
      real = absolute;
    }
  }
  memo.set(absolute, real);
  return real;
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
  /** Every spelling a root is matched by — resolved and realpath'd — to the root as given. */
  private readonly keys: Map<string, string>;
  private readonly keyList: readonly string[];
  private readonly homeDir: string;
  private readonly real = new Map<string, string>();

  constructor(roots: readonly string[], homeDir: string) {
    this.roots = new Map(roots.map((root) => [root, emptyTally()]));
    this.keys = new Map();
    for (const root of roots) {
      for (const spelling of [path.resolve(root), realOr(root)]) {
        if (!this.keys.has(spelling)) this.keys.set(spelling, root);
      }
    }
    this.keyList = [...this.keys.keys()];
    this.homeDir = homeDir;
  }

  /** The root `absolute` is under, as given, trying its spelling first and its realpath second. */
  private rootFor(absolute: string): string | undefined {
    const direct = rootOf(absolute, this.keyList);
    if (direct !== undefined) return this.keys.get(direct);
    const real = realpathMemo(absolute, this.real);
    if (real === absolute) return undefined;
    const resolved = rootOf(real, this.keyList);
    return resolved === undefined ? undefined : this.keys.get(resolved);
  }

  /**
   * Count one path, resolved against `cwd`. Returns the root it landed in, if any. With
   * `mustExist`, only a path that is on disk counts — the rule for a bare word in a shell
   * command (`ls card-a`), which is a path only when something by that name is there. A
   * `pathInput` is a path the agent named outside shell text: a path-tool input or a `cd`.
   */
  touch(given: string, cwd: string, write: boolean, mustExist = false, pathInput = false): string | undefined {
    const absolute = resolvePath(given, cwd, this.homeDir);
    const root = this.rootFor(absolute);
    if (root === undefined) return undefined;
    if (mustExist && !existsSync(absolute)) return undefined;
    const tally = this.roots.get(root) as TouchTally;
    tally.references += 1;
    if (write) tally.writes += 1;
    if (pathInput) tally.pathInputs += 1;
    return root;
  }

  /** A write with no path of its own — `git commit` — lands where the shell was. */
  writeAt(cwd: string): void {
    const root = this.rootFor(path.resolve(cwd));
    if (root === undefined) return;
    (this.roots.get(root) as TouchTally).writes += 1;
  }

  /**
   * One shell command: every word that looks like a path is a reference, a `cd` moves the
   * working directory for the words after it and is the one shell word that counts as a path
   * input, and a writing segment marks its paths — or, with none, its working directory — as
   * written. Returns the working directory the shell ended in.
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
          this.touch(target, current, false, false, true);
          current = resolvePath(target, current, this.homeDir);
        }
        continue;
      }
      let named = false;
      for (const word of words.slice(start, start === words.length ? start : undefined)) {
        if (word.startsWith("-") || SCHEME.test(word)) continue;
        const candidate = word.includes("=") && !word.startsWith("/") ? (word.split("=").pop() as string) : word;
        // A word with a separator, `~`, `.` or `..` is a path on its face; a bare word after the
        // command (`ls card-a`) is one only when it names something on disk under a candidate.
        const onItsFace =
          candidate.startsWith("/") || candidate.startsWith("~") || candidate === "." || candidate === ".." ||
          candidate.startsWith("./") || candidate.startsWith("../") || (candidate.includes("/") && !candidate.startsWith("."));
        if (!onItsFace && (word === head || candidate.startsWith(".") || !/^[\w][\w.@+-]*$/.test(candidate))) continue;
        if (this.touch(candidate, current, write, !onItsFace) !== undefined) named = true;
      }
      if (write && !named) this.writeAt(current);
    }
    return current;
  }

  /**
   * One tool call by its harness-neutral shape: a tool name and its input object. A path key is
   * a path input; a `pattern`'s literal prefix and a `command`'s words are references only.
   */
  toolCall(name: string, input: Record<string, unknown>, cwd: string): void {
    const write = WRITE_TOOLS.has(name);
    for (const key of PATH_KEYS) {
      const value = input[key];
      if (typeof value === "string" && value !== "") this.touch(value, cwd, write, false, true);
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

  /** A Codex `apply_patch` body: `*** Update File: <path>` and its siblings are writes, and path inputs. */
  patch(text: string, cwd: string): void {
    for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      this.touch((match[1] as string).trim(), cwd, true, false, true);
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
    stream = createReadStream(file, { encoding: "utf8", ...(options.start === undefined ? {} : { start: options.start }) });
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
  const result = new Map<string, TouchTally>(roots.map((root) => [root, emptyTally()]));
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
    const rows: TouchCount[] = kept.map((row) => ({ root: row.root, references: row.references, writes: row.writes, pathInputs: row.pathInputs }));
    for (const [root, tally] of scan.roots) {
      rows.push({ root, ...tally });
      cached.set(root, { transcript_path: file, root, ...tally, mtime_ms: stamp.mtimeMs, size: stamp.size });
    }
    db.replaceTranscriptTouches(file, stamp, rows);
  }
  for (const root of roots) {
    const row = cached.get(root);
    if (row !== undefined) result.set(root, { references: row.references, writes: row.writes, pathInputs: row.pathInputs });
  }
  return result;
}
