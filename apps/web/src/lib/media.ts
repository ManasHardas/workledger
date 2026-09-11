import { useCallback, useSyncExternalStore } from "react";

/**
 * The two breakpoints the shell is built on (`docs/design/direction.md` §Shell).
 *
 * They are read in JavaScript rather than expressed as Tailwind variants because the shell
 * *swaps components* at them, not just styles: below 900 px the left nav is a sheet, and below
 * 768 px the right panel is a modal bottom sheet. Rendering both forms and hiding one with CSS
 * would leave a second copy of the nav — and a second copy of every link in it — in the tree for
 * assistive technology and for `getByRole` to find.
 */
export const NAV_SHEET_QUERY = "(max-width: 899px)";
export const PANEL_SHEET_QUERY = "(max-width: 767px)";
/**
 * 1280 px and up: room for the whole X shape — 275 px nav, 600 px column, 350 px right column —
 * so the right column exists and the panel docks in it rather than floating over the page.
 */
export const ASIDE_QUERY = "(min-width: 1280px)";

/**
 * Whether `query` matches, re-read on every change.
 *
 * `matchMedia` is missing in jsdom, so an environment without it reports "no match" — which is
 * the desktop form of every query here, and the one a component test gets unless it stubs
 * `window.matchMedia` to say otherwise.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);
      if (list === undefined) return () => {};
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const snapshot = useCallback(() => window.matchMedia?.(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Below 900 px: the left nav collapses behind a hamburger. */
export function useNavIsSheet(): boolean {
  return useMediaQuery(NAV_SHEET_QUERY);
}

/** Below 768 px: the right panel becomes a modal bottom sheet. */
export function usePanelIsSheet(): boolean {
  return useMediaQuery(PANEL_SHEET_QUERY);
}

/** 1280 px and up: the shell has a right column for the panel and the folders to live in. */
export function useHasAside(): boolean {
  return useMediaQuery(ASIDE_QUERY);
}
