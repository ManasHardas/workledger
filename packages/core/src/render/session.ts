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
 * - [cp 2] Added retry to the upload client. files: src/upload.ts · commit: a1b2c3d · verified: tests-passed
 *
 * ## Remaining
 * - [cp 2] → WL-01J9… (new) Add a size limit before upload; why: server rejects >50 MB silently
 *
 * ## Notes
 * - decision [cp 2] by human: Keep uploads synchronous; reason: the async path needs the queue work
 * ```
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
 * Attribute runs are consumed right to left over a closed set of keys, so the prose that precedes
 * them is whatever is left over rather than something matched by a pattern.
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
import {
  ATTR_SEPARATOR,
  REF_ARROW,
  RenderError,
  cpTag,
  oneLine,
  readAttribute,
  readCpPrefix,
  splitList,
  validate,
} from "./common.js";

/** The four body headings, in the order the renderer emits them (`x-body.sections`). */
export const SESSION_SECTIONS = ["## Goal", "## Done", "## Remaining", "## Notes"] as const;

const GOAL_HEADING = SESSION_SECTIONS[0];
const DONE_HEADING = SESSION_SECTIONS[1];
const REMAINING_HEADING = SESSION_SECTIONS[2];
const NOTES_HEADING = SESSION_SECTIONS[3];

/** Evidence keys of a Done line, in the order they are emitted. */
const DONE_KEYS = ["files", "commit", "verified"] as const;
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

/** A `## Done` line with its evidence split off the prose. */
export interface DoneLine extends SessionLine {
  text: string;
  files: string[];
  commit?: string;
  verified?: Verified;
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

/** Render one `## Done` line: prose, then `files`, `commit`, and `verified` joined by ` · `. */
export function renderDoneLine(n: number, item: DoneItem): string {
  const attributes: string[] = [];
  const files = (item.files ?? []).map(oneLine).filter((file) => file.length > 0);
  if (files.length > 0) attributes.push(`files: ${files.join(", ")}`);
  if (item.commit !== undefined) attributes.push(`commit: ${item.commit}`);
  attributes.push(`verified: ${item.verified}`);
  return `- ${cpTag(n)} ${oneLine(item.text)} ${attributes.join(ATTR_SEPARATOR)}`;
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

/** Assemble the four sections, keeping any preamble above them and unknown blocks below. */
function renderBody(
  sections: {
    goal: readonly string[];
    done: readonly string[];
    remaining: readonly string[];
    notes: readonly string[];
  },
  preamble = "",
  extra = "",
): string {
  const blocks = [
    renderSection(GOAL_HEADING, sections.goal),
    renderSection(DONE_HEADING, sections.done),
    renderSection(REMAINING_HEADING, sections.remaining),
    renderSection(NOTES_HEADING, sections.notes),
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
    renderBody({ goal: [], done: [], remaining: [], notes: [] }),
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split a body into the four known sections plus whatever surrounds them. */
function splitBody(body: string): {
  goal: string[];
  done: string[];
  remaining: string[];
  notes: string[];
  preamble: string;
  extra: string;
} {
  const known = new Map<string, string[]>([
    [GOAL_HEADING, []],
    [DONE_HEADING, []],
    [REMAINING_HEADING, []],
    [NOTES_HEADING, []],
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
    preamble: block(preamble),
    extra: block(extra),
  };
}

/**
 * Consume a trailing run of `key: value` attributes right to left over `keys` (canonical order).
 * Returns the leftover head and the attributes found. Nothing here looks at the prose: the head
 * is simply whatever the known keys did not claim.
 */
function takeAttributes(
  rest: string,
  separator: string,
  keys: readonly string[],
): { head: string; attributes: Map<string, string> } {
  const segments = rest.split(separator);
  const attributes = new Map<string, string>();
  let si = segments.length - 1;
  let ki = keys.length - 1;
  while (si > 0 && ki >= 0) {
    const key = keys[ki]!;
    const value = readAttribute(segments[si]!, key);
    if (value !== undefined) {
      attributes.set(key, value);
      si -= 1;
    }
    ki -= 1;
  }
  return { head: segments.slice(0, si + 1).join(separator), attributes };
}

/** Is `value` a plausible value for `key`? Used to reject a prose match on the head segment. */
function plausible(key: string, value: string): boolean {
  if (key === "verified") return (VERIFIED as readonly string[]).includes(value);
  if (key === "commit") return COMMIT_PATTERN.test(value);
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

function parseDoneLine(line: string): DoneLine | undefined {
  const prefix = readCpPrefix(line);
  if (prefix === undefined) return undefined;
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
 * A line that does not match its section's form is skipped rather than guessed at — the brief and
 * the UI want the lines they can bind to a checkpoint, and a hand-edited stray is not one. Nothing
 * is lost on a write: {@link appendCheckpoint} re-emits the raw lines it read.
 *
 * @throws {RenderError} when the frontmatter is missing, unparseable, or fails `SessionFrontmatter`.
 */
export function parseSessionText(text: string): ParsedSession {
  let parsed;
  try {
    parsed = parseFrontmatter(text);
  } catch (error) {
    throw new RenderError(
      `not a session file: ${error instanceof Error ? error.message : String(error)}`,
      "invalid-document",
    );
  }
  const frontmatter = validate(SessionFrontmatterSchema, parsed.data, "the session frontmatter", "invalid-document");
  const sections = splitBody(parsed.body);

  const collect = <T>(lines: string[], parse: (line: string) => T | undefined): T[] => {
    const out: T[] = [];
    for (const line of lines) {
      const value = parse(line);
      if (value !== undefined) out.push(value);
    }
    return out;
  };

  return {
    frontmatter,
    data: parsed.data,
    goal: collect(sections.goal, parseGoalLine),
    done: collect(sections.done, parseDoneLine),
    remaining: collect(sections.remaining, parseRemainingLine),
    notes: collect(sections.notes, parseNoteLine),
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
 * when it does not; Done and Remaining gain the new lines above the existing ones; Notes gain
 * theirs below. Existing lines are re-emitted exactly as they were read.
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

  const goal =
    body.goal === undefined
      ? session.goal.map((line) => line.raw)
      : [renderGoalLine(checkpoint.n, body.goal)];

  const doneLines = body.done.map((item) => renderDoneLine(checkpoint.n, item));
  const remainingLines = body.remaining.map((item, index) =>
    renderRemainingLine(checkpoint.n, item, resolveRef(item, index, resolvedRefs)),
  );
  const noteLines = body.notes.map((note) => renderNoteLine(checkpoint.n, note));

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
        done: [...doneLines, ...session.done.map((line) => line.raw)],
        remaining: [...remainingLines, ...session.remaining.map((line) => line.raw)],
        notes: [...session.notes.map((line) => line.raw), ...noteLines],
      },
      session.preamble,
      session.extra,
    ),
  );

  let newItems = 0;
  let closed = 0;
  for (let index = 0; index < body.remaining.length; index += 1) {
    const rel = resolveRef(body.remaining[index]!, index, resolvedRefs).rel;
    if (rel === "new") newItems += 1;
    else if (rel === "closes") closed += 1;
  }

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
