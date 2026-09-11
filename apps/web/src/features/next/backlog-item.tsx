import { useEffect, useState, type ComponentProps } from "react";

import { actionLabel, actionsFor, isAgentProposed } from "./backlog-model.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { ConfirmAction, ListRow, RowActions, RowTitle } from "../../components/ui/list-row.js";

import type { BacklogActions } from "./backlog-actions.js";
import type { BacklogView } from "../../lib/ledger-source.js";

/**
 * The drag handlers the Next view puts on the row for drop-to-reorder are ordinary `<li>` props,
 * so they ride along rather than being re-declared one by one.
 */
export interface BacklogItemProps extends Omit<ComponentProps<"li">, "onSelect" | "title"> {
  item: BacklogView;
  actions: BacklogActions;
  canWrite: boolean;
  selected: boolean;
  editing: boolean;
  busy: boolean;
  error?: string;
  onSelect: () => void;
  /** Opens the item's right panel — where its detail, provenance and the rest of the writes live. */
  onOpen: () => void;
  onEditingChange: (editing: boolean) => void;
}

/**
 * One backlog item, as a row (`docs/design/direction.md` §Density): the title, at most three
 * chips that carry state and nothing else, and the two controls a person uses from the list.
 *
 * Everything the item *is* rather than what it says — the body, where it was proposed, its owner,
 * its history, the merge target — is evidence, and evidence is never inline (rule 3). It lives in
 * the right panel, which the title opens.
 *
 * Discard is a quiet control, not a red block sitting in the list: the destructive colour appears
 * only on the step that confirms it ({@link ConfirmAction}, #134).
 *
 * Inline rename stays on the row, because renaming is the one edit that is about the line the eye
 * is already on — `e` toggles it, exactly as it did before.
 */
export function BacklogItem({
  item,
  actions,
  canWrite,
  selected,
  editing,
  busy,
  error,
  onSelect,
  onOpen,
  onEditingChange,
  ...row
}: BacklogItemProps) {
  const { frontmatter: fm } = item;
  const [title, setTitle] = useState(fm.title);

  // A reconciled `backlog.changed` can rewrite an item under an open editor — the CLI or another
  // tab moved it. The draft follows the item when the editor is closed, and is left alone while it
  // is open so a keystroke is never eaten mid-sentence.
  useEffect(() => {
    if (!editing) setTitle(fm.title);
  }, [editing, fm.title]);

  const save = () => {
    if (title !== fm.title) actions.edit(item, { title });
    onEditingChange(false);
  };

  const disabled = !canWrite || busy;
  const legal = actionsFor(fm.status);
  // Discard is rendered by itself, as the confirming control; the rest of the machine's moves are
  // quiet buttons, and the ones the row has no width for are in the panel beside them.
  const moves = legal.filter((action) => action !== "discard");

  return (
    <ListRow
      selected={selected}
      aria-label={fm.title}
      onClick={onSelect}
      {...row}
    >
      {/*
        `basis-48`, not `flex-col` below `sm`: a row that is `flex-col` *and* `flex-wrap` wraps into
        a second **column** and grows sideways, which is rule 5 broken in the one place the rule is
        about. A wrapping row in row direction whose title prefers 12 rem instead pushes the
        controls onto a second line when there is no room for both.
      */}
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
        {editing ? (
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <span className="sr-only sm:not-sr-only">Title</span>
            <Input
              className="h-7 min-w-0 flex-1 text-sm"
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
                if (event.key === "Escape") onEditingChange(false);
              }}
            />
          </label>
        ) : (
          <RowTitle aria-haspopup="dialog" onClick={onOpen}>
            {fm.title}
          </RowTitle>
        )}
        <Chips item={item} />
      </div>

      <RowActions className="ml-auto">
        {editing ? (
          <>
            <Button variant="quiet" size="xs" onClick={save} disabled={disabled}>
              Save
            </Button>
            <Button variant="quiet" size="xs" onClick={() => onEditingChange(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {/* Rename is the one edit that is about the line the eye is already on, so it has a
                control on the row as well as the `e` key — a pointer has no keyboard shortcut. */}
            <Button
              variant="quiet"
              size="xs"
              onClick={() => onEditingChange(true)}
              disabled={disabled}
            >
              Edit
            </Button>
            {moves.map((action) => (
              <Button
                key={action}
                variant="quiet"
                size="xs"
                onClick={() => actions.run(item, action)}
                disabled={disabled}
              >
                {actionLabel(action)}
              </Button>
            ))}
            {legal.includes("discard") ? (
              <ConfirmAction
                label="Discard"
                confirmLabel="Confirm discard"
                disabled={disabled}
                onConfirm={() => actions.run(item, "discard")}
              />
            ) : null}
          </>
        )}
      </RowActions>

      {error === undefined ? null : (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </ListRow>
  );
}

/**
 * State, never decoration (rule 2): the priority, and whether a human has confirmed the item yet.
 *
 * Two, not three. The areas are a taxonomy rather than a state, so they are in the panel; the
 * priority is an outline chip because amber, red and green are reserved for status
 * (direction.md §Tokens) and a p2 is neither blocked nor failed nor verified; and the
 * agent-proposed marker is the muted kind chip rather than the warning one it used to be — every
 * unconfirmed row wearing amber made the whole list look like a warning.
 */
function Chips({ item }: { item: BacklogView }) {
  const { frontmatter: fm } = item;
  return (
    <span className="hidden shrink-0 items-center gap-1 sm:flex">
      {fm.priority ? <Badge variant="outline">{fm.priority}</Badge> : null}
      {isAgentProposed(item) ? <Badge variant="secondary">agent</Badge> : null}
    </span>
  );
}
