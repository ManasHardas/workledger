import { useEffect, useState } from "react";

import { messageOf } from "../../lib/errors.js";
import type { AppSource, Repo } from "../../lib/ledger-source.js";
import type { Async } from "../../lib/use-async.js";

/** How long a burst of events is allowed to coalesce into one `/api/repos` re-read. */
export const REPOS_REFRESH_MS = 200;

/**
 * `GET /api/repos`, re-read when any repo's ledger changes.
 *
 * Every SSE frame of a P8 daemon is stamped with its repo, and every one of them can move a count
 * on a card — a session, a backlog item, a note, a hook, a job — so the list is re-read on any
 * event rather than on a chosen subset. A checkpoint lands as several frames in a row, which is
 * why the re-read waits `REPOS_REFRESH_MS` for the burst to end; the whole list is one request,
 * so re-reading all cards for one repo's event costs nothing worth a per-card subscription.
 *
 * Unlike `useAsync`, a re-read keeps the cards on screen until the new list is in: Home is the
 * page left open all day, and a "Loading…" flash on every checkpoint would make it unreadable.
 * Only the first read shows the loading state; a later failure replaces the list with the error,
 * because stale counts presented as live ones are worse than none.
 *
 * On a source whose `capabilities.live` is false the subscription is a no-op and the list is
 * read once, which is why nothing here branches on the capability.
 */
export function useLiveRepos(source: AppSource): Async<Repo[]> {
  const [result, setResult] = useState<Async<Repo[]>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResult({ state: "loading" });

    const read = () => {
      source.listRepos().then(
        (value) => {
          if (live) setResult({ state: "ready", value });
        },
        (error: unknown) => {
          if (live) setResult({ state: "error", message: messageOf(error) });
        },
      );
    };
    read();

    const stop = source.subscribe(() => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        read();
      }, REPOS_REFRESH_MS);
    });
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      stop();
    };
  }, [source]);

  return result;
}
