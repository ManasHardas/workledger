/**
 * The in-memory read model: every `.workledger/sessions/*.md` and `.workledger/backlog/*.md`
 * parsed once at startup and re-parsed per file when the watcher says that file changed
 * (plans/feature-p2-data-flow.md §Reads).
 *
 * A file that does not parse is dropped rather than thrown on — the rule `workledger brief`
 * already follows, because one hand-mangled file must not take the whole server down. The
 * failure is kept in {@link ReadModel.problems} so `/api/health` can surface it.
 */
import { parseItem } from "@workledger/core/render/backlog";
import { parseSessionText } from "@workledger/core/render/session";

import { listMarkdown, readTextFile } from "./paths.js";
import { toBacklogView, toSessionView } from "./views.js";
import type { LedgerPaths } from "./paths.js";
import type { BacklogView, NoteRef, SessionView } from "./views.js";
import path from "node:path";

/** Filters `GET /api/sessions` accepts (api.md §Endpoints). */
export interface SessionQuery {
  author?: string;
  harness?: string;
  status?: string;
  /** ISO 8601; keeps sessions whose `started` is at or after it. */
  since?: string;
  /** Case-insensitive substring over goal, line text and note text. */
  q?: string;
  limit?: number;
}

/** Filters `GET /api/backlog` accepts. */
export interface BacklogQuery {
  /** Comma list of statuses; the default is every status but `discarded`. */
  status?: string;
  limit?: number;
}

/** Filters `GET /api/notes` accepts. */
export interface NotesQuery {
  /** Comma list of note types. */
  type?: string;
  /** `"true"` keeps only unresolved blocker/question notes. */
  open?: string;
  limit?: number;
}

/** The default `limit` on every list endpoint. */
export const DEFAULT_LIMIT = 100;

/** Note types that can be *open*: the two a human is expected to answer. */
const OPEN_NOTE_TYPES = new Set(["blocker", "question"]);

function splitList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = value.split(",").map((part) => part.trim()).filter((part) => part !== "");
  return parts.length === 0 ? undefined : parts;
}

/** `limit` as a positive integer, or the default when it is absent, unparsable or non-positive. */
export function parseLimit(value: string | undefined, fallback = DEFAULT_LIMIT): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/** Everything one session exposes to `q`: its goal, every line's text, every note's text. */
function searchHaystack(session: SessionView): string {
  const parts: string[] = [session.goal ?? ""];
  for (const line of session.done) parts.push(line.text);
  for (const line of session.remaining) parts.push(line.text, line.why);
  for (const note of session.notes) parts.push(note.text, note.reason ?? "");
  return parts.join("\n").toLowerCase();
}

/** The parsed ledger, invalidated per file. */
export class ReadModel {
  readonly paths: LedgerPaths;
  private readonly sessions = new Map<string, SessionView>();
  private readonly backlog = new Map<string, BacklogView>();
  /** `<relative file>: <reason>` for every file that would not parse. */
  readonly problems = new Map<string, string>();

  constructor(paths: LedgerPaths) {
    this.paths = paths;
  }

  /** Parse the whole ledger. Called once at startup, and by the polling fallback on a rescan. */
  loadAll(): void {
    this.sessions.clear();
    this.backlog.clear();
    this.problems.clear();
    for (const name of listMarkdown(this.paths.sessions)) this.invalidateSession(name.slice(0, -3));
    for (const name of listMarkdown(this.paths.backlog)) this.invalidateBacklog(name.slice(0, -3));
  }

  /** Re-read one session file; drop the entry when the file is gone or no longer parses. */
  invalidateSession(ulid: string): void {
    const file = path.join(this.paths.sessions, `${ulid}.md`);
    const text = readTextFile(file);
    if (text === undefined) {
      this.sessions.delete(ulid);
      this.problems.delete(`sessions/${ulid}.md`);
      return;
    }
    try {
      this.sessions.set(ulid, toSessionView(parseSessionText(text)));
      this.problems.delete(`sessions/${ulid}.md`);
    } catch (error) {
      this.sessions.delete(ulid);
      this.problems.set(`sessions/${ulid}.md`, error instanceof Error ? error.message : String(error));
    }
  }

  /** Re-read one backlog file; drop the entry when the file is gone or no longer parses. */
  invalidateBacklog(id: string): void {
    const file = path.join(this.paths.backlog, `${id}.md`);
    const text = readTextFile(file);
    if (text === undefined) {
      this.backlog.delete(id);
      this.problems.delete(`backlog/${id}.md`);
      return;
    }
    try {
      this.backlog.set(id, toBacklogView(parseItem(text)));
      this.problems.delete(`backlog/${id}.md`);
    } catch (error) {
      this.backlog.delete(id);
      this.problems.set(`backlog/${id}.md`, error instanceof Error ? error.message : String(error));
    }
  }

  /** Every session, newest `started` first, after the query's filters and `limit`. */
  listSessions(query: SessionQuery = {}): SessionView[] {
    const q = query.q?.toLowerCase();
    const authors = splitList(query.author);
    const harnesses = splitList(query.harness);
    const statuses = splitList(query.status);
    const since = query.since === undefined ? undefined : Date.parse(query.since);

    const out = [...this.sessions.values()].filter((session) => {
      const fm = session.frontmatter;
      if (statuses !== undefined && !statuses.includes(fm.status)) return false;
      if (harnesses !== undefined && !harnesses.includes(fm.harness)) return false;
      if (authors !== undefined && !authors.some((a) => a === fm.author.name || a === fm.author.email)) {
        return false;
      }
      if (since !== undefined && Number.isFinite(since) && Date.parse(fm.started) < since) return false;
      if (q !== undefined && !searchHaystack(session).includes(q)) return false;
      return true;
    });

    out.sort((a, b) => compareDesc(a.frontmatter.started, b.frontmatter.started, a.frontmatter.id, b.frontmatter.id));
    return out.slice(0, query.limit ?? DEFAULT_LIMIT);
  }

  /** One session, or `undefined`. */
  getSession(ulid: string): SessionView | undefined {
    return this.sessions.get(ulid);
  }

  /** Backlog items by `rank` ascending, then `updated` descending (api.md §Endpoints). */
  listBacklog(query: BacklogQuery = {}): BacklogView[] {
    const statuses = splitList(query.status);
    const out = [...this.backlog.values()].filter((item) =>
      statuses === undefined ? item.frontmatter.status !== "discarded" : statuses.includes(item.frontmatter.status),
    );
    out.sort((a, b) => {
      if (a.frontmatter.rank !== b.frontmatter.rank) return a.frontmatter.rank - b.frontmatter.rank;
      return compareDesc(a.frontmatter.updated, b.frontmatter.updated, a.frontmatter.id, b.frontmatter.id);
    });
    return out.slice(0, query.limit ?? DEFAULT_LIMIT);
  }

  /** One backlog item, or `undefined`. */
  getBacklog(id: string): BacklogView | undefined {
    return this.backlog.get(id);
  }

  /** Every note across every session, newest first. */
  listNotes(query: NotesQuery = {}): NoteRef[] {
    const types = splitList(query.type);
    const openOnly = query.open === "true";
    const out: NoteRef[] = [];
    for (const session of this.sessions.values()) {
      // `index` is the note's position within its own checkpoint — the same numbering
      // `toSessionView` uses for `resolved`, so `{session, cp, index}` addresses a note for
      // `POST /api/notes/resolve`. Counted before the filters, or a filtered-out note would
      // shift the ones after it.
      const seen = new Map<number, number>();
      for (const note of session.notes) {
        const index = seen.get(note.cp) ?? 0;
        seen.set(note.cp, index + 1);
        if (types !== undefined && !types.includes(note.type)) continue;
        if (openOnly && (note.resolved === true || !OPEN_NOTE_TYPES.has(note.type))) continue;
        out.push({ ...note, session: session.frontmatter.id, index });
      }
    }
    // "Newest first" over a note means its session's start, then its checkpoint: a note has no
    // timestamp of its own, and checkpoints within a session are strictly increasing.
    out.sort((a, b) => {
      const sa = this.sessions.get(a.session)?.frontmatter.started ?? "";
      const sb = this.sessions.get(b.session)?.frontmatter.started ?? "";
      if (sa !== sb) return sa < sb ? 1 : -1;
      if (a.cp !== b.cp) return b.cp - a.cp;
      return 0;
    });
    return out.slice(0, query.limit ?? DEFAULT_LIMIT);
  }

  /** Sessions whose status is still `open` — the ledger's answer to the index's open count. */
  openSessionCount(): number {
    let n = 0;
    for (const session of this.sessions.values()) if (session.frontmatter.status === "open") n += 1;
    return n;
  }

  /** Number of sessions currently held. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Number of backlog items currently held. */
  get backlogCount(): number {
    return this.backlog.size;
  }
}

/** Descending by `at`, with `id` as the tiebreak so the order is total and stable. */
function compareDesc(aAt: string, bAt: string, aId: string, bId: string): number {
  if (aAt !== bAt) return aAt < bAt ? 1 : -1;
  return aId < bId ? 1 : aId > bId ? -1 : 0;
}
