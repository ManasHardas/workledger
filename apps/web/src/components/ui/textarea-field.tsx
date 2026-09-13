import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

/**
 * The multi-line sibling of `Input` — a backlog item's markdown body, Review's answer. Drawn as
 * Review's `field` (`10:137`): 6 px corners, the input border, 12 px sides and 10 px above and
 * below, Body/Regular type with a subtle placeholder.
 */
export function TextareaField({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-input bg-card px-3 py-2.5 text-base leading-body tracking-body text-foreground placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
