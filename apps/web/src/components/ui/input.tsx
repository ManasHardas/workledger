import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

/**
 * The Figma text field (Ledger's search, Review's answer): 32 px, 12 px of side padding, 6 px
 * corners, the `input` border, Body/Regular type with a subtle placeholder.
 */
export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base leading-body tracking-body text-foreground placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
