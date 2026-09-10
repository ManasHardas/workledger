/**
 * The write backend the server is given rather than the one it imports.
 *
 * `docs/contracts/p2/api.md` says "every POST calls the same function the CLI command calls" and
 * "the server never writes ledger files directly". Those functions live in
 * `packages/cli/src/backlog-ops.ts`, and there are exactly two ways to let this package reach
 * them: move them into a third package both depend on, or let the caller pass them in. This file
 * is the second. `packages/cli` already depends on `@workledger/server` to run `workledger
 * serve`, so importing back the other way would be a cycle, and `packages/cli` ships as a single
 * bundled `dist/main.js` with no exports map — there is nothing for this package to import even
 * if the cycle were acceptable.
 *
 * What is declared here is the *shape* of that backend, not a second implementation. The CLI's
 * module satisfies it structurally, so `tsc` checks at the injection site
 * (`packages/cli/src/commands/serve.ts`) that the two have not drifted — a rename in
 * `backlog-ops.ts` is a compile error there, not a 500 at runtime.
 */
import type { Actor, BacklogItem, HistoryEntry, NoteType, Priority } from "@workledger/core/schema";

/** What every operation needs: which ledger, who is writing, and when. */
export interface OpContext {
  /** Repo root — the directory holding `.workledger/`. */
  repoRoot: string;
  /** The writer, resolved from the repo's git config (data-flow §Identity). */
  by: Actor;
  /** ISO 8601. Defaults to now inside the op. */
  now?: string;
}

/** One item after a mutation. */
export interface ItemResult {
  id: string;
  file: string;
  item: BacklogItem;
  body: string;
  history: HistoryEntry[];
}

/** A merge touches two files, so both come back. */
export interface MergeResult {
  source: ItemResult;
  target: ItemResult;
}

/** The `{cp, index}` pairs a session's `resolved` frontmatter list holds. */
export interface ResolvedNoteRef {
  cp: number;
  index: number;
}

/** What `resolveNote` reports about the decision line it appended. */
export interface ResolveNoteResult {
  file: string;
  session: string;
  cp: number;
  index: number;
  type: NoteType;
  line: string;
  resolved: ResolvedNoteRef[];
}

/** The fields `POST /api/backlog/:id/edit` may change. `null` clears `priority`. */
export interface EditPatch {
  title?: string;
  body?: string;
  priority?: Priority | null;
  area?: readonly string[];
}

/**
 * Why an operation refused, in the four classes the HTTP contract needs.
 *
 * `usage` is api.md's 400, `not-found` its 404, `conflict` its 409. `not-enabled` is a repo with
 * no `.workledger/` at all, which `workledger serve` refuses before it ever binds a port — the
 * server can only see it if the ledger was deleted underneath a running process, so it answers
 * 404 like any other missing thing.
 */
export type OpErrorCode = "usage" | "not-enabled" | "not-found" | "conflict";

/** The refusal every op throws, as this package sees it. */
export interface OpError extends Error {
  readonly code: OpErrorCode;
  /** Lines the caller should show under the message — e.g. the legal transition targets. */
  readonly details: readonly string[];
}

const CODES: readonly string[] = ["usage", "not-enabled", "not-found", "conflict"];

/**
 * Is this an {@link OpError}?
 *
 * Structural rather than `instanceof`: the class is in another package, and under vitest's
 * aliasing (and under esbuild's bundle) "another package" can mean another module instance of
 * the same file. A duplicated class identity must not turn a 409 into a 500.
 */
export function isOpError(error: unknown): error is OpError {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CODES.includes(code);
}

/** The detail lines of an {@link OpError}, tolerating one built without them. */
export function opErrorDetails(error: OpError): string[] {
  return Array.isArray(error.details) ? error.details.map(String) : [];
}

/**
 * The backlog and note mutations, exactly as `packages/cli/src/backlog-ops.ts` exports them.
 *
 * Every method throws an {@link OpError} to refuse; nothing here reads `process`, prints, or
 * decides an exit code, which is what lets one implementation serve both callers.
 */
export interface BacklogOps {
  /**
   * The repo's git `user.name` / `user.email`, or `undefined` when either is empty — which the
   * server turns into a 409 rather than inventing an author (data-flow §Identity).
   */
  gitActor(repoRoot: string): Actor | undefined;
  acceptItem(ctx: OpContext, id: string): Promise<ItemResult>;
  discardItem(ctx: OpContext, id: string): Promise<ItemResult>;
  doneItem(ctx: OpContext, id: string): Promise<ItemResult>;
  startItem(ctx: OpContext, id: string): Promise<ItemResult>;
  restoreItem(ctx: OpContext, id: string): Promise<ItemResult>;
  editItem(ctx: OpContext, id: string, patch: EditPatch): Promise<ItemResult>;
  assignItem(ctx: OpContext, id: string, owner: Actor | null): Promise<ItemResult>;
  rankItem(ctx: OpContext, id: string, rank: number): Promise<ItemResult>;
  mergeItems(ctx: OpContext, sourceId: string, targetId: string): Promise<MergeResult>;
  resolveNote(
    ctx: OpContext,
    session: string,
    cp: number,
    index: number,
    decision: string,
  ): Promise<ResolveNoteResult>;
}
