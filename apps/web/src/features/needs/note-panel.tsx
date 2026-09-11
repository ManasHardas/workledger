import { useEffect, useId, useState, type FormEvent } from "react";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Panel } from "../../components/ui/panel.js";
import { TextareaField } from "../../components/ui/textarea-field.js";
import { messageOf } from "../../lib/errors.js";
import type { Actor, LedgerSource, NoteRef, Repo } from "../../lib/ledger-source.js";
import { ActorName } from "../identity/actor-name.js";
import { NO_IDENTITIES, type IdentityMap } from "../identity/live.js";

/**
 * The note in full, and the decision that resolves it — in the right panel (rule 3).
 *
 * A `NoteRef` carries its own `session`, `cp` and `index`, which is the whole of a `resolveNote`
 * ref, so the panel never reconstructs one from a session listing. `source` is a prop rather than
 * `useSource()` because the machine-wide tab shows notes from several repos in one list, and each
 * has to resolve through the source of the repo its note lives in (P8).
 *
 * The panel stays mounted with `note === null` so focus returns to the row that opened it and a
 * second row replaces the contents rather than closing and reopening.
 */
export function NotePanel({
  note,
  source,
  identities = NO_IDENTITIES,
  repo,
  onResolved,
  onClose,
}: {
  note: NoteRef | null;
  source: LedgerSource;
  identities?: IdentityMap;
  repo?: Repo;
  onResolved: () => void;
  onClose: () => void;
}) {
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
        <NoteBody
          note={note}
          source={source}
          identities={identities}
          onResolved={() => {
            onResolved();
            onClose();
          }}
        />
      )}
    </Panel>
  );
}

function NoteBody({
  note,
  source,
  identities,
  onResolved,
}: {
  note: NoteRef;
  source: LedgerSource;
  identities: IdentityMap;
  onResolved: () => void;
}) {
  const { goal, author } = useSessionContext(source, note.session);
  const fieldId = useId();
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A read-only source rejects every write. The control is disabled rather than hidden, so the
  // reason it cannot be used stays visible.
  const resolvable = source.capabilities.write;

  useEffect(() => {
    setDecision("");
    setError(null);
  }, [note.session, note.cp, note.index]);

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
      onResolved();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">Session</p>
        {/* The goal keeps an element of its own so the author beside it is a sibling rather than
            text spliced into the middle of it. */}
        <p className="text-xs text-muted-foreground">
          <span>{goal ?? `session ${note.session}`}</span>
          {author ? (
            <>
              {" — "}
              <ActorName actor={author} identities={identities} />
            </>
          ) : null}
        </p>
        <p className="font-mono text-xs text-subtle-foreground">{note.session}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">Note</p>
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant={note.type === "blocker" ? "destructive" : "accent"}>{note.type}</Badge>
          <span className="min-w-0">{note.text}</span>
        </p>
      </div>

      <form className="flex flex-col gap-2" onSubmit={submit}>
        <label htmlFor={fieldId} className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">
          Your decision
        </label>
        <TextareaField
          id={fieldId}
          rows={4}
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
          placeholder="What should happen, and why."
          disabled={busy || !resolvable}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy || !resolvable || decision.trim() === ""}
          >
            {busy ? "Saving…" : "Resolve"}
          </Button>
          {resolvable ? null : (
            <span className="text-xs text-muted-foreground">This source is read-only.</span>
          )}
        </div>
      </form>

      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          Could not resolve this note: {error}
        </p>
      )}
    </div>
  );
}

/** What a note's own session contributes to its panel: what it was for, and whose it was. */
interface SessionContext {
  goal: string | null;
  /** The session's `author`, the one email a `NoteRef` can be attributed to. */
  author: Actor | null;
}

const NO_CONTEXT: SessionContext = { goal: null, author: null };

/**
 * The goal and author of the session a note came from, read when the panel opens.
 *
 * It is context, not the note: a panel that cannot get it falls back to the session ulid, which
 * still identifies the session and still resolves. Reading it here rather than joining a
 * `listSessions()` page is what keeps that page's `limit` out of whether a note is resolvable —
 * and reading it per *open panel* rather than per row is one request instead of one per note.
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
        // Rendered as the ulid fallback above rather than swallowed: the panel stays usable.
        if (live) setContext(NO_CONTEXT);
      },
    );
    return () => {
      live = false;
    };
  }, [source, ulid]);

  return context;
}
