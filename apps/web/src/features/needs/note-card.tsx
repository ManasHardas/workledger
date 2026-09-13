import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/cn.js";
import type { NoteRef, Repo } from "../../lib/ledger-source.js";
import { repoHref } from "../../lib/router.js";
import { formatDayMonth } from "../ledger/format.js";
import { NoteChip } from "./note-panel.js";

/**
 * One open `blocker` or `question`, as Review's answer card (frame `10:35`).
 *
 * The top line is the chip and what the note says, wrapping rather than truncating — a question
 * cut off mid-sentence cannot be answered. The foot is where it came from, in mono: the session's
 * first eleven characters, the checkpoint, and that checkpoint's day once the session has been read
 * (`at`); then the Answer button, which selects the card and puts the focus in the answer field.
 *
 * `repo`, when given, is the machine-wide Review (P8): the foot names the repo too, as a link into
 * that repo's own Review.
 */
export function NoteCard({
  note,
  repo,
  at,
  selected,
  opensDialog,
  onSelect,
  onAnswer,
}: {
  note: NoteRef;
  repo?: Repo;
  /** When the checkpoint that raised the note was recorded, once its session has been read. */
  at?: string;
  selected: boolean;
  /** True when selecting opens the floating panel rather than the docked module. */
  opensDialog: boolean;
  onSelect: () => void;
  onAnswer: () => void;
}) {
  const where = [note.session.slice(0, 11), `cp ${String(note.cp)}`, ...(at === undefined ? [] : [formatDayMonth(at)])];
  return (
    <li
      data-selected={selected ? "" : undefined}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 cursor-default flex-col gap-2 rounded-lg border px-3.5 py-3 transition-colors",
        selected ? "border-primary bg-selected" : "border-hairline bg-card hover:bg-muted",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <NoteChip type={note.type} />
        <button
          type="button"
          aria-haspopup={opensDialog ? "dialog" : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className="min-w-0 flex-1 break-words rounded-sm text-left text-base leading-body tracking-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {note.text}
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 break-words font-mono text-xs leading-tight text-subtle-foreground">
          {where.join(" · ")}
          {repo === undefined ? null : (
            <>
              {" · "}
              <a
                href={repoHref(repo.id, "review")}
                aria-label={`${repo.name} — Review`}
                onClick={(event) => event.stopPropagation()}
                className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {repo.name}
              </a>
            </>
          )}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onAnswer();
          }}
        >
          Answer
        </Button>
      </div>
    </li>
  );
}
