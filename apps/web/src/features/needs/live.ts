import { useCallback, useEffect, useState } from "react";

import type { NoteRef, NoteType } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { useAsync, type Async } from "../../lib/use-async.js";

/** What {@link useLiveNotes} hands a panel: the read's state, and a way to run it again. */
export interface LiveNotes<T extends NoteRef = NoteRef> {
  result: Async<T[]>;
  /** Re-reads now — what the panel calls once its own `resolveNote` has returned. */
  refresh: () => void;
}

/** The notes a person owes an answer: `blocker` stops work, `question` asks. */
export const OPEN_TYPES: NoteType[] = ["blocker", "question"];

/** The notes that are history rather than asks: what was decided, and what was found. */
export const HISTORY_TYPES: NoteType[] = ["decision", "discovery"];

/**
 * The notes of `types` across sessions (only the unresolved ones with `open`), re-read when the
 * source reports that notes changed on disk.
 *
 * `subscribe` is the whole of the live contract (`docs/contracts/p2/ledger-source.md`): the event
 * says *what* changed, never the new value, so the view re-reads. On a source whose
 * `capabilities.live` is false the subscription is a no-op and the counter never moves, which is
 * why nothing here branches on the capability — and why `refresh` exists, since a write's own
 * result must show up on a source that reports nothing.
 *
 * The rows are filtered by type here as well as in the query, so a source that ignores the filter
 * cannot put a blocker among the decisions. Order is the source's: `/api/notes` returns newest
 * first by contract.
 */
export function useLiveNotes(types: readonly NoteType[], open?: boolean): LiveNotes {
  const source = useSource();
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const key = types.join(",");

  useEffect(() => {
    return source.subscribe((event) => {
      if (event.type === "notes.changed") refresh();
    });
  }, [source, refresh]);

  const result = useAsync(
    // `nonce` is a dependency, not an argument: a bump re-runs the same read.
    useCallback(async () => {
      const wanted = key.split(",") as NoteType[];
      const notes = await source.listNotes({ type: wanted, ...(open === undefined ? {} : { open }) });
      return notes.filter((note) => wanted.includes(note.type) && (open !== true || note.resolved !== true));
    }, [source, key, open, nonce]),
  );
  return { result, refresh };
}

/** Every open `blocker` and `question` — Review's "Waiting on an answer". */
export function useLiveOpenNotes(): LiveNotes {
  return useLiveNotes(OPEN_TYPES, true);
}
