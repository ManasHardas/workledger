import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet.js";

/**
 * The confirmation surface every job action that spends something goes through.
 *
 * A bottom sheet rather than a centred modal because the app is mobile-first (design spec §13):
 * on a phone the controls land under the thumb, and on a wide screen the same element is a
 * centred card. It is Radix's dialog underneath, so Escape closes it, focus is trapped while it
 * is open and returns to the trigger when it closes — none of which a hand-rolled `<div>` would
 * give the keyboard.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** The buttons. Kept out of `children` so every sheet puts them in the same place. */
  footer: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85vh] max-w-lg overflow-y-auto rounded-t-lg sm:rounded-lg"
        {...(description === undefined ? { "aria-describedby": undefined } : {})}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description === undefined ? null : <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        {children}
        <div className="flex flex-wrap justify-end gap-2">{footer}</div>
      </SheetContent>
    </Sheet>
  );
}
