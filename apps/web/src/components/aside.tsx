import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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

/** The body rhythms of `components/ui/page.tsx`, whose top padding the right column matches. */
export type AsideRhythm = "home" | "ledger" | "review" | "session";

interface AsideValue {
  slot: HTMLElement | null;
  setSlot: (node: HTMLElement | null) => void;
  rhythm: AsideRhythm;
  setRhythm: (rhythm: AsideRhythm) => void;
}

const AsideContext = createContext<AsideValue | null>(null);

export function AsideHost({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [rhythm, setRhythm] = useState<AsideRhythm>("home");
  return (
    <AsideContext.Provider value={{ slot, setSlot, rhythm, setRhythm }}>{children}</AsideContext.Provider>
  );
}

/**
 * The page body's top padding, per rhythm — the same steps `PageBody` uses, so the right column's
 * first module starts on the same line as the reading column's first card (operator, 2026-09-13).
 */
const TOP = { home: "pt-5.5", ledger: "pt-5", review: "pt-5.5", session: "pt-7" } as const;

/** `PageBody` tells the right column which rhythm the page is on. */
export function useAsideRhythm(rhythm: AsideRhythm): void {
  const setRhythm = useContext(AsideContext)?.setRhythm;
  useEffect(() => setRhythm?.(rhythm), [setRhythm, rhythm]);
}

/**
 * The right column itself, as the shell mounts it from 1280 px: a 52 px band carrying the page
 * header's hairline across the column, then the view's module and any opened panel, sticky under
 * that band and starting where the reading column's content starts.
 */
export function AsideColumn({ children }: { children: ReactNode }) {
  const rhythm = useContext(AsideContext)?.rhythm ?? "home";
  return (
    <aside aria-label="Details" className="relative z-20 w-panel shrink-0">
      <div aria-hidden="true" className="sticky top-0 z-10 h-13 border-b border-hairline bg-background" />
      <div
        className={`sticky top-13 flex max-h-[calc(100vh_-_3.25rem)] flex-col gap-4 overflow-y-auto pb-4 pr-4 ${TOP[rhythm]}`}
      >
        {children}
      </div>
    </aside>
  );
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
