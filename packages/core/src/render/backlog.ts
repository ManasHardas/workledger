/**
 * Rendering and parsing of `.workledger/backlog/WL-<ulid>.md`.
 *
 * A backlog item is frontmatter (design spec §4.2, `backlog-item.schema.json`) plus a free
 * markdown body that starts life as the `why` line from the checkpoint that proposed it. Four
 * mutations exist, and every one of them obeys the same three rules:
 *
 * - `updated` is set to the caller's `now` on **every** write, including a no-op close.
 * - Exactly one `history` entry is appended per logical change — per *changed field* for
 *   {@link editItem}, which is the only mutation that can change several at once.
 * - `by` is a `SessionRef` (`{ session, checkpoint }`) for anything an agent's checkpoint caused
 *   and an `Actor` for a human edit from P2's UI. That distinction is the trust tier the spec
 *   builds `confirmed_by` on, so it is never blurred.
 *
 * Writes go through the frontmatter mapping exactly as it was read, so unknown keys and key order
 * survive a mutation — both P1 file contracts are `additionalProperties: true`, and a key this
 * build does not know is data, not noise. The result is validated against `BacklogItem` before it
 * is stringified, so a mutation can never produce a file the next read would reject.
 *
 * This module is pure: no Node built-ins, no clock, no id minting.
 */
import {
  type Actor,
  type BacklogItem,
  type BacklogStatus,
  type HistoryEntry,
  type HumanStamp,
  type Priority,
  type Provenance,
  type SessionRef,
  BacklogItem as BacklogItemSchema,
  Provenance as ProvenanceSchema,
  SCHEMA_VERSION,
  SessionRef as SessionRefSchema,
} from "../schema.js";
import { parseFrontmatter, stringifyFrontmatter } from "../frontmatter.js";
import { RenderError, cpTag, oneLine, validate } from "./common.js";

/** The arrow that separates the old and new value in a `history[].diff` (spec §4.2). */
const DIFF_ARROW = "→";
/** Rendered in a diff for a value that is absent or null. */
const NONE = "none";
/** The `diff` a close records when the item was already `done` (data-flow §3). */
export const ALREADY_DONE = "already done";

/** A backlog item split into its frontmatter and its markdown body. */
export interface ParsedItem {
  /** The validated frontmatter — what a reader should use. */
  frontmatter: BacklogItem;
  /** The mapping exactly as it was read, key order and unknown keys intact. */
  data: Record<string, unknown>;
  /** Everything after the closing `---`, verbatim. */
  body: string;
}

/** A mutation's result: the new file text and the history it appended. */
export interface MutationResult {
  text: string;
  history: HistoryEntry;
}

/** {@link editItem}'s result: one history entry per field the patch actually changed. */
export interface EditResult {
  text: string;
  history: HistoryEntry[];
}

/** What {@link createItem} needs to mint the file for a `new: true` Remaining item. */
export interface CreateItemInput {
  /** The `WL-<ulid>` id minted by the caller. */
  id: string;
  title: string;
  /** The Remaining item's `why`; becomes the first line of the body. */
  why: string;
  /** The checkpoint that proposed the item. */
  provenance: Provenance;
  /** Other `WL-` ids this item waits on. */
  blockedBy?: readonly string[];
  /** ISO 8601 timestamp with offset; becomes `created`, `updated`, and `history[0].at`. */
  now: string;
}

/** What {@link applyUpdate} needs: the checkpoint that advanced the item, and its new `why`. */
export interface ApplyUpdateInput {
  session: string;
  checkpoint: number;
  why: string;
  now: string;
}

/** What {@link closeItem} needs: the checkpoint that closed the item. */
export interface CloseItemInput {
  session: string;
  checkpoint: number;
  now: string;
}

/**
 * The fields P2's UI may change. Every key is optional; a key whose value equals what is already
 * there is not a change and records no history. `null` is a real value for the nullable fields —
 * it clears them — so `undefined` is the only way to say "leave this alone".
 */
export interface ItemPatch {
  title?: string;
  status?: BacklogStatus;
  owner?: Actor | null;
  priority?: Priority | null;
  confirmed_by?: HumanStamp | null;
  rank?: number;
  area?: readonly string[];
  blocked_by?: readonly string[];
  /** Replaces the markdown body wholesale. */
  body?: string;
}

/** What {@link editItem} needs: who edited, what they changed, and when. */
export interface EditItemInput {
  by: Actor;
  patch: ItemPatch;
  now: string;
}

/** The `history[].op` each patched field records (spec §4.2 `op` enum). */
const PATCH_OPS = {
  title: "edit",
  status: "status",
  owner: "assign",
  priority: "edit",
  confirmed_by: "edit",
  rank: "rank",
  area: "edit",
  blocked_by: "edit",
  body: "edit",
} as const satisfies Record<keyof ItemPatch, HistoryEntry["op"]>;

/** The order patched fields are applied and their history recorded in — stable, not patch order. */
const PATCH_FIELDS = Object.keys(PATCH_OPS) as (keyof ItemPatch)[];

// ---------------------------------------------------------------------------
// Diff rendering
// ---------------------------------------------------------------------------

/** Render a value for a `history[].diff`: readable, one line, and stable across runs. */
function show(value: unknown): string {
  if (value === undefined || value === null) return NONE;
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.map((entry) => show(entry)).join(", ")}]`;
  }
  if (typeof value === "object") {
    // `Actor` and `HumanStamp` are the only object-valued fields an `ItemPatch` can carry, and
    // both require a name and an email — so there is no third shape to fall back for.
    const actor = value as { name: string; email: string };
    return `${actor.name} <${actor.email}>`;
  }
  return oneLine(String(value));
}

/** `<field>: <old> → <new>`, the diff form the spec gives as `status: proposed → accepted`. */
function diffOf(field: string, before: unknown, after: unknown): string {
  return `${field}: ${show(before)} ${DIFF_ARROW} ${show(after)}`;
}

/** Structural equality, enough for the scalar / array / small-object values a patch carries. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) {
    return (a ?? null) === (b ?? null);
  }
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

/**
 * Read a backlog file.
 *
 * @throws {RenderError} when the frontmatter is missing, unparseable, or fails `BacklogItem`.
 */
export function parseItem(text: string): ParsedItem {
  let parsed;
  try {
    parsed = parseFrontmatter(text);
  } catch (error) {
    throw new RenderError(
      `not a backlog item: ${error instanceof Error ? error.message : String(error)}`,
      "invalid-document",
    );
  }
  const frontmatter = validate(
    BacklogItemSchema,
    parsed.data,
    "the backlog item frontmatter",
    "invalid-document",
  );
  return { frontmatter, data: parsed.data, body: parsed.body };
}

/** Validate a mutated mapping and render it back to file text. */
function write(data: Record<string, unknown>, body: string): string {
  validate(BacklogItemSchema, data, "the rendered backlog item", "invalid-input");
  return stringifyFrontmatter(data, body);
}

/** Append `entry` to the item's `history`, creating the key if a hand-edited file dropped it. */
function pushHistory(data: Record<string, unknown>, entry: HistoryEntry): void {
  const history = Array.isArray(data["history"]) ? (data["history"] as unknown[]) : [];
  data["history"] = [...history, entry];
}

/**
 * A fresh copy of the editing actor for each history entry.
 *
 * `yaml` emits an anchor and alias (`&a1` / `*a1`) whenever one object *reference* appears twice
 * in a document, so reusing the caller's `by` across the entries of a multi-field edit would put
 * anchors in a file humans hand-edit. `Actor` is three scalars, so a shallow copy is enough.
 */
function actorCopy(by: Actor): Actor {
  return { ...by };
}

/** Add `line` as a new paragraph at the end of the body. */
function appendBodyLine(body: string, line: string): string {
  const trimmed = body.replace(/\n+$/, "");
  return trimmed === "" ? `${line}\n` : `${trimmed}\n\n${line}\n`;
}

/** The `by` stamp for an agent-originated change, validated as a `SessionRef`. */
function sessionRef(session: string, checkpoint: number): SessionRef {
  return validate(
    SessionRefSchema,
    { session, checkpoint },
    "the session reference",
    "invalid-input",
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * The initial contents of `.workledger/backlog/WL-<ulid>.md`, written when a checkpoint's
 * Remaining item carries `new: true`.
 *
 * Keys are emitted in the order the design spec §4.2 lists them, so every file this build writes
 * reads the same way. The item starts `proposed`: `confirmed_by` stays null until a human accepts
 * it in the UI, which is the trust tier the whole backlog rests on.
 *
 * @throws {RenderError} when the id, title, provenance, or timestamp is not valid.
 */
export function createItem(input: CreateItemInput): string {
  const provenance = validate(
    ProvenanceSchema,
    input.provenance,
    "the item provenance",
    "invalid-input",
  );
  const history: HistoryEntry = {
    at: input.now,
    by: { session: provenance.session, checkpoint: provenance.checkpoint },
    op: "create",
    diff: `created ${cpTag(provenance.checkpoint)}`,
  };
  const data: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    id: input.id,
    title: oneLine(input.title),
    status: "proposed",
    proposed_by: provenance,
    confirmed_by: null,
    owner: null,
    priority: null,
    rank: 0,
    area: [],
    blocked_by: [...(input.blockedBy ?? [])],
    done_by: null,
    created: input.now,
    updated: input.now,
    history: [history],
  };
  return write(data, `${oneLine(input.why)}\n`);
}

/**
 * Record that a checkpoint advanced an open item without closing it (`rel: updates`).
 *
 * The new `why` is appended to the body as a `- [cp n] …` line — the same prefix the session
 * digest uses — so the body reads as the original rationale followed by a dated log of what each
 * checkpoint since has said about it. `status` is not touched: advancing an item is not the same
 * as accepting or starting it, and those transitions belong to the UI.
 *
 * @throws {RenderError} when the file or the input is not valid.
 */
export function applyUpdate(text: string, input: ApplyUpdateInput): MutationResult {
  const item = parseItem(text);
  const by = sessionRef(input.session, input.checkpoint);
  const why = oneLine(input.why);
  const history: HistoryEntry = {
    at: input.now,
    by,
    op: "update",
    diff: `why: ${why}`,
  };

  const data = { ...item.data };
  data["updated"] = input.now;
  pushHistory(data, history);

  return {
    text: write(data, appendBodyLine(item.body, `- ${cpTag(input.checkpoint)} ${why}`)),
    history,
  };
}

/**
 * Close an item from a checkpoint (`rel: closes`): `status` becomes `done` and `done_by` records
 * the checkpoint that did it.
 *
 * Closing an item that is already `done` is an accepted no-op, not an error (data-flow §3): a
 * session may legitimately report finishing something a previous session already closed, and
 * failing the whole checkpoint over it would lose the rest of the payload. The no-op still writes
 * — `updated` moves and a `close` entry with diff `"already done"` is appended — because the fact
 * that a second session believed it was closing this item is itself worth keeping. `done_by`
 * keeps the checkpoint that actually closed it.
 *
 * @throws {RenderError} when the file or the input is not valid.
 */
export function closeItem(text: string, input: CloseItemInput): MutationResult {
  const item = parseItem(text);
  const by = sessionRef(input.session, input.checkpoint);
  const alreadyDone = item.frontmatter.status === "done";

  const history: HistoryEntry = {
    at: input.now,
    by,
    op: "close",
    diff: alreadyDone ? ALREADY_DONE : diffOf("status", item.frontmatter.status, "done"),
  };

  const data = { ...item.data };
  if (!alreadyDone) {
    data["status"] = "done";
    data["done_by"] = { session: by.session, checkpoint: by.checkpoint };
  }
  data["updated"] = input.now;
  pushHistory(data, history);

  return { text: write(data, item.body), history };
}

/**
 * Apply a human's edit from P2's UI.
 *
 * One history entry per field the patch actually changes — a patch that re-sends the value
 * already on disk is not a change and records nothing, so an idempotent UI save does not grow
 * the history. Fields are applied in a fixed order rather than the patch's key order, so two UIs
 * sending the same edit produce the same file.
 *
 * `status: "done"` set from here leaves `done_by` alone: `done_by` is a `SessionRef` naming the
 * checkpoint that finished the work, and a human clicking Done in the UI is not one.
 *
 * @throws {RenderError} when the file or the resulting item is not valid.
 */
export function editItem(text: string, input: EditItemInput): EditResult {
  const item = parseItem(text);
  const data = { ...item.data };
  let body = item.body;
  const history: HistoryEntry[] = [];

  for (const field of PATCH_FIELDS) {
    const next = input.patch[field];
    if (next === undefined) continue;

    if (field === "body") {
      const nextBody = next as string;
      if (nextBody === body) continue;
      body = nextBody;
      history.push({
        at: input.now,
        by: actorCopy(input.by),
        op: PATCH_OPS.body,
        diff: "body: rewritten",
      });
      continue;
    }

    const before = data[field];
    const after = Array.isArray(next) ? [...next] : next;
    if (same(before, after)) continue;
    data[field] = after;
    history.push({
      at: input.now,
      by: actorCopy(input.by),
      op: PATCH_OPS[field],
      diff: diffOf(field, before, after),
    });
  }

  if (history.length === 0) return { text, history };

  data["updated"] = input.now;
  for (const entry of history) pushHistory(data, entry);

  return { text: write(data, body), history };
}
