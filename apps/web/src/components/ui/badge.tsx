import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-px text-xs font-medium",
  {
    variants: {
      variant: {
        // The blue tint X gives an active tab, not a solid blue block: the blue stays readable as
        // text on it in both themes, where text on the solid blue would not be.
        default: "border-transparent bg-accent text-accent-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        accent: "border-transparent bg-accent text-accent-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
