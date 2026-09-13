import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The right column's first module, owned by the view on screen (P9 frames): Home's "Selected
 * project", the Ledger's "Selected session", a session's "Provenance", Review's "Selected".
 *
 * From 1280 px the shell has a right column and mounts {@link AsideSlot} in it; a view's
 * {@link Aside} renders there through a portal. Below that there is no column, and the view says
 * what should happen instead: `inline` puts the module at the foot of the reading column (a
 * session's provenance is still the evidence for the page), `none` drops it (a selection summary
 * with nowhere to sit — the view then opens the item itself rather than selecting it).
 *
 * It is not a {@link Panel}: a panel is something a person opened and can close; a module is part
 * of the screen.
 */

interface AsideValue {
  slot: HTMLElement | null;
  setSlot: (node: HTMLElement | null) => void;
}

const AsideContext = createContext<AsideValue | null>(null);

export function AsideHost({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return <AsideContext.Provider value={{ slot, setSlot }}>{children}</AsideContext.Provider>;
}

/** Where a view's module lands in the right column. `empty:hidden` keeps the gap from opening. */
export function AsideSlot() {
  const setSlot = useContext(AsideContext)?.setSlot;
  return <div ref={setSlot} className="flex flex-col gap-4 empty:hidden" />;
}

/** True while the right column is on screen, so a view can choose between selecting and opening. */
export function useAsideDocked(): boolean {
  return (useContext(AsideContext)?.slot ?? null) !== null;
}

export function Aside({ children, narrow }: { children: ReactNode; narrow: "inline" | "none" }) {
  const slot = useContext(AsideContext)?.slot ?? null;
  if (slot !== null) return createPortal(children, slot);
  return narrow === "inline" ? <>{children}</> : null;
}
