import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/cn.js";
import { useAsideRhythm } from "../aside.js";

/**
 * The reading column's frame, as every Product Designs screen draws it: a 52 px header with a
 * hairline under it, then a body 32 px in from both edges with its own top padding, gap and
 * maximum width. The view owns both, because the header's copy and the body's rhythm differ per
 * screen (Home 22/26, Ledger 20/24, Session 28/28, Review 22/26 — `plans/feature-p9-figma-screens.md`).
 */
export function PageHeader({
  title,
  aside,
  children,
  className,
}: {
  /** Title/Page. Omitted by the Session header, which is a breadcrumb instead (`children`). */
  title?: ReactNode;
  /** The Meta line at the right edge: a count summary, or the keyboard hint. */
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-13 shrink-0 items-center gap-3 border-b border-hairline bg-background px-8",
        className,
      )}
    >
      {title === undefined ? null : (
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold leading-title tracking-title text-foreground">
          {title}
        </h1>
      )}
      {children}
      {aside === undefined ? null : (
        <p className="hidden shrink-0 whitespace-nowrap text-xs leading-tight text-subtle-foreground md:block">
          {aside}
        </p>
      )}
    </header>
  );
}

const BODY = {
  home: "max-w-reading gap-6.5 pt-5.5",
  ledger: "max-w-reading gap-6 pt-5",
  review: "max-w-reading gap-6.5 pt-5.5",
  session: "max-w-reading-narrow gap-7 pt-7",
} as const;

export function PageBody({
  rhythm,
  className,
  ...props
}: ComponentProps<"div"> & { rhythm: keyof typeof BODY }) {
  useAsideRhythm(rhythm);
  return <div className={cn("flex w-full min-w-0 flex-col px-8 pb-10", BODY[rhythm], className)} {...props} />;
}

/** A section head: Title/Section, and a Meta aside at the right edge (a count, a span). */
export function SectionHead({
  id,
  title,
  aside,
  className,
}: {
  id?: string;
  title: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <h2 id={id} className="min-w-0 flex-1 text-lg font-semibold leading-body tracking-title text-foreground">
        {title}
      </h2>
      {aside === undefined ? null : (
        <span className="shrink-0 whitespace-nowrap text-xs leading-tight text-subtle-foreground">{aside}</span>
      )}
    </div>
  );
}

/** A reading-column section: its head, then its cards 10 px apart. */
export function PageSection({
  id,
  title,
  aside,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <SectionHead id={id} title={title} aside={aside} />
      {children}
    </section>
  );
}
