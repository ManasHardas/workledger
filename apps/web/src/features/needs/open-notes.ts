import type { NoteRef, ParsedSession } from "../../lib/ledger-source.js";

/** An open note plus the session context the card shows and the ref that resolves it. */
export interface OpenNote {
  note: NoteRef;
  /** The session's goal, or null when that session was not in the window we read. */
  goal: string | null;
  /**
   * The note's 0-based position **among the notes of its own checkpoint**, in file order — the
   * `index` half of a `resolveNote` ref (`docs/contracts/p2/backlog-cli.md`). `/api/notes` returns
   * a `NoteRef` without it, so it is recovered here from the session the note was read from; null
   * when that session is unavailable, in which case the note is shown but cannot be resolved.
   */
  index: number | null;
  /** The checkpoint's timestamp. Ordering only — a note carries no time of its own. */
  at: string | null;
}

/**
 * Joins open notes onto their sessions, newest first.
 *
 * Newest is the note's checkpoint time, because that is when the question was actually asked; a
 * session whose checkpoint list does not reach that far falls back to when it started, and a note
 * whose session is missing sorts last rather than disappearing.
 */
export function joinOpenNotes(notes: NoteRef[], sessions: ParsedSession[]): OpenNote[] {
  const byUlid = new Map(sessions.map((session) => [session.frontmatter.id, session]));

  return notes
    .map((note): OpenNote => {
      const session = byUlid.get(note.session);
      if (!session) return { note, goal: null, index: null, at: null };
      return {
        note,
        goal: session.goal[0]?.text ?? null,
        index: indexOf(note, session),
        at: session.frontmatter.checkpoints.find((cp) => cp.n === note.cp)?.at ??
          session.frontmatter.started,
      };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "") || b.note.cp - a.note.cp);
}

/** Where `note` sits among its checkpoint's notes, or null when the session no longer carries it. */
function indexOf(note: NoteRef, session: ParsedSession): number | null {
  const inCheckpoint = session.notes.filter((line) => line.cp === note.cp);
  const found = inCheckpoint.findIndex(
    (line) => line.type === note.type && line.text === note.text,
  );
  return found === -1 ? null : found;
}
