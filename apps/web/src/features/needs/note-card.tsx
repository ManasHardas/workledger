import { useEffect, useId, useState, type FormEvent } from "react";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import { messageOf } from "../../lib/errors.js";
import type { Actor, LedgerSource, NoteRef, Repo } from "../../lib/ledger-source.js";
import { repoHref } from "../../lib/router.js";
import { ActorName } from "../identity/actor-name.js";

import type { IdentityMap } from "../identity/live.js";

/**
 * One open `blocker` or `question`, resolvable in place (design spec §8 "Needs you").
 *
 * A `NoteRef` carries its own `session`, `cp` and `index`, which is the whole of a `resolveNote`
 * ref — the card never reconstructs one from a session listing. `source` is a prop rather than
 * `useSource()` because the machine-wide tab renders notes from several repos in one list, and
 * each card has to resolve through the source of the repo its note lives in (P8). `repo`, when
 * given, is shown on the card and links into that repo's own Needs you.
 */
export function NoteCard({
  note,
  source,
  identities,
  repo,
  onResolved,
}: {
  note: NoteRef;
  source: LedgerSource;
  identities: IdentityMap;
  repo?: Repo;
  onResolved: () => void;
}) {
  const { goal, author } = useSessionContext(source, note.session);
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
          {repo === undefined ? null : (
            <a
              href={repoHref(repo.id, "needs")}
              aria-label={`${repo.name} — Needs you`}
              className="rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {repo.name}
            </a>
          )}
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
function useSessionContext(source: LedgerSource, ulid: string): SessionContext {
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
