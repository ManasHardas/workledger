import { z } from "zod";

import {
  Actor,
  BacklogItem,
  Checkpoint,
  CheckpointPayload,
  DoneItemObject,
  HistoryEntry,
  HumanStamp,
  MAX_PAYLOAD_BYTES,
  MemoryItem,
  NoteObject,
  Provenance,
  RemainingItemObject,
  SessionFrontmatter,
  SessionRef,
} from "@workledger/core";

/**
 * Composition of the three frozen JSON Schema artifacts under `docs/contracts/p1/`.
 *
 * zod is the source for every *constraint* (`type`, `enum`, `pattern`, `minLength`, …), for
 * every prose `description`, for which properties are `required`, and for whether unknown keys
 * are allowed. Each leaf below is `pick()`ed out of `z.toJSONSchema()` output; each `required`
 * list goes through `requiredOf()` and each `additionalProperties` through
 * `additionalPropertiesOf()`. All three throw on mismatch, so a change to
 * `packages/core/src/schema.ts` can never silently drift from the contract: making a field
 * optional, or loosening a `.strict()` object, fails the export instead of quietly rewriting
 * what the frozen file promises.
 *
 * What zod cannot express in JSON Schema is hand-maintained here: `$id`, `title`, the `$defs`/
 * `$ref` split, the cross-field `anyOf`/`oneOf`/`if`-`then` blocks, the `x-limits`/`x-body`
 * annotations, the key order of every object, and which objects are printed on one line.
 *
 * These files are frozen. If zod and the fragments cannot reproduce them byte for byte, that is
 * a contract amendment — never an edit to `docs/contracts/p1/`.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const ID_BASE = "https://workledger.dev/contracts/p1/";

// ---------------------------------------------------------------------------
// Formatting: which nodes are printed across several lines
// ---------------------------------------------------------------------------

const blockNodes = new WeakSet<object>();

/**
 * Mark an object or array as "printed one entry per line". Everything else is printed on a
 * single line, which is how the frozen files are formatted; children of an inline node are
 * always inline.
 */
export function block<T extends JsonObject | JsonValue[]>(node: T): T {
  blockNodes.add(node);
  return node;
}

/** True when {@link block} marked this node. */
export function isBlock(node: object): boolean {
  return blockNodes.has(node);
}

// ---------------------------------------------------------------------------
// zod → JSON Schema, normalized
// ---------------------------------------------------------------------------

const SAFE_INT_MAX = 9007199254740991;

/**
 * zod emits a few things JSON Schema does not need and the frozen contract does not carry:
 * the `$schema` dialect on every sub-schema, the ±2^53-1 bounds `z.int()` adds, the belt-and-
 * braces `pattern` beside `format: "date-time"`, `additionalProperties: {}` for a loose object,
 * and `anyOf: [X, { type: "null" }]` where the contract writes a nullable type array.
 */
function normalize(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    out[key] = normalize(value);
  }

  if (out["type"] === "integer") {
    if (out["maximum"] === SAFE_INT_MAX) delete out["maximum"];
    if (out["minimum"] === -SAFE_INT_MAX) delete out["minimum"];
  }
  if (out["format"] === "date-time") delete out["pattern"];
  if (isPlainObject(out["additionalProperties"]) && Object.keys(out["additionalProperties"]).length === 0) {
    out["additionalProperties"] = true;
  }

  const collapsed = collapseNullable(out);
  return collapsed ?? out;
}

function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ anyOf: [X, { type: "null" }] }` → `{ ...X, type: [X.type, "null"] }` (enum gains `null`). */
function collapseNullable(node: JsonObject): JsonObject | undefined {
  const keys = Object.keys(node);
  if (keys.length !== 1 || keys[0] !== "anyOf") return undefined;
  const variants = node["anyOf"];
  if (!Array.isArray(variants) || variants.length !== 2) return undefined;
  const [head, tail] = variants;
  if (!isPlainObject(head) || !isPlainObject(tail)) return undefined;
  if (tail["type"] !== "null" || Object.keys(tail).length !== 1) return undefined;
  if (typeof head["type"] !== "string") return undefined;

  const out: JsonObject = { type: [head["type"], "null"] };
  for (const [key, value] of Object.entries(head)) {
    if (key === "type") continue;
    out[key] = key === "enum" && Array.isArray(value) ? [...value, null] : value;
  }
  return out;
}

/** Normalized JSON Schema for a whole zod schema. */
function jsonOf(schema: z.ZodType): JsonObject {
  return normalize(z.toJSONSchema(schema, { io: "input" }) as JsonValue) as JsonObject;
}

/** Normalized JSON Schema for each property of a zod object schema. */
function propsOf(schema: z.ZodType): Record<string, JsonObject> {
  const properties = jsonOf(schema)["properties"];
  if (!isPlainObject(properties)) {
    throw new Error("expected an object schema with properties");
  }
  return properties as Record<string, JsonObject>;
}

/**
 * Reorder `source` into `order`, asserting the two key sets are identical. This is the merge
 * point: it fails loudly when zod starts or stops emitting a keyword instead of silently
 * producing a schema that no longer matches the frozen file.
 */
export function pick(source: JsonObject, order: readonly string[], label: string): JsonObject {
  const have = Object.keys(source).sort();
  const want = [...order].sort();
  if (have.length !== want.length || have.some((key, i) => key !== want[i])) {
    throw new Error(
      `${label}: key mismatch — zod produced [${have.join(", ")}], fragment expects [${want.join(", ")}]`,
    );
  }
  const out: JsonObject = {};
  for (const key of order) out[key] = source[key] as JsonValue;
  return out;
}

/**
 * The `required` list zod derives from the schema, asserted to equal the frozen contract's —
 * in order, since JSON Schema `required` is ordered in these files. Making a property optional
 * (or required) in `packages/core/src/schema.ts` fails the export here rather than leaving the
 * contract claiming something zod no longer enforces.
 */
export function requiredOf(
  schema: z.ZodType,
  expected: readonly string[],
  label: string,
): string[] {
  const actual = jsonOf(schema)["required"];
  const have = Array.isArray(actual) ? actual.map(String) : [];
  if (have.length !== expected.length || have.some((key, i) => key !== expected[i])) {
    throw new Error(
      `${label}: required mismatch — zod requires [${have.join(", ")}], fragment expects [${expected.join(", ")}]`,
    );
  }
  return [...expected];
}

/**
 * The unknown-key policy zod derives from `.strict()` / `.loose()`, asserted to equal the frozen
 * contract's `additionalProperties`. Swapping one for the other fails the export.
 */
export function additionalPropertiesOf(
  schema: z.ZodType,
  expected: boolean,
  label: string,
): boolean {
  const actual = jsonOf(schema)["additionalProperties"];
  if (actual !== expected) {
    throw new Error(
      `${label}: additionalProperties mismatch — zod says ${JSON.stringify(actual)}, fragment expects ${JSON.stringify(expected)}`,
    );
  }
  return expected;
}

const ref = (name: string): JsonObject => ({ $ref: `#/$defs/${name}` });

/** The `description` zod carries on a schema, asserted to exist. */
function descriptionOf(schema: z.ZodType, label: string): string {
  const description = jsonOf(schema)["description"];
  if (typeof description !== "string") throw new Error(`${label}: expected a zod .describe()`);
  return description;
}

// ---------------------------------------------------------------------------
// checkpoint-payload.schema.json
// ---------------------------------------------------------------------------

function checkpointPayloadDocument(): JsonObject {
  const root = propsOf(CheckpointPayload);
  const done = propsOf(DoneItemObject);
  const remaining = propsOf(RemainingItemObject);
  const note = propsOf(NoteObject);
  const memory = propsOf(MemoryItem);

  const arraySection = (name: string, def: string): JsonObject =>
    block(
      pick(
        { ...(root[name] as JsonObject), items: ref(def) },
        ["type", "maxItems", "items", "default"],
        `CheckpointPayload.${name}`,
      ),
    );

  // The root carries no `required`: every section defaults, and `goal` is a CLI concern.
  requiredOf(CheckpointPayload, [], "CheckpointPayload");

  return block({
    $schema: SCHEMA_DIALECT,
    $id: `${ID_BASE}checkpoint-payload.schema.json`,
    title: "CheckpointPayload",
    description: descriptionOf(CheckpointPayload, "CheckpointPayload"),
    type: "object",
    additionalProperties: additionalPropertiesOf(CheckpointPayload, false, "CheckpointPayload"),
    properties: block({
      goal: block(
        pick(root["goal"] as JsonObject, ["type", "minLength", "maxLength", "description"], "goal"),
      ),
      done: arraySection("done", "DoneItem"),
      remaining: arraySection("remaining", "RemainingItem"),
      notes: arraySection("notes", "Note"),
      memory: arraySection("memory", "MemoryItem"),
    }),
    $defs: block({
      DoneItem: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(DoneItemObject, false, "DoneItem"),
        required: requiredOf(DoneItemObject, ["text", "verified"], "DoneItem"),
        properties: block({
          text: pick(done["text"] as JsonObject, ["type", "minLength", "maxLength", "description"], "DoneItem.text"),
          detail: pick(done["detail"] as JsonObject, ["type", "minLength", "maxLength", "description"], "DoneItem.detail"),
          files: pick(done["files"] as JsonObject, ["type", "items", "maxItems", "description"], "DoneItem.files"),
          commit: pick(done["commit"] as JsonObject, ["type", "pattern"], "DoneItem.commit"),
          verified: pick(done["verified"] as JsonObject, ["type", "enum"], "DoneItem.verified"),
        }),
        anyOf: block([
          { required: ["files"], properties: { files: { minItems: 1 } } },
          { required: ["commit"] },
        ]),
        description: descriptionOf(DoneItemObject, "DoneItem"),
      }),
      RemainingItem: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(RemainingItemObject, false, "RemainingItem"),
        required: requiredOf(RemainingItemObject, ["text", "why"], "RemainingItem"),
        properties: block({
          text: pick(remaining["text"] as JsonObject, ["type", "minLength", "maxLength", "description"], "RemainingItem.text"),
          why: pick(remaining["why"] as JsonObject, ["type", "minLength", "maxLength"], "RemainingItem.why"),
          new: pick(remaining["new"] as JsonObject, ["type", "const"], "RemainingItem.new"),
          ref: pick(remaining["ref"] as JsonObject, ["type", "pattern"], "RemainingItem.ref"),
          rel: pick(remaining["rel"] as JsonObject, ["type", "enum"], "RemainingItem.rel"),
          blocked_by: pick(
            remaining["blocked_by"] as JsonObject,
            ["type", "items", "maxItems"],
            "RemainingItem.blocked_by",
          ),
        }),
        oneOf: block([
          { required: ["new"], not: { anyOf: [{ required: ["ref"] }, { required: ["rel"] }] } },
          { required: ["ref", "rel"], not: { required: ["new"] } },
        ]),
        description: descriptionOf(RemainingItemObject, "RemainingItem"),
      }),
      Note: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(NoteObject, false, "Note"),
        required: requiredOf(NoteObject, ["type", "text"], "Note"),
        properties: block({
          type: pick(note["type"] as JsonObject, ["type", "enum"], "Note.type"),
          text: pick(note["text"] as JsonObject, ["type", "minLength", "maxLength"], "Note.text"),
          by: pick(note["by"] as JsonObject, ["type", "enum"], "Note.by"),
          reason: pick(note["reason"] as JsonObject, ["type", "minLength", "maxLength"], "Note.reason"),
        }),
        if: { properties: { type: { const: "decision" } } },
        then: { required: ["by", "reason"] },
        description: descriptionOf(NoteObject, "Note"),
      }),
      MemoryItem: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(MemoryItem, false, "MemoryItem"),
        required: requiredOf(MemoryItem, ["text"], "MemoryItem"),
        properties: block({
          text: pick(memory["text"] as JsonObject, ["type", "minLength", "maxLength", "description"], "MemoryItem.text"),
          file: pick(memory["file"] as JsonObject, ["type", "minLength", "description"], "MemoryItem.file"),
        }),
        description: descriptionOf(MemoryItem, "MemoryItem"),
      }),
    }),
    "x-limits": block({
      maxPayloadBytes: MAX_PAYLOAD_BYTES,
      note: "The CLI rejects payloads over maxPayloadBytes before parsing. Caps keep checkpoints short.",
    }),
  });
}

// ---------------------------------------------------------------------------
// session-frontmatter.schema.json
// ---------------------------------------------------------------------------

/** Shared `$defs.Actor`; identical in both file contracts. */
function actorDef(): JsonObject {
  const actor = propsOf(Actor);
  return block({
    type: "object",
    additionalProperties: additionalPropertiesOf(Actor, false, "Actor"),
    required: requiredOf(Actor, ["name", "email"], "Actor"),
    properties: block({
      name: pick(actor["name"] as JsonObject, ["type"], "Actor.name"),
      email: pick(actor["email"] as JsonObject, ["type"], "Actor.email"),
      dome_user: pick(actor["dome_user"] as JsonObject, ["type"], "Actor.dome_user"),
    }),
  });
}

function sessionFrontmatterDocument(): JsonObject {
  const root = propsOf(SessionFrontmatter);
  const cp = propsOf(Checkpoint);

  return block({
    $schema: SCHEMA_DIALECT,
    $id: `${ID_BASE}session-frontmatter.schema.json`,
    title: "SessionFrontmatter",
    description: descriptionOf(SessionFrontmatter, "SessionFrontmatter"),
    type: "object",
    additionalProperties: additionalPropertiesOf(SessionFrontmatter, true, "SessionFrontmatter"),
    required: requiredOf(
      SessionFrontmatter,
      [
        "schema_version",
        "id",
        "harness",
        "harness_session_id",
        "repo",
        "author",
        "started",
        "status",
        "private",
        "source",
        "checkpoints",
      ],
      "SessionFrontmatter",
    ),
    properties: block({
      // zod models `schema_version` as `z.literal(1)`, which JSON Schema types as a number;
      // the contract narrows it to an integer.
      schema_version: pick(
        { ...(root["schema_version"] as JsonObject), type: "integer" },
        ["type", "const"],
        "SessionFrontmatter.schema_version",
      ),
      id: pick(root["id"] as JsonObject, ["type", "pattern", "description"], "SessionFrontmatter.id"),
      harness: pick(root["harness"] as JsonObject, ["type", "enum"], "SessionFrontmatter.harness"),
      harness_session_id: pick(
        root["harness_session_id"] as JsonObject,
        ["type", "minLength"],
        "SessionFrontmatter.harness_session_id",
      ),
      repo: pick(root["repo"] as JsonObject, ["type", "minLength", "description"], "SessionFrontmatter.repo"),
      branch: pick(root["branch"] as JsonObject, ["type"], "SessionFrontmatter.branch"),
      author: ref("Actor"),
      started: pick(root["started"] as JsonObject, ["type", "format"], "SessionFrontmatter.started"),
      ended: pick(root["ended"] as JsonObject, ["type", "format"], "SessionFrontmatter.ended"),
      end_reason: pick(root["end_reason"] as JsonObject, ["type", "enum"], "SessionFrontmatter.end_reason"),
      status: pick(root["status"] as JsonObject, ["type", "enum"], "SessionFrontmatter.status"),
      private: pick(root["private"] as JsonObject, ["type"], "SessionFrontmatter.private"),
      source: pick(root["source"] as JsonObject, ["type", "enum"], "SessionFrontmatter.source"),
      model: pick(root["model"] as JsonObject, ["type"], "SessionFrontmatter.model"),
      needs_repair: pick(root["needs_repair"] as JsonObject, ["type", "default"], "SessionFrontmatter.needs_repair"),
      checkpoint_failures: pick(
        root["checkpoint_failures"] as JsonObject,
        ["type", "minimum", "default", "description"],
        "SessionFrontmatter.checkpoint_failures",
      ),
      checkpoints: block(
        pick(
          { ...(root["checkpoints"] as JsonObject), items: ref("Checkpoint") },
          ["type", "items"],
          "SessionFrontmatter.checkpoints",
        ),
      ),
      // P8 amendment 10 (2026-09-10): optional, additive.
      started_in: pick(root["started_in"] as JsonObject, ["type", "minLength", "description"], "SessionFrontmatter.started_in"),
      about: pick(root["about"] as JsonObject, ["type", "items", "description"], "SessionFrontmatter.about"),
    }),
    $defs: block({
      Actor: actorDef(),
      Checkpoint: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(Checkpoint, false, "Checkpoint"),
        required: requiredOf(
          Checkpoint,
          ["n", "at", "turns", "transcript_offset", "trigger"],
          "Checkpoint",
        ),
        properties: block({
          n: pick(cp["n"] as JsonObject, ["type", "minimum"], "Checkpoint.n"),
          at: pick(cp["at"] as JsonObject, ["type", "format"], "Checkpoint.at"),
          turns: pick(cp["turns"] as JsonObject, ["type", "minimum", "description"], "Checkpoint.turns"),
          transcript_offset: pick(
            cp["transcript_offset"] as JsonObject,
            ["type", "minimum", "description"],
            "Checkpoint.transcript_offset",
          ),
          trigger: pick(cp["trigger"] as JsonObject, ["type", "enum", "description"], "Checkpoint.trigger"),
        }),
      }),
    }),
    "x-body": block({
      sections: ["## Goal", "## Done", "## Remaining", "## Notes", "## Memory"],
      "line-prefix": "- [cp <n>] ",
      "goal-form":
        "- [cp <n>] <goal>; the Goal section holds exactly one line, replaced (not appended) whenever a payload carries a goal",
      "section-order":
        "Done and Remaining are newest-checkpoint-first; Notes is chronological; payload order is kept within one checkpoint",
      "done-form":
        "- [cp <n>] <gist>, then one continuation line indented by two spaces carrying 'detail: <detail> · commit: <hash> · files: <a>, <b> · verified: <v>'; attributes in that order joined by ' · ' (U+00B7 with a space either side); detail, commit and files omitted when absent; verified always present. Lines written before amendment 11 carry 'files: … · commit: … · verified: …' inline after the text and still parse",
      "remaining-form":
        "- [cp <n>] → WL-<ulid> (new|updates|closes) <text>; why: <why>; then '; blocked_by: <ids joined by \", \">' only when the payload carries the key, 'none' when present and empty",
      "note-form":
        "- <type> [cp <n>]<' by <by>' for decisions>: <text><'; reason: <reason>' for decisions>",
      "memory-form":
        "- [cp <n>] <text><' file: <path>' when the item names one>; the section is chronological like Notes and is absent from a file written before amendment 11",
      "unparsed-lines":
        "a line matching no form is preserved verbatim at the foot of its own section and exposed by the parser as unparsed[]; blank lines inside a section are structural and not preserved",
      amended:
        "2026-09-09 amendment 2: goal-form, section-order, done-form, remaining-form, unparsed-lines frozen from PR #22 golden files; 2026-09-10 P8 amendment 11: done-form gains the indented continuation, sections and memory-form gain ## Memory",
    }),
  });
}

// ---------------------------------------------------------------------------
// backlog-item.schema.json
// ---------------------------------------------------------------------------

/** `{ "oneOf": [ { "type": "null" }, { "$ref": … } ] }` — zod emits a bare `anyOf` union. */
const nullableRef = (name: string): JsonObject => ({ oneOf: [{ type: "null" }, ref(name)] });

function backlogItemDocument(): JsonObject {
  const root = propsOf(BacklogItem);
  const stamp = propsOf(HumanStamp);
  const sessionRef = propsOf(SessionRef);
  const provenance = propsOf(Provenance);
  const history = propsOf(HistoryEntry);

  return block({
    $schema: SCHEMA_DIALECT,
    $id: `${ID_BASE}backlog-item.schema.json`,
    title: "BacklogItem",
    description: descriptionOf(BacklogItem, "BacklogItem"),
    type: "object",
    additionalProperties: additionalPropertiesOf(BacklogItem, true, "BacklogItem"),
    required: requiredOf(
      BacklogItem,
      [
        "schema_version",
        "id",
        "title",
        "status",
        "proposed_by",
        "rank",
        "created",
        "updated",
        "history",
      ],
      "BacklogItem",
    ),
    properties: block({
      schema_version: pick(
        { ...(root["schema_version"] as JsonObject), type: "integer" },
        ["type", "const"],
        "BacklogItem.schema_version",
      ),
      id: pick(root["id"] as JsonObject, ["type", "pattern"], "BacklogItem.id"),
      title: pick(root["title"] as JsonObject, ["type", "minLength", "maxLength"], "BacklogItem.title"),
      status: pick(root["status"] as JsonObject, ["type", "enum"], "BacklogItem.status"),
      proposed_by: ref("Provenance"),
      confirmed_by: nullableRef("HumanStamp"),
      owner: nullableRef("Actor"),
      priority: pick(root["priority"] as JsonObject, ["type", "enum"], "BacklogItem.priority"),
      // `rank` is required by the contract but carries a documented default for writers, which
      // is a JSON Schema annotation zod's `.default()` cannot express without making it optional.
      rank: pick({ ...(root["rank"] as JsonObject), default: 0 }, ["type", "default", "description"], "BacklogItem.rank"),
      area: pick(root["area"] as JsonObject, ["type", "items", "default"], "BacklogItem.area"),
      blocked_by: pick(root["blocked_by"] as JsonObject, ["type", "items", "default"], "BacklogItem.blocked_by"),
      done_by: nullableRef("SessionRef"),
      created: pick(root["created"] as JsonObject, ["type", "format"], "BacklogItem.created"),
      updated: pick(root["updated"] as JsonObject, ["type", "format"], "BacklogItem.updated"),
      history: pick(
        { ...(root["history"] as JsonObject), items: ref("HistoryEntry") },
        ["type", "items"],
        "BacklogItem.history",
      ),
    }),
    $defs: block({
      Actor: actorDef(),
      HumanStamp: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(HumanStamp, false, "HumanStamp"),
        required: requiredOf(HumanStamp, ["name", "email", "at"], "HumanStamp"),
        properties: block({
          name: pick(stamp["name"] as JsonObject, ["type"], "HumanStamp.name"),
          email: pick(stamp["email"] as JsonObject, ["type"], "HumanStamp.email"),
          dome_user: pick(stamp["dome_user"] as JsonObject, ["type"], "HumanStamp.dome_user"),
          at: pick(stamp["at"] as JsonObject, ["type", "format"], "HumanStamp.at"),
        }),
      }),
      SessionRef: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(SessionRef, false, "SessionRef"),
        required: requiredOf(SessionRef, ["session", "checkpoint"], "SessionRef"),
        properties: block({
          session: pick(sessionRef["session"] as JsonObject, ["type", "pattern"], "SessionRef.session"),
          checkpoint: pick(sessionRef["checkpoint"] as JsonObject, ["type", "minimum"], "SessionRef.checkpoint"),
        }),
      }),
      Provenance: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(Provenance, false, "Provenance"),
        required: requiredOf(
          Provenance,
          ["harness", "session", "checkpoint", "author"],
          "Provenance",
        ),
        properties: block({
          harness: pick(provenance["harness"] as JsonObject, ["type", "enum"], "Provenance.harness"),
          session: pick(provenance["session"] as JsonObject, ["type", "pattern"], "Provenance.session"),
          checkpoint: pick(provenance["checkpoint"] as JsonObject, ["type", "minimum"], "Provenance.checkpoint"),
          author: ref("Actor"),
        }),
      }),
      HistoryEntry: block({
        type: "object",
        additionalProperties: additionalPropertiesOf(HistoryEntry, false, "HistoryEntry"),
        required: requiredOf(HistoryEntry, ["at", "by", "op"], "HistoryEntry"),
        properties: block({
          at: pick(history["at"] as JsonObject, ["type", "format"], "HistoryEntry.at"),
          by: block({
            oneOf: block([ref("Actor"), ref("SessionRef")]),
            description: descriptionOf(HistoryEntry.shape.by, "HistoryEntry.by"),
          }),
          op: pick(history["op"] as JsonObject, ["type", "enum"], "HistoryEntry.op"),
          diff: pick(history["diff"] as JsonObject, ["type", "description"], "HistoryEntry.diff"),
        }),
      }),
    }),
  });
}

/** One frozen artifact: its path relative to the repo root, and its composed value. */
export interface ContractDocument {
  path: string;
  value: JsonObject;
}

/** Compose all three frozen artifacts. Pure — no I/O. */
export function buildDocuments(): ContractDocument[] {
  return [
    { path: "docs/contracts/p1/checkpoint-payload.schema.json", value: checkpointPayloadDocument() },
    {
      path: "docs/contracts/p1/session-frontmatter.schema.json",
      value: sessionFrontmatterDocument(),
    },
    { path: "docs/contracts/p1/backlog-item.schema.json", value: backlogItemDocument() },
  ];
}
