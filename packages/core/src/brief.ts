/**
 * The brief: the deterministic ledger summary injected at `SessionStart` and printed by
 * `workledger brief` (design spec §7, data-flow §5).
 *
 * No model, no ledger reading. The input is already-parsed plain objects — the caller
 * (`packages/cli`) does the file I/O and the frontmatter parsing, this module does the selection,
 * the ordering and the cap. That split is what keeps `packages/core` pure (CLAUDE.md) and what
 * makes "byte-identical output for identical input" a property this module can actually promise.
 *
 * **What determinism means here.** Every ordering below is a *total* order: where the contract's
 * sort key can tie (two items with the same `rank` and the same `updated`), a final tie-break on
 * the item's id settles it, so two ledgers that differ only in file-read order render the same
 * bytes. The one clock read in this module is the `generated` header line, and it happens only
 * when the caller omits {@link BriefOptions.now} — see that field.
 *
 * **Where the spec and the data-flow doc disagree.** Design spec §7 says "the last three Done
 * items across sessions"; data-flow §5 and issue #9 say "the three most recent `sessions/*.md` by
 * `started`" with their Done lines. Data-flow §5 governs (it is the contract named by the issue),
 * so this module renders the Done lines of the three most recent sessions rather than three Done
 * items in total. The drop order confirms the reading: §5 drops "the third and second most recent
 * session's Done lines", which only makes sense if Done lines are grouped per session.
 */
import type { Actor, BacklogItem, BacklogStatus, NoteType, SessionFrontmatter } from "./schema.js";
import { estimateTokens } from "./tokens.js";

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * One parsed `backlog/WL-<ulid>.md`.
 *
 * `body` is carried so slot 8's CLI can hand a parsed ledger file straight through without
 * projecting it into a narrower shape first; the brief itself renders frontmatter only, because
 * spec §7's line format is `WL-id · title · status · owner` and a body would blow the cap on the
 * first few items.
 */
export interface BriefBacklogEntry {
  frontmatter: BacklogItem;
  body: string;
}

/** One note recorded at a checkpoint, flattened out of the session file's Notes section. */
export interface BriefNote {
  type: NoteType;
  text: string;
  /** The checkpoint number the note was recorded at; orders notes within a session. */
  cp: number;
}

/**
 * One parsed `sessions/<ulid>.md`: its frontmatter plus the already-rendered lines of the
 * sections the brief reads. `done` holds the Done section's item texts in file order.
 */
export interface BriefSession {
  frontmatter: SessionFrontmatter;
  done: string[];
  notes: BriefNote[];
}

/** Everything the brief is built from. Both arrays may be empty. */
export interface BriefInput {
  backlog: BriefBacklogEntry[];
  sessions: BriefSession[];
}

export interface BriefOptions {
  /** The `config.brief.max_tokens` budget (default 2,000), measured with {@link estimateTokens}. */
  maxTokens: number;
  /**
   * The session ULID this brief is being injected for. When present the brief opens with the
   * line the `SessionStart` hook contract requires, naming the ulid so the agent can pass it to
   * `workledger checkpoint --session <ulid>` when the environment does not expose it
   * (hooks-claude-code.md §Outputs emitted → SessionStart). Omit it for `workledger brief`, which
   * prints the ledger summary alone.
   */
  sessionId?: string;
  /**
   * The timestamp for the `generated` header line, as an ISO 8601 string. Pass it — the CLI reads
   * its clock once per invocation and threads that value in — and the output is a pure function
   * of the input. It is the *only* clock-dependent part of the brief: when it is omitted this
   * module falls back to `new Date().toISOString()` for that one line, and nothing else in the
   * output ever consults the clock.
   */
  now?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Backlog statuses the brief shows. `done` and `discarded` items never appear (spec §7). */
export const BRIEF_OPEN_STATUSES: readonly BacklogStatus[] = ["proposed", "accepted", "in_progress"];

/** Note types the brief shows: the two that are open questions for the next session (spec §7). */
export const BRIEF_NOTE_TYPES: readonly NoteType[] = ["blocker", "question"];

/** How many sessions contribute Done lines, most recent first (data-flow §5). */
export const BRIEF_MAX_SESSIONS = 3;

/** Column separator in the backlog line format `WL-id · title · status · owner`. */
const SEP = " · ";

/** Shown in the owner column of an unassigned backlog item. */
const UNASSIGNED = "unassigned";

// ---------------------------------------------------------------------------
// Ordering helpers
// ---------------------------------------------------------------------------

/**
 * Compare two ISO 8601 timestamps chronologically. The frontmatter contracts allow any offset,
 * so `2026-09-09T09:00:00Z` and `2026-09-09T11:00:00+02:00` are the same instant while comparing
 * unequal as strings — hence the parse. An unparseable value (possible: both frontmatter schemas
 * are `additionalProperties: true` and a hand-edited file can carry rubbish) falls back to a
 * string compare so the sort stays total rather than throwing.
 */
function compareInstants(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a < b ? -1 : a > b ? 1 : 0;
  return ta - tb;
}

/** Lexicographic compare, used for the id tie-breaks that make every ordering total. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The date shown next to a Done line, as `YYYY-MM-DD` in UTC. Normalizing through
 * `toISOString` rather than slicing the raw string means a session started at
 * `2026-09-09T23:30:00-05:00` renders as `2026-09-10`, the same on every host regardless of the
 * machine's timezone. An unparseable timestamp falls back to its first ten characters.
 */
function utcDate(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return timestamp.slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Collapse whitespace so one ledger item is one brief line. Titles and note texts are free text
 * from a human or an agent; a newline in one would otherwise forge an extra line in the output
 * and desynchronize the drop accounting from what the reader sees.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The owner column: the actor's name, or `unassigned`. */
function ownerLabel(owner: Actor | null | undefined): string {
  const name = owner?.name === undefined ? "" : oneLine(owner.name);
  return name === "" ? UNASSIGNED : name;
}

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

/** One rendered line that the cap may drop. */
interface Entry {
  line: string;
  dropped: boolean;
}

/**
 * One step of the drop plan: the entries removed together, in the order data-flow §5 removes
 * them. A session's Done lines are one step (the whole group goes at once); everything else is
 * one entry per step so the cap removes no more than it must.
 */
type DropStep = Entry[];

function entry(line: string): Entry {
  return { line, dropped: false };
}

function alive(entries: readonly Entry[]): string[] {
  const out: string[] = [];
  for (const item of entries) if (!item.dropped) out.push(item.line);
  return out;
}

// ---------------------------------------------------------------------------
// buildBrief
// ---------------------------------------------------------------------------

/**
 * Build the brief.
 *
 * Sections, in order (spec §7):
 * 1. the optional session line, when {@link BriefOptions.sessionId} is given;
 * 2. `Open backlog:` — items with status `proposed`, `accepted` or `in_progress`, ordered by
 *    `rank` ascending then `updated` descending (data-flow §5), each as
 *    `WL-id · title · status · owner`;
 * 3. `Recent work:` — the Done lines of the three most recent sessions by `started` descending,
 *    each prefixed with the session's date;
 * 4. `Open blockers and questions:` — every open `blocker` and `question` note across *all*
 *    sessions, newest first.
 *
 * When the rendered text exceeds `maxTokens`, entries are dropped one step at a time, in the
 * order data-flow §5 fixes: `proposed` items oldest-first, then notes oldest-first, then the
 * third and then the second most recent session's Done lines. §5 stops there, but the cap is a
 * guarantee this function has to keep, so two further stages continue past it: the remaining open
 * backlog items (`accepted`, `in_progress`) oldest-first, and finally the most recent session's
 * Done lines. Those two are this module's extension, not the contract's; a brief that reaches
 * them was over budget by an order of magnitude and the alternative is silently blowing the cap.
 * Anything dropped is reported by a trailing `… N items omitted (brief cap)` line.
 *
 * The irreducible floor is the session line plus the header plus that footer: the session ulid is
 * a protocol obligation to the agent, so it is never dropped even at an absurd `maxTokens`.
 *
 * @returns The brief text, with no trailing newline.
 */
export function buildBrief(input: BriefInput, opts: BriefOptions): string {
  const generated = opts.now ?? new Date().toISOString();

  // --- backlog ------------------------------------------------------------
  const open = input.backlog.filter((item) =>
    BRIEF_OPEN_STATUSES.includes(item.frontmatter.status),
  );

  const displayOrder = [...open].sort((a, b) => {
    const rank = a.frontmatter.rank - b.frontmatter.rank;
    if (rank !== 0) return rank;
    const updated = compareInstants(b.frontmatter.updated, a.frontmatter.updated);
    if (updated !== 0) return updated;
    return compareStrings(a.frontmatter.id, b.frontmatter.id);
  });

  const backlogEntries = new Map<string, Entry>();
  const backlogLines: Entry[] = [];
  for (const item of displayOrder) {
    const { id, title, status } = item.frontmatter;
    const rendered = entry(
      `  ${id}${SEP}${oneLine(title)}${SEP}${status}${SEP}${ownerLabel(item.frontmatter.owner)}`,
    );
    backlogEntries.set(id, rendered);
    backlogLines.push(rendered);
  }

  /** Oldest-first by `created`, the age order both backlog drop stages consume. */
  const oldestFirst = [...open].sort((a, b) => {
    const created = compareInstants(a.frontmatter.created, b.frontmatter.created);
    if (created !== 0) return created;
    return compareStrings(a.frontmatter.id, b.frontmatter.id);
  });

  // --- sessions and their Done lines --------------------------------------
  const recent = [...input.sessions]
    .sort((a, b) => {
      const started = compareInstants(b.frontmatter.started, a.frontmatter.started);
      if (started !== 0) return started;
      return compareStrings(b.frontmatter.id, a.frontmatter.id);
    })
    .slice(0, BRIEF_MAX_SESSIONS);

  const doneGroups: Entry[][] = recent.map((session) => {
    const date = utcDate(session.frontmatter.started);
    return session.done
      .map((text) => oneLine(text))
      .filter((text) => text !== "")
      .map((text) => entry(`  ${date}${SEP}${text}`));
  });
  const doneLines = doneGroups.flat();

  // --- notes --------------------------------------------------------------
  // Notes come from every session, not just the three most recent: an open blocker recorded a
  // week ago is exactly the thing the next session needs to be told about.
  interface AgedNote {
    entry: Entry;
    started: string;
    sessionId: string;
    cp: number;
    index: number;
  }
  const agedNotes: AgedNote[] = [];
  for (const session of input.sessions) {
    session.notes.forEach((note, index) => {
      if (!BRIEF_NOTE_TYPES.includes(note.type)) return;
      const text = oneLine(note.text);
      if (text === "") return;
      agedNotes.push({
        entry: entry(`  ${note.type}${SEP}${text}`),
        started: session.frontmatter.started,
        sessionId: session.frontmatter.id,
        cp: note.cp,
        index,
      });
    });
  }
  agedNotes.sort((a, b) => {
    const started = compareInstants(a.started, b.started);
    if (started !== 0) return started;
    const id = compareStrings(a.sessionId, b.sessionId);
    if (id !== 0) return id;
    if (a.cp !== b.cp) return a.cp - b.cp;
    return a.index - b.index;
  });
  // `agedNotes` is oldest-first — the drop order. The reader gets the reverse: newest first.
  const noteLines = agedNotes.map((note) => note.entry).reverse();

  // --- the drop plan ------------------------------------------------------
  const plan: DropStep[] = [];
  for (const item of oldestFirst) {
    if (item.frontmatter.status !== "proposed") continue;
    const rendered = backlogEntries.get(item.frontmatter.id);
    if (rendered) plan.push([rendered]);
  }
  for (const note of agedNotes) plan.push([note.entry]);
  for (let i = BRIEF_MAX_SESSIONS - 1; i >= 1; i -= 1) {
    const group = doneGroups[i];
    if (group && group.length > 0) plan.push(group);
  }
  // Beyond data-flow §5, so the cap holds even on a ledger that is all `accepted` work.
  for (const item of oldestFirst) {
    if (item.frontmatter.status === "proposed") continue;
    const rendered = backlogEntries.get(item.frontmatter.id);
    if (rendered) plan.push([rendered]);
  }
  const mostRecentDone = doneGroups[0];
  if (mostRecentDone && mostRecentDone.length > 0) plan.push(mostRecentDone);

  // --- render, dropping until it fits -------------------------------------
  const render = (omitted: number): string =>
    assemble({
      sessionId: opts.sessionId,
      generated,
      backlog: alive(backlogLines),
      done: alive(doneLines),
      notes: alive(noteLines),
      omitted,
    });

  let omitted = 0;
  let text = render(omitted);
  for (const step of plan) {
    if (estimateTokens(text) <= opts.maxTokens) return text;
    for (const item of step) item.dropped = true;
    omitted += step.length;
    text = render(omitted);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface Assembly {
  sessionId: string | undefined;
  generated: string;
  backlog: string[];
  done: string[];
  notes: string[];
  omitted: number;
}

/** Join the surviving lines into the final text. Empty sections drop their heading with them. */
function assemble(parts: Assembly): string {
  const blocks: string[] = [];
  if (parts.sessionId !== undefined) {
    blocks.push(
      `workledger session ${parts.sessionId} — ` +
        `run \`workledger checkpoint --session ${parts.sessionId}\` when asked`,
    );
  }
  blocks.push(`workledger brief${SEP}generated ${parts.generated}`);

  if (parts.backlog.length > 0) blocks.push(["Open backlog:", ...parts.backlog].join("\n"));
  if (parts.done.length > 0) blocks.push(["Recent work:", ...parts.done].join("\n"));
  if (parts.notes.length > 0) {
    blocks.push(["Open blockers and questions:", ...parts.notes].join("\n"));
  }
  if (
    parts.omitted === 0 &&
    parts.backlog.length === 0 &&
    parts.done.length === 0 &&
    parts.notes.length === 0
  ) {
    // Only for a genuinely empty ledger. When the cap emptied the sections the footer below says
    // so, and "Nothing open" next to "40 items omitted" would be a lie.
    blocks.push("Nothing open: no backlog items, no recorded sessions.");
  }
  if (parts.omitted > 0) {
    const noun = parts.omitted === 1 ? "item" : "items";
    blocks.push(`… ${parts.omitted} ${noun} omitted (brief cap)`);
  }
  return blocks.join("\n\n");
}
