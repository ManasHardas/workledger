import { useCallback, useEffect, useState } from "react";

import type { LedgerEvent, LedgerSource, ParsedSession, SessionQuery } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { useAsync, type Async } from "../../lib/use-async.js";

/**
 * A counter that steps every time the source reports a `session.changed` the caller cares about.
 *
 * `LedgerSource.subscribe` is the whole of the live contract (`docs/contracts/p2/ledger-source.md`):
 * an event says *what* changed, never the new value, so the view re-reads. On a source whose
 * `capabilities.live` is false the subscription is a no-op and the counter simply never moves —
 * which is why nothing here branches on the capability.
 */
function useSessionChanges(source: LedgerSource, matches: (ulid: string) => boolean): number {
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    return source.subscribe((event: LedgerEvent) => {
      if (event.type === "session.changed" && matches(event.ulid)) setNonce((n) => n + 1);
    });
  }, [source, matches]);

  return nonce;
}

const ANY_SESSION = () => true;

/** The session list for a query, re-read whenever any session changes on disk. */
export function useLiveSessions(query: SessionQuery): Async<ParsedSession[]> {
  const source = useSource();
  const nonce = useSessionChanges(source, ANY_SESSION);
  const { author, harness, status, since, q, limit } = query;
  return useAsync(
    useCallback(
      () =>
        source
          .listSessions({ author, harness, status, since, q, limit })
          // Newest first (design spec §8: "session cards over time"). The source is not required
          // to order its rows, so the view does it rather than trusting the transport.
          .then((sessions) =>
            [...sessions].sort((a, b) => b.frontmatter.started.localeCompare(a.frontmatter.started)),
          ),
      // `nonce` is a dependency, not an argument: a bump re-runs the same read.
      [source, author, harness, status, since, q, limit, nonce],
    ),
  );
}

/** One session, re-read whenever that session changes on disk. */
export function useLiveSession(ulid: string): Async<ParsedSession> {
  const source = useSource();
  const matches = useCallback((changed: string) => changed === ulid, [ulid]);
  const nonce = useSessionChanges(source, matches);
  return useAsync(useCallback(() => source.getSession(ulid), [source, ulid, nonce]));
}
