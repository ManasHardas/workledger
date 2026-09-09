import type { ReactNode } from "react";

import type { Async } from "../lib/use-async.js";

/**
 * The loading, error and empty renderings every data-fetching view owes the user, in one place so
 * no view can quietly skip one.
 */
export function AsyncPanel<T>({
  result,
  isEmpty,
  empty,
  children,
}: {
  result: Async<T>;
  isEmpty?: (value: T) => boolean;
  empty: string;
  children: (value: T) => ReactNode;
}) {
  if (result.state === "loading") {
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (result.state === "error") {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Could not read the ledger: {result.message}
      </p>
    );
  }
  if (isEmpty?.(result.value)) {
    return <p className="p-4 text-sm text-muted-foreground">{empty}</p>;
  }
  return <>{children(result.value)}</>;
}
