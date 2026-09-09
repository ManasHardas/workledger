import { useEffect, useState } from "react";

/** What a view knows about one `LedgerSource` call: still loading, failed, or resolved. */
export type Async<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; value: T };

/**
 * Runs one `LedgerSource` read and reports all three states, because every data-fetching view owes
 * the user a loading, empty and error rendering (`.orchestrator/agents/frontend.md`).
 *
 * `load` is the dependency: callers wrap it in `useCallback` over whatever the query depends on, so
 * a changed filter re-runs the read and an unchanged render does not. A resolution that arrives
 * after `load` changed is dropped rather than written over the newer one.
 */
export function useAsync<T>(load: () => Promise<T>): Async<T> {
  const [result, setResult] = useState<Async<T>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setResult({ state: "loading" });
    load().then(
      (value) => {
        if (live) setResult({ state: "ready", value });
      },
      (error: unknown) => {
        if (live) setResult({ state: "error", message: messageOf(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [load]);

  return result;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return String(error);
}
