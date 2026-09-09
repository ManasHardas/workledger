/**
 * The backlog mutations, as pure-ish functions over one repo's ledger —
 * docs/contracts/p2/backlog-cli.md, plans/feature-p2-data-flow.md §Writes and §Notes resolution.
 *
 * "Pure-ish" because every one of them reads and writes files: what they do *not* do is touch
 * `process`, print anything, or decide an exit code. That is the whole point of this file. Two
 * callers run the same eight operations — `workledger backlog …` here and
 * `POST /api/backlog/:id/<op>` in `packages/server` (#34) — and the contract says they must be
 * the same code, not two implementations that agree today. So each op has one shape,
 *
 * ```ts
 * (ctx: { repoRoot: string; by: Actor; now?: string }, …args) => Promise<Result>
 * ```
 *
 * and reports failure by throwing {@link BacklogOpError}, whose `code` the CLI maps to an exit
 * code and the server maps to an HTTP status.
 *
 * Three rules every mutation obeys, inherited from `@workledger/core`'s renderer:
 *
 * - The file is re-read immediately before it is written, so a concurrent edit is overwritten
 *   only from the moment of the read (data-flow §Writes: last write wins at the file level; the
 *   server serializes per id with a mutex).
 * - `updated` moves and a `history` entry is appended for every logical change, stamped with the
 *   `Actor` the caller resolved from git config — never a `SessionRef`, which is reserved for
 *   agent-originated changes.
 * - The write is atomic (`writeFileAtomic`), so a crash mid-write leaves the previous file.
 *
 * `status` changes go through {@link TRANSITIONS} rather than being set directly, so the state
 * machine is stated once and both callers get the same refusal with the same list of targets.
 */
import { RenderError } from "@workledger/core";
import { stringifyFrontmatter } from "@workledger/core/frontmatter";
import { BACKLOG_ID_PATTERN, ULID_PATTERN } from "@workledger/core/ids";
import { editItem as applyItemEdit, parseItem } from "@workledger/core/render/backlog";
import { parseSessionText, renderNoteLine } from "@workledger/core/render/session";
import { BacklogItem as BacklogItemSchema } from "@workledger/core/schema";

import { gitInfo } from "./git-info.js";
import {
  backlogFile,
  isEnabled,
  ledgerFiles,
  ledgerPaths,
  readTextFile,
  sessionFile,
  writeFileAtomic,
} from "./ledger-fs.js";

import type { ItemPatch, ParsedItem } from "@workledger/core/render/backlog";
import type {
  Actor,
  BacklogItem,
  BacklogStatus,
  HistoryEntry,
  HumanStamp,
  NoteType,
  Priority,
} from "@workledger/core/schema";

// ---------------------------------------------------------------------------
// Context, results and failure
// ---------------------------------------------------------------------------

/** What every operation needs: which ledger, who is writing, and when. */
export interface OpContext {
  /** Repo root — the directory holding `.workledger/`. */
  repoRoot: string;
  /** The writer, resolved from git config by {@link gitActor}. */
  by: Actor;
  /** ISO 8601 with offset. Defaults to now; supplied by tests and by a batching caller. */
  now?: string;
}

/** One item after a mutation — everything a `BacklogView` needs, plus what changed. */
export interface ItemResult {
  id: string;
  /** Absolute path of the file that was written. */
  file: string;
  /** The item's frontmatter as it now stands on disk. */
  item: BacklogItem;
  /** The markdown body as it now stands on disk. */
  body: string;
  /** The history entries this operation appended; empty when the patch was a no-op. */
  history: HistoryEntry[];
}

/** {@link mergeItems}: both files changed, so both come back. */
export interface MergeResult {
  source: ItemResult;
  target: ItemResult;
}

/** One `{cp, index}` pair in a session's `resolved` frontmatter list. */
export interface ResolvedNoteRef {
  cp: number;
  index: number;
}

/** {@link resolveNote}: the decision line that was appended and the list it joined. */
export interface ResolveNoteResult {
  /** Absolute path of the session file that was written. */
  file: string;
  session: string;
  cp: number;
  index: number;
  /** Type of the note that was resolved — `blocker` or `question`. */
  type: NoteType;
  /** The rendered `## Notes` line that was appended. */
  line: string;
  /** The session's `resolved` list after the write. */
  resolved: ResolvedNoteRef[];
}

/**
 * Why an operation refused.
 *
 * `not-enabled` is the repo-level refusal the CLI reports as exit `4` and the server as a 404;
 * everything else — an unknown id, an illegal transition, a malformed argument, a ledger file
 * that does not parse — is `usage`, exit `1`.
 */
export type BacklogOpCode = "usage" | "not-enabled";

/** A refusal with the exit-code class already decided. */
export class BacklogOpError extends Error {
  readonly code: BacklogOpCode;
  /** Lines a caller should print under the message — e.g. the legal transition targets. */
  readonly details: readonly string[];

  constructor(message: string, code: BacklogOpCode = "usage", details: readonly string[] = []) {
    super(message);
    this.name = "BacklogOpError";
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * `gitInfo`'s documented stand-in for a `user.name` / `user.email` that git config does not set.
 * A repo that really does set the literal string is indistinguishable from one that sets nothing,
 * and refusing both is the safe way round: a history entry attributed to "unknown" is worse than
 * a command that tells the user to configure git.
 */
const UNSET_IDENTITY = "unknown";

/**
 * The `Actor` every write is stamped with: the repo's git `user.name` / `user.email`
 * (data-flow §Identity).
 *
 * @param home overrides the user's home directory, so a test never reads the real
 * `~/.gitconfig` and find an identity the fixture did not put there.
 * @returns `undefined` when either is unset — the caller refuses with exit `1` (CLI) or 409
 * (server) rather than inventing an author.
 */
export function gitActor(repoRoot: string, home?: string): Actor | undefined {
  const { author } = gitInfo(repoRoot, home);
  const name = author.name.trim();
  const email = author.email.trim();
  if (name === "" || name === UNSET_IDENTITY) return undefined;
  if (email === "" || email === UNSET_IDENTITY) return undefined;
  return { name, email };
}

// ---------------------------------------------------------------------------
// The status machine
// ---------------------------------------------------------------------------

/**
 * Legal `status` targets from each status (docs/contracts/p2/backlog-cli.md).
 *
 * This is the single source of truth for what each subcommand may do: `accept` asks for
 * `accepted` and is legal from wherever `accepted` is reachable, and so on. Note that a status is
 * never a legal target of itself — accepting an already-accepted item is a refusal, not a no-op,
 * because the alternative is a history full of entries recording that nothing happened.
 */
export const TRANSITIONS: Readonly<Record<BacklogStatus, readonly BacklogStatus[]>> = {
  proposed: ["accepted", "discarded", "done"],
  accepted: ["in_progress", "done", "discarded"],
  in_progress: ["accepted", "done", "discarded"],
  done: ["accepted"],
  discarded: ["proposed"],
};

/** @throws {BacklogOpError} `usage`, listing the legal targets, when the move is not allowed. */
function assertTransition(id: string, from: BacklogStatus, to: BacklogStatus): void {
  const allowed = TRANSITIONS[from];
  if (allowed.includes(to)) return;
  throw new BacklogOpError(`${id} is ${from}; it cannot move to ${to}`, "usage", [
    allowed.length === 0
      ? `no transition is legal from ${from}`
      : `legal targets from ${from}: ${allowed.join(", ")}`,
  ]);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** @throws {BacklogOpError} `not-enabled` when the repo has no `.workledger/`. */
function requireEnabled(repoRoot: string): void {
  if (!isEnabled(repoRoot)) {
    throw new BacklogOpError(
      `${repoRoot} is not an enabled repo; run \`workledger init\``,
      "not-enabled",
    );
  }
}

/** A parsed item plus the file it came from. */
interface FoundItem extends ParsedItem {
  file: string;
  text: string;
}

/**
 * Read one backlog item.
 *
 * The id is matched against `BACKLOG_ID_PATTERN` before it is turned into a path, so a caller —
 * including an HTTP one — cannot walk out of `.workledger/backlog/` with it.
 *
 * @throws {BacklogOpError} `not-enabled` for a repo without a ledger, `usage` for an id that is
 * not a `WL-<ulid>`, names no file, or names a file that does not parse.
 */
export function readItem(repoRoot: string, id: string): FoundItem {
  requireEnabled(repoRoot);
  if (!BACKLOG_ID_PATTERN.test(id)) {
    throw new BacklogOpError(`${JSON.stringify(id)} is not a backlog id of the form WL-<ulid>`);
  }
  const file = backlogFile(repoRoot, id);
  const text = readTextFile(file);
  if (text === undefined) throw new BacklogOpError(`unknown backlog item ${id}`);
  try {
    return { ...parseItem(text), file, text };
  } catch (error) {
    throw asOpError(error, `cannot read ${id}`);
  }
}

/** One row of {@link listItems}. */
export interface ItemSummary {
  id: string;
  item: BacklogItem;
  body: string;
}

/**
 * Every item in the ledger, optionally narrowed to a set of statuses, ordered by `rank` and then
 * by id so two runs over an unchanged ledger print the same lines.
 *
 * A file that does not parse is skipped rather than thrown on — the same rule
 * `listOpenBacklogIds` follows, because one corrupt file must not make the whole backlog
 * unreadable. `workledger doctor` is where a corrupt ledger file is reported.
 */
export function listItems(repoRoot: string, statuses?: readonly BacklogStatus[]): ItemSummary[] {
  requireEnabled(repoRoot);
  const wanted = statuses === undefined || statuses.length === 0 ? undefined : new Set(statuses);
  const rows: ItemSummary[] = [];
  for (const file of ledgerFiles(ledgerPaths(repoRoot).backlog)) {
    const text = readTextFile(file);
    if (text === undefined) continue;
    try {
      const parsed = parseItem(text);
      if (wanted !== undefined && !wanted.has(parsed.frontmatter.status)) continue;
      rows.push({ id: parsed.frontmatter.id, item: parsed.frontmatter, body: parsed.body });
    } catch {
      continue;
    }
  }
  return rows.sort((a, b) =>
    a.item.rank === b.item.rank ? a.id.localeCompare(b.id) : a.item.rank - b.item.rank,
  );
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** The caller's `now`, or the wall clock in the form `dateTime()` accepts. */
function stampOf(ctx: OpContext): string {
  return ctx.now ?? new Date().toISOString();
}

/** Wrap a renderer or validation failure as a `usage` refusal, keeping its detail lines. */
function asOpError(error: unknown, prefix: string): BacklogOpError {
  if (error instanceof BacklogOpError) return error;
  if (error instanceof RenderError) {
    return new BacklogOpError(`${prefix}: ${error.message}`, "usage", error.details);
  }
  return new BacklogOpError(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
}

/** The item as it stands on disk after a write, for the result the caller returns. */
function resultOf(id: string, file: string, text: string, history: HistoryEntry[]): ItemResult {
  const parsed = parseItem(text);
  return { id, file, item: parsed.frontmatter, body: parsed.body, history };
}

/**
 * Read one item, build a patch from what is on disk, and apply it with core's `editItem` — which
 * is what decides that a field re-sent unchanged records no history.
 *
 * `build` sees the current item so it can assert its transition before anything is written.
 */
async function patchItem(
  ctx: OpContext,
  id: string,
  build: (found: FoundItem, now: string) => ItemPatch,
): Promise<ItemResult> {
  const found = readItem(ctx.repoRoot, id);
  const now = stampOf(ctx);
  const patch = build(found, now);
  let text: string;
  let history: HistoryEntry[];
  try {
    const edited = applyItemEdit(found.text, { by: ctx.by, patch, now });
    text = edited.text;
    history = edited.history;
  } catch (error) {
    throw asOpError(error, `cannot edit ${id}`);
  }
  if (history.length === 0) return resultOf(id, found.file, found.text, []);
  writeFileAtomic(found.file, text);
  return resultOf(id, found.file, text, history);
}

/**
 * Apply a change core's `ItemPatch` cannot express, because it must record one history entry with
 * an `op` of the caller's choosing rather than one per changed field. Only `merge` needs this.
 */
function writeItem(
  id: string,
  found: FoundItem,
  changes: Record<string, unknown>,
  body: string,
  entry: HistoryEntry,
  now: string,
): ItemResult {
  const data: Record<string, unknown> = { ...found.data, ...changes };
  const history = Array.isArray(found.data["history"]) ? (found.data["history"] as unknown[]) : [];
  data["history"] = [...history, entry];
  data["updated"] = now;
  try {
    BacklogItemSchema.parse(data);
  } catch (error) {
    throw asOpError(error, `cannot write ${id}`);
  }
  const text = stringifyFrontmatter(data, body);
  writeFileAtomic(found.file, text);
  return resultOf(id, found.file, text, [entry]);
}

// ---------------------------------------------------------------------------
// The eight operations
// ---------------------------------------------------------------------------

/**
 * `proposed | in_progress | done → accepted`, stamping `confirmed_by` with the human who did it.
 *
 * `confirmed_by` is the trust tier the whole backlog rests on (design spec §4.2): an item an
 * agent proposed carries no human endorsement until this runs.
 */
export async function acceptItem(ctx: OpContext, id: string): Promise<ItemResult> {
  return patchItem(ctx, id, (found, now) => {
    assertTransition(id, found.frontmatter.status, "accepted");
    const confirmed: HumanStamp = { name: ctx.by.name, email: ctx.by.email, at: now };
    if (ctx.by.dome_user !== undefined) confirmed.dome_user = ctx.by.dome_user;
    return { status: "accepted", confirmed_by: confirmed };
  });
}

/** `proposed | accepted | in_progress → discarded`. */
export async function discardItem(ctx: OpContext, id: string): Promise<ItemResult> {
  return patchItem(ctx, id, (found) => {
    assertTransition(id, found.frontmatter.status, "discarded");
    return { status: "discarded" };
  });
}

/**
 * `proposed | accepted | in_progress → done`.
 *
 * `done_by` is left alone: it is a `SessionRef` naming the checkpoint that finished the work, and
 * a human closing an item from the UI is not one (backlog-cli.md: "done_by stays null (human
 * closure)").
 */
export async function doneItem(ctx: OpContext, id: string): Promise<ItemResult> {
  return patchItem(ctx, id, (found) => {
    assertTransition(id, found.frontmatter.status, "done");
    return { status: "done" };
  });
}

/** The fields `workledger backlog edit` may change. `null` clears `priority`. */
export interface EditPatch {
  title?: string;
  body?: string;
  priority?: Priority | null;
  area?: readonly string[];
}

/**
 * Edit the human-owned fields. One history entry per field that actually changed, so an
 * idempotent save from the UI does not grow the history.
 *
 * @throws {BacklogOpError} `usage` when the patch carries nothing.
 */
export async function editItem(
  ctx: OpContext,
  id: string,
  patch: EditPatch,
): Promise<ItemResult> {
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new BacklogOpError(`nothing to edit on ${id}: pass --title, --body, --priority or --area`);
  }
  return patchItem(ctx, id, () => {
    const next: ItemPatch = {};
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.body !== undefined) next.body = patch.body;
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.area !== undefined) next.area = [...patch.area];
    return next;
  });
}

/** Set or clear `owner`. `null` is `--none`. */
export async function assignItem(
  ctx: OpContext,
  id: string,
  owner: Actor | null,
): Promise<ItemResult> {
  return patchItem(ctx, id, () => ({ owner }));
}

/** Set `rank`, the manual order within a status group. */
export async function rankItem(ctx: OpContext, id: string, rank: number): Promise<ItemResult> {
  if (!Number.isInteger(rank)) {
    throw new BacklogOpError(`rank must be an integer, got ${JSON.stringify(rank)}`);
  }
  return patchItem(ctx, id, () => ({ rank }));
}

/** The paragraph `mergeItems` appends to the target's body. */
function mergedBody(target: string, source: FoundItem): string {
  const head = target.replace(/\n+$/, "");
  const paragraph = `Merged from ${source.frontmatter.id}: ${source.frontmatter.title}\n${source.body.replace(/\n+$/, "")}`;
  return `${head === "" ? "" : `${head}\n\n`}${paragraph}\n`;
}

/**
 * Fold `sourceId` into `targetId`: the source is discarded, and its title and body are appended
 * to the target's body under a `Merged from …` line (backlog-cli.md).
 *
 * Both files get one history entry with `op: "merge"` — the source's diff names where it went,
 * the target's names where the text came from — so the merge is legible from either end.
 *
 * The target is written first. Neither ordering is transactional across two files, but a crash
 * between the two writes should leave the text preserved on the target rather than a discarded
 * source whose body went nowhere.
 */
export async function mergeItems(
  ctx: OpContext,
  sourceId: string,
  targetId: string,
): Promise<MergeResult> {
  if (sourceId === targetId) {
    throw new BacklogOpError(`cannot merge ${sourceId} into itself`);
  }
  const source = readItem(ctx.repoRoot, sourceId);
  const target = readItem(ctx.repoRoot, targetId);
  assertTransition(sourceId, source.frontmatter.status, "discarded");

  const now = stampOf(ctx);
  const targetResult = writeItem(
    targetId,
    target,
    {},
    mergedBody(target.body, source),
    { at: now, by: { ...ctx.by }, op: "merge", diff: `merged from ${sourceId}` },
    now,
  );
  const sourceResult = writeItem(
    sourceId,
    source,
    { status: "discarded" },
    source.body,
    { at: now, by: { ...ctx.by }, op: "merge", diff: `merged into ${targetId}` },
    now,
  );
  return { source: sourceResult, target: targetResult };
}

// ---------------------------------------------------------------------------
// Note resolution
// ---------------------------------------------------------------------------

/** The note types that can be open, and so the only ones that can be resolved (data-flow). */
const RESOLVABLE: readonly NoteType[] = ["blocker", "question"];

/** The `## Notes` heading, as `parseSessionText` writes and reads it. */
const NOTES_HEADING = "## Notes";

/** Read a session's `resolved` list, tolerating a hand-edited or absent key. */
function readResolved(data: Record<string, unknown>): ResolvedNoteRef[] {
  const raw = data["resolved"];
  if (!Array.isArray(raw)) return [];
  const out: ResolvedNoteRef[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { cp, index } = entry as { cp?: unknown; index?: unknown };
    if (Number.isInteger(cp) && Number.isInteger(index)) {
      out.push({ cp: cp as number, index: index as number });
    }
  }
  return out;
}

/**
 * Insert `line` at the foot of the `## Notes` section.
 *
 * A targeted splice rather than a re-render: `appendCheckpoint` is the only writer that owns the
 * whole body, and re-rendering here to add one line would also normalize blank lines inside every
 * other section of a file a human may have hand-edited.
 */
function appendNoteLine(body: string, line: string): string {
  const lines = body.split("\n");
  const heading = lines.findIndex((entry) => entry.trimEnd() === NOTES_HEADING);
  if (heading === -1) {
    throw new BacklogOpError(`the session body has no \`${NOTES_HEADING}\` section`);
  }
  let end = lines.length;
  for (let i = heading + 1; i < lines.length; i += 1) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  let at = heading + 1;
  for (let i = heading + 1; i < end; i += 1) {
    if (lines[i]!.trim() !== "") at = i + 1;
  }
  lines.splice(at, 0, line);
  return lines.join("\n");
}

/**
 * Resolve one open note (data-flow §Notes resolution).
 *
 * A `decision` note is appended to the session — `- decision [cp n] by human: <text>; reason:
 * resolves <type> #<index>` — and the pair `{cp, index}` joins the session frontmatter's
 * `resolved` list, which is the additive field P2 adds to a `SessionFrontmatter` that is
 * `additionalProperties: true` by contract. Open notes are then the blocker and question notes
 * whose pair is not in that list.
 *
 * `index` is the note's 0-based position **among the notes of checkpoint `cp`**, in file order.
 * Both halves are needed: the checkpoint alone does not identify a note, and a whole-file index
 * would move whenever an earlier checkpoint's line was hand-edited away.
 *
 * @throws {BacklogOpError} `not-enabled` for a repo without a ledger; `usage` for an unknown
 * session, an index that names no note, a note that is not a blocker or a question, or a note
 * that is already resolved.
 */
export async function resolveNote(
  ctx: OpContext,
  session: string,
  cp: number,
  index: number,
  decision: string,
): Promise<ResolveNoteResult> {
  requireEnabled(ctx.repoRoot);
  if (!ULID_PATTERN.test(session)) {
    throw new BacklogOpError(`${JSON.stringify(session)} is not a 26-character session ULID`);
  }
  if (!Number.isInteger(cp) || cp < 1) {
    throw new BacklogOpError(`checkpoint must be a positive integer, got ${JSON.stringify(cp)}`);
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new BacklogOpError(`index must be a non-negative integer, got ${JSON.stringify(index)}`);
  }
  if (decision.trim() === "") throw new BacklogOpError("--decision must not be empty");

  const file = sessionFile(ctx.repoRoot, session);
  const text = readTextFile(file);
  if (text === undefined) throw new BacklogOpError(`unknown session ${session}`);

  let parsed;
  try {
    parsed = parseSessionText(text);
  } catch (error) {
    throw asOpError(error, `cannot read session ${session}`);
  }

  const inCheckpoint = parsed.notes.filter((note) => note.cp === cp);
  const note = inCheckpoint[index];
  if (note === undefined) {
    throw new BacklogOpError(
      `session ${session} has no note #${index} at checkpoint ${cp}`,
      "usage",
      [`checkpoint ${cp} has ${inCheckpoint.length} note(s)`],
    );
  }
  if (!RESOLVABLE.includes(note.type)) {
    throw new BacklogOpError(
      `note #${index} at checkpoint ${cp} is a ${note.type}, which is never open`,
      "usage",
      [`only ${RESOLVABLE.join(" and ")} notes can be resolved`],
    );
  }

  const resolved = readResolved(parsed.data);
  if (resolved.some((entry) => entry.cp === cp && entry.index === index)) {
    throw new BacklogOpError(`note #${index} at checkpoint ${cp} is already resolved`);
  }

  const line = renderNoteLine(cp, {
    type: "decision",
    by: "human",
    text: decision,
    reason: `resolves ${note.type} #${index}`,
  });

  const data: Record<string, unknown> = { ...parsed.data };
  const next = [...resolved, { cp, index }];
  data["resolved"] = next;

  const body = appendNoteLine(bodyOf(text), line);
  writeFileAtomic(file, stringifyFrontmatter(data, body));

  return { file, session, cp, index, type: note.type, line, resolved: next };
}

/**
 * The markdown body of a session file. `parseSessionText` splits the body into records rather
 * than handing it back verbatim, and {@link appendNoteLine} needs the text.
 */
function bodyOf(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]!.trimEnd() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) throw new BacklogOpError("the session file has no frontmatter block");
  const consumed = lines.slice(0, close + 1).join("\n").length;
  return consumed < normalized.length ? normalized.slice(consumed + 1) : "";
}
