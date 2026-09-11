import { Badge } from "../../components/ui/badge.js";
import { ListRow, RowMeta, RowTitle } from "../../components/ui/list-row.js";
import type { Repo } from "../../lib/ledger-source.js";
import { repoHref } from "../../lib/router.js";
import { formatRelative } from "./format.js";

/**
 * One tracked repo, as a status row on Home (#134).
 *
 * Home is not a second copy of the nav: the nav already lists the projects and the five views, so
 * the row here is about *state* — the health reading, what is waiting, and when the repo last
 * showed a sign of life. Every count is a link to the view that holds it (rule 4), so the row is
 * three ways into the repo rather than one.
 */
export function RepoCard({ repo, now }: { repo: Repo; now: number }) {
  return (
    <ListRow aria-label={repo.name}>
      <HealthBadge health={repo.health} />
      <RowTitle href={repoHref(repo.id, "ledger")} className="font-medium">
        {repo.name}
      </RowTitle>
      {/* The path disambiguates two repos with the same basename. It has no space to wrap at, so
          it truncates rather than pushing the row past a 375 px viewport (rule 5) — and below
          `md` it is gone entirely, where the name alone has to do. */}
      <span className="hidden min-w-0 shrink truncate font-mono text-xs text-subtle-foreground md:inline">
        {repo.path}
      </span>
      <Count repo={repo} view="next" value={repo.openBacklog} noun="open backlog" />
      <Count repo={repo} view="needs" value={repo.openNotes} noun="open notes" />
      <Count repo={repo} view="ledger" value={repo.sessions7d} noun="sessions in the last 7 days" />
      <RowMeta className="hidden sm:inline">{formatRelative(repo.lastHookAt, now)}</RowMeta>
    </ListRow>
  );
}

/**
 * A count, as a link to the view that counts it (rule 4). The number is what is painted; the
 * accessible name says what it is a count of, because "4" on its own names nothing.
 */
function Count({
  repo,
  view,
  value,
  noun,
}: {
  repo: Repo;
  view: "ledger" | "next" | "needs";
  value: number;
  noun: string;
}) {
  return (
    <a
      href={repoHref(repo.id, view)}
      aria-label={`${repo.name} — ${String(value)} ${noun}`}
      className="shrink-0 rounded-sm px-1 text-xs tabular-nums text-subtle-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {value}
    </a>
  );
}

/** Same three readings, same tokens, as the Health view's rows. */
export function HealthBadge({ health }: { health: Repo["health"] }) {
  if (health === "broken") return <Badge variant="destructive" className="shrink-0">broken</Badge>;
  if (health === "warn") return <Badge variant="warning" className="shrink-0">warn</Badge>;
  return (
    <Badge variant="outline" className="shrink-0 border-transparent bg-success text-success-foreground">
      ok
    </Badge>
  );
}
