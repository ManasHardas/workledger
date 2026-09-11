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
 * One session, summarised: goal, when it started, who ran it, on what harness, its status, how many
 * checkpoints it has, and how much is done versus still remaining (design spec §8, Ledger).
 *
 * Laid out as a post on X's timeline: who and where on the first line in bold and grey, the goal as
 * the body, the counts along the foot where X keeps its action bar. The list around it separates
 * the posts with hairlines; the card itself has no box.
 *
 * The whole card is one link to `#/r/<repo>/ledger/<ulid>`, so it is reachable by Tab, activates on Enter
 * for free, and the list's `j`/`k` handler only has to move focus.
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
      className="block px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active]:bg-muted/50"
    >
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm leading-body">
        <span className="min-w-0 truncate font-bold text-foreground">{frontmatter.author.name}</span>
        <span className="text-muted-foreground">· {frontmatter.harness}</span>
        <span className="ml-auto shrink-0">
          <Badge variant={statusVariant(frontmatter.status)}>{frontmatter.status}</Badge>
        </span>
      </div>
      <p className="mt-1 break-words text-sm leading-body text-foreground">
        {session.goal ?? "No goal recorded"}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>Started {formatInstant(frontmatter.started)}</span>
        <span>
          {checkpoints} {checkpoints === 1 ? "checkpoint" : "checkpoints"}
        </span>
        <span>
          {done} done · {remaining} remaining
        </span>
      </div>
    </a>
  );
}
