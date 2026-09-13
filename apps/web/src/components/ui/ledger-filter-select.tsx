import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

export interface LedgerFilterOption {
  value: string;
  label: string;
}

export type LedgerFilterSelectProps = Omit<ComponentProps<"select">, "children"> & {
  /** The control's accessible name. Not drawn: the Ledger frame shows the option ("Any author"). */
  label: string;
  options: LedgerFilterOption[];
};

/**
 * The one native `<select>` the Ledger filters use, drawn as the Ledger frame's filter (`7:34`):
 * 128 px wide, 32 px tall, 6 px corners, the `input` border, the chosen option in Body/Regular
 * muted and a `▾` in Meta subtle at the right edge.
 *
 * It stays native — `appearance-none` only removes the platform arrow so the frame's glyph can sit
 * in its place — so it costs no bundle, keeps the platform's mobile picker, and keeps every
 * keyboard and assistive-technology behaviour a select promises (design spec §14).
 */
export function LedgerFilterSelect({ className, label, options, ...props }: LedgerFilterSelectProps) {
  return (
    <div className={cn("relative w-32 shrink-0", className)}>
      <select
        aria-label={label}
        className="h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-input bg-background pl-3 pr-7 text-base leading-body tracking-body text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs leading-tight text-subtle-foreground"
      >
        ▾
      </span>
    </div>
  );
}
