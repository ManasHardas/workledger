import { useCallback, useEffect, useMemo, useState } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import type { LedgerSource, NoteAcrossRepos } from "../../lib/ledger-source.js";
import { useMachine } from "../../lib/source-context.js";
import { useAsync } from "../../lib/use-async.js";
import { NO_IDENTITIES, type IdentityMap } from "../identity/live.js";
import { NoteCard } from "./note-card.js";

/**
 * Needs you across every repo the daemon serves — `GET /api/notes/all` (P8), a repo per row.
 *
 * Each card resolves through `forRepo(id)` of the repo its note came from, so the write carries
 * the `repo` parameter the daemon requires, and reads its session context and identities from
 * the same scoped source. The list re-reads on any `notes.changed`, whichever repo stamped it:
 * the aggregate is one request either way.
 */
export function AllNeedsPanel() {
  const machine = useMachine();
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    return machine.subscribe((event) => {
      if (event.type === "notes.changed") refresh();
    });
  }, [machine, refresh]);

  const result = useAsync(
    // `nonce` is a dependency, not an argument: a bump re-runs the same read.
    useCallback(() => machine.listAllNotes({ type: ["blocker", "question"], open: true }), [machine, nonce]),
  );
  const notes = result.state === "ready" ? result.value : [];
  const sources = useRepoSources(notes);
  const identities = useIdentitiesByRepo(sources);

  return (
    <AsyncPanel
      result={result}
      isEmpty={(list) => list.length === 0}
      empty="Nothing is waiting on you in any project. Open questions and blockers appear here."
    >
      {(list) => (
        <ul className="flex flex-col gap-3">
          {list.map((note) => (
            <li key={`${note.repo.id}-${note.session}-${note.cp}-${note.index}`}>
              <NoteCard
                note={note}
                repo={note.repo}
                source={sources.get(note.repo.id) ?? machine}
                identities={identities.get(note.repo.id) ?? NO_IDENTITIES}
                onResolved={refresh}
              />
            </li>
          ))}
        </ul>
      )}
    </AsyncPanel>
  );
}

/** One scoped source per distinct repo in the list, stable across re-reads of the same repos. */
function useRepoSources(notes: NoteAcrossRepos[]): ReadonlyMap<string, LedgerSource> {
  const machine = useMachine();
  const ids = [...new Set(notes.map((note) => note.repo.id))].sort().join(",");
  return useMemo(
    () => new Map(ids === "" ? [] : ids.split(",").map((id) => [id, machine.forRepo(id)])),
    [machine, ids],
  );
}

/**
 * `.workledger/identities.yaml` of each repo in the list, keyed by repo id. One read per repo,
 * not per note; a repo whose file is missing simply misses every lookup, which is the contract's
 * "emails display as before".
 */
function useIdentitiesByRepo(sources: ReadonlyMap<string, LedgerSource>): ReadonlyMap<string, IdentityMap> {
  const result = useAsync(
    useCallback(
      () =>
        Promise.all(
          [...sources].map(async ([id, source]) => {
            const list = await source.listIdentities().catch(() => []);
            const map: IdentityMap = new Map(list.map((identity) => [identity.email.trim().toLowerCase(), identity]));
            return [id, map] as const;
          }),
        ),
      [sources],
    ),
  );
  return useMemo(() => new Map(result.state === "ready" ? result.value : []), [result]);
}
