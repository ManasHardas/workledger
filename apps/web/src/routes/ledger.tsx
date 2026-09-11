import { useMemo, useState } from "react";

import { AsyncPanel } from "../components/async-panel.js";
import { useDetailUlid } from "../features/ledger/detail-route.js";
import { EMPTY_FILTERS, LedgerFilterBar, sinceInstant } from "../features/ledger/filters.js";
import { useLiveSessions } from "../features/ledger/live.js";
import { SessionDetail } from "../features/ledger/session-detail.js";
import { SessionList, openFirst } from "../features/ledger/session-list.js";

/**
 * Ledger — session cards in one list, with the filters and full-text search of design spec §8,
 * and `#/ledger/<ulid>` for one session in full.
 *
 * There are no Open/All tabs (daemon-and-api.md amendment 11, UI; operator: "on the ledger page
 * there shouldn't be open and all tabs, simply show the open ledgers at the top no tab is
 * required"). The sessions still running are simply the top of the list — one list, one keyboard
 * cursor, and `status` back in the filter row where every other narrowing lives, instead of a
 * scope that silently hid four fifths of the ledger behind a second click.
 *
 * Everything below the heading is a `SessionQuery` and nothing more — the view has no opinion the
 * source could not answer, bar the open-first ordering, which is presentation. That is
 * deliberate: the fixture source honours only `status`, `harness` and `q` today, so `author` and
 * `since` are forwarded and ignored until `LocalServerSource` (#35) answers the whole query.
 */
export function LedgerView() {
  const ulid = useDetailUlid();
  if (ulid) return <SessionDetail ulid={ulid} />;
  return <LedgerList />;
}

function LedgerList() {
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
