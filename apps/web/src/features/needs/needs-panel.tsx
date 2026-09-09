import { useId, useState, type FormEvent } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import type { LedgerSource } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { useLiveRead } from "../live-read.js";
import { joinOpenNotes, type OpenNote } from "./open-notes.js";

/**
 * Every open `blocker` and `question` across sessions, newest first, each resolvable in place
 * (design spec §8 "Needs you").
 *
 * The sessions are read alongside the notes rather than one per card: a `NoteRef` carries neither
 * the goal the card shows nor the per-checkpoint `index` that `resolveNote` needs, and both come
 * out of the same one session list.
 */
async function readOpenNotes(source: LedgerSource): Promise<OpenNote[]> {
  const [notes, sessions] = await Promise.all([
    source.listNotes({ type: ["blocker", "question"], open: true }),
    source.listSessions(),
  ]);
  return joinOpenNotes(notes, sessions);
}

export function NeedsPanel() {
  const source = useSource();
  const { result, refresh } = useLiveRead(source, ["notes.changed"], readOpenNotes);

  return (
    <AsyncPanel
      result={result}
      isEmpty={(list) => list.length === 0}
      empty="Nothing is waiting on you. Open questions and blockers appear here."
    >
      {(list) => (
        <ul className="flex flex-col gap-3">
          {list.map((entry) => (
            <li key={`${entry.note.session}-${entry.note.cp}-${entry.note.text}`}>
              <NoteCard entry={entry} onResolved={refresh} />
            </li>
          ))}
        </ul>
      )}
    </AsyncPanel>
  );
}

function NoteCard({ entry, onResolved }: { entry: OpenNote; onResolved: () => void }) {
  const source = useSource();
  const { note, goal, index } = entry;
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A read-only source rejects every write, and a note whose session we could not read has no
  // `index` to name it by — in both cases the control is disabled rather than hidden, so the
  // reason it cannot be used stays visible.
  const resolvable = source.capabilities.write && index !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (index === null || decision.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await source.resolveNote(
        { session: note.session, cp: note.cp, index },
        decision.trim(),
      );
      setDecision("");
      setOpen(false);
      onResolved();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={note.type === "blocker" ? "destructive" : "accent"}>{note.type}</Badge>
          <Badge variant="outline" className="font-mono">
            [cp {note.cp}]
          </Badge>
        </div>
        <CardTitle>{note.text}</CardTitle>
        <CardDescription>{goal ?? `session ${note.session}`}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {open ? (
          <form className="flex flex-col gap-2" onSubmit={submit}>
            <label htmlFor={fieldId} className="text-sm font-medium">
              Your decision
            </label>
            <textarea
              id={fieldId}
              rows={3}
              value={decision}
              autoFocus
              onChange={(event) => setDecision(event.target.value)}
              placeholder="What should happen, and why."
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy || decision.trim() === ""}>
                {busy ? "Saving…" : "Save decision"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!resolvable}
              onClick={() => setOpen(true)}
            >
              Resolve
            </Button>
            {resolvable ? null : (
              <span className="text-xs text-muted-foreground">
                {index === null
                  ? "This note's session is not loaded, so it cannot be resolved here."
                  : "This source is read-only."}
              </span>
            )}
          </div>
        )}
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            Could not resolve this note: {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return String(error);
}
