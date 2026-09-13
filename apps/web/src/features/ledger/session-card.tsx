import type { MouseEvent, Ref } from "react";

import { Badge } from "../../components/ui/badge.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { useRepoId } from "../../lib/source-context.js";
import { detailHref } from "./detail-route.js";
import { sessionSpan } from "./format.js";

/** The chip a session's status gets (Ledger frame `7:50`, `7:62`). */
export function statusVariant(status: string) {
  if (status === "open") return "default" as const;
  if (status === "crashed") return "destructive" as const;
  if (status === "repaired") return "warning" as const;
  return "secondary" as const;
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * One session in the Ledger list, as the frame draws it (`7:46`): the goal leads in Body/Strong,
 * two lines at most, then one meta row — the status chip, when and how long it ran and how many
 * checkpoints it wrote, then what it got done and what it left open.
 *
 * The card is always one link to `#/r/<repo>/session/<ulid>`, so it is reachable by Tab, keeps
 * open-in-new-tab, and names its destination. What a plain click does depends on the screen:
 * with the right column docked, a click *selects* the card (its summary is beside it) and a
 * double-click or `Enter` opens it (`onSelect`/`onOpen`); without the column, there is nothing to
 * select into, so the link simply opens the session.
 */
export function SessionCard({
  session,
  active,
  onFocus,
  onSelect,
  onOpen,
  ref,
}: {
  session: ParsedSession;
  active: boolean;
  onFocus: () => void;
  /** Set only while the right column is docked: a click selects instead of following the link. */
  onSelect?: () => void;
  onOpen?: () => void;
  ref?: Ref<HTMLAnchorElement>;
}) {
  const repo = useRepoId();
  const { frontmatter } = session;
  const remaining = session.remaining.length;
  const done = session.done.length;
  const checkpoints = frontmatter.checkpoints.length;
  const span = sessionSpan(frontmatter);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (onSelect === undefined) return;
    // A modified click still means "open this somewhere else", which the href already does.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onSelect();
  }

  return (
    <a
      ref={ref}
      href={detailHref(repo, frontmatter.id)}
      onFocus={onFocus}
      onClick={onClick}
      onDoubleClick={onOpen}
      aria-current={onSelect !== undefined && active ? "true" : undefined}
      data-active={active ? "" : undefined}
      className="flex flex-col gap-2 rounded-lg border border-hairline bg-card px-3.5 py-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active]:border-primary data-[active]:bg-selected"
    >
      <span className="line-clamp-2 min-w-0 break-words text-base font-semibold leading-body tracking-body text-foreground">
        {session.goal ?? "No goal recorded"}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <Badge variant={statusVariant(frontmatter.status)}>{frontmatter.status}</Badge>
        <span className="min-w-0 flex-1 truncate text-xs leading-tight text-subtle-foreground tabular-nums">
          {span.clocks} · {span.duration} · {plural(checkpoints, "checkpoint", "checkpoints")}
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs leading-tight text-muted-foreground tabular-nums">
          {plural(done, "outcome", "outcomes")}
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs leading-tight text-subtle-foreground tabular-nums">
          {remaining} open
        </span>
      </span>
    </a>
  );
}
