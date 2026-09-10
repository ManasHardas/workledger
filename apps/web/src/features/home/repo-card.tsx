import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import type { Repo } from "../../lib/ledger-source.js";
import { repoHref } from "../../lib/router.js";
import { formatRelative } from "./format.js";

/**
 * One tracked repo, summarised: name, path, the four counts `/api/repos` carries and the health
 * reading (plans/feature-p8-onboarding-home.md §Scope 2). The whole card is one link into that
 * repo's Ledger, the same shape as a session card, so Tab reaches it and Enter opens it.
 */
export function RepoCard({ repo, now }: { repo: Repo; now: number }) {
  return (
    <a
      href={repoHref(repo.id, "ledger")}
      aria-label={repo.name}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="h-full transition-colors hover:bg-muted">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <HealthBadge health={repo.health} />
            {repo.harnesses.map((harness) => (
              <Badge key={harness} variant="secondary">
                {harness}
              </Badge>
            ))}
          </div>
          <CardTitle>{repo.name}</CardTitle>
          <CardDescription className="break-all font-mono">{repo.path}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Stat label="sessions · 7d" value={String(repo.sessions7d)} />
            <Stat label="open backlog" value={String(repo.openBacklog)} />
            <Stat label="open notes" value={String(repo.openNotes)} />
            <Stat label="last hook" value={formatRelative(repo.lastHookAt, now)} />
          </dl>
        </CardContent>
      </Card>
    </a>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Same three readings, same tokens, as the Health view's rows. */
export function HealthBadge({ health }: { health: Repo["health"] }) {
  if (health === "broken") return <Badge variant="destructive">broken</Badge>;
  if (health === "warn") return <Badge variant="warning">warn</Badge>;
  return (
    <Badge variant="outline" className="border-transparent bg-success text-success-foreground">
      ok
    </Badge>
  );
}
