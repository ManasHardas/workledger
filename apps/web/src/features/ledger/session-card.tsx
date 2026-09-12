import { Badge } from "../../components/ui/badge.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { useRepoId } from "../../lib/source-context.js";
import { detailHref } from "./detail-route.js";
import { formatInstant } from "./format.js";

/** Which badge an open session gets versus one that has already ended or gone wrong. */
function statusVariant(status: string) {
  if (status === "open") return "default" as const;
  if (status === "crashed") return "destructive" as const;
  if (status === "repaired") return "warning" as const;
  return "outline" as const;
}

/**
 * One session in the Ledger list.
 *
 * The goal leads, because that is what a person scans for — what the session was *asked* to do,
 * in the human's own words. Who ran it and on what harness are provenance, not identity, so they
 * drop to the foot beside the counts.
 *
 * The whole card is one link to `#/r/<repo>/session/<ulid>`, so it is reachable by Tab, activates
 * on Enter for free, and the list's `j`/`k` handler only has to move focus.
 */
export function SessionCard({
  session,
  active,
  onFocus,
  ref,
}: {
  session: ParsedSession;
  active: boolean;
  onFocus: () => void;
  ref?: React.Ref<HTMLAnchorElement>;
}) {
  const repo = useRepoId();
  const { frontmatter } = session;
  const remaining = session.remaining.length;
  const done = session.done.length;
  const checkpoints = frontmatter.checkpoints.length;

  return (
    <a
      ref={ref}
      href={detailHref(repo, frontmatter.id)}
      onFocus={onFocus}
      data-active={active ? "" : undefined}
      className="group block rounded-lg border border-hairline bg-card p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active]:border-primary data-[active]:bg-selected"
    >
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 break-words text-sm font-medium leading-body text-foreground">
          {session.goal ?? "No goal recorded"}
        </p>
        <span className="shrink-0">
          <Badge variant={statusVariant(frontmatter.status)}>{frontmatter.status}</Badge>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
        <span className="tabular-nums">{formatInstant(frontmatter.started)}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">
          {checkpoints} {checkpoints === 1 ? "checkpoint" : "checkpoints"}
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">
          {done} {done === 1 ? "outcome" : "outcomes"}
        </span>
        {remaining === 0 ? null : (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{remaining} open</span>
          </>
        )}
        <span className="ml-auto truncate">
          {frontmatter.author.name} · {frontmatter.harness}
        </span>
      </div>
    </a>
  );
}
