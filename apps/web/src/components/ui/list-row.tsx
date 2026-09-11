import { useRef, type ComponentProps, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";

/**
 * The list row of `docs/design/direction.md` §Density, in one place so Next, Needs you, Jobs,
 * Health and Home cannot drift apart: 44 px tall on the 8 px grid, a hover background, a focus
 * ring on keyboard focus, and a left accent bar when it is the selected row.
 *
 * A row never scrolls sideways at 375 px (rule 5). That is what the `min-w-0 truncate` on
 * {@link RowTitle} and the `shrink-0` on the chips and the trailing controls are for: the title
 * gives up its width, nothing else does, and the long form of anything lives in the right panel.
 */

/** Rows are separated by a hairline rather than by a gap: one list, not a stack of cards. */
export function RowList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("flex flex-col divide-y divide-hairline", className)} {...props} />;
}

export interface ListRowProps extends Omit<ComponentProps<"li">, "title"> {
  /** Paints the selected surface and the left accent bar. */
  selected?: boolean;
}

export function ListRow({ selected, className, children, ...props }: ListRowProps) {
  return (
    <li
      data-selected={selected === true ? "" : undefined}
      className={cn(
        "group relative flex min-h-row flex-wrap items-center gap-2 rounded-md py-2 pl-3 pr-2 text-sm leading-body transition-colors",
        "hover:bg-muted",
        selected === true ? "bg-selected" : "",
        className,
      )}
      {...props}
    >
      {selected === true ? (
        <span aria-hidden="true" className="absolute inset-y-1 left-0 w-px rounded-full bg-primary" />
      ) : null}
      {children}
    </li>
  );
}

/**
 * The row's primary control: the prose the row is about, and the thing that opens its panel.
 *
 * A real `<button>` (or, with `href`, a real `<a>`), so Enter and Space work, it is in the tab
 * order, and a screen reader announces it as something that does something — none of which a
 * `<li>` with an `onClick` gives.
 */
export function RowTitle({
  className,
  href,
  ...props
}: ComponentProps<"button"> & { href?: string }) {
  const shared = cn(
    "min-w-0 flex-1 truncate rounded-sm text-left text-sm text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  if (href !== undefined) {
    const { children, ...rest } = props;
    return (
      <a href={href} className={shared} {...(rest as ComponentProps<"a">)}>
        {children}
      </a>
    );
  }
  return <button type="button" className={shared} {...props} />;
}

/** The right-hand meta of a row: a count, a duration, a relative time. Tabular, never prose. */
export function RowMeta({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("shrink-0 text-xs tabular-nums text-subtle-foreground", className)}
      {...props}
    />
  );
}

/** An identifier on a row — a path, a commit, a ulid (rule 1: never mixed with prose). */
export function RowId({ className, ...props }: ComponentProps<"span">) {
  return (
    <span className={cn("shrink-0 font-mono text-xs text-subtle-foreground", className)} {...props} />
  );
}

/** The trailing controls. Quiet by default; the row is the thing, not the buttons on it. */
export function RowActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 items-center gap-1", className)} {...props} />;
}

/**
 * A section of a view: a heading, the count of what is in it, and the list itself.
 *
 * Rule 4 — every count is a link to the thing it counts — holds whether or not the list lives on
 * another route. `countHref` sends it there; without one the count links to *this* section's list,
 * scrolls it into view and moves focus onto it, which is what a count with its list right beneath
 * it can honestly lead to. The href is neutralised rather than followed because the app is
 * hash-routed (`lib/router.ts`): letting `#<id>` reach the address bar would read as a route.
 */
export function RowSection({
  title,
  id,
  count,
  countHref,
  countLabel,
  action,
  children,
}: {
  title: string;
  id: string;
  /** Rendered beside the heading. Always a link when there is a count at all (rule 4). */
  count?: number;
  countHref?: string;
  countLabel?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  const listId = `${id}-list`;
  const linkClass =
    "rounded-sm text-xs tabular-nums text-subtle-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h3 id={id} className="text-lg font-extrabold leading-title text-foreground">
          {title}
        </h3>
        {count === undefined ? null : (
          <a
            href={countHref ?? `#${listId}`}
            aria-label={countLabel ?? `${String(count)} — ${title}`}
            className={linkClass}
            onClick={
              countHref === undefined
                ? (event) => {
                    event.preventDefault();
                    // Optional call: jsdom has no layout, so it has no `scrollIntoView` either.
                    list.current?.scrollIntoView?.({ block: "nearest" });
                    list.current?.focus();
                  }
                : undefined
            }
          >
            {count}
          </a>
        )}
        {action === undefined ? null : <div className="ml-auto shrink-0">{action}</div>}
      </div>
      {/* `tabIndex={-1}`: the count's target has to be focusable to be a destination at all, but
          it is never a tab stop of its own. */}
      <div ref={list} id={listId} tabIndex={-1} className="flex min-w-0 flex-col gap-2 outline-none">
        {children}
      </div>
    </section>
  );
}

/** The one empty line a section shows when it has nothing — never a whole empty card. */
export function RowEmpty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-sm text-muted-foreground">{children}</p>;
}
