import { useEffect, useRef, useState, type ComponentProps } from "react";

import { actionLabel, actionsFor, armKeyFor, isAgentProposed } from "./backlog-model.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { useArm } from "../../components/ui/confirm.js";
import { ListRow, RowActions, RowTitle } from "../../components/ui/list-row.js";

import type { Arm } from "../../components/ui/confirm.js";
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
  /**
   * The view's arm latch, so `x` and this row's Discard button are the same two-step (#138).
   * Without one the button keeps its own, which is the pointer-only two-step of #134 unchanged.
   */
  arm?: Arm;
  /**
   * `proposal` is Review's "Proposed by agents" card (frame `10:75`): the title, where it came
   * from, Accept and Discard — nothing else. `row` is the same card for the groups below it, which
   * keep their chips, Edit, and every move the status machine allows.
   */
  variant?: "proposal" | "row";
}

/** `WL-01M26N0TJEE · 01M26DA5RBB · cp 9` — the item, the session that proposed it, its checkpoint. */
export function provenanceLine(item: BacklogView): string {
  const { id, proposed_by: by } = item.frontmatter;
  return [id.slice(0, 14), by.session.slice(0, 11), `cp ${String(by.checkpoint)}`].join(" · ");
}

/**
 * One backlog item, as a card: the title (which opens the right panel) over a mono line naming
 * where it came from, and the controls a person uses from the list.
 *
 * The body, the owner, the history and the merge target are evidence, and evidence is never
 * inline (rule 3): they live in the panel. The provenance line is short identifiers only — the
 * full session ulid is in the panel too.
 *
 * Inline rename stays on the card, because renaming is the one edit that is about the line the eye
 * is already on — `e` toggles it on every card, and the `row` cards also carry an Edit button.
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
  arm,
  variant = "row",
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
  const proposal = variant === "proposal";
  // Discard is rendered by itself, as the confirming control. A proposal card offers Accept beside
  // it and nothing else (the frame); Done is still `d`, and in the panel.
  const moves = legal.filter((action) => action !== "discard" && (!proposal || action === "accept"));

  return (
    <ListRow
      selected={selected}
      aria-label={fm.title}
      onClick={onSelect}
      // Tabbing onto the row selects it, so alt+arrow re-ranks *the focused row* rather than
      // whichever one `j`/`k` last landed on (#138). `focusin` bubbles, so one handler covers
      // the title, the chips and every control on the row.
      onFocus={onSelect}
      className="gap-3"
      {...row}
    >
      {/*
        `basis-48`: a wrapping row whose text column prefers 12 rem pushes the controls onto a
        second line when there is no room for both, rather than growing sideways (rule 5).
      */}
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.75">
        {editing ? (
          <label className="flex min-w-0 items-center gap-2 text-xs leading-tight text-muted-foreground">
            <span className="sr-only sm:not-sr-only">Title</span>
            <Input
              className="h-7 min-w-0 flex-1"
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
          <div className="flex min-w-0 items-center gap-2">
            <RowTitle aria-haspopup="dialog" onClick={onOpen}>
              {fm.title}
            </RowTitle>
            {proposal ? null : <Chips item={item} />}
          </div>
        )}
        <p className="truncate font-mono text-xs leading-tight text-subtle-foreground">{provenanceLine(item)}</p>
      </div>

      <RowActions className="ml-auto gap-2">
        {editing ? (
          <>
            <Button size="sm" onClick={save} disabled={disabled}>
              Save
            </Button>
            <Button variant="quiet" size="sm" onClick={() => onEditingChange(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {proposal ? null : (
              // Rename has a control on the row as well as the `e` key — a pointer has no shortcut.
              <Button variant="quiet" size="sm" onClick={() => onEditingChange(true)} disabled={disabled}>
                Edit
              </Button>
            )}
            {moves.map((action) => (
              <Button
                key={action}
                variant={action === "accept" ? "default" : "outline"}
                size="sm"
                onClick={() => actions.run(item, action)}
                disabled={disabled}
              >
                {actionLabel(action)}
              </Button>
            ))}
            {legal.includes("discard") ? (
              <DiscardControl
                disabled={disabled}
                arm={arm}
                armKey={armKeyFor("discard", fm.id)}
                onConfirm={() => actions.run(item, "discard")}
              />
            ) : null}
          </>
        )}
      </RowActions>

      {error === undefined ? null : (
        <p role="alert" className="basis-full text-xs leading-tight text-destructive">
          {error}
        </p>
      )}
    </ListRow>
  );
}

/**
 * Discard, drawn as the frame draws it — the destructive outline from the start — and still the
 * two-step of #134/#138: the first press (or `x`) arms it, the second runs it.
 *
 * It is `ConfirmAction`'s latch and behaviour with the frame's trigger: arming renames the control
 * to "Confirm discard" and says so in a live region, Escape or Keep disarm it and hand the focus
 * back, and moving focus out of the pair disarms it.
 */
function DiscardControl({
  disabled,
  arm,
  armKey,
  onConfirm,
}: {
  disabled: boolean;
  arm?: Arm;
  armKey: string;
  onConfirm: () => void;
}) {
  const own = useArm();
  const latch = arm ?? own;
  const key = armKey;
  const armed = latch.isArmed(key);

  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (armed) confirm.current?.focus();
  }, [armed]);

  useEffect(() => {
    if (latch.restoring !== key) return;
    trigger.current?.focus();
    latch.restoreTaken(key);
  }, [latch, key]);

  useEffect(() => {
    if (disabled && armed) latch.disarm();
  }, [disabled, armed, latch]);

  if (!armed) {
    return (
      <Button ref={trigger} type="button" variant="danger" size="sm" disabled={disabled} onClick={() => latch.arm(key)}>
        Discard
      </Button>
    );
  }

  return (
    <div
      ref={wrap}
      className="flex shrink-0 items-center gap-2"
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) latch.disarm();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          latch.disarm({ restoreFocus: true });
        }
      }}
    >
      <span role="status" className="sr-only">
        Discard armed. Confirm discard, or Escape to keep it.
      </span>
      <Button
        ref={confirm}
        type="button"
        variant="danger"
        size="sm"
        disabled={disabled}
        onClick={() => {
          latch.disarm();
          onConfirm();
        }}
      >
        Confirm discard
      </Button>
      <Button type="button" variant="quiet" size="sm" onClick={() => latch.disarm({ restoreFocus: true })}>
        Keep
      </Button>
    </div>
  );
}

/**
 * State, never decoration (rule 2): the priority, and whether a human has confirmed the item yet.
 * Only on the `row` cards: the proposal card is the frame's, which carries neither — every item in
 * that section is agent-proposed, and its priority is in the panel.
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
