import { useCallback, useEffect, useMemo, useState } from "react";

import type { LedgerSource, NoteAcrossRepos } from "../../lib/ledger-source.js";
import { useMachine } from "../../lib/source-context.js";
import { useAsync } from "../../lib/use-async.js";
import { NO_IDENTITIES, type IdentityMap } from "../identity/live.js";
import { Answers } from "./needs-panel.js";

/**
 * Review's answers across every repo the daemon serves — `GET /api/notes/all` (P8), a card per
 * note, each naming its repo. There is no proposals section: there is no machine-wide backlog read.
 *
 * The selected note resolves through `forRepo(id)` of the repo its note came from, so the write carries
 * the `repo` parameter the daemon requires, and reads its session context and identities from the
 * same scoped source. The list re-reads on any `notes.changed`, whichever repo stamped it: the
 * aggregate is one request either way.
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
    <Answers
      result={result}
      sourceOf={(note) => (note?.repo === undefined ? machine : (sources.get(note.repo.id) ?? machine))}
      identitiesOf={(note) => (note.repo === undefined ? NO_IDENTITIES : (identities.get(note.repo.id) ?? NO_IDENTITIES))}
      onResolved={refresh}
      empty="Nothing is waiting on you in any project. Open questions and blockers appear here."
    />
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
