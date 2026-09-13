import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

/**
 * The Figma chip (Design System `Badge`; every Product Designs frame): 22 px tall, 8 px of side
 * padding, a pill, Meta/Strong type. Status is carried by a solid fill; the neutral chip — an
 * `ended` session, a harness — is the one with a hairline border instead.
 */
const badgeVariants = cva(
  "inline-flex h-5.5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-xs font-medium leading-tight",
  {
    variants: {
      variant: {
        /** An open session, a `question`: the accent tint with the accent text on it. */
        default: "bg-accent text-accent-foreground",
        accent: "bg-accent text-accent-foreground",
        /** `ended`, a harness name, anything that is a label rather than a state. */
        secondary: "border border-border bg-muted text-muted-foreground",
        outline: "border border-border bg-muted text-muted-foreground",
        /** `crashed`, `blocker`, `broken`, `tests-failed`. */
        destructive: "bg-destructive text-destructive-foreground",
        /** `check this`, `folder`, `warn`, `repaired`. */
        warning: "bg-warning text-warning-foreground",
        /** `ok`, `tests-passed`, `hooks`. */
        success: "bg-success text-success-foreground",
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
