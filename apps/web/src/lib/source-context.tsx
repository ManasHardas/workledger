import { createContext, useContext, type ReactNode } from "react";

import type { AppSource, LedgerSource } from "./ledger-source.js";

const SourceContext = createContext<LedgerSource | null>(null);
const MachineContext = createContext<AppSource | null>(null);
const RepoIdContext = createContext<string | null>(null);

/**
 * Injects the one `LedgerSource` a per-repo view reads through. Nothing below this provider knows
 * whether it is talking to the local server, to a Dome card's cardFS, or to fixtures — swapping
 * the implementation is the whole of the change in issues #37–#39. Under P8 it is the
 * `forRepo(id)` source of the route's repo.
 */
export function SourceProvider({ source, children }: { source: LedgerSource; children: ReactNode }) {
  return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>;
}

export function useSource(): LedgerSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error("useSource must be used inside a <SourceProvider>");
  return source;
}

/**
 * The machine-wide source (P8): `listRepos`, the aggregates, `forRepo`, and the unscoped SSE
 * stream every repo's events ride on. Home and the machine-wide tabs read through this; a
 * per-repo view never needs it.
 */
export function MachineProvider({ source, children }: { source: AppSource; children: ReactNode }) {
  return <MachineContext.Provider value={source}>{children}</MachineContext.Provider>;
}

export function useMachine(): AppSource {
  const source = useContext(MachineContext);
  if (!source) throw new Error("useMachine must be used inside a <MachineProvider>");
  return source;
}

/** The repo id of the `#/r/<id>/…` route being rendered, for links that stay inside it. */
export function RepoIdProvider({ id, children }: { id: string; children: ReactNode }) {
  return <RepoIdContext.Provider value={id}>{children}</RepoIdContext.Provider>;
}

export function useRepoId(): string {
  const id = useContext(RepoIdContext);
  if (id === null) throw new Error("useRepoId must be used inside a <RepoIdProvider>");
  return id;
}
