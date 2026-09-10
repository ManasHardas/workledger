/**
 * The wire read models of `docs/contracts/p2/api.md` §Read models, and the projection from
 * `@workledger/core`'s parse results onto them.
 *
 * Core's `ParsedSession` carries everything a *writer* needs — the verbatim `raw` of every line,
 * the unvalidated frontmatter mapping, the preamble and unknown-heading blocks — so that an
 * append is never lossy. None of that belongs on the wire: the UI reads the validated
 * frontmatter and the split fields, so this module drops the write-side machinery and renames
 * `blockedBy` to the contract's `blocked_by`.
 */
import type { BacklogItem, Editor, NoteType, SessionFrontmatter, Verified } from "@workledger/core/schema";
import type { ParsedItem } from "@workledger/core/render/backlog";
import type { RepoRemote } from "./remote.js";
import type { ParsedSession as CoreParsedSession } from "@workledger/core/render/session";

/**
 * A `## Done` line on the wire. `text` is the gist a human reads; `detail` the specifics for
 * agents, off the indented continuation (P8 amendment 11). `detail` is absent on a line written
 * before the amendment, which carried its evidence inline and no `detail` at all.
 */
export interface Line {
  cp: number;
  text: string;
  detail?: string;
  files?: string[];
  commit?: string;
  verified?: Verified;
}

/** A `## Remaining` line on the wire. */
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
  by?: "human" | "agent";
  reason?: string;
  /** `true` when the session frontmatter's `resolved` list names this note. */
  resolved?: boolean;
}

/** A `## Memory` line on the wire: one fact the session saved to a memory file (amendment 11). */
export interface MemoryLine {
  cp: number;
  text: string;
  file?: string;
}

/** A body line that did not match its section's form, kept so the UI can flag a drifted file. */
export interface UnparsedLine {
  section: string;
  line: string;
}

/** `GET /api/sessions` element. */
export interface SessionView {
  frontmatter: SessionFrontmatter;
  goal: string | null;
  done: Line[];
  remaining: RemainingLine[];
  notes: NoteLine[];
  /** `## Memory`; `[]` for a file written before amendment 11, which has no such section. */
  memory: MemoryLine[];
  unparsed: UnparsedLine[];
  /**
   * Where the harness session was started — the frontmatter's `started_in` (P8 amendment 10),
   * `null` for a session from before it was recorded.
   */
  startedIn: string | null;
  /** The repos the session is about, best first — the frontmatter's `about`; empty when never inferred. */
  about: string[];
}

/**
 * `GET /api/sessions/:ulid` — the session plus what its Done items' links are built from (P8
 * amendment 13). The three fields belong to the repo, not to the session, so they are added at
 * the route rather than cached per file in the read model, and the *list* stays `SessionView`:
 * a link is a detail-view concern and 100 rows have no use for 100 copies of the same base.
 */
export interface SessionDetailView extends SessionView {
  /** The repo's resolved web base, or `null` — no remote, or a host this build does not know. */
  remote: RepoRemote | null;
  /** Which editor an open-in-editor control targets; `none` for no such control. */
  editor: Editor;
  /** The repo root, absolute — what an editor URL is built from, since `files` are relative. */
  repoPath: string;
}

/** `GET /api/backlog` element. */
export interface BacklogView {
  frontmatter: BacklogItem;
  body: string;
}

/** `GET /api/notes` element — a note plus the session it came from. */
export interface NoteRef extends NoteLine {
  /** The session ulid. */
  session: string;
  /** The note's 0-based position among the notes of its own checkpoint — `ResolvedNoteRef`'s. */
  index: number;
}

/**
 * One entry of the additive `resolved` list a session's frontmatter grows when a note is
 * resolved (plans/feature-p2-data-flow.md §Notes resolution). The P1 `SessionFrontmatter` schema
 * is `.loose()`, so the key survives validation untouched.
 *
 * `index` is the note's **position among the notes of its own checkpoint**, 0-based. The pair
 * `{cp, index}` is what `POST /api/notes/resolve` takes, and a position within the whole session
 * would make `cp` redundant; scoping it to the checkpoint also keeps an earlier checkpoint's
 * resolutions valid when a later checkpoint appends notes.
 */
export interface ResolvedNoteRef {
  cp: number;
  index: number;
}

/** The `resolved` list of a session frontmatter, ignoring anything that is not a `{cp, index}`. */
export function resolvedNotes(frontmatter: SessionFrontmatter): ResolvedNoteRef[] {
  const raw = (frontmatter as Record<string, unknown>)["resolved"];
  if (!Array.isArray(raw)) return [];
  const out: ResolvedNoteRef[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const { cp, index } = entry as Record<string, unknown>;
    if (typeof cp === "number" && typeof index === "number") out.push({ cp, index });
  }
  return out;
}

/** Project core's parse result onto the wire shape of api.md §Read models. */
export function toSessionView(parsed: CoreParsedSession): SessionView {
  const resolved = resolvedNotes(parsed.frontmatter);
  // Notes are numbered per checkpoint, so the counter resets whenever `cp` changes; the parser
  // returns them in file order, which is checkpoint order.
  const seen = new Map<number, number>();

  return {
    frontmatter: parsed.frontmatter,
    // The renderer writes at most one goal line, but a hand-edited file can hold several; the
    // contract's `goal` is a single string, and the last one written is the current one.
    goal: parsed.goal.length === 0 ? null : (parsed.goal[parsed.goal.length - 1]?.text ?? null),
    done: parsed.done.map((line) => ({
      cp: line.cp,
      text: line.text,
      ...(line.detail === undefined ? {} : { detail: line.detail }),
      files: line.files,
      ...(line.commit === undefined ? {} : { commit: line.commit }),
      ...(line.verified === undefined ? {} : { verified: line.verified }),
    })),
    remaining: parsed.remaining.map((line) => ({
      cp: line.cp,
      text: line.text,
      ref: line.ref,
      rel: line.rel,
      why: line.why ?? "",
      ...(line.blockedBy === undefined ? {} : { blocked_by: line.blockedBy }),
    })),
    notes: parsed.notes.map((line) => {
      const index = seen.get(line.cp) ?? 0;
      seen.set(line.cp, index + 1);
      return {
        cp: line.cp,
        type: line.type,
        text: line.text,
        ...(line.by === undefined ? {} : { by: line.by }),
        ...(line.reason === undefined ? {} : { reason: line.reason }),
        resolved: resolved.some((ref) => ref.cp === line.cp && ref.index === index),
      };
    }),
    memory: parsed.memory.map((line) => ({
      cp: line.cp,
      text: line.text,
      ...(line.file === undefined ? {} : { file: line.file }),
    })),
    unparsed: parsed.unparsed.map((line) => ({ section: line.section, line: line.line })),
    startedIn: parsed.frontmatter.started_in ?? null,
    about: parsed.frontmatter.about ?? [],
  };
}

/** Project core's parse result onto `BacklogView`. */
export function toBacklogView(parsed: ParsedItem): BacklogView {
  return { frontmatter: parsed.frontmatter, body: parsed.body };
}
