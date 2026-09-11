import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../../lib/cn.js";
import { usePanelIsSheet } from "../../lib/media.js";

/**
 * The right pane, and the one place the app is allowed to put evidence
 * (`docs/design/direction.md` §Shell, rule 3; P8 amendment 13).
 *
 * From 1280 px it **docks** as the first module of the shell's right column (X's "Today's News"
 * slot, see {@link PanelSlot}): 350 px, radius 16, a hairline border, its own scroll and its own
 * header with a round close control. Between 768 and 1279 px there is no right column, so it
 * **floats** at the right edge instead — inset 12 px, the app's single shadow — never a
 * full-height drawer. Either way it is non-modal — the middle pane keeps its scroll and its
 * clicks, so opening a second item *replaces* the panel instead of closing and reopening it.
 * Below 768 px the same component is a modal bottom sheet at 85 vh with a drag handle, closed by
 * Escape, by the close control, or by a swipe down.
 *
 * Focus moves into the panel when it opens and back to whatever opened it when it closes, in both
 * forms: that is Radix's dialog underneath, with the focus trap turned off in the non-modal form
 * so Tab can leave the panel for the middle pane behind it.
 */

/** How far a downward swipe on the sheet's handle must travel before it closes. */
const SWIPE_CLOSE_PX = 72;

interface PanelHostValue {
  /** How many panels are open — 0, or 1 in practice; a count so nesting cannot strand the inset. */
  open: number;
  acquire: () => void;
  release: () => void;
  /** The right column's dock, while the shell has one on screen; an open panel renders into it. */
  slot: HTMLElement | null;
  setSlot: (node: HTMLElement | null) => void;
}

const PanelHostContext = createContext<PanelHostValue | null>(null);

/**
 * Wraps the shell so the middle pane can make room for an open panel on desktop. Without it the
 * panel still works; it simply floats over the content instead of beside it.
 */
export function PanelHost({ children }: { children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo<PanelHostValue>(
    () => ({
      open,
      acquire: () => setOpen((n) => n + 1),
      release: () => setOpen((n) => Math.max(0, n - 1)),
      slot,
      setSlot,
    }),
    [open, slot],
  );
  return <PanelHostContext.Provider value={value}>{children(open > 0)}</PanelHostContext.Provider>;
}

/**
 * Where a desktop panel docks: the top of the shell's right column, the slot X gives its first
 * module. While one is mounted, an open panel renders in the column's flow as a module instead of
 * floating over the page; `empty:hidden` keeps the column's gap from opening above nothing.
 */
export function PanelSlot() {
  const setSlot = useContext(PanelHostContext)?.setSlot;
  return <div ref={setSlot} className="empty:hidden" />;
}

/** True while any {@link Panel} is open. The shell reads it to inset the middle pane. */
export function usePanelOpen(): boolean {
  return (useContext(PanelHostContext)?.open ?? 0) > 0;
}

export interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The panel's own header title — its accessible name, so never empty. */
  title: ReactNode;
  /** Optional line under the title: identifiers, timestamps, the checkpoint marker. */
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ open, onOpenChange, title, description, children, className }: PanelProps) {
  const sheet = usePanelIsSheet();
  const host = useContext(PanelHostContext);
  const [drag, setDrag] = useState(0);
  const slot = host?.slot ?? null;
  // Docked: the shell's right column is on screen, so the panel is one of its modules.
  const docked = !sheet && slot !== null;

  // The middle pane's inset is the host's business, not this component's; releasing on unmount as
  // well as on close is what keeps it from sticking when a route changes while the panel is open.
  const { acquire, release } = host ?? {};
  useEffect(() => {
    if (!open || acquire === undefined || release === undefined) return;
    acquire();
    return release;
  }, [open, acquire, release]);

  useEffect(() => {
    if (!open) setDrag(0);
  }, [open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  /*
   * Focus returns to whatever opened the panel. Radix would do this for a dialog with a
   * `Dialog.Trigger`, but the panel has none — it is opened by a row in the middle pane, and which
   * row that was is not knowable to this component. So the opener is remembered on the render that
   * flips `open` to true, before Radix's mount effect moves focus into the content, and restored in
   * `onCloseAutoFocus` (which Radix fires for both the modal and the non-modal form).
   *
   * On desktop the panel is non-modal and a second row *replaces* its contents without ever
   * closing it, so the opener has to keep up: while the panel is open, any focus landing outside
   * it is the new opener. Without that, closing after a second click sent focus back to the first
   * row — a jump backwards (#132 review).
   */
  const contentRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  if (open && !wasOpen.current) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (contentRef.current?.contains(target) === true) return;
      opener.current = target;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  // A ref, not a local: `setDrag` re-renders between `touchmove`s, and a local would be back to
  // null by the second one.
  const startY = useRef<number | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    startY.current = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (startY.current === null || y === undefined) return;
    setDrag(Math.max(0, y - startY.current));
  };
  const onTouchEnd = () => {
    if (drag >= SWIPE_CLOSE_PX) close();
    else setDrag(0);
    startY.current = null;
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={sheet}>
      <DialogPrimitive.Portal container={docked ? slot : undefined}>
        {/* No scrim on desktop: a non-modal panel that dimmed the page would be lying about it. */}
        {sheet ? (
          <DialogPrimitive.Overlay
            data-panel-overlay=""
            className="fixed inset-0 z-40 bg-overlay/40"
          />
        ) : null}
        <DialogPrimitive.Content
          ref={contentRef}
          data-variant={sheet ? "sheet" : "panel"}
          data-docked={docked ? "" : undefined}
          // Radix wires `aria-describedby` to the Description when there is one; without one it
          // warns unless the absence is stated, which is what this spread says.
          {...(description === undefined ? { "aria-describedby": undefined } : {})}
          style={sheet && drag > 0 ? { transform: `translateY(${drag}px)` } : undefined}
          // Desktop: a click in the middle pane must not close the panel — the middle pane stays
          // live behind it, and the panel is what the *next* item replaces (direction.md §Shell).
          onInteractOutside={(event) => {
            if (!sheet) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = opener.current;
            if (target !== null && target.isConnected) target.focus();
          }}
          className={cn(
            "flex flex-col overflow-hidden border border-hairline bg-raised text-foreground focus-visible:outline-none",
            sheet
              ? "fixed inset-x-0 bottom-0 z-50 h-[85vh] rounded-t-lg border-b-0 shadow-panel"
              : docked
                ? // A module in the right column's flow: no shadow, as tall as the viewport allows
                  // under the column's own 12 px of padding, scrolling inside itself past that.
                  "max-h-[calc(100vh_-_2_*_var(--wl-spacing-inset))] w-full rounded-lg"
                : "fixed bottom-inset right-inset top-inset z-50 w-panel rounded-lg shadow-panel",
            className,
          )}
        >
          {sheet ? (
            <div
              className="flex shrink-0 justify-center pt-2"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <span aria-hidden="true" className="h-1 w-10 rounded-full bg-input" />
            </div>
          ) : null}
          <div className="flex shrink-0 items-start gap-3 px-4 pb-2 pt-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="line-clamp-3 text-lg font-extrabold leading-body">
                {title}
              </DialogPrimitive.Title>
              {description === undefined ? null : (
                <DialogPrimitive.Description className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Close panel"
              className="-mr-2 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CloseIcon />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Inlined so the bundle asks the network for nothing (design spec §14: no external assets). */
function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}
