import { z } from "zod";

/**
 * The zod source of truth for every P1 file and payload contract.
 *
 * The three frozen JSON Schema artifacts under `docs/contracts/p1/` are *generated* from the
 * schemas in this module by `scripts/export-json-schema.ts`; `packages/core/test/schema-export.test.ts`
 * asserts the export reproduces them byte for byte. Change a constraint here and the export
 * diverges — which is exactly the signal that a contract amendment is needed.
 *
 * This module is pure: no Node built-ins, no I/O. `zod` is its only runtime dependency.
 */

/** Version stamped into the `schema_version` frontmatter key of every ledger artifact. */
export const SCHEMA_VERSION = 1;

/** Guard for the `schema_version` key carried by every ledger file and payload. */
export const schemaVersionSchema = z.literal(SCHEMA_VERSION);

export type SchemaVersion = z.infer<typeof schemaVersionSchema>;

/**
 * The CLI rejects a checkpoint payload larger than this before parsing it (design spec §4.4).
 * Bytes, not characters — measure with {@link payloadByteLength}. Raised from 4096 by the P1
 * contract amendment of 2026-09-10 (#97): a 100-turn session's digest did not fit.
 */
export const MAX_PAYLOAD_BYTES = 16384;

/** Item cap per `done` / `remaining` / `notes` section of a checkpoint payload (design spec §4.4). */
export const MAX_SECTION_ITEMS = 12;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Evidence state of a Done item. */
export const VERIFIED = ["tests-passed", "tests-failed", "not-verified"] as const;
/** Note kinds. `decision` additionally requires `by` and `reason`. */
export const NOTE_TYPES = ["discovery", "decision", "blocker", "question"] as const;
/** How a Remaining item relates to the backlog item it references. */
export const REL = ["updates", "closes"] as const;
/**
 * What caused a checkpoint. P1 emits `bytes`, `minutes`, `turns`, `manual`; `end`, `repair`,
 * `backfill` and `extract` are reserved for P3 so the enum needs no `schema_version` bump
 * (data-flow §3). Precedence when several thresholds cross at once: bytes, minutes, turns.
 */
export const TRIGGERS = [
  "bytes",
  "minutes",
  "turns",
  "manual",
  "end",
  "repair",
  "backfill",
  "extract",
] as const;
/** Lifecycle state of a session file. */
export const SESSION_STATUS = ["open", "ended", "crashed", "repaired"] as const;
/** Lifecycle state of a backlog item. */
export const BACKLOG_STATUS = ["proposed", "accepted", "in_progress", "done", "discarded"] as const;
/** Why a session ended, as reported by the harness. */
export const END_REASONS = ["clean", "clear", "resume", "logout", "crashed", "unknown"] as const;
/** Coding agents workledger observes. */
export const HARNESSES = ["claude-code", "cursor", "codex"] as const;
/** Optional backlog priority band. */
export const PRIORITIES = ["p1", "p2", "p3"] as const;
/** Whether a session was recorded live or reconstructed by backfill. */
export const SOURCES = ["live", "backfill"] as const;
/** Backlog history operations. */
export const HISTORY_OPS = [
  "create",
  "edit",
  "status",
  "assign",
  "rank",
  "merge",
  "update",
  "close",
] as const;
/** Who made a note. */
export const NOTE_BY = ["human", "agent"] as const;

/**
 * `z.enum` with a message shaped for an agent reading stderr:
 * `done[0].verified: expected one of tests-passed, tests-failed, not-verified`.
 */
function enumOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values, { error: `expected one of ${values.join(", ")}` });
}

export const Verified = enumOf(VERIFIED);
export type Verified = z.infer<typeof Verified>;

export const NoteType = enumOf(NOTE_TYPES);
export type NoteType = z.infer<typeof NoteType>;

export const Rel = enumOf(REL);
export type Rel = z.infer<typeof Rel>;

export const Trigger = enumOf(TRIGGERS);
export type Trigger = z.infer<typeof Trigger>;

export const SessionStatus = enumOf(SESSION_STATUS);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const BacklogStatus = enumOf(BACKLOG_STATUS);
export type BacklogStatus = z.infer<typeof BacklogStatus>;

export const EndReason = enumOf(END_REASONS);
export type EndReason = z.infer<typeof EndReason>;

export const Harness = enumOf(HARNESSES);
export type Harness = z.infer<typeof Harness>;

export const Priority = enumOf(PRIORITIES);
export type Priority = z.infer<typeof Priority>;

export const Source = enumOf(SOURCES);
export type Source = z.infer<typeof Source>;

export const HistoryOp = enumOf(HISTORY_OPS);
export type HistoryOp = z.infer<typeof HistoryOp>;

export const NoteBy = enumOf(NOTE_BY);
export type NoteBy = z.infer<typeof NoteBy>;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Crockford base32 ULID, as `.workledger/sessions/<ulid>.md` uses it. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** A backlog id: `WL-` + ULID. */
const BACKLOG_ID = /^WL-[0-9A-HJKMNP-TV-Z]{26}$/;
/** An abbreviated or full lowercase git object name. */
const COMMIT = /^[0-9a-f]{7,40}$/;

const ulid = () => z.string().regex(ULID, "expected a 26-character ULID");
const backlogId = () => z.string().regex(BACKLOG_ID, "expected a backlog id of the form WL-<ulid>");
const dateTime = () => z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// CheckpointPayload — what the agent sends on stdin to `workledger checkpoint`
// ---------------------------------------------------------------------------

/** Object shape of a Done item, before the cross-field evidence rule is applied. */
export const DoneItemObject = z
  .object({
    text: z.string().min(1).max(300).describe("Past tense, one unit of work."),
    files: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe("Repo-relative paths touched."),
    commit: z.string().regex(COMMIT, "expected a 7-40 character lowercase git commit hash").optional(),
    verified: Verified,
  })
  .strict()
  .describe("Needs at least one of a non-empty files list or a commit hash.");

export const DoneItem = DoneItemObject.refine(
  (item) => (item.files?.length ?? 0) > 0 || item.commit !== undefined,
  { error: "needs evidence: a non-empty `files` list or a `commit` hash" },
);
export type DoneItem = z.infer<typeof DoneItem>;

/** Object shape of a Remaining item, before the `new` XOR `ref`+`rel` rule is applied. */
export const RemainingItemObject = z
  .object({
    text: z.string().min(1).max(300).describe("Imperative next action."),
    why: z.string().min(1).max(300),
    new: z.literal(true).optional(),
    ref: backlogId().optional(),
    rel: Rel.optional(),
    blocked_by: z.array(backlogId()).max(10).optional(),
  })
  .strict()
  .describe(
    "Either `new: true`, or `ref` + `rel` naming an existing open backlog item. " +
      "Unknown refs are rejected by the CLI with the list of open ids.",
  );

export const RemainingItem = RemainingItemObject.superRefine((item, ctx) => {
  const isNew = item.new === true;
  const hasRef = item.ref !== undefined;
  const hasRel = item.rel !== undefined;
  if (isNew && (hasRef || hasRel)) {
    ctx.addIssue({
      code: "custom",
      message: "`new: true` cannot be combined with `ref` or `rel` — an item is new or it is not",
    });
    return;
  }
  if (!isNew && !hasRef && !hasRel) {
    ctx.addIssue({
      code: "custom",
      message: "expected either `new: true` or `ref` + `rel` (updates or closes)",
    });
    return;
  }
  if (hasRef !== hasRel) {
    ctx.addIssue({
      code: "custom",
      message: hasRef
        ? "`ref` needs a `rel` of updates or closes"
        : "`rel` needs a `ref` naming an existing backlog item",
    });
  }
});
export type RemainingItem = z.infer<typeof RemainingItem>;

/** Object shape of a Note, before the `decision` rule is applied. */
export const NoteObject = z
  .object({
    type: NoteType,
    text: z.string().min(1).max(500),
    by: NoteBy.optional(),
    reason: z.string().min(1).max(300).optional(),
  })
  .strict()
  .describe("Decisions require `by` and `reason`.");

export const Note = NoteObject.superRefine((note, ctx) => {
  if (note.type !== "decision") return;
  if (note.by === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["by"],
      message: "a decision note requires `by` (human or agent)",
    });
  }
  if (note.reason === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["reason"],
      message: "a decision note requires `reason`",
    });
  }
});
export type Note = z.infer<typeof Note>;

const section = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .max(MAX_SECTION_ITEMS, { error: `at most ${MAX_SECTION_ITEMS} items per section` })
    .default([]);

export const CheckpointPayload = z
  .object({
    goal: z
      .string()
      .min(1)
      .max(400)
      .optional()
      .describe(
        "What the human asked for, in the human's terms. Required at checkpoint 1; " +
          "optional afterwards and replaces the previous goal when present.",
      ),
    done: section(DoneItem),
    remaining: section(RemainingItem),
    notes: section(Note),
  })
  .strict()
  .describe(
    "What the session's agent sends on stdin to `workledger checkpoint`. " +
      "Frozen at P1 Wave 0 (2026-09-09). The zod schema in packages/core/src/schema.ts is the " +
      "source; its export must reproduce this file byte for byte.",
  );
export type CheckpointPayload = z.infer<typeof CheckpointPayload>;

// ---------------------------------------------------------------------------
// SessionFrontmatter — YAML frontmatter of `.workledger/sessions/<ulid>.md`
// ---------------------------------------------------------------------------

export const Actor = z
  .object({
    name: z.string(),
    email: z.string(),
    dome_user: z.string().nullable().optional(),
  })
  .strict();
export type Actor = z.infer<typeof Actor>;

export const Checkpoint = z
  .object({
    n: z.int().min(1),
    at: dateTime(),
    turns: z
      .int()
      .min(0)
      .describe(
        "Cumulative Stop events seen in this session at the time of the checkpoint; " +
          "per-checkpoint deltas are derived by subtraction.",
      ),
    transcript_offset: z
      .int()
      .min(0)
      .describe(
        "Byte size of the transcript file when the checkpoint was recorded; " +
          "the span for checkpoint n is [offset(n-1), offset(n)).",
      ),
    trigger: Trigger.describe(
      "P1 emits bytes, minutes, turns, manual. The rest are reserved for P3 so the enum does " +
        "not need a schema_version bump. Precedence when several thresholds cross at once: " +
        "bytes, minutes, turns.",
    ),
  })
  .strict();
export type Checkpoint = z.infer<typeof Checkpoint>;

export const SessionFrontmatter = z
  .object({
    schema_version: schemaVersionSchema,
    id: ulid().describe("ULID assigned at SessionStart."),
    harness: Harness,
    harness_session_id: z.string().min(1),
    repo: z
      .string()
      .min(1)
      .describe(
        "First git remote's host/path without scheme or .git, else the directory basename.",
      ),
    branch: z.string().nullable().optional(),
    author: Actor,
    started: dateTime(),
    ended: dateTime().nullable().optional(),
    end_reason: EndReason.nullable().optional(),
    status: SessionStatus,
    private: z.boolean(),
    source: Source,
    model: z.string().nullable().optional(),
    needs_repair: z.boolean().default(false),
    checkpoint_failures: z
      .int()
      .min(0)
      .default(0)
      .describe(
        "Times a block was followed by a failed checkpoint attempt and a retry that also failed.",
      ),
    checkpoints: z.array(Checkpoint),
  })
  .loose()
  .describe(
    "YAML frontmatter of `.workledger/sessions/<ulid>.md`. Written only by the CLI. " +
      "Frozen at P1 Wave 0 (2026-09-09).",
  );
export type SessionFrontmatter = z.infer<typeof SessionFrontmatter>;

// ---------------------------------------------------------------------------
// BacklogItem — YAML frontmatter of `.workledger/backlog/WL-<ulid>.md`
// ---------------------------------------------------------------------------

export const HumanStamp = z
  .object({
    name: z.string(),
    email: z.string(),
    dome_user: z.string().nullable().optional(),
    at: dateTime(),
  })
  .strict();
export type HumanStamp = z.infer<typeof HumanStamp>;

export const SessionRef = z
  .object({
    session: ulid(),
    checkpoint: z.int().min(1),
  })
  .strict();
export type SessionRef = z.infer<typeof SessionRef>;

export const Provenance = z
  .object({
    harness: Harness,
    session: ulid(),
    checkpoint: z.int().min(1),
    author: Actor,
  })
  .strict();
export type Provenance = z.infer<typeof Provenance>;

export const HistoryEntry = z
  .object({
    at: dateTime(),
    by: z
      .union([Actor, SessionRef])
      .describe("A human (Actor) for UI edits; a SessionRef for agent-originated changes."),
    op: HistoryOp,
    diff: z
      .string()
      .optional()
      .describe("Human-readable summary of what changed, e.g. 'status: proposed → accepted'."),
  })
  .strict();
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const BacklogItem = z
  .object({
    schema_version: schemaVersionSchema,
    id: backlogId(),
    title: z.string().min(1).max(300),
    status: BacklogStatus,
    proposed_by: Provenance,
    confirmed_by: HumanStamp.nullable().optional(),
    owner: Actor.nullable().optional(),
    priority: Priority.nullable().optional(),
    rank: z
      .int()
      .describe("Manual order within a status group; shared across the team."),
    area: z.array(z.string()).default([]),
    blocked_by: z.array(backlogId()).default([]),
    done_by: SessionRef.nullable().optional(),
    created: dateTime(),
    updated: dateTime(),
    history: z.array(HistoryEntry),
  })
  .loose()
  .describe(
    "YAML frontmatter of `.workledger/backlog/WL-<ulid>.md`. Body is free markdown (initially " +
      "the `why` line). Written only by the CLI. Frozen at P1 Wave 0 (2026-09-09).",
  );
export type BacklogItem = z.infer<typeof BacklogItem>;

// ---------------------------------------------------------------------------
// Config — `.workledger/config.yaml` (docs/contracts/p1/cli.md)
// ---------------------------------------------------------------------------

export const Thresholds = z
  .object({
    bytes: z.int().min(1).default(40000),
    minutes: z.int().min(1).default(20),
    turns: z.int().min(1).default(15),
  })
  .loose();
export type Thresholds = z.infer<typeof Thresholds>;

export const BriefConfig = z
  .object({
    inject: z.boolean().default(true),
    max_tokens: z.int().min(1).default(2000),
  })
  .loose();
export type BriefConfig = z.infer<typeof BriefConfig>;

/** Unknown keys are preserved and ignored (cli.md §`.workledger/config.yaml`). */
export const Config = z
  .object({
    schema_version: schemaVersionSchema,
    harnesses: z.array(Harness).min(1).default(["claude-code"]),
    thresholds: Thresholds.prefault({}),
    brief: BriefConfig.prefault({}),
    stale_turns: z.int().min(1).default(5),
    orphan_minutes: z.int().min(1).default(30),
    private_paths: z.array(z.string()).default([]),
    /**
     * P5 (docs/contracts/p5/config-and-identities.md): `false | on_checkpoint | on_session_end`.
     * `false` stays legal and stays the default; `true` was never a documented value and is not
     * accepted, so a repo that means "commit for me" has to say when.
     */
    auto_commit: z
      .union([z.literal(false), z.enum(["on_checkpoint", "on_session_end"])])
      .default(false),
    /** The email → display-name map, relative to `.workledger/`. */
    identities_file: z.string().default("identities.yaml"),
  })
  .loose();
export type Config = z.infer<typeof Config>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * `goal` is required at checkpoint 1 and optional afterwards (design spec §4.4). That depends on
 * the session's checkpoint counter, which lives in the CLI, so the zod schema keeps `goal`
 * optional and the CLI asks this helper.
 */
export function requiresGoal(checkpointNumber: number): boolean {
  return checkpointNumber <= 1;
}

/**
 * UTF-8 size of a raw payload in bytes — the unit {@link MAX_PAYLOAD_BYTES} is measured in.
 * Counted by hand rather than with `TextEncoder`, which is a host global this package cannot
 * assume (`packages/core` compiles with `"types": []` and no DOM lib).
 */
export function payloadByteLength(raw: string): number {
  let bytes = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(raw.charCodeAt(i + 1))) {
      // A surrogate pair is one code point, encoded in four bytes.
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** One human-readable validation failure, `path` shaped like `done[0].verified`. */
export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

/** Render a zod issue path as `done[0].verified`; the empty path becomes `(payload)`. */
export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "(payload)";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

/**
 * Validate a parsed checkpoint payload. Messages are printed verbatim to an agent on stderr,
 * so they are path-prefixed and say what was expected rather than quoting zod internals.
 */
export function validateCheckpointPayload(input: unknown): ValidationResult<CheckpointPayload> {
  const result = CheckpointPayload.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      message: issue.message,
    })),
  };
}
