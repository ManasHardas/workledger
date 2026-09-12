import { useMemo, useState } from "react";

import { AsyncPanel } from "../components/async-panel.js";
import { EMPTY_FILTERS, LedgerFilterBar, sinceInstant } from "../features/ledger/filters.js";
import { useLiveSessions } from "../features/ledger/live.js";
import { SessionList, openFirst } from "../features/ledger/session-list.js";

/**
 * Ledger — one repo's sessions over time, with the filters and full-text search of design spec §8.
 *
 * P9 split the detail out: a session is its own destination at `#/r/<id>/session/<ulid>`
 * (`routes/session.tsx`), so this view is the list and nothing else. `lib/router.ts` still parses
 * the old `#/…/ledger/<ulid>` into the Session route, so saved links keep working.
 *
 * There are no Open/All tabs (daemon-and-api.md amendment 11, UI; operator: "on the ledger page
 * there shouldn't be open and all tabs, simply show the open ledgers at the top no tab is
 * required"). The sessions still running are simply the top of the list.
 *
 * Everything below the heading is a `SessionQuery` and nothing more — the view has no opinion the
 * source could not answer, bar the open-first ordering, which is presentation.
 */
export function LedgerView() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [q, setQ] = useState("");

  const query = useMemo(
    () => ({
      author: filters.author || undefined,
      harness: filters.harness || undefined,
      status: filters.status || undefined,
      since: sinceInstant(filters.since),
      q: q || undefined,
    }),
    [filters, q],
  );
  const sessions = useLiveSessions(query);

  return (
    <section aria-labelledby="ledger-heading" className="flex flex-col gap-4">
      <h2 id="ledger-heading" className="text-xl font-extrabold">
        Ledger
      </h2>
      <LedgerFilterBar filters={filters} onChange={setFilters} q={q} onQChange={setQ} />
      <AsyncPanel
        result={sessions}
        isEmpty={(list) => list.length === 0}
        empty="No sessions match. Run an agent in an enabled repo and checkpoints land here."
      >
        {(list) => <SessionList sessions={openFirst(list)} />}
      </AsyncPanel>
    </section>
  );
}
