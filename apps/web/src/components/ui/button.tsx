import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

/**
 * X's buttons: every one a pill, every label bold. The primary is the inverted pill — white on
 * black, black on white — that X uses for Post and Follow; the blue stays for focus, links and
 * selection (docs/design/direction.md §Tokens).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:opacity-90",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        outline: "border border-input bg-transparent text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        /*
         * The control a list row carries: no fill and no border until it is hovered, so a row of
         * them reads as one row rather than as a strip of buttons (docs/design/direction.md
         * §Density). Every per-row action in Next, Needs you, Jobs and Health is one of these.
         */
        quiet: "text-muted-foreground hover:bg-muted hover:text-foreground",
        /*
         * The *confirming* step of a destructive action, and the only place the destructive colour
         * appears outside a status chip: an outline, not a fill, so a list never carries a solid
         * red block in it (#134).
         */
        danger:
          "border border-destructive bg-transparent text-destructive hover:bg-destructive hover:text-destructive-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-4 text-xs",
        /** Fits inside the 44 px list row with the 8 px grid still intact above and below it. */
        xs: "h-6 px-3 text-xs",
        /** X's Post button: the one big pill in the nav. */
        lg: "h-row-nav px-8 text-lg",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
