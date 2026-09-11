import { useState } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { RowList } from "../../components/ui/list-row.js";
import type { NoteRef } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { useIdentities } from "../identity/live.js";
import { useLiveOpenNotes } from "./live.js";
import { NoteCard } from "./note-card.js";
import { NotePanel } from "./note-panel.js";

/** A `NoteRef`'s identity: the three fields `resolveNote` takes, and the only stable key it has. */
function keyOf(note: NoteRef): string {
  return `${note.session}-${String(note.cp)}-${String(note.index)}`;
}

/**
 * Every open `blocker` and `question` across one repo's sessions, newest first, on the shell's
 * list rhythm — one row each, with the decision form in the right panel (#134, rule 3). The
 * machine-wide version is `all-needs-panel.tsx`.
 */
export function NeedsPanel() {
  const source = useSource();
  const { result, refresh } = useLiveOpenNotes();
  // One read for the whole list rather than one per row: the map is the same for every note.
  const identities = useIdentities();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const notes = result.state === "ready" ? result.value : [];
  const opened = notes.find((note) => keyOf(note) === openKey) ?? null;

  return (
    <>
      <AsyncPanel
        result={result}
        isEmpty={(list) => list.length === 0}
        empty="Nothing is waiting on you. Open questions and blockers appear here."
      >
        {(list) => (
          <RowList aria-label="Open questions and blockers">
            {list.map((note) => (
              <NoteCard
                key={keyOf(note)}
                note={note}
                selected={openKey === keyOf(note)}
                onOpen={() => setOpenKey(keyOf(note))}
              />
            ))}
          </RowList>
        )}
      </AsyncPanel>
      <NotePanel
        note={opened}
        source={source}
        identities={identities}
        onResolved={refresh}
        onClose={() => setOpenKey(null)}
      />
    </>
  );
}
