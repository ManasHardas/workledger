import { targetStatus, type BacklogAction } from "./backlog-model.js";

import type { Backlog } from "./use-backlog.js";
import type { Actor, BacklogView, EditPatch, LedgerSource } from "../../lib/ledger-source.js";

/** Every write the Next view can make, each one `LedgerSource` call plus its optimistic paint. */
export interface BacklogActions {
  run: (item: BacklogView, action: BacklogAction) => void;
  edit: (item: BacklogView, patch: EditPatch) => void;
  assign: (item: BacklogView, owner: Actor | null) => void;
  rank: (item: BacklogView, rank: number) => void;
  merge: (item: BacklogView, into: string) => void;
}

/** `frontmatter` with `patch` applied and `updated` moved to now, for the optimistic paint. */
function patched(item: BacklogView, patch: Partial<BacklogView["frontmatter"]>): BacklogView {
  return {
    ...item,
    frontmatter: { ...item.frontmatter, ...patch, updated: new Date().toISOString() },
  };
}

/**
 * Binds the five writes to one source and one list.
 *
 * The predictions here are deliberately narrow: a status action paints the status the machine says
 * it lands on and nothing else — `confirmed_by`, `history` and `done_by` are the CLI's to stamp, so
 * the view waits for the returned `BacklogView` rather than guessing a human's name.
 */
export function backlogActions(source: LedgerSource, run: Backlog["run"]): BacklogActions {
  const id = (item: BacklogView) => item.frontmatter.id;
  return {
    run: (item, action) =>
      run(id(item), {
        predict: (current) =>
          patched(current, { status: targetStatus(action, item.frontmatter.status) }),
        call: () => source[action](id(item)),
      }),
    edit: (item, patch) =>
      run(id(item), {
        predict: (current) => ({
          ...patched(current, {
            ...(patch.title === undefined ? {} : { title: patch.title }),
            ...(patch.priority === undefined ? {} : { priority: patch.priority }),
            ...(patch.area === undefined ? {} : { area: patch.area }),
          }),
          body: patch.body ?? current.body,
        }),
        call: () => source.edit(id(item), patch),
      }),
    assign: (item, owner) =>
      run(id(item), {
        predict: (current) => patched(current, { owner }),
        call: () => source.assign(id(item), owner),
      }),
    rank: (item, rank) =>
      run(id(item), {
        predict: (current) => patched(current, { rank }),
        call: () => source.rank(id(item), rank),
      }),
    // A merge moves two items at once — the source to `discarded`, the target's body and history —
    // so there is nothing honest to paint from here; both returned views land on reconcile.
    merge: (item, into) => run(id(item), { call: () => source.merge(id(item), into) }),
  };
}
