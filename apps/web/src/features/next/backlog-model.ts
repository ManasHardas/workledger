/**
 * The Next view's rules about a backlog item, kept out of the components so the status machine is
 * read from one place.
 *
 * The machine is `docs/contracts/p2/backlog-cli.md` verbatim — the UI never invents a transition,
 * because the server runs the same `backlog-ops` function the CLI runs and answers exit 1 for an
 * illegal one. A button the machine does not allow is not rendered at all.
 */
import type { BacklogStatus, BacklogView } from "../../lib/ledger-source.js";

/** Every action the view can take on an item, named for the `LedgerSource` method it calls. */
export type BacklogAction = "accept" | "start" | "done" | "discard" | "restore";

/** Groups in the order design spec §8 lists them; `discarded` renders collapsed at the end. */
export const GROUPS: BacklogStatus[] = ["proposed", "accepted", "in_progress", "done", "discarded"];

export const GROUP_LABELS: Record<BacklogStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  in_progress: "In progress",
  done: "Done",
  discarded: "Discarded",
};

/** `status → allowed next statuses` (backlog-cli.md §State machine). */
const TRANSITIONS: Record<BacklogStatus, BacklogStatus[]> = {
  proposed: ["accepted", "discarded", "done"],
  accepted: ["in_progress", "done", "discarded"],
  in_progress: ["done", "discarded", "accepted"],
  done: ["accepted"],
  discarded: ["proposed"],
};

/** The status each action moves an item to, given where it starts. */
const TARGET: Record<BacklogAction, (from: BacklogStatus) => BacklogStatus> = {
  accept: () => "accepted",
  start: () => "in_progress",
  done: () => "done",
  discard: () => "discarded",
  // `restore` is the one action whose target depends on the source: a discarded item goes back to
  // the queue, a done item reopens as accepted.
  restore: (from) => (from === "done" ? "accepted" : "proposed"),
};

const LABELS: Record<BacklogAction, string> = {
  accept: "Accept",
  start: "Start",
  done: "Done",
  discard: "Discard",
  restore: "Restore",
};

export function actionLabel(action: BacklogAction): string {
  return LABELS[action];
}

/** Where `action` lands an item that is currently in `from`. */
export function targetStatus(action: BacklogAction, from: BacklogStatus): BacklogStatus {
  return TARGET[action](from);
}

/**
 * The actions legal from `status`, in the order they are offered.
 *
 * `accept` is special-cased out of `accepted` (it is already accepted) and `restore` out of the
 * three live statuses, so the list is exactly the buttons a human can press.
 */
export function actionsFor(status: BacklogStatus): BacklogAction[] {
  const legal = TRANSITIONS[status];
  const offered: BacklogAction[] =
    status === "done" || status === "discarded"
      ? ["restore"]
      : ["accept", "start", "done", "discard"];
  return offered.filter((action) => legal.includes(TARGET[action](status)));
}

export function canRun(action: BacklogAction, status: BacklogStatus): boolean {
  return actionsFor(status).includes(action);
}

/** An item is agent-proposed until a human's `confirmed_by` stamp lands on it (spec §8). */
export function isAgentProposed(item: BacklogView): boolean {
  return !item.frontmatter.confirmed_by;
}

/** `rank` ascending, then most recently `updated` first — the order `/api/backlog` returns. */
export function compareItems(a: BacklogView, b: BacklogView): number {
  if (a.frontmatter.rank !== b.frontmatter.rank) return a.frontmatter.rank - b.frontmatter.rank;
  return b.frontmatter.updated.localeCompare(a.frontmatter.updated);
}

/** The list split into its status groups, each sorted, empty groups dropped. */
export function groupByStatus(items: BacklogView[]): { status: BacklogStatus; items: BacklogView[] }[] {
  return GROUPS.map((status) => ({
    status,
    items: items.filter((item) => item.frontmatter.status === status).sort(compareItems),
  })).filter((group) => group.items.length > 0);
}

/** The visit order `j`/`k` walk: every group's items, concatenated in group order. */
export function flatten(items: BacklogView[]): BacklogView[] {
  return groupByStatus(items).flatMap((group) => group.items);
}

/** The message an inline error shows for a rejected write. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return String(error);
}

/**
 * The group re-ordered by dropping `draggedId` onto `targetId`, in the sorted order it renders in.
 *
 * A downward drag lands the item in the slot it was dropped on (everything between shifts up); an
 * upward drag lands it directly above. Callers turn the result into `rank` calls — `rankItem` sets
 * exactly the number it is given and re-spaces nothing, so the whole group's sequence is the
 * caller's to write.
 */
export function reorder(group: BacklogView[], draggedId: string, targetId: string): BacklogView[] {
  const sorted = [...group].sort(compareItems);
  const from = sorted.findIndex((item) => item.frontmatter.id === draggedId);
  const to = sorted.findIndex((item) => item.frontmatter.id === targetId);
  if (from < 0 || to < 0 || from === to) return sorted;
  const rest = sorted.filter((item) => item.frontmatter.id !== draggedId);
  const at = rest.findIndex((item) => item.frontmatter.id === targetId) + (from < to ? 1 : 0);
  rest.splice(at, 0, sorted[from]!);
  return rest;
}
