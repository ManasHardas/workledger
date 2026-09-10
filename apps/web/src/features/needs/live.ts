import { useCallback, useEffect, useState } from "react";

import type { NoteRef } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { useAsync, type Async } from "../../lib/use-async.js";

/** What {@link useLiveOpenNotes} hands the panel: the read's state, and a way to run it again. */
export interface LiveNotes {
  result: Async<NoteRef[]>;
  /** Re-reads now — what the panel calls once its own `resolveNote` has returned. */
  refresh: () => void;
}

/**
 * Every open `blocker` and `question` across sessions, re-read when the source reports that notes
 * changed on disk.
 *
 * `subscribe` is the whole of the live contract (`docs/contracts/p2/ledger-source.md`): the event
 * says *what* changed, never the new value, so the view re-reads. On a source whose
 * `capabilities.live` is false the subscription is a no-op and the counter never moves, which is
 * why nothing here branches on the capability — and why `refresh` exists, since a write's own
 * result must show up on a source that reports nothing.
 *
 * Order is the source's: `/api/notes` returns newest first by contract.
 */
export function useLiveOpenNotes(): LiveNotes {
  const source = useSource();
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    return source.subscribe((event) => {
      if (event.type === "notes.changed") refresh();
    });
  }, [source, refresh]);

  const result = useAsync(
    // `nonce` is a dependency, not an argument: a bump re-runs the same read.
    useCallback(
      () => source.listNotes({ type: ["blocker", "question"], open: true }),
      [source, nonce],
    ),
  );
  return { result, refresh };
}
