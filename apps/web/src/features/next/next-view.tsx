import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { backlogActions } from "./backlog-actions.js";
import { GROUP_LABELS, canRun, compareItems, flatten, groupByStatus, reorder } from "./backlog-model.js";
import { useBacklog } from "./use-backlog.js";
import { Badge } from "../../components/ui/badge.js";
import { useSource } from "../../lib/source-context.js";
import { BacklogItem } from "./backlog-item.js";

import type { BacklogAction } from "./backlog-model.js";
import type { BacklogView } from "../../lib/ledger-source.js";

/** The keys spec §8 gives the Next view, mapped to what they do to the selected item. */
const ACTION_KEYS: Record<string, BacklogAction> = { a: "accept", d: "done", x: "discard" };

/** A keystroke inside a field is text, not a command. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Next — the repo's backlog, grouped by status and editable in place (design spec §8).
 *
 * Every edit is a `LedgerSource` call, never a file write: the source is the local server, which
 * runs the same `backlog-ops` function `workledger backlog …` runs, so the CLI and this list can
 * never disagree about what a transition means.
 */
export function NextView() {
  const source = useSource();
  const backlog = useBacklog();
  const actions = useMemo(() => backlogActions(source, backlog.run), [source, backlog.run]);
  const canWrite = source.capabilities.write;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const items = backlog.result.state === "ready" ? backlog.result.value : [];
  // The keyboard walks the rendered order, so `j` from the last proposed item lands on the first
  // accepted one rather than jumping back to the top.
  const order = useMemo(() => flatten(items), [items]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const groups = groupByStatus(items);

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const list = orderRef.current;
      if (list.length === 0) return;
      const at = list.findIndex((item) => item.frontmatter.id === selectedRef.current);
      const selected = at < 0 ? null : list[at];

      if (event.key === "j" || event.key === "k") {
        const step = event.key === "j" ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : Math.min(Math.max(at + step, 0), list.length - 1);
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
      if (action && canRun(action, selected.frontmatter.status)) {
        actions.run(selected, action);
        event.preventDefault();
      }
    },
    [actions, canWrite],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  /**
   * Drop-to-reorder.
   *
   * `rankItem` stores exactly the number it is given and re-spaces nothing, so handing the dragged
   * item its target's rank would only tie the two and leave the order to the `updated` tiebreak.
   * The view therefore writes the whole sequence: the group is re-ordered here and every item whose
   * position changed is ranked to its new index, low to high.
   */
  const onDrop = (target: BacklogView) => {
    const dragged = items.find((item) => item.frontmatter.id === draggingId);
    setDraggingId(null);
    if (!dragged || dragged.frontmatter.id === target.frontmatter.id) return;
    if (dragged.frontmatter.status !== target.frontmatter.status) return;
    const group = items.filter((item) => item.frontmatter.status === target.frontmatter.status);
    const before = [...group].sort(compareItems);
    reorder(group, dragged.frontmatter.id, target.frontmatter.id).forEach((item, index) => {
      if (before[index]?.frontmatter.id !== item.frontmatter.id) actions.rank(item, index);
    });
  };

  return (
    <section aria-labelledby="next-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="next-heading" className="text-xl font-semibold">
          Next
        </h2>
        {canWrite ? null : <Badge variant="outline">read-only source</Badge>}
        <p className="text-xs text-muted-foreground">
          j/k move · e edit · a accept · d done · x discard
        </p>
      </div>

      {backlog.result.state === "loading" ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading…
        </p>
      ) : backlog.result.state === "error" ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          Could not read the backlog: {backlog.result.message}
        </p>
      ) : items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          The backlog is empty. Agent-proposed items appear here as checkpoints land.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => {
            const collapsed = group.status === "discarded" && !showDiscarded;
            return (
              <div key={group.status} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABELS[group.status]}
                  </h3>
                  <span className="text-xs text-muted-foreground">{group.items.length}</span>
                  {group.status === "discarded" ? (
                    <button
                      type="button"
                      className="text-xs underline text-muted-foreground"
                      aria-expanded={showDiscarded}
                      onClick={() => setShowDiscarded((prior) => !prior)}
                    >
                      {showDiscarded ? "Hide discarded" : "Show discarded"}
                    </button>
                  ) : null}
                </div>
                {collapsed ? null : (
                  <ul aria-label={GROUP_LABELS[group.status]} className="flex flex-col gap-3">
                    {group.items.map((item) => (
                      <li
                        key={item.frontmatter.id}
                        aria-label={item.frontmatter.title}
                        draggable={canWrite}
                        onDragStart={() => setDraggingId(item.frontmatter.id)}
                        onDragEnd={() => setDraggingId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          onDrop(item);
                        }}
                      >
                        <BacklogItem
                          item={item}
                          others={items.filter((o) => o.frontmatter.id !== item.frontmatter.id)}
                          actions={actions}
                          canWrite={canWrite}
                          selected={selectedId === item.frontmatter.id}
                          editing={editingId === item.frontmatter.id}
                          busy={item.frontmatter.id in backlog.pending}
                          error={backlog.errors[item.frontmatter.id]}
                          onSelect={() => setSelectedId(item.frontmatter.id)}
                          onEditingChange={(editing) =>
                            setEditingId(editing ? item.frontmatter.id : null)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
