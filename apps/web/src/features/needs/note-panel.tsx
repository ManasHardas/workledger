import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Module, ModuleHead, ModuleSection, ModuleTitle } from "../../components/ui/module.js";
import { Panel } from "../../components/ui/panel.js";
import { TextareaField } from "../../components/ui/textarea-field.js";
import { messageOf } from "../../lib/errors.js";
import type { LedgerSource, NoteRef, ParsedSession, Repo } from "../../lib/ledger-source.js";
import { formatDayMonthYear } from "../ledger/format.js";
import { ActorName } from "../identity/actor-name.js";
import { NO_IDENTITIES, type IdentityMap } from "../identity/live.js";

/**
 * A note in full, and the answer that resolves it — two presentations of one form.
 *
 * From 1280 px it is Review's docked "Selected" module ({@link NoteModule}, frame `10:121`); below
 * that there is no right column, so the same readings and the same form open in the floating
 * {@link NotePanel}. Both submit through {@link NoteForm}, so the two can never disagree about
 * what an answer writes.
 *
 * A `NoteRef` carries its own `session`, `cp` and `index`, which is the whole of a `resolveNote`
 * ref, so nothing reconstructs one from a session listing. `source` is a prop rather than
 * `useSource()` because the machine-wide Review shows notes from several repos in one list, and
 * each has to resolve through the source of the repo its note lives in (P8).
 *
 * `session` is the note's own session when it has been read, and `undefined` until then (or when
 * the read failed): it is context — the goal, the author, the checkpoint's time — never what makes
 * the note resolvable, so every reading falls back to what the `NoteRef` itself carries.
 */

export interface NoteViewProps {
  note: NoteRef;
  source: LedgerSource;
  session?: ParsedSession;
  identities?: IdentityMap;
  onResolved: () => void;
  /** Bumped by an Answer button: the form takes the focus each time it changes. */
  focusSignal?: number;
}

/** `blocker` stops work; `question` is asked. The chip says which, in the status colours. */
export function NoteChip({ type, className }: { type: NoteRef["type"]; className?: string }) {
  return (
    <Badge variant={type === "blocker" ? "destructive" : "accent"} className={className}>
      {type}
    </Badge>
  );
}

/** When the checkpoint that raised `note` was recorded, if its session has been read. */
export function checkpointAt(note: NoteRef, session: ParsedSession | undefined): string | undefined {
  return session?.frontmatter.checkpoints.find((checkpoint) => checkpoint.n === note.cp)?.at;
}

/** Review's docked "Selected" module: the chip and the note, its readings, and the answer. */
export function NoteModule({ note, source, session, identities = NO_IDENTITIES, onResolved, focusSignal }: NoteViewProps) {
  const titleId = useId();
  return (
    <Module aria-labelledby={titleId}>
      <ModuleHead className="gap-2">
        <NoteChip type={note.type} className="self-start" />
        <ModuleTitle id={titleId}>{note.text}</ModuleTitle>
      </ModuleHead>
      <NoteReadings note={note} session={session} identities={identities} framed />
      <NoteForm note={note} source={source} onResolved={onResolved} focusSignal={focusSignal} framed />
    </Module>
  );
}

/**
 * The same note in the floating right panel, for widths with no right column.
 *
 * The panel stays mounted with `note === null` so focus returns to the card that opened it and a
 * second card replaces the contents rather than closing and reopening.
 */
export function NotePanel({
  note,
  source,
  session,
  identities = NO_IDENTITIES,
  repo,
  onResolved,
  onClose,
  focusSignal,
}: Omit<NoteViewProps, "note"> & { note: NoteRef | null; repo?: Repo; onClose: () => void }) {
  return (
    <Panel
      open={note !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={note?.text ?? ""}
      description={
        note === null ? undefined : (
          <>
            <span>{note.type}</span>
            <span className="font-mono">{`cp ${String(note.cp)}`}</span>
            {repo === undefined ? null : <span>{repo.name}</span>}
          </>
        )
      }
    >
      {note === null ? null : (
        <div className="flex flex-col gap-4">
          <NoteReadings note={note} session={session} identities={identities} framed={false} />
          <NoteForm
            note={note}
            source={source}
            focusSignal={focusSignal}
            framed={false}
            onResolved={() => {
              onResolved();
              onClose();
            }}
          />
        </div>
      )}
    </Panel>
  );
}

/** One labelled reading: a module section when docked, a plain block inside the panel. */
function Reading({ label, framed, children }: { label: string; framed: boolean; children: ReactNode }) {
  if (framed) return <ModuleSection label={label}>{children}</ModuleSection>;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-medium leading-tight text-muted-foreground">{label}</p>
      <div className="min-w-0 break-words text-base leading-body tracking-body text-foreground">{children}</div>
    </div>
  );
}

/** "Raised in", "Where", and why the agent stopped or asked (`10:126`–`10:134`). */
function NoteReadings({
  note,
  session,
  identities,
  framed,
}: {
  note: NoteRef;
  session: ParsedSession | undefined;
  identities: IdentityMap;
  framed: boolean;
}) {
  const at = checkpointAt(note, session);
  const author = session?.frontmatter.author;
  return (
    <>
      <Reading label="Raised in" framed={framed}>
        {/* The goal keeps an element of its own so the author under it is a sibling rather than
            text spliced into the middle of it. */}
        <p>{session?.goal ?? `session ${note.session}`}</p>
        {author === undefined ? null : (
          <p className="text-xs leading-tight text-subtle-foreground">
            <ActorName actor={author} identities={identities} />
          </p>
        )}
      </Reading>
      <Reading label="Where" framed={framed}>
        <p className="break-words font-mono text-xs leading-tight">
          {[note.session, `cp ${String(note.cp)}`, ...(at === undefined ? [] : [formatDayMonthYear(at)])].join(" · ")}
        </p>
      </Reading>
      {note.reason === undefined || note.reason === "" ? null : (
        <Reading label={note.type === "blocker" ? "Why it stopped work" : "Why it is asked"} framed={framed}>
          {note.reason}
        </Reading>
      )}
    </>
  );
}

/**
 * "Your answer" — recorded through `resolveNote` as a decision note on the session the note came
 * from. A read-only source rejects every write, so the field and the button are disabled rather
 * than hidden, and the line beside the button says why.
 */
function NoteForm({
  note,
  source,
  onResolved,
  focusSignal,
  framed,
}: {
  note: NoteRef;
  source: LedgerSource;
  onResolved: () => void;
  focusSignal?: number;
  framed: boolean;
}) {
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolvable = source.capabilities.write;

  useEffect(() => {
    setDecision("");
    setError(null);
  }, [note.session, note.cp, note.index]);

  // A tick later than the render that asked, so a panel opening in the same render (whose dialog
  // moves focus into itself on mount) does not take the focus straight back.
  useEffect(() => {
    if (focusSignal === undefined || focusSignal === 0) return;
    const timer = setTimeout(() => field.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [focusSignal]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (decision.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await source.resolveNote({ session: note.session, cp: note.cp, index: note.index }, decision.trim());
      setDecision("");
      onResolved();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={framed ? "flex min-w-0 flex-col gap-2 border-t border-hairline px-4 pb-3.5 pt-3" : "flex min-w-0 flex-col gap-2"}
      onSubmit={submit}
    >
      <label htmlFor={fieldId} className="text-xs font-medium leading-tight text-muted-foreground">
        Your answer
      </label>
      <TextareaField
        ref={field}
        id={fieldId}
        rows={2}
        value={decision}
        onChange={(event) => setDecision(event.target.value)}
        placeholder="What should happen, and why."
        disabled={busy || !resolvable}
      />
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 text-xs leading-tight text-subtle-foreground">
          {resolvable ? "Recorded as a decision note on the session" : "This source is read-only."}
        </p>
        <Button type="submit" size="sm" disabled={busy || !resolvable || decision.trim() === ""}>
          {busy ? "Saving…" : "Answer"}
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs leading-tight text-destructive">
          Could not resolve this note: {error}
        </p>
      )}
    </form>
  );
}
