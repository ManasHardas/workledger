import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

export interface LedgerFilterOption {
  value: string;
  label: string;
}

export type LedgerFilterSelectProps = Omit<ComponentProps<"select">, "children"> & {
  /** Rendered above the control; also the accessible name, so no `aria-label` is needed. */
  label: string;
  options: LedgerFilterOption[];
};

/**
 * The one native `<select>` the Ledger filters use.
 *
 * Named for its feature rather than `Select` because the P2 views are built in parallel and a bare
 * `Select` is the name a Radix-backed listbox will want later; this one is deliberately native, so
 * it costs no bundle and gets the platform's mobile picker for free (design spec §14: mobile-first,
 * nothing fetched from the network).
 */
export function LedgerFilterSelect({
  className,
  label,
  options,
  id,
  ...props
}: LedgerFilterSelectProps) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        id={id}
        className={cn(
          "h-10 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
