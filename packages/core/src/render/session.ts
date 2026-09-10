/**
 * Rendering and parsing of `.workledger/sessions/<ulid>.md`.
 *
 * The session digest is the one ledger file a human reads top to bottom, so its body is plain
 * markdown — but it is also the input to the brief and to P2's UI, which must not run regular
 * expressions over agent prose to find out what a line means. {@link parseSessionText} is the
 * answer to both: every line the renderer emits comes back out as a record with its checkpoint
 * number, its backlog reference, and its evidence already separated from the prose.
 *
 * ## Line forms (design spec §4.1, `session-frontmatter.schema.json` §`x-body`)
 *
 * ```text
 * ## Goal
 * - [cp 2] Ship the upload size limit
 *
 * ## Done
 * - [cp 2] Buyers can now check out from the cart on their phone
 *   detail: Checkout control is the link itself · commit: a1b2c3d · files: src/cart/checkout.ts · verified: tests-passed
 *
 * ## Remaining
 * - [cp 2] → WL-01J9… (new) Add a size limit before upload; why: server rejects >50 MB silently
 *
 * ## Notes
 * - decision [cp 2] by human: Keep uploads synchronous; reason: the async path needs the queue work
 *
 * ## Memory
 * - [cp 2] gh needs the ManasHardas token prefix file: ~/.claude/projects/-Users-x/memory/MEMORY.md
 * ```
 *
 * **P8 amendment 11 (2026-09-10).** A Done line is the *gist* for humans; everything else —
 * `detail`, `commit`, `files`, `verified`, in that order — goes on one indented continuation
 * line below it, so a human reads outcomes and an agent reads the specifics. Files written
 * before the amendment carry the evidence inline (`<text> files: … · commit: … · verified: …`)
 * and still parse: the inline form is read whenever a line carries it, and a continuation is read
 * whenever the next line is indented. `## Memory` is the fifth section, chronological like Notes;
 * a file without it parses as having none.
 *
 * Three readings the spec leaves open, resolved here in favour of a parse that never has to
 * guess where prose ends (each is asserted by a golden file):
 *
 * 1. **Goal carries `[cp n]` like every other line.** Spec §4.1 and data-flow §4 both say "every
 *    line carries `[cp n]`", and the goal is explicitly "revised if it changes" — so which
 *    checkpoint last set it is exactly the fact worth keeping. The Goal section holds a single
 *    line, replaced rather than appended.
 * 2. **Done and Remaining are newest-checkpoint-first; Notes are chronological.** The §4.1 example
 *    shows `[cp 2]` above `[cp 1]` under Done and Remaining, and `[cp 1]` above `[cp 2]` under
 *    Notes. Done and Remaining answer "where does this stand now", so the newest block goes on
 *    top; Notes are a log, so they grow downward. Within one checkpoint, payload order is kept.
 * 3. **`why` is always rendered; `blocked_by` is rendered only when the payload carries the key.**
 *    `why` is required by `RemainingItem`, so a Remaining line always ends with `; why: …`.
 *    `blocked_by` is optional: an absent key renders nothing, and a present-but-empty list
 *    renders `; blocked_by: none` — which is how the §4.1 example's third line reads.
 *
 * Attribute runs are consumed right to left over a closed set of keys, and a key is only consumed
 * when its value is plausible for that key, so the prose that precedes them is whatever the known
 * keys did not claim rather than something matched by a pattern.
 *
 * A line that matches none of the forms — a hand-typed entry, prose left under a heading — is
 * neither guessed at nor deleted: it surfaces in {@link ParsedSession.unparsed} and is re-emitted
 * verbatim at the foot of its own section.
 *
 * Two other ways the file that comes back is not byte-for-byte the file a human wrote, both
 * deliberate and both content-preserving: blank lines *inside* a known section are structural and
 * are decided by the renderer, and a block under a heading this build does not know is re-emitted
 * below `## Notes` rather than wherever it sat.
 *
 * ## Cost
 *
 * `appendCheckpoint` re-parses and re-stringifies the whole file, so one append is linear in file
 * size and a session's appends are quadratic *cumulatively* — the frontmatter's `checkpoints[]`
 * array is re-emitted every time and nothing caps it. One CLI process does one append, so the
 * quadratic term is never paid by a single invocation. Measured on the host (Node 25.9.0) at 2
 * done / 2 remaining / 2 notes per checkpoint: 2.0 ms at 50 checkpoints, **6.7 ms at 200
 * checkpoints** (101 KB, 2,226 lines; ~0.7% of the §6 `checkpoint < 1 s` budget), 17.2 ms at 500.
 * At 500 checkpoints `checkpoints[]` is 44% of the file — past that, a reader is in territory
 * nobody has measured.
 *
 * This module is pure: no Node built-ins, no clock, no id minting. The caller supplies the stamp
 * and the resolved backlog ids.
 */
import {
  type Checkpoint,
  type CheckpointPayload,
  type DoneItem,
  type Note,
  type NoteBy,
  type MemoryItem,
  type NoteType,
  type RemainingItem,
  type SessionFrontmatter,
  type Verified,
  Checkpoint as CheckpointSchema,
  CheckpointPayload as CheckpointPayloadSchema,
  NOTE_TYPES,
  NOTE_BY,
  SessionFrontmatter as SessionFrontmatterSchema,
  VERIFIED,
  requiresGoal,
} from "../schema.js";
import { parseFrontmatter, stringifyFrontmatter } from "../frontmatter.js";
import { BACKLOG_ID_PATTERN } from "../ids.js";
import {
  ATTR_SEPARATOR,
  REF_ARROW,
  RenderError,
  cpTag,
  documentError,
  oneLine,
  readAttribute,
  readCpPrefix,
  splitList,
  validate,
} from "./common.js";

/** The five body headings, in the order the renderer emits them (`x-body.sections`). */
export const SESSION_SECTIONS = ["## Goal", "## Done", "## Remaining", "## Notes", "## Memory"] as const;

const GOAL_HEADING = SESSION_SECTIONS[0];
const DONE_HEADING = SESSION_SECTIONS[1];
const REMAINING_HEADING = SESSION_SECTIONS[2];
const NOTES_HEADING = SESSION_SECTIONS[3];
const MEMORY_HEADING = SESSION_SECTIONS[4];

/** Evidence keys of a pre-amendment-11 inline Done line, in the order they were emitted. */
const DONE_KEYS = ["files", "commit", "verified"] as const;
/** Keys of a Done continuation line, in the order they are emitted (amendment 11). */
const CONTINUATION_KEYS = ["detail", "commit", "files", "verified"] as const;
/** The indent that marks a Done continuation line. */
const CONTINUATION_INDENT = "  ";
/** The one trailing key of a Memory line. */
const MEMORY_FILE_KEY = "file";
/** Trailing keys of a Remaining line, in the order they are emitted. */
const REMAINING_KEYS = ["why", "blocked_by"] as const;
/** Separator between a Remaining line's text and its trailing keys. */
const REMAINING_SEPARATOR = "; ";
/** Rendered for a `blocked_by` key that is present but empty. */
const NO_BLOCKERS = "none";

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const REMAINING_HEAD = new RegExp(`^${REF_ARROW} (\\S+) \\((new|updates|closes)\\) `);
const NOTE_HEAD = new RegExp(
  `^- (${NOTE_TYPES.join("|")}) \\[cp (\\d+)\\](?: by (${NOTE_BY.join("|")}))?: `,
);

// ---------------------------------------------------------------------------
// Parsed line records
// ---------------------------------------------------------------------------

/** Fields every rendered body line carries. */
export interface SessionLine {
  /** The checkpoint that produced the line — its transcript span (data-flow §4). */
  cp: number;
  /** The line exactly as it appears in the file, so an append never rewrites it. */
  raw: string;
}

/** A `## Goal` line. The section holds at most one after a render. */
export interface GoalLine extends SessionLine {
  text: string;
}

/**
 * A `## Done` line with its evidence split off the prose. `raw` spans both lines when the entry
 * carries a continuation (amendment 11), so a re-emit keeps the pair together.
 */
export interface DoneLine extends SessionLine {
  /** The gist for humans. */
  text: string;
  /** The specifics for agents, from the continuation line; absent on pre-amendment lines. */
  detail?: string;
  files: string[];
  commit?: string;
  verified?: Verified;
}

/** A `## Memory` line: one fact the session saved to a memory file (amendment 11). */
export interface MemoryLine extends SessionLine {
  text: string;
  file?: string;
}

/** A `## Remaining` line with its backlog reference split off the prose. */
export interface RemainingLine extends SessionLine {
  /** The backlog id the line points at. */
  ref: string;
  /** How the item relates to the backlog: minted here, advanced, or closed. */
  rel: ResolvedRel;
  text: string;
  why?: string;
  /** Absent when the payload carried no `blocked_by` key; `[]` when it carried an empty one. */
  blockedBy?: string[];
}

/** A `## Notes` line. */
export interface NoteLine extends SessionLine {
  type: NoteType;
  by?: NoteBy;
  text: string;
  reason?: string;
}

/** How a Remaining item relates to the backlog item it names. */
export type ResolvedRel = "new" | "updates" | "closes";

/** The five body sections, keyed the way {@link ParsedSession} exposes them. */
export type SessionSectionName = "goal" | "done" | "remaining" | "notes" | "memory";

/**
 * A body line that does not match its section's form — a hand-typed entry, or prose someone left
 * under a heading. It is kept verbatim and re-emitted rather than guessed at, and surfaced here so
 * the CLI can warn about a file that has drifted from what the renderer writes.
 */
export interface UnparsedLine {
  section: SessionSectionName;
  line: string;
}

/** The backlog id a Remaining item resolved to, decided by the CLI before rendering. */
export interface ResolvedRef {
  id: string;
  rel: ResolvedRel;
}

/**
 * A session file split into frontmatter and structured body lines.
 *
 * `data` is the frontmatter mapping exactly as it was read — key order and unknown keys intact —
 * and is what a writer should mutate; `frontmatter` is the same mapping after validation, and is
 * what a reader should use.
 */
export interface ParsedSession {
  frontmatter: SessionFrontmatter;
  data: Record<string, unknown>;
  goal: GoalLine[];
  done: DoneLine[];
  remaining: RemainingLine[];
  notes: NoteLine[];
  /** Empty for a file written before amendment 11. */
  memory: MemoryLine[];
  /**
   * Lines that did not match their section's form, in the order they were read. They are re-emitted
   * verbatim at the foot of their own section on the next write, so a hand edit is never deleted.
   */
  unparsed: UnparsedLine[];
  /** Body text before the first recognized heading, verbatim. Empty for a CLI-written file. */
  preamble: string;
  /** Blocks under headings this build does not know, verbatim, kept so a write is not lossy. */
  extra: string;
}

/** What {@link appendCheckpoint} reports, matching the `checkpoint` stdout line (cli.md step 8). */
export interface CheckpointSummary {
  done: number;
  remaining: number;
  newItems: number;
  closed: number;
  questions: number;
}

/** The new file text plus the counts the CLI prints. */
export interface AppendCheckpointResult {
  text: string;
  summary: CheckpointSummary;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Render one `## Goal` line. */
export function renderGoalLine(n: number, goal: string): string {
  return `- ${cpTag(n)} ${oneLine(goal)}`;
}

/**
 * Render one `## Done` entry: the gist line, then an indented continuation carrying `detail`,
 * `commit`, `files` and `verified` joined by ` · ` (amendment 11). Two lines, joined by `\n`.
 */
export function renderDoneLine(n: number, item: DoneItem): string {
  const attributes: string[] = [];
  if (item.detail !== undefined) attributes.push(`detail: ${oneLine(item.detail)}`);
  if (item.commit !== undefined) attributes.push(`commit: ${item.commit}`);
  const files = (item.files ?? []).map(oneLine).filter((file) => file.length > 0);
  if (files.length > 0) attributes.push(`files: ${files.join(", ")}`);
  attributes.push(`verified: ${item.verified}`);
  return `- ${cpTag(n)} ${oneLine(item.text)}\n${CONTINUATION_INDENT}${attributes.join(ATTR_SEPARATOR)}`;
}

/**
 * The Done text the brief carries (P8 amendment 11). The brief is read by agents, so it gets the
 * gist *and* the detail; the session view shows the gist alone.
 */
export function doneBriefText(line: Pick<DoneLine, "text" | "detail">): string {
  return line.detail === undefined || line.detail === "" ? line.text : `${line.text} — ${line.detail}`;
}

/** Render one `## Memory` line: the fact, then ` file: <path>` when the item names one. */
export function renderMemoryLine(n: number, item: MemoryItem): string {
  const file = item.file === undefined ? "" : ` ${MEMORY_FILE_KEY}: ${oneLine(item.file)}`;
  return `- ${cpTag(n)} ${oneLine(item.text)}${file}`;
}

/** Render one `## Remaining` line against the backlog id the caller resolved it to. */
export function renderRemainingLine(n: number, item: RemainingItem, ref: ResolvedRef): string {
  let line = `- ${cpTag(n)} ${REF_ARROW} ${ref.id} (${ref.rel}) ${oneLine(item.text)}`;
  line += `${REMAINING_SEPARATOR}why: ${oneLine(item.why)}`;
  if (item.blocked_by !== undefined) {
    const blockers = item.blocked_by.length > 0 ? item.blocked_by.join(", ") : NO_BLOCKERS;
    line += `${REMAINING_SEPARATOR}blocked_by: ${blockers}`;
  }
  return line;
}

/** Render one `## Notes` line (`x-body.note-form`). */
export function renderNoteLine(n: number, note: Note): string {
  let line = `- ${note.type} ${cpTag(n)}`;
  if (note.by !== undefined) line += ` by ${note.by}`;
  line += `: ${oneLine(note.text)}`;
  if (note.reason !== undefined) line += `${REMAINING_SEPARATOR}reason: ${oneLine(note.reason)}`;
  return line;
}

/** One `## Heading` block: the heading alone when empty, else heading plus its lines. */
function renderSection(heading: string, lines: readonly string[]): string {
  return lines.length === 0 ? heading : `${heading}\n${lines.join("\n")}`;
}

/** Assemble the five sections, keeping any preamble above them and unknown blocks below. */
function renderBody(
  sections: {
    goal: readonly string[];
    done: readonly string[];
    remaining: readonly string[];
    notes: readonly string[];
    memory: readonly string[];
  },
  preamble = "",
  extra = "",
): string {
  const blocks = [
    renderSection(GOAL_HEADING, sections.goal),
    renderSection(DONE_HEADING, sections.done),
    renderSection(REMAINING_HEADING, sections.remaining),
    renderSection(NOTES_HEADING, sections.notes),
    renderSection(MEMORY_HEADING, sections.memory),
  ];
  return `${preamble}${blocks.join("\n\n")}\n${extra === "" ? "" : `\n${extra}`}`;
}

/**
 * The initial contents of `.workledger/sessions/<ulid>.md`: validated frontmatter and the four
 * headings with nothing under them. Written at SessionStart, before any checkpoint exists.
 */
export function createSessionText(frontmatter: SessionFrontmatter): string {
  const data = validate(SessionFrontmatterSchema, frontmatter, "the session frontmatter", "invalid-input");
  return stringifyFrontmatter(
    data as unknown as Record<string, unknown>,
    renderBody({ goal: [], done: [], remaining: [], notes: [], memory: [] }),
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split a body into the five known sections plus whatever surrounds them. */
function splitBody(body: string): {
  goal: string[];
  done: string[];
  remaining: string[];
  notes: string[];
  memory: string[];
  preamble: string;
  extra: string;
} {
  const known = new Map<string, string[]>([
    [GOAL_HEADING, []],
    [DONE_HEADING, []],
    [REMAINING_HEADING, []],
    [NOTES_HEADING, []],
    [MEMORY_HEADING, []],
  ]);
  const preamble: string[] = [];
  const extra: string[] = [];
  let sink: string[] = preamble;
  let inExtra = false;

  for (const line of body.split("\n")) {
    const heading = line.trimEnd();
    const section = known.get(heading);
    if (section !== undefined) {
      sink = section;
      inExtra = false;
      continue;
    }
    if (heading.startsWith("## ")) {
      // A heading this build does not know: keep the whole block verbatim, below the four.
      sink = extra;
      inExtra = true;
      sink.push(line);
      continue;
    }
    if (sink === preamble || inExtra) sink.push(line);
    else if (line.trim() !== "") sink.push(line);
  }

  const trim = (lines: string[]): string =>
    lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  const block = (lines: string[]): string => {
    const text = trim(lines);
    return text === "" ? "" : `${text}\n`;
  };

  return {
    goal: known.get(GOAL_HEADING) ?? [],
    done: known.get(DONE_HEADING) ?? [],
    remaining: known.get(REMAINING_HEADING) ?? [],
    notes: known.get(NOTES_HEADING) ?? [],
    memory: known.get(MEMORY_HEADING) ?? [],
    preamble: block(preamble),
    extra: block(extra),
  };
}

/**
 * Consume a trailing run of `key: value` attributes right to left over `keys` (canonical order).
 * Returns the leftover head and the attributes found.
 *
 * Two guards keep prose from being mistaken for evidence, both of which resolve in favour of the
 * *rightmost* reading — the renderer always puts the attributes last, so the last candidate is the
 * real one:
 *
 * 1. If the matched segment carries the same key again later (`files: fake.ts files: real.ts`,
 *    which is what rendering a text that itself ends in ` · files: fake.ts` produces), the split
 *    happens at the rightmost occurrence and everything before it goes back into the head.
 * 2. The value has to be {@link plausible} for its key. An implausible one is prose, and the
 *    segment stays in the head.
 */
function takeAttributes(
  rest: string,
  separator: string,
  keys: readonly string[],
): { head: string; attributes: Map<string, string> } {
  const segments = rest.split(separator);
  const attributes = new Map<string, string>();
  const heads: string[] = [];
  let si = segments.length - 1;
  let ki = keys.length - 1;
  while (si > 0 && ki >= 0) {
    const key = keys[ki]!;
    const claimed = readAttribute(segments[si]!, key);
    if (claimed !== undefined) {
      // The same key again inside the value means the prose ended in a key-shaped run.
      const marker = ` ${key}: `;
      const at = claimed.lastIndexOf(marker);
      const value = at === -1 ? claimed : claimed.slice(at + marker.length);
      if (plausible(key, value)) {
        attributes.set(key, value);
        if (at !== -1) heads.unshift(`${key}: ${claimed.slice(0, at)}`);
        si -= 1;
      }
    }
    ki -= 1;
  }
  return { head: [...segments.slice(0, si + 1), ...heads].join(separator), attributes };
}

/**
 * Is `value` a plausible value for `key`? This is what stops agent prose that happens to be shaped
 * like an attribute from being read as one — a fabricated repo path reaching P2's provenance panel
 * is worse than a line that parses as prose.
 */
function plausible(key: string, value: string): boolean {
  if (key === "verified") return (VERIFIED as readonly string[]).includes(value);
  if (key === "commit") return COMMIT_PATTERN.test(value);
  if (key === "files") {
    const files = splitList(value);
    // Every member must look like a path, not like more prose carrying another key.
    return files.length > 0 && files.every((file) => !/\s(?:files|commit|verified):\s/.test(file));
  }
  if (key === "blocked_by") {
    return value === NO_BLOCKERS || splitList(value).every((id) => BACKLOG_ID_PATTERN.test(id));
  }
  return value.length > 0;
}

/**
 * Pull the first emitted attribute out of the head segment, if it is there. Only one attribute
 * can share the head with the prose — the rest are separated by `separator` — so the search runs
 * over the keys the right-to-left pass did not claim, rightmost match first, and the value has to
 * be plausible for the key. A Done text that itself ends in ` verified: tests-passed` is the one
 * shape this cannot tell apart, and it resolves in favour of the evidence.
 */
function takeHeadAttribute(
  head: string,
  keys: readonly string[],
  claimed: ReadonlySet<string>,
): { text: string; key?: string; value?: string } {
  for (const key of keys) {
    if (claimed.has(key)) continue;
    const marker = ` ${key}: `;
    const at = head.lastIndexOf(marker);
    if (at === -1) continue;
    const value = head.slice(at + marker.length);
    if (!plausible(key, value)) continue;
    return { text: head.slice(0, at), key, value };
  }
  return { text: head };
}

function parseGoalLine(line: string): GoalLine | undefined {
  const prefix = readCpPrefix(line);
  if (prefix === undefined) return undefined;
  return { cp: prefix.n, raw: line, text: prefix.rest };
}

/**
 * Read a Done line whose evidence is inline — the pre-amendment-11 form, and the form any line
 * with no continuation below it is read as. `prefix` is the already-read `- [cp n] ` head.
 */
function parseDoneLine(line: string, prefix: { n: number; rest: string }): DoneLine {
  const { head, attributes } = takeAttributes(prefix.rest, ATTR_SEPARATOR, DONE_KEYS);
  const inHead = takeHeadAttribute(head, DONE_KEYS, new Set(attributes.keys()));
  if (inHead.key !== undefined) attributes.set(inHead.key, inHead.value!);

  const files = attributes.get("files");
  const commit = attributes.get("commit");
  const verified = attributes.get("verified");
  const done: DoneLine = {
    cp: prefix.n,
    raw: line,
    text: inHead.text,
    files: files === undefined ? [] : splitList(files),
  };
  if (commit !== undefined) done.commit = commit;
  if (verified !== undefined && (VERIFIED as readonly string[]).includes(verified)) {
    done.verified = verified as Verified;
  }
  return done;
}

/**
 * Read a Done continuation line (`  detail: … · commit: … · files: … · verified: …`) into the
 * attributes it carries, or `undefined` when the indented line is not one. Consumed right to
 * left over the closed key set like an inline line; whatever the evidence keys did not claim
 * has to be the `detail`, so a leftover that is not `detail: …` makes the line a stray.
 */
function parseDoneContinuation(line: string): Map<string, string> | undefined {
  if (!line.startsWith(CONTINUATION_INDENT)) return undefined;
  const segments = line.slice(CONTINUATION_INDENT.length).split(ATTR_SEPARATOR);
  const attributes = new Map<string, string>();
  let si = segments.length - 1;
  for (let ki = CONTINUATION_KEYS.length - 1; ki >= 1 && si >= 0; ki -= 1) {
    const key = CONTINUATION_KEYS[ki]!;
    const value = readAttribute(segments[si]!, key);
    if (value !== undefined && plausible(key, value)) {
      attributes.set(key, value);
      si -= 1;
    }
  }
  if (si >= 0) {
    const detail = readAttribute(segments.slice(0, si + 1).join(ATTR_SEPARATOR), CONTINUATION_KEYS[0]);
    if (detail === undefined || detail === "") return undefined;
    attributes.set(CONTINUATION_KEYS[0], detail);
  }
  return attributes.size === 0 ? undefined : attributes;
}

/** Fold a continuation's attributes into the gist line's record; the continuation wins. */
function applyContinuation(done: DoneLine, line: string, attributes: Map<string, string>): void {
  done.raw = `${done.raw}\n${line}`;
  const detail = attributes.get("detail");
  if (detail !== undefined) done.detail = detail;
  const files = attributes.get("files");
  if (files !== undefined) done.files = splitList(files);
  const commit = attributes.get("commit");
  if (commit !== undefined) done.commit = commit;
  const verified = attributes.get("verified");
  if (verified !== undefined) done.verified = verified as Verified;
}

function parseMemoryLine(line: string): MemoryLine | undefined {
  const prefix = readCpPrefix(line);
  if (prefix === undefined) return undefined;
  const marker = ` ${MEMORY_FILE_KEY}: `;
  const at = prefix.rest.lastIndexOf(marker);
  const file = at === -1 ? undefined : prefix.rest.slice(at + marker.length).trimEnd();
  if (file === undefined || file === "") return { cp: prefix.n, raw: line, text: prefix.rest };
  return { cp: prefix.n, raw: line, text: prefix.rest.slice(0, at), file };
}

function parseRemainingLine(line: string): RemainingLine | undefined {
  const prefix = readCpPrefix(line);
  if (prefix === undefined) return undefined;
  const head = REMAINING_HEAD.exec(prefix.rest);
  if (head === null) return undefined;
  const body = prefix.rest.slice(head[0].length);
  const { head: text, attributes } = takeAttributes(body, REMAINING_SEPARATOR, REMAINING_KEYS);

  const item: RemainingLine = {
    cp: prefix.n,
    raw: line,
    ref: head[1]!,
    rel: head[2] as ResolvedRel,
    text,
  };
  const why = attributes.get("why");
  if (why !== undefined) item.why = why;
  const blockedBy = attributes.get("blocked_by");
  if (blockedBy !== undefined) {
    item.blockedBy = blockedBy === NO_BLOCKERS ? [] : splitList(blockedBy);
  }
  return item;
}

function parseNoteLine(line: string): NoteLine | undefined {
  const head = NOTE_HEAD.exec(line);
  if (head === null) return undefined;
  const body = line.slice(head[0].length);
  const { head: text, attributes } = takeAttributes(body, REMAINING_SEPARATOR, ["reason"]);
  const note: NoteLine = {
    cp: Number(head[2]),
    raw: line,
    type: head[1] as NoteType,
    text,
  };
  if (head[3] !== undefined) note.by = head[3] as NoteBy;
  const reason = attributes.get("reason");
  if (reason !== undefined) note.reason = reason;
  return note;
}

/**
 * Read a session file into its frontmatter and its body lines.
 *
 * A line that does not match its section's form is not guessed at — the brief and the UI want the
 * lines they can bind to a checkpoint, and a hand-edited stray is not one. It is not dropped
 * either: it comes back in {@link ParsedSession.unparsed} and {@link appendCheckpoint} re-emits it
 * verbatim at the foot of its own section, the same way an unknown `##` heading survives in
 * {@link ParsedSession.extra}. The one thing a write does not preserve is blank lines *inside* a
 * section: those are structural, and the renderer decides them.
 *
 * @throws {RenderError} when the frontmatter is missing, unparseable, or fails `SessionFrontmatter`.
 */
export function parseSessionText(text: string): ParsedSession {
  let parsed;
  try {
    parsed = parseFrontmatter(text);
  } catch (error) {
    throw documentError("not a session file", error);
  }
  const frontmatter = validate(SessionFrontmatterSchema, parsed.data, "the session frontmatter", "invalid-document");
  const sections = splitBody(parsed.body);

  const unparsed: UnparsedLine[] = [];
  const collect = <T>(
    section: SessionSectionName,
    parse: (line: string) => T | undefined,
  ): T[] => {
    const out: T[] = [];
    for (const line of sections[section]) {
      const value = parse(line);
      if (value === undefined) unparsed.push({ section, line });
      else out.push(value);
    }
    return out;
  };

  // Done is the one section with a two-line form: an indented line right after a gist line is
  // its continuation (amendment 11); any other indented line is a stray. A line that has a
  // continuation is read as prose only — every attribute is on the continuation — so a gist
  // that itself contains ` · files: fake.ts` keeps it instead of losing it to the evidence.
  const done: DoneLine[] = [];
  for (let i = 0; i < sections.done.length; i += 1) {
    const line = sections.done[i]!;
    const prefix = line.startsWith(CONTINUATION_INDENT) ? undefined : readCpPrefix(line);
    if (prefix === undefined) {
      unparsed.push({ section: "done", line });
      continue;
    }
    const next = sections.done[i + 1];
    const continuation = next === undefined ? undefined : parseDoneContinuation(next);
    if (continuation === undefined) {
      done.push(parseDoneLine(line, prefix));
      continue;
    }
    const value: DoneLine = { cp: prefix.n, raw: line, text: prefix.rest, files: [] };
    applyContinuation(value, next!, continuation);
    done.push(value);
    i += 1;
  }

  return {
    frontmatter,
    data: parsed.data,
    goal: collect("goal", parseGoalLine),
    done,
    remaining: collect("remaining", parseRemainingLine),
    notes: collect("notes", parseNoteLine),
    memory: collect("memory", parseMemoryLine),
    unparsed,
    preamble: sections.preamble,
    extra: sections.extra,
  };
}

// ---------------------------------------------------------------------------
// Appending a checkpoint
// ---------------------------------------------------------------------------

/**
 * Which backlog id a Remaining item resolved to. Keys are the item's index in
 * `payload.remaining` as a decimal string — an index is total and unambiguous where the item's
 * text is neither. An item that already carries `ref` + `rel` may be left out of the map and is
 * then taken at its word; a `new: true` item has no id of its own, so leaving it out is an error.
 */
export type ResolvedRefs = ReadonlyMap<string, ResolvedRef>;

function resolveRef(item: RemainingItem, index: number, refs: ResolvedRefs): ResolvedRef {
  const resolved = refs.get(String(index));
  if (resolved !== undefined) return resolved;
  if (item.ref !== undefined && item.rel !== undefined) return { id: item.ref, rel: item.rel };
  throw new RenderError(
    `remaining[${index}] is new and has no resolved backlog id`,
    "unresolved-ref",
    [`remaining[${index}]: expected resolvedRefs to carry an entry keyed "${index}"`],
  );
}

/**
 * Append checkpoint `stamp.n` to a session file.
 *
 * Frontmatter gains the stamp; the Goal is replaced when the payload carries one and left alone
 * when it does not; Done and Remaining gain the new lines above the existing ones; Notes and
 * Memory gain theirs below. Existing lines are re-emitted exactly as they were read.
 *
 * The render is idempotent by refusal, not by merge: a stamp whose `n` is already in
 * `checkpoints[]` — or is behind the last one — is a {@link RenderError} with code
 * `duplicate-checkpoint`, so a retried CLI invocation cannot double-append.
 *
 * @throws {RenderError} on an invalid file, an invalid payload or stamp, a duplicate checkpoint,
 * a missing goal at checkpoint 1, or a `new` Remaining item with no resolved id.
 */
export function appendCheckpoint(
  text: string,
  payload: CheckpointPayload,
  stamp: Checkpoint,
  resolvedRefs: ResolvedRefs = new Map(),
): AppendCheckpointResult {
  const session = parseSessionText(text);
  const checkpoint = validate(CheckpointSchema, stamp, "the checkpoint stamp", "invalid-input");
  const body = validate(CheckpointPayloadSchema, payload, "the checkpoint payload", "invalid-input");

  const existing = session.frontmatter.checkpoints;
  const last = existing.length === 0 ? 0 : Math.max(...existing.map((entry) => entry.n));
  if (existing.some((entry) => entry.n === checkpoint.n)) {
    throw new RenderError(
      `checkpoint ${checkpoint.n} is already recorded in session ${session.frontmatter.id}`,
      "duplicate-checkpoint",
    );
  }
  if (checkpoint.n <= last) {
    throw new RenderError(
      `checkpoint ${checkpoint.n} is behind the last recorded checkpoint ${last}`,
      "duplicate-checkpoint",
    );
  }
  if (requiresGoal(checkpoint.n) && body.goal === undefined) {
    throw new RenderError("the first checkpoint of a session must carry a goal", "invalid-input", [
      "goal: required at checkpoint 1",
    ]);
  }

  const strays = (section: SessionSectionName): string[] =>
    session.unparsed.filter((entry) => entry.section === section).map((entry) => entry.line);

  // A payload goal *replaces* the section — a stale hand-written goal is not kept alongside the
  // new one. With no goal in the payload the whole section is kept, strays included.
  const goal =
    body.goal === undefined
      ? [...session.goal.map((line) => line.raw), ...strays("goal")]
      : [renderGoalLine(checkpoint.n, body.goal)];

  const doneLines = body.done.map((item) => renderDoneLine(checkpoint.n, item));

  // The `new` and `closes` counts fall out of resolving the refs; there is no second pass.
  let newItems = 0;
  let closed = 0;
  const remainingLines = body.remaining.map((item, index) => {
    const ref = resolveRef(item, index, resolvedRefs);
    if (ref.rel === "new") newItems += 1;
    else if (ref.rel === "closes") closed += 1;
    return renderRemainingLine(checkpoint.n, item, ref);
  });

  const noteLines = body.notes.map((note) => renderNoteLine(checkpoint.n, note));
  const memoryLines = body.memory.map((item) => renderMemoryLine(checkpoint.n, item));

  const data = { ...session.data };
  const priorStamps = Array.isArray(data["checkpoints"])
    ? (data["checkpoints"] as unknown[])
    : [];
  data["checkpoints"] = [...priorStamps, checkpoint];

  const rendered = stringifyFrontmatter(
    data,
    renderBody(
      {
        goal,
        done: [...doneLines, ...session.done.map((line) => line.raw), ...strays("done")],
        remaining: [
          ...remainingLines,
          ...session.remaining.map((line) => line.raw),
          ...strays("remaining"),
        ],
        notes: [...session.notes.map((line) => line.raw), ...noteLines, ...strays("notes")],
        memory: [...session.memory.map((line) => line.raw), ...memoryLines, ...strays("memory")],
      },
      session.preamble,
      session.extra,
    ),
  );

  return {
    text: rendered,
    summary: {
      done: body.done.length,
      remaining: body.remaining.length,
      newItems,
      closed,
      questions: body.notes.filter((note) => note.type === "question").length,
    },
  };
}
