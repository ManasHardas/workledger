import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet.js";

/**
 * The event `/` fires on `window`. The view that owns a search box listens for it and focuses
 * that box; a view without one simply never listens, which is why this is an event rather than a
 * direct call — the shell must not know which views have search.
 */
export const FOCUS_SEARCH_EVENT = "focus-search";

/** The shortcuts of design spec §8, in the order that spec lists them. */
const SHORTCUTS: readonly { keys: string; what: string }[] = [
  { keys: "j / k", what: "Move down / up the list" },
  { keys: "e", what: "Edit the selected item" },
  { keys: "a", what: "Accept the selected item" },
  { keys: "d", what: "Mark the selected item done" },
  // Two presses, like the button: the first arms the row's Discard, the second runs it (#138).
  { keys: "x", what: "Arm Discard on the selected item; press again to confirm, Escape to keep" },
  { keys: "alt + ↑ / ↓", what: "Move the selected item up or down its group" },
  { keys: "/", what: "Focus search" },
  { keys: "?", what: "Show this help" },
];

/**
 * The `?` help overlay, and the two shortcuts the shell itself owns: `?` toggles this sheet and
 * `/` asks the current view to focus its search box. Everything else in the list belongs to the
 * view that has a selection, so it is documented here and handled there.
 *
 * Shortcuts are desktop-only by spec §13; on a touch keyboard none of these keys arrive, and the
 * sheet still opens from nothing but this listener, so nothing here needs a mobile fallback.
 */
export function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="mx-auto max-w-3xl rounded-t-lg">
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>Press ? again, or Escape, to close.</SheetDescription>
        </SheetHeader>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="col-span-2 grid grid-cols-subgrid">
              <dt className="font-mono text-muted-foreground">{shortcut.keys}</dt>
              <dd className="m-0">{shortcut.what}</dd>
            </div>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  );
}

/** Whether the key went to a place the user is typing, where a bare letter is text, not a command. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
