/**
 * Shared vocabulary for the two ledger renderers.
 *
 * Both `render/session.ts` and `render/backlog.ts` are pure text-in/text-out: they never touch
 * the filesystem, never read a clock, and never mint an id. Every timestamp and every ULID is
 * handed in by `packages/cli`, which is what makes a rendered file reproducible from its inputs
 * and what keeps `packages/core` inside its purity fence (CLAUDE.md).
 */
import { formatIssuePath } from "../schema.js";

import type { ZodType } from "zod";


/** The reason a render was refused. Mapped to CLI exit codes by `packages/cli`. */
export type RenderErrorCode =
  /** The file handed in is not a valid ledger artifact of the expected kind. */
  | "invalid-document"
  /** The payload, stamp, or patch handed in does not satisfy its schema. */
  | "invalid-input"
  /** Checkpoint `n` is already recorded in this session file (see the idempotency rule). */
  | "duplicate-checkpoint"
  /** A Remaining item names a backlog id the caller did not resolve. */
  | "unresolved-ref";

/**
 * A render that cannot proceed. Distinct from `FrontmatterError` (a malformed `---` block) and
 * from a zod failure (a malformed payload) so the CLI can tell "your input is wrong" from
 * "the file on disk is wrong" without string matching.
 */
export class RenderError extends Error {
  readonly code: RenderErrorCode;
  /** Zero or more `path: message` lines, shaped for stderr the way `schema.ts` shapes them. */
  readonly details: readonly string[];

  constructor(
    message: string,
    code: RenderErrorCode,
    details: readonly string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RenderError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Wrap a failure from `frontmatter.ts` as a {@link RenderError} without throwing away what makes
 * a corrupt ledger file debuggable.
 *
 * `parseFrontmatter` computes a 1-based document line; interpolating only its message would force
 * the CLI to string-match a message it just built to recover that number — the coupling `details`
 * exists to avoid. So the line goes into `details` in the same `<where>: <message>` shape, and the
 * original error is threaded through as `cause`.
 */
export function documentError(what: string, error: unknown): RenderError {
  const message = error instanceof Error ? error.message : String(error);
  const line = (error as { line?: unknown }).line;
  const details = typeof line === "number" ? [`line ${line}: ${message}`] : [];
  return new RenderError(`${what}: ${message}`, "invalid-document", details, { cause: error });
}

/** Separator between the evidence attributes of a Done line: U+00B7 with a space either side. */
export const ATTR_SEPARATOR = " · ";
/** The arrow that opens a Remaining line's backlog reference (`x-body.remaining-ref-form`). */
export const REF_ARROW = "→";

/**
 * Collapse a scalar to something that can live on one line.
 *
 * The schemas cap `text`, `why`, and `reason` by length but not by content, so an agent may send
 * a payload with an embedded newline — which would otherwise split one logical entry into two
 * lines and make `[cp n]` provenance ambiguous for the second. Every run of whitespace becomes a
 * single space and the result is trimmed. This is the only normalization the renderers apply to
 * agent text; nothing else is rewritten or escaped.
 */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Render `[cp <n>]`, the token that binds a line to a transcript span (data-flow §4). */
export function cpTag(n: number): string {
  return `[cp ${n}]`;
}

/**
 * Parse a leading `- [cp <n>] `; returns the number and the rest, or `undefined` if absent.
 *
 * `n` is a join key for the brief and for P2's UI, so a value past `Number.MAX_SAFE_INTEGER` is
 * treated as an unrecognized line rather than silently handed on as a float.
 */
export function readCpPrefix(line: string): { n: number; rest: string } | undefined {
  const match = /^- \[cp (\d+)\] /.exec(line);
  if (match === null) return undefined;
  const n = Number(match[1]);
  if (!Number.isSafeInteger(n)) return undefined;
  return { n, rest: line.slice(match[0].length) };
}

/**
 * A `key: value` pair from an attribute run, or `undefined` when `segment` does not start with
 * `<key>: `. Used to walk a Done or Remaining line right to left over known keys, so no part of
 * the parse ever has to guess where prose ends.
 *
 * The value is right-trimmed so a hand-edited `verified: tests-passed   ` is still recognized as
 * the enum member it obviously is rather than dropped from the parse over trailing spaces.
 */
export function readAttribute(segment: string, key: string): string | undefined {
  const marker = `${key}: `;
  return segment.startsWith(marker) ? segment.slice(marker.length).trimEnd() : undefined;
}

/** Split a comma-joined list back into its members, dropping empties. */
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Validate `value` through a zod schema, re-throwing a failure as a {@link RenderError} whose
 * `details` are the `path: message` lines `schema.ts` shapes for stderr.
 */
export function validate<T>(
  schema: ZodType<T>,
  value: unknown,
  what: string,
  code: RenderErrorCode,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new RenderError(
    `${what} is not valid`,
    code,
    result.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`),
  );
}
