import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { cn } from "../../lib/cn.js";
import { Button } from "./button.js";

/**
 * The list row of `docs/design/direction.md` §Density, in one place so Next, Needs you, Jobs,
 * Health and Home cannot drift apart: 32 px tall on the 8 px grid, a hover background, a focus
 * ring on keyboard focus, and a left accent bar when it is the selected row.
 *
 * The shape is the nav's, deliberately — `components/app-shell.tsx` paints its own rows the same
 * way, and a list that matched the nav in every respect but the accent bar would read as a second
 * hand. The one difference is height: 32 px here, 28 px in the nav, as the direction asks.
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
        "group relative flex min-h-row flex-wrap items-center gap-2 rounded-md py-1 pl-3 pr-1 text-sm transition-colors",
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
 * A destructive action as the direction wants it (#134): a quiet control in the list, and the
 * destructive colour only on the step that actually confirms it.
 *
 * Two clicks, never a `window.confirm`: the first arms the row and the second runs it. Arming
 * changes the button's accessible name to the confirming sentence, so the announcement and the
 * paint say the same thing. Escape, a click on `Keep`, and moving focus out of the pair all
 * disarm it, so an armed row cannot be left behind for the next person to hit by accident.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  cancelLabel = "Keep",
  onConfirm,
  disabled,
  size = "xs",
}: {
  label: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  size?: "xs" | "sm";
}) {
  const [armed, setArmed] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  // Focus lands on the confirming control, so Enter twice is the whole gesture from the keyboard.
  useEffect(() => {
    if (armed) confirm.current?.focus();
  }, [armed]);

  useEffect(() => {
    if (disabled === true) setArmed(false);
  }, [disabled]);

  if (!armed) {
    return (
      <Button
        type="button"
        variant="quiet"
        size={size}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div
      ref={wrap}
      className="flex shrink-0 items-center gap-1"
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) setArmed(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setArmed(false);
        }
      }}
    >
      <Button
        ref={confirm}
        type="button"
        variant="danger"
        size={size}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button type="button" variant="quiet" size={size} onClick={() => setArmed(false)}>
        {cancelLabel}
      </Button>
    </div>
  );
}

/** A section of a view: a heading, an optional count that links to what it counts, and a list. */
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
  /** Rendered beside the heading. Always a link when there is somewhere to send it (rule 4). */
  count?: number;
  countHref?: string;
  countLabel?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h3 id={id} className="text-sm font-medium leading-body text-foreground">
          {title}
        </h3>
        {count === undefined ? null : countHref === undefined ? (
          <span className="text-xs tabular-nums text-subtle-foreground">{count}</span>
        ) : (
          <a
            href={countHref}
            aria-label={countLabel ?? `${String(count)} — ${title}`}
            className="rounded-sm text-xs tabular-nums text-subtle-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {count}
          </a>
        )}
        {action === undefined ? null : <div className="ml-auto shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** The one empty line a section shows when it has nothing — never a whole empty card. */
export function RowEmpty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-sm text-muted-foreground">{children}</p>;
}
