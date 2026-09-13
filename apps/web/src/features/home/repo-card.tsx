import { Badge } from "../../components/ui/badge.js";
import { cn } from "../../lib/cn.js";
import type { Repo } from "../../lib/ledger-source.js";
import { repoHref } from "../../lib/router.js";
import { formatAgo } from "./format.js";

/**
 * True when this tracked repo is really the folder the others sit in.
 *
 * The operator's `~/Projects` carries more open items than every real project combined, because a
 * session run from a worktree or a sibling directory is filed against the nearest enabled repo —
 * which, for anything under `~/Projects`, is `~/Projects` itself. Nothing in the ledger says
 * "this is a container"; the repo list says it, if you look: its path is a prefix of another
 * tracked repo's.
 */
export function isContainerOf(repo: Repo, all: readonly Repo[]): number {
  const prefix = repo.path.endsWith("/") ? repo.path : `${repo.path}/`;
  return all.filter((other) => other.id !== repo.id && other.path.startsWith(prefix)).length;
}

/** `~/Projects/workledger` for `/Users/<name>/Projects/workledger`, as the frames print a path. */
export function homePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** What a project card or row does when activated: select it for the right column, or open it. */
export type ProjectAction = { kind: "select"; onSelect: () => void } | { kind: "open" };

/**
 * One project under "Active this week" (Home frame `11:34`): its name and path, three stats —
 * sessions this week, open backlog, and the blockers and questions that need the operator — and
 * when it last showed a sign of life.
 *
 * With the right column on screen the card selects the project, whose module then carries the
 * way in ("Open the ledger"); without one there is nowhere to show a selection, so the card is the
 * link to the project's Ledger itself.
 */
export function ProjectCard({
  repo,
  now,
  selected,
  action,
}: {
  repo: Repo;
  now: number;
  selected: boolean;
  action: ProjectAction;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.75">
        <span className="truncate text-base font-semibold leading-body tracking-body text-foreground">
          {repo.name}
        </span>
        <span className="truncate font-mono text-xs leading-tight text-subtle-foreground">{homePath(repo.path)}</span>
      </span>
      <Stat value={repo.sessions7d} label="sessions" tone="text-foreground" />
      <Stat value={repo.openBacklog} label="open" tone="text-muted-foreground" />
      <Stat value={repo.openNotes} label="need you" tone="text-accent-foreground" />
      <span className="hidden shrink-0 whitespace-nowrap text-xs leading-tight text-subtle-foreground sm:inline">
        {formatAgo(repo.lastHookAt, now)}
      </span>
    </>
  );
  const className = cn(
    "flex w-full min-w-0 items-center gap-3 rounded-lg border px-3.5 py-2.75 text-left transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected ? "border-primary bg-selected" : "border-hairline bg-card hover:bg-muted",
  );
  const label = `${repo.name} — ${String(repo.sessions7d)} sessions this week, ${String(repo.openBacklog)} open, ${String(repo.openNotes)} need you`;

  return (
    <li aria-label={repo.name}>
      {action.kind === "select" ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={label}
          onClick={action.onSelect}
          onDoubleClick={() => (window.location.hash = repoHref(repo.id, "ledger"))}
          className={className}
        >
          {body}
        </button>
      ) : (
        <a href={repoHref(repo.id, "ledger")} aria-label={label} className={className}>
          {body}
        </a>
      )}
    </li>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <span className="hidden w-18 shrink-0 flex-col items-end gap-px whitespace-nowrap sm:flex">
      <span className={cn("text-base font-medium leading-body tracking-body tabular-nums", tone)}>{value}</span>
      <span className="text-xs leading-tight text-subtle-foreground">{label}</span>
    </span>
  );
}

/** One project under "Quiet" (Home frame `11:122`): a line, not a card — nothing ran this week. */
export function QuietRow({
  repo,
  now,
  selected,
  action,
}: {
  repo: Repo;
  now: number;
  selected: boolean;
  action: ProjectAction;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-base leading-body tracking-body text-muted-foreground">
        {repo.name}
      </span>
      <Meta>{`${String(repo.openBacklog)} open`}</Meta>
      <Meta>{`${String(repo.openNotes)} need you`}</Meta>
      <Meta className="hidden sm:inline">{formatAgo(repo.lastHookAt, now)}</Meta>
    </>
  );
  const className = cn(
    "flex w-full min-w-0 items-center gap-3 rounded-lg px-3.5 py-2 text-left transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected ? "bg-selected" : "hover:bg-muted",
  );
  return (
    <li aria-label={repo.name}>
      {action.kind === "select" ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={action.onSelect}
          onDoubleClick={() => (window.location.hash = repoHref(repo.id, "ledger"))}
          className={className}
        >
          {body}
        </button>
      ) : (
        <a href={repoHref(repo.id, "ledger")} className={className}>
          {body}
        </a>
      )}
    </li>
  );
}

function Meta({ className, children }: { className?: string; children: string }) {
  return (
    <span className={cn("shrink-0 whitespace-nowrap text-xs leading-tight tabular-nums text-subtle-foreground", className)}>
      {children}
    </span>
  );
}

/** The repo's own health, as the frames' chip: `ok` green, `warn` amber, `broken` red. */
export function HealthBadge({ health }: { health: Repo["health"] }) {
  if (health === "broken") return <Badge variant="destructive">broken</Badge>;
  if (health === "warn") return <Badge variant="warning">warn</Badge>;
  return <Badge variant="success">ok</Badge>;
}
