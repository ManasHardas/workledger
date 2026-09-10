import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
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

  return (
    <a
      ref={ref}
      href={detailHref(repo, frontmatter.id)}
      onFocus={onFocus}
      data-active={active ? "" : undefined}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="transition-colors hover:bg-muted data-[active]:border-ring">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(frontmatter.status)}>{frontmatter.status}</Badge>
            <Badge variant="secondary">{frontmatter.harness}</Badge>
            <Badge variant="outline">
              {frontmatter.checkpoints.length}{" "}
              {frontmatter.checkpoints.length === 1 ? "checkpoint" : "checkpoints"}
            </Badge>
          </div>
          <CardTitle>{session.goal ?? "No goal recorded"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Started {formatInstant(frontmatter.started)}</span>
          <span>{frontmatter.author.name}</span>
          <span>
            {done} done · {remaining} remaining
          </span>
        </CardContent>
      </Card>
    </a>
  );
}
