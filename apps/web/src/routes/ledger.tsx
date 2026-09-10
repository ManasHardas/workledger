import { useMemo, useState } from "react";

import { AsyncPanel } from "../components/async-panel.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { useDetailUlid } from "../features/ledger/detail-route.js";
import { EMPTY_FILTERS, LedgerFilterBar, sinceInstant } from "../features/ledger/filters.js";
import { useLiveSessions } from "../features/ledger/live.js";
import { SessionDetail } from "../features/ledger/session-detail.js";
import { SessionList } from "../features/ledger/session-list.js";

const SCOPES = [
  { id: "open", label: "Open", status: "open" as const },
  { id: "all", label: "All", status: undefined },
];

/**
 * Ledger — session cards newest first, with the filters and full-text search of design spec §8,
 * and `#/ledger/<ulid>` for one session in full.
 *
 * The two tabs are the coarse scope: "Open" pins `status` to the sessions still running, "All"
 * hands the status back to the filter row. Everything below the tabs is a `SessionQuery` and
 * nothing more — the view has no opinion the source could not answer. That is deliberate: the
 * fixture source honours only `status`, `harness` and `q` today, so `author` and `since` are
 * forwarded and ignored until `LocalServerSource` (#35) answers the whole query. Narrowing them in
 * the view instead would put a second, divergent filter implementation in the UI.
 */
export function LedgerView() {
  const ulid = useDetailUlid();
  if (ulid) return <SessionDetail ulid={ulid} />;
  return <LedgerList />;
}

function LedgerList() {
  const [scope, setScope] = useState(SCOPES[0]!.id);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [q, setQ] = useState("");
  const scopeStatus = SCOPES.find((s) => s.id === scope)?.status;

  const query = useMemo(
    () => ({
      author: filters.author || undefined,
      harness: filters.harness || undefined,
      status: scopeStatus ?? (filters.status || undefined),
      since: sinceInstant(filters.since),
      q: q || undefined,
    }),
    [filters, scopeStatus, q],
  );
  const sessions = useLiveSessions(query);

  return (
    <section aria-labelledby="ledger-heading" className="flex flex-col gap-4">
      <h2 id="ledger-heading" className="text-xl font-semibold">
        Ledger
      </h2>
      <Tabs value={scope} onValueChange={setScope} className="flex flex-col gap-4">
        <TabsList aria-label="Session scope">
          {SCOPES.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <LedgerFilterBar
          filters={filters}
          onChange={setFilters}
          q={q}
          onQChange={setQ}
          statusLocked={scopeStatus !== undefined}
        />
        {SCOPES.map((s) => (
          <TabsContent key={s.id} value={s.id} className="flex flex-col gap-3">
            <AsyncPanel
              result={sessions}
              isEmpty={(list) => list.length === 0}
              empty="No sessions match. Run an agent in an enabled repo and checkpoints land here."
            >
              {(list) => <SessionList sessions={list} />}
            </AsyncPanel>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
