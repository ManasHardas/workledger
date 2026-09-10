/**
 * The `LedgerSource` contract of `docs/contracts/p2/ledger-source.md` and the wire read models of
 * `docs/contracts/p2/api.md` §Read models.
 *
 * The domain vocabulary — `Actor`, `BacklogItem`, `BacklogStatus`, `SessionFrontmatter`, the four
 * note types — is re-exported from `@workledger/core`, which is where the frozen P1 schemas live.
 * Everything else is defined here rather than imported from `@workledger/server`, because the
 * contract's whole point is that `apps/web` never imports the server: the wire shapes are the
 * boundary, and a UI that could reach into the server's types would drift into its internals.
 *
 * Two names deliberately *differ* from core's. Core's `ParsedSession` and `NoteLine` are
 * parse-time shapes carrying the write-side machinery (`raw` for every line, the unvalidated
 * `data` mapping, the preamble and unknown-heading blocks) so that an append is never lossy. The
 * wire drops all of it, and `goal` collapses from a list of lines to the single current string.
 * These are api.md's versions, not core's.
 */
export type {
  Actor,
  BacklogItem,
  BacklogStatus,
  Harness,
  NoteBy,
  NoteType,
  Priority,
  SessionFrontmatter,
  Verified,
} from "@workledger/core";

import type {
  Actor,
  BacklogItem,
  BacklogStatus,
  NoteBy,
  NoteType,
  SessionFrontmatter,
  Verified,
} from "@workledger/core";

/** A `## Done` line on the wire. */
export interface Line {
  cp: number;
  text: string;
  files?: string[];
  commit?: string;
  verified?: Verified;
}

/** A `## Remaining` line on the wire — core's `blockedBy` renamed to the contract's snake case. */
export interface RemainingLine extends Line {
  ref: string;
  rel: "new" | "updates" | "closes";
  why: string;
  blocked_by?: string[];
}

/** A `## Notes` line on the wire. */
export interface NoteLine {
  cp: number;
  type: NoteType;
  text: string;
  by?: NoteBy;
  reason?: string;
  /** `true` when the session frontmatter's `resolved` list names this note. */
  resolved?: boolean;
}

/** A body line that did not match its section's form, kept so the UI can flag a drifted file. */
export interface UnparsedLine {
  section: string;
  line: string;
}

/** `GET /api/sessions` element — api.md's `ParsedSession`, not core's. */
export interface ParsedSession {
  frontmatter: SessionFrontmatter;
  goal: string | null;
  done: Line[];
  remaining: RemainingLine[];
  notes: NoteLine[];
  unparsed: UnparsedLine[];
}

/** `GET /api/backlog` element. */
export interface BacklogView {
  frontmatter: BacklogItem;
  body: string;
}

/** `GET /api/notes` element — a note plus the ulid of the session it was read from. */
export interface NoteRef extends NoteLine {
  session: string;
  /** The note's 0-based position among the notes of its own checkpoint (api.md §Read models). */
  index: number;
}

/** One harness row of `workledger doctor`, as `/api/health` returns it. */
export interface DoctorEntry {
  harness: string;
  binary: string | null;
  version: string | null;
  contract_tested_version: string;
  store: string;
  store_readable: boolean;
  projects: number | null;
  last_activity: string | null;
}

/** `GET /api/health`. */
export interface Health {
  cli: string;
  repo: string;
  harnesses: DoctorEntry[];
  index: { path: string; bytes: number; openSessions: number };
  config: { valid: boolean; problems: string[] };
  lastHookAt: string | null;
}

/** The four SSE events of api.md §SSE, in the shape the UI subscribes to. */
export type LedgerEvent =
  | { type: "session.changed"; ulid: string }
  | { type: "backlog.changed"; id: string }
  | { type: "notes.changed" }
  | { type: "health.changed" };

/** `GET /api/sessions` query. */
export interface SessionQuery {
  author?: string;
  harness?: string;
  status?: string;
  since?: string;
  q?: string;
  limit?: number;
}

/** `POST /api/backlog/:id/edit` body. */
export interface EditPatch {
  title?: string;
  body?: string;
  priority?: "p1" | "p2" | "p3" | null;
  area?: string[];
}

/** What a source can do. A view must degrade rather than assume any of it (design spec §14.2). */
export interface SourceCapabilities {
  write: boolean;
  live: boolean;
  provenance: boolean;
}

/**
 * The UI's only data dependency, `docs/contracts/p2/ledger-source.md`.
 *
 * `start` and `restore` are additive to the frozen listing: api.md §Endpoints carries
 * `POST /api/backlog/:id/start` and `POST /api/backlog/:id/restore`, and a source that could not
 * reach them would leave two of the backlog's five transitions unreachable from the UI.
 */
export interface LedgerSource {
  readonly capabilities: SourceCapabilities;
  listSessions(q?: SessionQuery): Promise<ParsedSession[]>;
  getSession(ulid: string): Promise<ParsedSession>;
  listBacklog(q?: { status?: BacklogStatus[] }): Promise<BacklogView[]>;
  getBacklogItem(id: string): Promise<BacklogView>;
  listNotes(q?: { type?: NoteType[]; open?: boolean }): Promise<NoteRef[]>;
  brief(maxTokens?: number): Promise<string>;
  health(): Promise<Health>;
  // writes: reject with { code: "read-only" } when capabilities.write is false
  accept(id: string): Promise<BacklogView>;
  discard(id: string): Promise<BacklogView>;
  done(id: string): Promise<BacklogView>;
  start(id: string): Promise<BacklogView>;
  restore(id: string): Promise<BacklogView>;
  edit(id: string, patch: EditPatch): Promise<BacklogView>;
  assign(id: string, owner: Actor | null): Promise<BacklogView>;
  rank(id: string, rank: number): Promise<BacklogView>;
  merge(id: string, into: string): Promise<{ source: BacklogView; target: BacklogView }>;
  resolveNote(
    ref: { session: string; cp: number; index: number },
    decision: string,
  ): Promise<ParsedSession>;
  // live: no-op unsubscribe when capabilities.live is false
  subscribe(handler: (event: LedgerEvent) => void): () => void;
}
