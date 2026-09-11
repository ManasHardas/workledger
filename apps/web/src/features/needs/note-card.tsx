import { Badge } from "../../components/ui/badge.js";
import { ListRow, RowTitle } from "../../components/ui/list-row.js";
import type { NoteRef, Repo } from "../../lib/ledger-source.js";
import { repoHref } from "../../lib/router.js";

/**
 * One open `blocker` or `question`, as a row (`docs/design/direction.md` §Density).
 *
 * The row carries what the note *says* and two chips that carry state — its type and the
 * checkpoint it came from. Which session it was, whose it was, and the decision form that resolves
 * it are all in the right panel, because a resolution is written against evidence and evidence is
 * never inline (rule 3). The text opens it.
 *
 * `repo`, when given, is the machine-wide tab's repo column (P8): a link into that repo's own
 * Needs you, so the row says where it came from without a third chip.
 */
export function NoteCard({
  note,
  repo,
  selected,
  onOpen,
}: {
  note: NoteRef;
  repo?: Repo;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <ListRow selected={selected}>
      <Badge variant={note.type === "blocker" ? "destructive" : "accent"} className="shrink-0">
        {note.type}
      </Badge>
      <RowTitle aria-haspopup="dialog" onClick={onOpen}>
        {note.text}
      </RowTitle>
      <span className="shrink-0 font-mono text-xs text-subtle-foreground">{`cp ${String(note.cp)}`}</span>
      {repo === undefined ? null : (
        <a
          href={repoHref(repo.id, "needs")}
          aria-label={`${repo.name} — Needs you`}
          className="shrink-0 rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {repo.name}
        </a>
      )}
    </ListRow>
  );
}
