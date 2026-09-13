import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn.js";

/**
 * The Figma button (Design System `Button`; Review's Answer, Accept and Discard): 8 px corners,
 * Meta/Strong type, the green primary fill. `sm` is the frames' 28 px size and the one every list
 * row carries.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
        outline: "border border-input bg-transparent text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        /**
         * The control a list row carries when it is not the row's main action: no fill and no
         * border until it is hovered, so a row of them reads as one row.
         */
        quiet: "text-muted-foreground hover:bg-muted hover:text-foreground",
        /** Review's Discard: the destructive colour as an outline, never a solid block in a list. */
        danger:
          "border border-destructive bg-transparent text-destructive hover:bg-destructive hover:text-destructive-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
      },
      size: {
        default: "h-8 px-3 text-base leading-body tracking-body",
        /** The frames' button: 28 px, 12 px of side padding, 12 px type. */
        sm: "h-7 px-3 text-xs leading-tight",
        xs: "h-6 px-2 text-xs leading-tight",
        lg: "h-9 px-4 text-base leading-body tracking-body",
        icon: "h-8 w-8",
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
