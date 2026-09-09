import { createContext, useContext, type ReactNode } from "react";

import type { LedgerSource } from "./ledger-source.js";

const SourceContext = createContext<LedgerSource | null>(null);

/**
 * Injects the one `LedgerSource` the app reads through. Nothing below this provider knows whether
 * it is talking to the local server, to a Dome card's cardFS, or to fixtures — swapping the
 * implementation is the whole of the change in issues #37–#39.
 */
export function SourceProvider({ source, children }: { source: LedgerSource; children: ReactNode }) {
  return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>;
}

export function useSource(): LedgerSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error("useSource must be used inside a <SourceProvider>");
  return source;
}
