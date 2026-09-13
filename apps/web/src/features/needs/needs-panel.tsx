import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { Aside, useAsideDocked } from "../../components/aside.js";
import { RowList } from "../../components/ui/list-row.js";
import { PageSection } from "../../components/ui/page.js";
import type { LedgerSource, NoteRef, ParsedSession, Repo } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import type { Async } from "../../lib/use-async.js";
import { useIdentities, type IdentityMap } from "../identity/live.js";
import type { LiveNotes } from "./live.js";
import { NoteCard } from "./note-card.js";
import { checkpointAt, NoteModule, NotePanel } from "./note-panel.js";

/** A note as the answer list holds it: machine-wide rows also carry the repo they came from. */
export type AnswerNote = NoteRef & { repo?: Repo };

/** A note's identity: its repo (machine-wide), then the three fields `resolveNote` takes. */
export function keyOf(note: AnswerNote): string {
  return `${note.repo?.id ?? ""}-${note.session}-${String(note.cp)}-${String(note.index)}`;
}

/** A keystroke inside a field, or on a control of its own, is not the page's to take. */
function isOnControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName);
}

/** How Review heads the answers on each of the views that shows them. */
export const ANSWER_SECTIONS = {
  all: {
    title: "Waiting on an answer",
    label: "Open questions and blockers",
    empty: "Nothing is waiting on you. Open questions and blockers appear here.",
    emptyAcross: "Nothing is waiting on you in any project. Open questions and blockers appear here.",
  },
  blocker: {
    title: "Blockers",
    label: "Open blockers",
    empty: "No open blockers.",
    emptyAcross: "No open blockers in any project.",
  },
  question: {
    title: "Questions",
    label: "Open questions",
    empty: "No open questions.",
    emptyAcross: "No open questions in any project.",
  },
} as const;

export type AnswerSection = keyof typeof ANSWER_SECTIONS;

/** `result` narrowed to one note type, or left whole for `all`; identity-stable while `result` is. */
export function useNotesOfType<T extends NoteRef>(
  result: Async<T[]>,
  type: NoteRef["type"] | "all",
): Async<T[]> {
  return useMemo(
    () =>
      result.state !== "ready" || type === "all"
        ? result
        : { state: "ready", value: result.value.filter((note) => note.type === type) },
    [result, type],
  );
}

/**
 * The open `blocker` and `question` notes in one repo, newest first — Review's "Waiting on an
 * answer" (frame `10:31`), or one kind of them on the Blockers and Questions views. The read is
 * the page's (`live`), because the toolbar counts the same notes. The machine-wide version is
 * `all-needs-panel.tsx`; both are {@link Answers}.
 */
export function NeedsPanel({ live, section = "all" }: { live: LiveNotes; section?: AnswerSection }) {
  const source = useSource();
  const result = useNotesOfType(live.result, section);
  // One read for the whole list rather than one per card: the map is the same for every note.
  const identities = useIdentities();
  const copy = ANSWER_SECTIONS[section];
  return (
    <Answers
      result={result}
      sourceOf={() => source}
      identitiesOf={() => identities}
      onResolved={live.refresh}
      title={copy.title}
      label={copy.label}
      empty={copy.empty}
    />
  );
}

/**
 * The answer cards, and the one note they select.
 *
 * From 1280 px the selected note — the first one until a card is chosen — is the right column's
 * "Selected" module, with the answer field in it; a card's Answer button selects it and moves the
 * focus into that field. Below 1280 px there is no column to hold a module (`narrow="none"`), so a
 * card opens the note in the floating panel instead, with the same readings and the same form.
 */
export function Answers({
  result,
  sourceOf,
  identitiesOf,
  onResolved,
  title = ANSWER_SECTIONS.all.title,
  label = ANSWER_SECTIONS.all.label,
  empty,
}: {
  result: Async<AnswerNote[]>;
  /** The source a note resolves through; `null` asks for the one to hold while nothing is open. */
  sourceOf: (note: AnswerNote | null) => LedgerSource;
  identitiesOf: (note: AnswerNote) => IdentityMap;
  onResolved: () => void;
  /** The section head, and the list's accessible name. */
  title?: string;
  label?: string;
  empty: string;
}) {
  const docked = useAsideDocked();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);

  const notes = useMemo(() => (result.state === "ready" ? result.value : []), [result]);
  const sessions = useSessionsOf(notes, sourceOf);

  // Docked, something is always selected while there is anything to select.
  const selected = notes.find((note) => keyOf(note) === selectedKey) ?? notes[0] ?? null;
  const opened = docked ? null : (notes.find((note) => keyOf(note) === openKey) ?? null);

  const choose = useCallback(
    (note: AnswerNote, focus: boolean) => {
      if (docked) setSelectedKey(keyOf(note));
      else setOpenKey(keyOf(note));
      if (focus) setFocusSignal((n) => n + 1);
    },
    [docked],
  );

  // Enter answers the selected note, as the header's hint says — unless the key is already some
  // control's own (a focused button's Enter is that button's click).
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isOnControl(event.target) || selectedRef.current === null) return;
      event.preventDefault();
      choose(selectedRef.current, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose]);

  return (
    <PageSection
      id="review-answers-heading"
      title={title}
      aside={result.state === "ready" ? `${String(notes.length)} open` : undefined}
    >
      <AsyncPanel result={result} isEmpty={(list) => list.length === 0} empty={empty}>
        {(list) => (
          <RowList aria-label={label}>
            {list.map((note) => {
              const session = sessions.get(sessionKey(note));
              return (
                <NoteCard
                  key={keyOf(note)}
                  note={note}
                  repo={note.repo}
                  at={checkpointAt(note, session)}
                  selected={docked ? selected === note : openKey === keyOf(note)}
                  opensDialog={!docked}
                  onSelect={() => choose(note, false)}
                  onAnswer={() => choose(note, true)}
                />
              );
            })}
          </RowList>
        )}
      </AsyncPanel>

      <Aside narrow="none">
        {docked && selected !== null ? (
          <NoteModule
            note={selected}
            source={sourceOf(selected)}
            session={sessions.get(sessionKey(selected))}
            identities={identitiesOf(selected)}
            onResolved={onResolved}
            focusSignal={focusSignal}
          />
        ) : null}
      </Aside>
      <NotePanel
        note={opened}
        repo={opened?.repo}
        source={sourceOf(opened)}
        session={opened === null ? undefined : sessions.get(sessionKey(opened))}
        identities={opened === null ? undefined : identitiesOf(opened)}
        onResolved={onResolved}
        onClose={() => setOpenKey(null)}
        focusSignal={focusSignal}
      />
    </PageSection>
  );
}

/** A session is only unique within its repo. */
export function sessionKey(note: AnswerNote): string {
  return `${note.repo?.id ?? ""}:${note.session}`;
}

/**
 * The session of every note in the list, read once per distinct session (through the note's own
 * source) rather than once per card — a handful of sessions usually raise every open note.
 *
 * Context, not the note: a read that fails leaves the entry missing, and the card and the module
 * fall back to what the `NoteRef` carries. A session already read is not read again when the list
 * re-reads; its goal and checkpoint times do not change under an open note.
 */
export function useSessionsOf(
  notes: readonly AnswerNote[],
  sourceOf: (note: AnswerNote) => LedgerSource,
): ReadonlyMap<string, ParsedSession> {
  const [found, setFound] = useState<ReadonlyMap<string, ParsedSession>>(() => new Map());
  const requested = useRef(new Set<string>());
  const live = useRef(true);
  const wanted = useRef({ notes, sourceOf });
  wanted.current = { notes, sourceOf };
  const signature = [...new Set(notes.map(sessionKey))].sort().join("|");

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    for (const note of wanted.current.notes) {
      const key = sessionKey(note);
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      wanted.current
        .sourceOf(note)
        .getSession(note.session)
        .then(
          (session) => {
            if (live.current) setFound((prior) => new Map(prior).set(key, session));
          },
          () => {
            // Left missing on purpose: every reading falls back to the NoteRef's own fields.
          },
        );
    }
  }, [signature]);

  return found;
}
