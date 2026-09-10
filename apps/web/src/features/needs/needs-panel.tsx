import { useEffect, useId, useState, type FormEvent } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import type { Actor, NoteRef } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { ActorName } from "../identity/actor-name.js";
import { useIdentities } from "../identity/live.js";
import { useLiveOpenNotes } from "./live.js";

import type { IdentityMap } from "../identity/live.js";

/**
 * Every open `blocker` and `question` across sessions, newest first, each resolvable in place
 * (design spec §8 "Needs you").
 *
 * A `NoteRef` carries its own `session`, `cp` and `index`, which is the whole of a `resolveNote`
 * ref — the panel never reconstructs one from a session listing.
 */
export function NeedsPanel() {
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
              <NoteCard note={note} onResolved={refresh} identities={identities} />
            </li>
          ))}
        </ul>
      )}
    </AsyncPanel>
  );
}

function NoteCard({
  note,
  onResolved,
  identities,
}: {
  note: NoteRef;
  onResolved: () => void;
  identities: IdentityMap;
}) {
  const source = useSource();
  const { goal, author } = useSessionContext(note.session);
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A read-only source rejects every write. The control is disabled rather than hidden, so the
  // reason it cannot be used stays visible.
  const resolvable = source.capabilities.write;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (decision.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await source.resolveNote(
        { session: note.session, cp: note.cp, index: note.index },
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
        <CardDescription>
          {/* The goal keeps an element of its own so the author beside it is a sibling rather
              than text spliced into the middle of it. */}
          <span>{goal ?? `session ${note.session}`}</span>
          {author ? (
            <>
              {" — "}
              <ActorName actor={author} identities={identities} />
            </>
          ) : null}
        </CardDescription>
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
            <Button size="sm" variant="outline" disabled={!resolvable} onClick={() => setOpen(true)}>
              Resolve
            </Button>
            {resolvable ? null : (
              <span className="text-xs text-muted-foreground">This source is read-only.</span>
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

/** What a note's own session contributes to its card: what it was for, and whose it was. */
interface SessionContext {
  goal: string | null;
  /** The session's `author`, the one email a `NoteRef` can be attributed to. */
  author: Actor | null;
}

const NO_CONTEXT: SessionContext = { goal: null, author: null };

/**
 * The goal and author of the session a note came from, read lazily per card.
 *
 * It is context, not the note: a card that cannot get it falls back to showing the session ulid,
 * which still identifies the session and still resolves. Reading it per card rather than joining a
 * `listSessions()` page is what keeps that page's `limit` out of whether a note is resolvable.
 *
 * The author is here rather than on the `NoteRef` because api.md's `NoteLine.by` is the enum
 * `"human" | "agent"` — a *kind*, not a person. The session's `author` is the address behind that
 * kind, and it is what the identities map has a name for.
 */
function useSessionContext(ulid: string): SessionContext {
  const source = useSource();
  const [context, setContext] = useState<SessionContext>(NO_CONTEXT);

  useEffect(() => {
    let live = true;
    setContext(NO_CONTEXT);
    source.getSession(ulid).then(
      (session) => {
        if (live) setContext({ goal: session.goal, author: session.frontmatter.author });
      },
      () => {
        // Rendered as the ulid fallback above rather than swallowed: the card stays usable.
        if (live) setContext(NO_CONTEXT);
      },
    );
    return () => {
      live = false;
    };
  }, [source, ulid]);

  return context;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return String(error);
}
