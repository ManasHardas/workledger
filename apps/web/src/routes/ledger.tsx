import { useMemo, useState } from "react";

import { AsyncPanel } from "../components/async-panel.js";
import { PageBody, PageHeader } from "../components/ui/page.js";
import { EMPTY_FILTERS, LedgerFilterBar, LedgerSinceFilter, sinceInstant } from "../features/ledger/filters.js";
import { useLiveSessions } from "../features/ledger/live.js";
import { SessionList, openFirst } from "../features/ledger/session-list.js";
import type { ParsedSession } from "../lib/ledger-source.js";

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** The header's Meta line over the sessions on screen: `5 sessions · 46 outcomes · 58 still open`. */
export function ledgerSummary(sessions: readonly ParsedSession[]): string {
  let done = 0;
  let remaining = 0;
  for (const session of sessions) {
    done += session.done.length;
    remaining += session.remaining.length;
  }
  return `${plural(sessions.length, "session", "sessions")} · ${plural(done, "outcome", "outcomes")} · ${String(remaining)} still open`;
}

/**
 * Ledger — one repo's sessions over time, with the filters and full-text search of design spec §8,
 * drawn as the Product Designs frame `7:2`.
 *
 * P9 split the detail out: a session is its own destination at `#/r/<id>/session/<ulid>`
 * (`routes/session.tsx`), so this view is the list, and — while the right column is on screen —
 * a summary of the selected session beside it. `lib/router.ts` still parses the old
 * `#/…/ledger/<ulid>` into the Session route, so saved links keep working.
 *
 * There are no Open/All tabs (daemon-and-api.md amendment 11, UI; operator: "on the ledger page
 * there shouldn't be open and all tabs, simply show the open ledgers at the top no tab is
 * required"). The sessions still running are simply the top of the list.
 *
 * Everything below the heading is a `SessionQuery` and nothing more — the view has no opinion the
 * source could not answer, bar the open-first ordering, which is presentation. The header's counts
 * are over that same result, so they change with the filters.
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
    <>
      <PageHeader title="Ledger" aside={sessions.state === "ready" ? ledgerSummary(sessions.value) : undefined} />
      <PageBody rhythm="ledger">
        <LedgerFilterBar filters={filters} onChange={setFilters} q={q} onQChange={setQ} />
        <AsyncPanel
          result={sessions}
          isEmpty={(list) => list.length === 0}
          empty="No sessions match. Run an agent in an enabled repo and checkpoints land here."
        >
          {(list) => <SessionList sessions={openFirst(list)} />}
        </AsyncPanel>
        <LedgerSinceFilter filters={filters} onChange={setFilters} />
      </PageBody>
    </>
  );
}
