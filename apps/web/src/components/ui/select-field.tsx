import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

/**
 * A native `<select>` in the shell's token palette.
 *
 * Native rather than a Radix listbox because the Next view's selects (priority, merge target) are
 * short, and a native control keeps keyboard handling — including the view's own `j/k` guard —
 * the browser's job rather than ours.
 */
export function SelectField({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 rounded-sm border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
