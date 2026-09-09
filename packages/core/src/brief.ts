/**
 * The brief: the deterministic ledger summary injected at `SessionStart` and printed by
 * `workledger brief` (design spec §7, data-flow §5).
 *
 * No model, no ledger reading, and — since the `generated` line became opt-in — no clock. The
 * input is already-parsed plain objects: the caller (`packages/cli`) does the file I/O and the
 * frontmatter parsing, this module does the selection, the ordering and the cap. That split is
 * what keeps `packages/core` pure (CLAUDE.md), and what lets `workledger brief` meet its
 * acceptance criterion — "output is byte-identical across two runs on the same ledger"
 * (`plans/feature-p1-cli-core.md`) — as a property of this function rather than a hope about
 * timing. {@link buildBrief} is a total function of its arguments.
 *
 * **What determinism means here.** Every ordering below is a *total* order: where the contract's
 * sort key can tie (two items with the same `rank` and the same `updated`), a final tie-break on
 * the item's id settles it, so two ledgers that differ only in file-read order render the same
 * bytes. Dates are derived in UTC, so the output does not depend on the host timezone.
 *
 * **Where the input comes from.** {@link BriefInput} is deliberately shaped as
 * *frontmatter + already-split section contents*, so this module never parses markdown:
 *
 * | `BriefInput` field | Produced by |
 * |---|---|
 * | `backlog[].frontmatter` | `parseFrontmatter(fileText).data` validated as `BacklogItem` |
 * | `backlog[].body` | `parseFrontmatter(fileText).body` (optional; the brief ignores it) |
 * | `sessions[].frontmatter` | `parseFrontmatter(fileText).data` as `SessionFrontmatter` |
 * | `sessions[].done` | the `## Done` section's item texts, in file order (oldest first) |
 * | `sessions[].notes` | the `## Notes` items as `{ type, text, cp }`, `cp` from the `[cp n]` stamp |
 *
 * The last two rows are the session *body* parse that is the counterpart of slot 4's
 * `render/session.ts` renderer. Slot 8 must not re-implement that in `packages/cli`: a markdown
 * parser belongs next to the renderer that produced the markdown, in core.
 *
 * **Where design spec §7 and data-flow §5 disagree — §5 governs.** §5 is the contract issue #9
 * names, and it is the more specific document. Three divergences, all resolved in §5's favour:
 * 1. §7 "the last three Done items across sessions" vs §5 the three most recent *sessions*' Done
 *    lines. §5's own drop order ("the third and second most recent session's Done lines") only
 *    parses if Done lines are grouped per session, so §5 is self-consistent and §7 is not.
 * 2. §7 backlog "newest first" vs §5 `rank` ascending then `updated` descending. §5 wins: `rank`
 *    is the field the UI exists to set, and "newest first" would make it inert.
 * 3. §7 "drop `proposed` items first, then oldest" vs §5's four-stage order. §5 wins; see
 *    {@link buildBrief} for the fifth stage this module adds past the end of §5's list.
 */
import type { Actor, BacklogItem, BacklogStatus, NoteType, SessionFrontmatter } from "./schema.js";
import { CHARS_PER_TOKEN } from "./tokens.js";

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * One parsed `backlog/WL-<ulid>.md`.
 *
 * `body` is optional and unread: the brief renders frontmatter only, because spec §7's line
 * format is `WL-id · title · status · owner` and a body would blow the cap on the first few
 * items. It is part of the interface so slot 8 can hand a parsed ledger file straight through
 * without projecting it into a narrower shape first.
 */
export interface BriefBacklogEntry {
  frontmatter: BacklogItem;
  body?: string;
}

/** One note recorded at a checkpoint, flattened out of the session file's `## Notes` section. */
export interface BriefNote {
  type: NoteType;
  text: string;
  /** The checkpoint number the note was recorded at; orders notes within a session. */
  cp: number;
}

/**
 * One parsed `sessions/<ulid>.md`: its frontmatter plus the already-split contents of the
 * sections the brief reads. `done` holds the `## Done` item texts **in file order**, which is
 * oldest first — the brief relies on that to keep the newest work when it has to trim.
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
  /**
   * The `config.brief.max_tokens` budget (default 2,000), measured as `ceil(chars / 4)`.
   * Must be at least {@link MIN_BRIEF_MAX_TOKENS}; below that the brief's own irreducible floor
   * would exceed the budget and the cap could not be honoured, so it is rejected rather than
   * silently broken.
   */
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
   * When given, the brief carries a `workledger brief · generated <now>` line stamped with this
   * ISO 8601 string. **Omit it and the line is not emitted at all** — this module never reads a
   * clock, so `workledger brief`, which omits it, is byte-identical across runs on an unchanged
   * ledger. The `SessionStart` hook passes its own timestamp and gets the stamp; there is no
   * value the `brief` command could pass that would be both truthful and constant, which is why
   * the line is opt-in rather than defaulted.
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

/**
 * The smallest `maxTokens` {@link buildBrief} accepts.
 *
 * The brief has an irreducible floor it will not drop below: the session line (a 26-character
 * ulid inside the `workledger checkpoint --session <ulid>` instruction — the agent's only handle
 * on the checkpoint command when the environment does not expose one), an optional `generated`
 * stamp, and the `… N items omitted (brief cap)` footer that says content was cut. That is
 * 53 tokens with every part present. Below this bound the guarantee
 * `estimateTokens(buildBrief(input, opts)) <= opts.maxTokens` cannot hold for every input, so a
 * smaller budget is rejected with a `RangeError` instead of being silently exceeded. At or above
 * it the guarantee is unconditional.
 */
export const MIN_BRIEF_MAX_TOKENS = 64;

/** Column separator in the backlog line format `WL-id · title · status · owner`. */
const SEP = " · ";

/** Shown in the owner column of an unassigned backlog item. */
const UNASSIGNED = "unassigned";

/** Printed instead of the sections when the ledger is genuinely empty. */
const NOTHING_OPEN = "Nothing open: no backlog items, no recorded sessions.";

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

/** One rendered line the cap may drop. */
interface Line {
  text: string;
  dropped: boolean;
}

/**
 * A headed group of lines, carrying its own live length so the drop loop never has to re-render
 * to find out how big the brief currently is. `chars` is the sum of the *surviving* lines'
 * lengths; `count` is how many survive.
 */
interface Section {
  heading: string;
  lines: Line[];
  count: number;
  chars: number;
}

function section(heading: string): Section {
  return { heading, lines: [], count: 0, chars: 0 };
}

function addLine(target: Section, text: string): Line {
  const line: Line = { text, dropped: false };
  target.lines.push(line);
  target.count += 1;
  target.chars += text.length;
  return line;
}

/** One step of the drop plan. Every step is a single line — see {@link buildBrief}. */
interface DropStep {
  section: Section;
  line: Line;
}

function applyDrop(step: DropStep): void {
  step.line.dropped = true;
  step.section.count -= 1;
  step.section.chars -= step.line.text.length;
}

/**
 * A block of the output. `len` is its exact rendered length, available without rendering; the
 * two are computed from the same place so the O(1) size model and the final text cannot drift.
 */
interface Block {
  len: number;
  render: () => string;
}

function textBlock(text: string): Block {
  return { len: text.length, render: () => text };
}

/**
 * `["heading", ...lines].join("\n")` has length `heading.length + Σ lineLengths + lines.length`
 * — one newline per line — which is exactly `heading.length + chars + count`.
 */
function sectionBlock(source: Section): Block | null {
  if (source.count === 0) return null;
  return {
    len: source.heading.length + source.chars + source.count,
    render: () => {
      const out = [source.heading];
      for (const line of source.lines) if (!line.dropped) out.push(line.text);
      return out.join("\n");
    },
  };
}

function footerText(omitted: number): string {
  return `… ${omitted} ${omitted === 1 ? "item" : "items"} omitted (brief cap)`;
}

/** Blocks are joined by a blank line, so `n` blocks add `2 * (n - 1)` separator characters. */
const BLOCK_SEPARATOR = "\n\n";

function totalChars(blocks: readonly Block[]): number {
  let chars = 0;
  for (const block of blocks) chars += block.len;
  return chars + Math.max(0, blocks.length - 1) * BLOCK_SEPARATOR.length;
}

// ---------------------------------------------------------------------------
// buildBrief
// ---------------------------------------------------------------------------

/**
 * Build the brief.
 *
 * Sections, in order (spec §7):
 * 1. the optional session line, when {@link BriefOptions.sessionId} is given;
 * 2. the optional `generated` stamp, when {@link BriefOptions.now} is given;
 * 3. `Open backlog:` — items with status `proposed`, `accepted` or `in_progress`, ordered by
 *    `rank` ascending then `updated` descending (data-flow §5), each as
 *    `WL-id · title · status · owner`;
 * 4. `Recent work:` — the Done lines of the three most recent sessions by `started` descending,
 *    each prefixed with the session's date, newest work first;
 * 5. `Open blockers and questions:` — every open `blocker` and `question` note across *all*
 *    sessions, newest first.
 *
 * **The cap.** When the rendered text would exceed `maxTokens`, lines are dropped one at a time,
 * in the order data-flow §5 fixes:
 *
 * 1. `proposed` backlog items, oldest first by `created`;
 * 2. open notes, oldest first;
 * 3. the third most recent session's Done lines, oldest first;
 * 4. the second most recent session's Done lines, oldest first;
 *
 * §5 stops there, but the cap is a guarantee this function has to keep on any ledger, so a fifth
 * stage continues past it — this module's extension, not the contract's. It trims the two
 * survivors, the `accepted`/`in_progress` backlog and the most recent session's Done lines,
 * *against each other*: whichever currently occupies more characters gives up its oldest line.
 * Spending one to save the other would be the wrong trade in both directions, and this converges
 * on an even split, so both sections still say something at any accepted `maxTokens`.
 *
 * Every stage is **line-granular**: a session's Done lines are trimmed from the oldest end, never
 * removed as a block. That is what stops a single busy session from erasing the whole brief —
 * at the shipped default of 2,000 tokens a ledger of 500 open items and three sessions of 200
 * Done lines still renders both its recent work and its backlog, instead of collapsing to a
 * footer. Anything dropped is reported by a trailing `… N items omitted (brief cap)` line, and
 * the session line is never dropped: it is the agent's handle on `workledger checkpoint`.
 *
 * **Cost.** Linear in the size of the ledger. The size of the brief is tracked incrementally as
 * lines are dropped, so the loop never re-renders; the text is assembled once, at the end.
 *
 * @throws RangeError if `maxTokens` is below {@link MIN_BRIEF_MAX_TOKENS} or is not a finite
 * number — at those budgets the cap cannot be honoured, and a caller that asked for the
 * impossible should hear about it rather than get a brief that quietly exceeds it.
 * @returns The brief text, with no trailing newline.
 */
export function buildBrief(input: BriefInput, opts: BriefOptions): string {
  if (!Number.isFinite(opts.maxTokens) || opts.maxTokens < MIN_BRIEF_MAX_TOKENS) {
    throw new RangeError(
      `maxTokens must be a number of at least ${MIN_BRIEF_MAX_TOKENS} — the brief's floor is the ` +
        "session line plus the omitted-items footer, which cannot be dropped — got " +
        `${String(opts.maxTokens)}`,
    );
  }

  const backlogSection = section("Open backlog:");
  const doneSection = section("Recent work:");
  const notesSection = section("Open blockers and questions:");

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

  const backlogLines = new Map<string, Line>();
  for (const item of displayOrder) {
    const { id, title, status } = item.frontmatter;
    const owner = ownerLabel(item.frontmatter.owner);
    const text = `  ${id}${SEP}${oneLine(title)}${SEP}${status}${SEP}${owner}`;
    backlogLines.set(id, addLine(backlogSection, text));
  }

  /** Oldest-first by `created`, the age order both backlog drop stages consume. */
  const backlogByAge = [...open].sort((a, b) => {
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

  /**
   * `doneByAge[i]` is session `i`'s Done lines oldest first — file order, and the order the cap
   * trims them in. They are *added* to the section newest first, so the whole `Recent work:`
   * block reads newest to oldest and the lines that survive a trim are the ones at the top.
   */
  const doneByAge: Line[][] = recent.map((entry) => {
    const date = utcDate(entry.frontmatter.started);
    const texts = entry.done.map((text) => oneLine(text)).filter((text) => text !== "");
    const lines: Line[] = [];
    // Walk backwards: the section receives them newest first, the returned array stays in file
    // order (oldest first) for the drop plan.
    for (let i = texts.length - 1; i >= 0; i -= 1) {
      lines[i] = addLine(doneSection, `  ${date}${SEP}${texts[i]!}`);
    }
    return lines;
  });

  // --- notes --------------------------------------------------------------
  // Notes come from every session, not just the three most recent: an open blocker recorded a
  // week ago is exactly the thing the next session needs to be told about.
  interface AgedNote {
    started: string;
    sessionId: string;
    cp: number;
    index: number;
    type: NoteType;
    text: string;
  }
  const agedNotes: AgedNote[] = [];
  for (const entry of input.sessions) {
    entry.notes.forEach((item, index) => {
      if (!BRIEF_NOTE_TYPES.includes(item.type)) return;
      const text = oneLine(item.text);
      if (text === "") return;
      agedNotes.push({
        started: entry.frontmatter.started,
        sessionId: entry.frontmatter.id,
        cp: item.cp,
        index,
        type: item.type,
        text,
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
  const notesByAge: Line[] = [];
  for (let i = agedNotes.length - 1; i >= 0; i -= 1) {
    const item = agedNotes[i]!;
    notesByAge[i] = addLine(notesSection, `  ${item.type}${SEP}${item.text}`);
  }

  // --- the drop plan ------------------------------------------------------
  const plan: DropStep[] = [];
  const pushBacklog = (wanted: "proposed" | "other"): void => {
    for (const item of backlogByAge) {
      const isProposed = item.frontmatter.status === "proposed";
      if (isProposed !== (wanted === "proposed")) continue;
      const line = backlogLines.get(item.frontmatter.id);
      if (line) plan.push({ section: backlogSection, line });
    }
  };
  const pushDone = (index: number): void => {
    for (const line of doneByAge[index] ?? []) plan.push({ section: doneSection, line });
  };

  pushBacklog("proposed");
  for (const line of notesByAge) plan.push({ section: notesSection, line });
  for (let i = BRIEF_MAX_SESSIONS - 1; i >= 1; i -= 1) pushDone(i);

  /**
   * What data-flow §5's drop order leaves standing: the `accepted` and `in_progress` backlog,
   * and the most recent session's Done lines. §5 says nothing about these, and neither can be
   * spent to save the other — a brief that is all backlog and no recent work is as useless as
   * one that is all recent work and no backlog. So they are trimmed *against each other*: the
   * pool currently occupying more characters gives up its oldest line, which converges on an
   * even split and leaves both sections populated at any cap. Both queues are oldest-first.
   */
  const tailBacklog: Line[] = [];
  for (const item of backlogByAge) {
    if (item.frontmatter.status === "proposed") continue;
    const line = backlogLines.get(item.frontmatter.id);
    if (line) tailBacklog.push(line);
  }
  const tailDone = doneByAge[0] ?? [];

  // --- drop until it fits -------------------------------------------------
  const sections = [backlogSection, doneSection, notesSection];
  const layout = (omitted: number): Block[] => {
    const blocks: Block[] = [];
    if (opts.sessionId !== undefined) {
      blocks.push(
        textBlock(
          `workledger session ${opts.sessionId} — ` +
            `run \`workledger checkpoint --session ${opts.sessionId}\` when asked`,
        ),
      );
    }
    if (opts.now !== undefined) {
      blocks.push(textBlock(`workledger brief${SEP}generated ${opts.now}`));
    }
    for (const source of sections) {
      const block = sectionBlock(source);
      if (block) blocks.push(block);
    }
    // Only for a genuinely empty ledger. When the cap emptied the sections the footer says so,
    // and "Nothing open" next to "40 items omitted" would be a lie.
    if (omitted === 0 && sections.every((source) => source.count === 0)) {
      blocks.push(textBlock(NOTHING_OPEN));
    }
    if (omitted > 0) blocks.push(textBlock(footerText(omitted)));
    return blocks;
  };

  const fits = (omitted: number): boolean =>
    Math.ceil(totalChars(layout(omitted)) / CHARS_PER_TOKEN) <= opts.maxTokens;

  let omitted = 0;
  let done = false;
  for (const step of plan) {
    if (fits(omitted)) {
      done = true;
      break;
    }
    applyDrop(step);
    omitted += 1;
  }

  let nextBacklog = 0;
  let nextDone = 0;
  while (!done && (nextBacklog < tailBacklog.length || nextDone < tailDone.length)) {
    if (fits(omitted)) break;
    const takeBacklog =
      nextDone >= tailDone.length ||
      (nextBacklog < tailBacklog.length && backlogSection.chars >= doneSection.chars);
    if (takeBacklog) {
      applyDrop({ section: backlogSection, line: tailBacklog[nextBacklog]! });
      nextBacklog += 1;
    } else {
      applyDrop({ section: doneSection, line: tailDone[nextDone]! });
      nextDone += 1;
    }
    omitted += 1;
  }

  return layout(omitted)
    .map((block) => block.render())
    .join(BLOCK_SEPARATOR);
}
