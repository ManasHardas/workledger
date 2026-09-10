import { AsyncPanel } from "../../components/async-panel.js";
import { useSource } from "../../lib/source-context.js";
import { useIdentities } from "../identity/live.js";
import { useLiveOpenNotes } from "./live.js";
import { NoteCard } from "./note-card.js";

/**
 * Every open `blocker` and `question` across one repo's sessions, newest first, each resolvable
 * in place (design spec §8 "Needs you"). The machine-wide version is `all-needs-panel.tsx`.
 */
export function NeedsPanel() {
  const source = useSource();
  const { result, refresh } = useLiveOpenNotes();
  // One read for the whole list rather than one per card: the map is the same for every note.
  const identities = useIdentities();

  return (
    <AsyncPanel
      result={result}
      isEmpty={(list) => list.length === 0}
      empty="Nothing is waiting on you. Open questions and blockers appear here."
    >
      {(list) => (
        <ul className="flex flex-col gap-3">
          {list.map((note) => (
            <li key={`${note.session}-${note.cp}-${note.index}`}>
              <NoteCard note={note} source={source} identities={identities} onResolved={refresh} />
            </li>
          ))}
        </ul>
      )}
    </AsyncPanel>
  );
}
