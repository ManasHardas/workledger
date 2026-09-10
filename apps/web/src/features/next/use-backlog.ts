import { useCallback, useEffect, useRef, useState } from "react";

import { GROUPS, messageOf } from "./backlog-model.js";
import { useSource } from "../../lib/source-context.js";

import type { BacklogView } from "../../lib/ledger-source.js";

/** The list's three read states; write failures live in `errors`, keyed by item, not here. */
export type BacklogState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; value: BacklogView[] };

/** What a write predicts locally and what it actually calls. */
export interface Mutation {
  /** The item as it will look if the write succeeds; `null` drops it from the list. */
  predict?: (item: BacklogView) => BacklogView | null;
  /** The `LedgerSource` call. Its resolved views replace the predictions. */
  call: () => Promise<BacklogView | BacklogView[] | { source: BacklogView; target: BacklogView }>;
}

export interface Backlog {
  result: BacklogState;
  /** The last write error per item id, cleared when that item's next write starts. */
  errors: Record<string, string>;
  /** Ids with a write in flight, so their controls can be disabled without freezing the list. */
  pending: Record<string, true>;
  run: (id: string, mutation: Mutation) => void;
  reload: () => void;
}

/** `map` without `key` — the eslint-clean spelling of a rest-destructuring omit. */
function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

function replace(items: BacklogView[], next: BacklogView): BacklogView[] {
  const at = items.findIndex((item) => item.frontmatter.id === next.frontmatter.id);
  if (at < 0) return [...items, next];
  return items.map((item, i) => (i === at ? next : item));
}

function viewsOf(
  outcome: BacklogView | BacklogView[] | { source: BacklogView; target: BacklogView },
): BacklogView[] {
  if (Array.isArray(outcome)) return outcome;
  return "frontmatter" in outcome ? [outcome] : [outcome.source, outcome.target];
}

/**
 * The backlog, its writes, and the reconciliation between them.
 *
 * A write paints its predicted item immediately (spec §8 wants "Accept" to be one keystroke, which
 * a round-trip's worth of nothing-happened would spoil), then replaces the prediction with the
 * views the source returned, and finally re-reads on the `backlog.changed` the file watcher emits —
 * so the CLI, another tab, or an agent's own edit converges to the same list. A rejected write
 * rolls the item back to the snapshot taken before the prediction and reports inline.
 */
export function useBacklog(): Backlog {
  const source = useSource();
  const [result, setResult] = useState<BacklogState>({ state: "loading" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, true>>({});
  // Reads that resolve after the component is gone must not set state; the ref is the one flag
  // both the effect and the in-flight writes check.
  const live = useRef(true);
  // The list as it last rendered, so a write can snapshot it for rollback without reading state
  // inside an updater (updaters must stay pure — React invokes them twice under StrictMode).
  const itemsRef = useRef<BacklogView[]>([]);
  if (result.state === "ready") itemsRef.current = result.value;

  const reload = useCallback(() => {
    source.listBacklog({ status: GROUPS }).then(
      (items) => {
        if (live.current) setResult({ state: "ready", value: items });
      },
      (error: unknown) => {
        if (live.current) setResult({ state: "error", message: messageOf(error) });
      },
    );
  }, [source]);

  useEffect(() => {
    live.current = true;
    reload();
    // A source without `capabilities.live` returns a no-op unsubscribe, so this is safe either way.
    const stop = source.subscribe((event) => {
      if (event.type === "backlog.changed") reload();
    });
    return () => {
      live.current = false;
      stop();
    };
  }, [reload, source]);

  const run = useCallback((id: string, { predict, call }: Mutation) => {
    const snapshot = itemsRef.current;
    setErrors((prior) => without(prior, id));
    setPending((prior) => ({ ...prior, [id]: true }));
    setResult((prior) => {
      if (prior.state !== "ready" || !predict) return prior;
      const next = prior.value.flatMap((item) => {
        if (item.frontmatter.id !== id) return [item];
        const predicted = predict(item);
        return predicted ? [predicted] : [];
      });
      return { state: "ready", value: next };
    });

    const settle = () =>
      setPending((prior) => without(prior, id));

    call().then(
      (outcome) => {
        if (!live.current) return;
        settle();
        setResult((prior) =>
          prior.state === "ready"
            ? { state: "ready", value: viewsOf(outcome).reduce(replace, prior.value) }
            : prior,
        );
      },
      (error: unknown) => {
        if (!live.current) return;
        settle();
        setErrors((prior) => ({ ...prior, [id]: messageOf(error) }));
        // Roll the optimistic paint back: the ledger did not change, so the list must not claim it
        // did.
        setResult((prior) => (prior.state === "ready" ? { state: "ready", value: snapshot } : prior));
      },
    );
  }, []);

  return { result, errors, pending, run, reload };
}
