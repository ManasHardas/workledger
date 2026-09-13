import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { backlogActions } from "./backlog-actions.js";
import {
  GROUP_LABELS,
  armKeyFor,
  canRun,
  flatten,
  groupByStatus,
  moveWithin,
  rankWrites,
  reorder,
} from "./backlog-model.js";
import { useBacklog, type Backlog } from "./use-backlog.js";
import { Button } from "../../components/ui/button.js";
import { useArm } from "../../components/ui/confirm.js";
import { RowEmpty, RowList, RowSection } from "../../components/ui/list-row.js";
import { PageSection } from "../../components/ui/page.js";
import { useSource } from "../../lib/source-context.js";
import { useIdentities } from "../identity/live.js";
import { BacklogItem } from "./backlog-item.js";
import { BacklogPanel } from "./backlog-panel.js";

import type { BacklogAction } from "./backlog-model.js";
import type { BacklogView } from "../../lib/ledger-source.js";

/** The keys spec §8 gives the Next view, mapped to what they do to the selected item. */
const ACTION_KEYS: Record<string, BacklogAction> = { a: "accept", d: "done", x: "discard" };

/** The actions that need arming before they run, whichever control started them (#138). */
const DESTRUCTIVE: BacklogAction[] = ["discard"];

/** A keystroke inside a field is text, not a command. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The backlog half of Review, grouped by status (#134; frame `10:71`).
 *
 * The proposed group is the frame's "Proposed by agents" section: a card per item with its
 * provenance line, Accept and Discard. The groups the frame leaves out — accepted, in progress,
 * done, discarded — stay below it in the same cards (operator decision 1, 2026-09-12), with their
 * chips, Edit and every move. The body, the owner, the history and the merge target are in the
 * right panel, which a title opens (rule 3). The page header carries the keyboard hint.
 *
 * Every edit is a `LedgerSource` call, never a file write: the source is the local server, which
 * runs the same `backlog-ops` function `workledger backlog …` runs, so the CLI and this list can
 * never disagree about what a transition means.
 */
export function NextView(props: NextListProps) {
  const backlog = useBacklog();
  return <NextList backlog={backlog} {...props} />;
}

export interface NextListProps {
  /**
   * `proposed` renders only the "Proposed by agents" group — Review's Proposals view — and the
   * keyboard walks only that group. Omitted, every group renders.
   */
  only?: "proposed";
  /**
   * Whether this list takes `j`/`k`/`e`/`a`/`d`/`x`/`alt+↑↓` from the page. Every project's
   * Proposals renders one list per repo, and only one of them may own the keys — so none does.
   */
  keyboard?: boolean;
  /** Whether the proposed group draws its own section head; a per-repo sub-group has one already. */
  head?: boolean;
}

/**
 * {@link NextView} over a backlog read the caller owns — Review reads it once for the list and
 * for the toolbar's Proposals count, so an optimistic Accept moves both.
 */
export function NextList({ backlog, only, keyboard = true, head = true }: NextListProps & { backlog: Backlog }) {
  const source = useSource();
  // One read for the whole list rather than one per row: the map is the same for every item.
  const identities = useIdentities();
  const actions = useMemo(() => backlogActions(source, backlog.run), [source, backlog.run]);
  const canWrite = source.capabilities.write;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /**
   * One latch for the whole list, so `x` arms the very Discard button a pointer would have armed
   * (#138) instead of a second, parallel two-step that the row knows nothing about.
   */
  const arm = useArm();
  /** Where the last reorder put a row, for anyone who cannot see the list move. */
  const [moved, setMoved] = useState("");

  const items = backlog.result.state === "ready" ? backlog.result.value : [];
  // The keyboard walks the rendered order, so `j` from the last proposed item lands on the first
  // accepted one rather than jumping back to the top.
  const order = useMemo(
    () => (only === "proposed" ? flatten(items).filter((item) => item.frontmatter.status === "proposed") : flatten(items)),
    [items, only],
  );
  const orderRef = useRef(order);
  orderRef.current = order;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const armRef = useRef(arm);
  armRef.current = arm;

  const groups = groupByStatus(items);
  const opened = items.find((item) => item.frontmatter.id === openId) ?? null;

  // An item that left the list — discarded and hidden, or merged away — must not leave its panel
  // behind describing something that is no longer there.
  useEffect(() => {
    if (openId !== null && !items.some((item) => item.frontmatter.id === openId)) setOpenId(null);
  }, [items, openId]);

  /**
   * Writes the whole group's sequence after a move, and says where the row landed.
   *
   * Shared by the drop handler and the keyboard, so the two can never disagree about what a
   * reorder means — the pointer path and the keyboard path are one path with two triggers.
   */
  const applyMove = useCallback(
    (ordered: BacklogView[], subject: BacklogView, at: number, total: number, label: string) => {
      for (const { item, rank } of rankWrites(ordered)) actions.rank(item, rank);
      setMoved(
        `${subject.frontmatter.title} moved to ${String(at + 1)} of ${String(total)} in ${label}.`,
      );
    },
    [actions],
  );

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || isTyping(event.target)) return;
      const list = orderRef.current;
      const latch = armRef.current;
      const at = list.findIndex((item) => item.frontmatter.id === selectedRef.current);
      const selected = at < 0 ? null : list[at];

      // Escape disarms whatever is armed and hands focus back to the control it armed, from
      // anywhere on the page — an armed destructive control must never be left behind.
      if (event.key === "Escape" && latch.armed !== null) {
        latch.disarm({ restoreFocus: true });
        event.preventDefault();
        return;
      }

      /**
       * The keyboard's drag-rank (#138): alt plus an arrow moves the selected row one slot inside
       * its own group, through the same `reorder` a drop uses.
       */
      if (event.altKey) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (!selected || !canWrite) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const status = selected.frontmatter.status;
        const group = itemsRef.current.filter((item) => item.frontmatter.status === status);
        const move = moveWithin(group, selected.frontmatter.id, step);
        event.preventDefault();
        if (move === null) return;
        applyMove(move.ordered, selected, move.at, move.total, GROUP_LABELS[status]);
        return;
      }
      if (list.length === 0) return;

      if (event.key === "j" || event.key === "k") {
        const step = event.key === "j" ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : Math.min(Math.max(at + step, 0), list.length - 1);
        // Moving the selection leaves nothing armed behind on the row being left.
        latch.disarm();
        setSelectedId(list[next]!.frontmatter.id);
        setEditingId(null);
        event.preventDefault();
        return;
      }
      if (!selected || !canWrite) return;
      if (event.key === "e") {
        setEditingId((prior) => (prior === selected.frontmatter.id ? null : selected.frontmatter.id));
        event.preventDefault();
        return;
      }
      const action = ACTION_KEYS[event.key];
      if (!action || !canRun(action, selected.frontmatter.status)) return;
      event.preventDefault();
      if (!DESTRUCTIVE.includes(action)) {
        actions.run(selected, action);
        return;
      }
      // Arm-then-confirm, on the row's own control: the first press writes nothing at all.
      const key = armKeyFor(action, selected.frontmatter.id);
      if (!latch.isArmed(key)) {
        latch.arm(key);
        return;
      }
      latch.disarm();
      actions.run(selected, action);
    },
    [actions, applyMove, canWrite],
  );

  useEffect(() => {
    if (!keyboard) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey, keyboard]);

  /**
   * Drop-to-reorder — the pointer's half of the same move the keyboard makes above.
   */
  const onDrop = (target: BacklogView) => {
    const dragged = items.find((item) => item.frontmatter.id === draggingId);
    setDraggingId(null);
    if (!dragged || dragged.frontmatter.id === target.frontmatter.id) return;
    const status = target.frontmatter.status;
    if (dragged.frontmatter.status !== status) return;
    const group = items.filter((item) => item.frontmatter.status === status);
    const ordered = reorder(group, dragged.frontmatter.id, target.frontmatter.id);
    const at = ordered.findIndex((item) => item.frontmatter.id === dragged.frontmatter.id);
    applyMove(ordered, dragged, at, ordered.length, GROUP_LABELS[status]);
  };

  const renderItem = (item: BacklogView, variant: "proposal" | "row") => (
    <BacklogItem
      key={item.frontmatter.id}
      variant={variant}
      item={item}
      actions={actions}
      canWrite={canWrite}
      selected={selectedId === item.frontmatter.id}
      editing={editingId === item.frontmatter.id}
      busy={item.frontmatter.id in backlog.pending}
      error={backlog.errors[item.frontmatter.id]}
      onSelect={() => setSelectedId(item.frontmatter.id)}
      onOpen={() => {
        setSelectedId(item.frontmatter.id);
        setOpenId(item.frontmatter.id);
      }}
      onEditingChange={(editing) => setEditingId(editing ? item.frontmatter.id : null)}
      arm={arm}
      draggable={canWrite}
      onDragStart={() => setDraggingId(item.frontmatter.id)}
      onDragEnd={() => setDraggingId(null)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(item);
      }}
    />
  );

  const proposed = groups.find((group) => group.status === "proposed")?.items ?? [];
  const accepted = items.filter((item) => item.frontmatter.status === "accepted").length;
  const rest = only === "proposed" ? [] : groups.filter((group) => group.status !== "proposed");

  const proposals = (
    <>
      {canWrite ? null : (
        <p className="text-xs leading-tight text-subtle-foreground">
          read-only source · accepting, discarding and editing are disabled
        </p>
      )}
      {backlog.result.state === "loading" ? (
        <p role="status" className="px-3.5 py-2 text-base leading-body tracking-body text-muted-foreground">
          Loading…
        </p>
      ) : backlog.result.state === "error" ? (
        <p role="alert" className="px-3.5 py-2 text-base leading-body tracking-body text-destructive">
          Could not read the backlog: {backlog.result.message}
        </p>
      ) : items.length === 0 ? (
        <RowEmpty>The backlog is empty. Agent-proposed items appear here as checkpoints land.</RowEmpty>
      ) : proposed.length === 0 ? (
        <RowEmpty>Nothing an agent proposed is waiting.</RowEmpty>
      ) : (
        <RowList aria-label={GROUP_LABELS.proposed}>{proposed.map((item) => renderItem(item, "proposal"))}</RowList>
      )}
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6.5">
      {/*
        Mounted from the first paint, empty, so a screen reader is already watching it when a row
        moves — a live region inserted at the moment it has something to say is often missed.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {moved}
      </p>

      {head ? (
        <PageSection
          id="review-proposals-heading"
          title="Proposed by agents"
          aside={
            backlog.result.state === "ready"
              ? `${String(proposed.length)} waiting · ${String(accepted)} accepted`
              : undefined
          }
        >
          {proposals}
        </PageSection>
      ) : (
        <div className="flex min-w-0 flex-col gap-2.5">{proposals}</div>
      )}

      {rest.map((group) => {
        const collapsed = group.status === "discarded" && !showDiscarded;
        return (
          <RowSection
            key={group.status}
            id={`next-group-${group.status}`}
            title={GROUP_LABELS[group.status]}
            count={group.items.length}
            countLabel={`${String(group.items.length)} — ${GROUP_LABELS[group.status]}`}
            action={
              group.status === "discarded" ? (
                <Button
                  variant="quiet"
                  size="sm"
                  aria-expanded={showDiscarded}
                  onClick={() => setShowDiscarded((prior) => !prior)}
                >
                  {showDiscarded ? "Hide discarded" : "Show discarded"}
                </Button>
              ) : undefined
            }
          >
            {collapsed ? null : (
              <RowList aria-label={GROUP_LABELS[group.status]}>
                {group.items.map((item) => renderItem(item, "row"))}
              </RowList>
            )}
          </RowSection>
        );
      })}

      <BacklogPanel
        item={opened}
        others={items.filter((item) => item.frontmatter.id !== openId)}
        actions={actions}
        canWrite={canWrite}
        busy={openId !== null && openId in backlog.pending}
        error={openId === null ? undefined : backlog.errors[openId]}
        identities={identities}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
