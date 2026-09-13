import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/cn.js";

/**
 * A right-column module, as the Product Designs frames draw one — Home's "Selected project",
 * Ledger's "Selected session", Session's "Provenance", Review's "Selected": 12 px corners, a
 * hairline, the `card` surface, and sections separated by hairlines.
 */
export function Module({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-hairline bg-card", className)}
      {...props}
    />
  );
}

/** The module's head: 14 px above, 12 below, 16 at the sides. */
export function ModuleHead({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-col gap-1.5 px-4 pb-3 pt-3.5", className)} {...props} />;
}

/** The module's title: Title/Section. */
export function ModuleTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn("break-words text-lg font-semibold leading-body tracking-title text-foreground", className)}
      {...props}
    />
  );
}

/** One labelled reading: a Meta/Strong label over a Body/Regular value. */
export function ModuleSection({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 border-t border-hairline px-4 py-3", className)}>
      <p className="text-xs font-medium leading-tight text-muted-foreground">{label}</p>
      <div className="min-w-0 break-words text-base leading-body tracking-body text-foreground">{children}</div>
    </div>
  );
}

/** The module's foot: a primary link and a quiet aside. */
export function ModuleFoot({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2 border-t border-hairline px-4 pb-3.5 pt-3", className)}
      {...props}
    />
  );
}

/** The foot's link, Body/Medium in the primary colour. */
export const MODULE_LINK =
  "min-w-0 flex-1 rounded-sm text-left text-base font-medium leading-body tracking-body text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
