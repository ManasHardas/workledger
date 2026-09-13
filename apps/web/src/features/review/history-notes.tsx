import { useMemo } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { Badge } from "../../components/ui/badge.js";
import { RowList } from "../../components/ui/list-row.js";
import { PageSection } from "../../components/ui/page.js";
import type { LedgerSource, NoteRef, Repo } from "../../lib/ledger-source.js";
import { repoHref } from "../../lib/router.js";
import type { Async } from "../../lib/use-async.js";
import { formatDayMonth } from "../ledger/format.js";
import { checkpointAt } from "../needs/note-panel.js";
import { keyOf, sessionKey, useSessionsOf, type AnswerNote } from "../needs/needs-panel.js";

export type HistoryType = "decision" | "discovery";

const COPY: Record<HistoryType, { title: string; label: string; empty: string }> = {
  decision: { title: "Decisions", label: "Decisions, newest first", empty: "No decisions recorded yet." },
  discovery: { title: "Discoveries", label: "Discoveries, newest first", empty: "No discoveries recorded yet." },
};

/**
 * Review's Decisions and Discoveries views: what was decided and what was found, newest first, as
 * read-only cards — there is nothing to answer, so there is no Answer button and no Selected
 * module.
 *
 * Newest is the checkpoint's time once the note's session has been read (the same per-session
 * read the answer cards make); a note whose session is not in yet keeps the source's order, which
 * is newest first by contract.
 */
export function HistoryNotes({
  type,
  result,
  sourceOf,
}: {
  type: HistoryType;
  /** Already narrowed to `type`. */
  result: Async<AnswerNote[]>;
  sourceOf: (note: AnswerNote) => LedgerSource;
}) {
  const notes = useMemo(() => (result.state === "ready" ? result.value : []), [result]);
  const sessions = useSessionsOf(notes, sourceOf);
  const copy = COPY[type];

  const ordered = useMemo(() => {
    const timed = notes.map((note, at) => ({ note, at, when: checkpointAt(note, sessions.get(sessionKey(note))) }));
    return timed
      .sort((a, b) => {
        if (a.when !== undefined && b.when !== undefined && a.when !== b.when) return a.when < b.when ? 1 : -1;
        return a.at - b.at;
      })
      .map(({ note, when }) => ({ note, when }));
  }, [notes, sessions]);

  return (
    <PageSection
      id={`review-${type}-heading`}
      title={copy.title}
      aside={result.state === "ready" ? String(notes.length) : undefined}
    >
      <AsyncPanel result={result} isEmpty={(list) => list.length === 0} empty={copy.empty}>
        {() => (
          <RowList aria-label={copy.label}>
            {ordered.map(({ note, when }) => (
              <HistoryCard key={keyOf(note)} note={note} repo={note.repo} at={when} />
            ))}
          </RowList>
        )}
      </AsyncPanel>
    </PageSection>
  );
}

/**
 * One `decision` or `discovery`: the chip and what the note says, the reason under it when the
 * note has one, and the answer cards' foot — where it came from, in mono, and on every project's
 * Review the repo as a link into that repo's own.
 */
export function HistoryCard({ note, repo, at }: { note: NoteRef; repo?: Repo; at?: string }) {
  const where = [note.session.slice(0, 11), `cp ${String(note.cp)}`, ...(at === undefined ? [] : [formatDayMonth(at)])];
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-hairline bg-card px-3.5 py-3">
      <div className="flex min-w-0 items-start gap-2">
        <Badge variant={note.type === "decision" ? "success" : "secondary"}>{note.type}</Badge>
        <p className="min-w-0 flex-1 break-words text-base leading-body tracking-body text-foreground">{note.text}</p>
      </div>
      {note.reason === undefined || note.reason === "" ? null : (
        <p className="min-w-0 break-words text-base leading-body tracking-body text-muted-foreground">{note.reason}</p>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 break-words font-mono text-xs leading-tight text-subtle-foreground">
          {where.join(" · ")}
          {repo === undefined ? null : (
            <>
              {" · "}
              <a
                href={repoHref(repo.id, "review")}
                aria-label={`${repo.name} — Review`}
                className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {repo.name}
              </a>
            </>
          )}
        </p>
        {note.type === "decision" && note.by !== undefined ? (
          <span className="shrink-0 text-xs leading-tight text-subtle-foreground">{`by ${note.by}`}</span>
        ) : null}
      </div>
    </li>
  );
}
