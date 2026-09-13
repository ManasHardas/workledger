import { useCallback, useEffect, useMemo, useState } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { Badge } from "../../components/ui/badge.js";
import { buttonVariants } from "../../components/ui/button.js";
import { Aside, useAsideDocked } from "../../components/aside.js";
import {
  ListRow,
  RowEmpty,
  RowList,
  RowMeta,
  RowSection,
  RowTitle,
} from "../../components/ui/list-row.js";
import { PageBody, PageHeader, PageSection } from "../../components/ui/page.js";
import type { AppSource, Job, JobAcrossRepos, Repo, Workspace } from "../../lib/ledger-source.js";
import { ONBOARDING_HREF, machineHref, repoHref } from "../../lib/router.js";
import { useMachine } from "../../lib/source-context.js";
import type { Async } from "../../lib/use-async.js";
import { elapsed, shortId } from "../jobs/format.js";
import { JobStatusChip } from "../jobs/job-status-chip.js";
import { useJobList, useNow } from "../jobs/use-jobs.js";
import { BackfillBanner } from "../onboarding/banner.js";
import { plural } from "./format.js";
import { useLiveWorkspaces } from "./live.js";
import { ProjectCard, QuietRow, isContainerOf, type ProjectAction } from "./repo-card.js";
import { SelectedProject } from "./selected-project.js";
import { WorkspaceCard } from "./workspace-card.js";

/** How many rows a lower group shows before it stops being an overview. */
const PREVIEW = 5;

/** A job the queue has not finished with: it is running, or it is about to. */
function isLive(job: Job): boolean {
  return job.status === "running" || job.status === "queued";
}

/**
 * Home — every project on this machine (Product Designs frame `11:2`).
 *
 * The frame answers, in order: is anything filed somewhere it should not be (the flag), which
 * projects did something this week and what each is carrying (Active this week), and which have
 * gone quiet (Quiet) — with the selected project's detail in the right column. Below the frame's
 * content, and in the same style, sit the groups it leaves out (operator, 2026-09-12): the recovery
 * queue and the folders sessions were started from. Adding projects is the left nav's (operator,
 * 2026-09-13).
 *
 * The repo list is the app's, not this view's: the shell needs the same repos for its switcher and
 * the legacy redirects need them to pick a target, so `App` reads them once and hands them down.
 */
export function HomeView({ repos, now = Date.now() }: { repos: Async<Repo[]>; now?: number }) {
  const source = useMachine();
  const { result: workspaces, reload } = useLiveWorkspaces(source);
  const jobs = useJobList(
    useCallback(() => source.listAllJobs(), [source]),
    source,
  );
  const jobList = jobs.result.state === "ready" ? jobs.result.value : [];
  const ticking = useNow(jobList.some((job) => job.status === "running"));
  const docked = useAsideDocked();

  const repoList = useMemo(() => (repos.state === "ready" ? repos.value : []), [repos]);
  const empty = repos.state === "ready" && repoList.length === 0;
  const { active, quiet } = useMemo(() => splitByWeek(repoList), [repoList]);
  const [showAllQuiet, setShowAllQuiet] = useState(false);
  const shownQuiet = showAllQuiet ? quiet : quiet.slice(0, QUIET_PREVIEW);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    repoList.find((repo) => repo.id === selectedId) ?? active[0] ?? repoList[0] ?? null;
  const order = useMemo(() => [...active, ...shownQuiet], [active, shownQuiet]);
  useListKeys(docked, order, selected?.id ?? null, setSelectedId);

  const action = (repo: Repo): ProjectAction =>
    docked ? { kind: "select", onSelect: () => setSelectedId(repo.id) } : { kind: "open" };
  const sessions = repoList.reduce((total, repo) => total + repo.sessions7d, 0);
  const waiting = repoList.reduce((total, repo) => total + repo.openNotes, 0);

  return (
    <>
      <PageHeader
        title="Home"
        aside={
          repos.state === "ready" && !empty
            ? `${plural(repoList.length, "project")} · ${plural(sessions, "session")} this week · ${String(waiting)} waiting on you`
            : undefined
        }
      />
      <PageBody rhythm="home">
        <BackfillBanner />
        {empty ? (
          <EmptyState />
        ) : (
          <>
            <FolderFlag repos={repoList} />
            <AsyncPanel result={repos} isEmpty={() => false} empty="">
              {() => (
                <>
                  <PageSection
                    id="home-active"
                    title="Active this week"
                    aside={`${String(active.length)} of ${String(repoList.length)}`}
                  >
                    {active.length === 0 ? (
                      <RowEmpty>Nothing ran this week.</RowEmpty>
                    ) : (
                      <ul aria-label="Active this week" className="flex flex-col gap-2.5">
                        {active.map((repo) => (
                          <ProjectCard
                            key={repo.id}
                            repo={repo}
                            now={now}
                            selected={docked && selected?.id === repo.id}
                            action={action(repo)}
                          />
                        ))}
                      </ul>
                    )}
                  </PageSection>
                  {quiet.length === 0 ? null : (
                    <PageSection
                      id="home-quiet"
                      title="Quiet"
                      aside={`${plural(quiet.length, "project")} · nothing this week`}
                    >
                      <ul aria-label="Quiet" className="flex flex-col">
                        {shownQuiet.map((repo) => (
                          <QuietRow
                            key={repo.id}
                            repo={repo}
                            now={now}
                            selected={docked && selected?.id === repo.id}
                            action={action(repo)}
                          />
                        ))}
                      </ul>
                      {quiet.length > QUIET_PREVIEW ? (
                        <div className="flex pl-3.5 pt-1">
                          <button
                            type="button"
                            aria-expanded={showAllQuiet}
                            onClick={() => setShowAllQuiet((prior) => !prior)}
                            className="rounded-sm text-left text-base leading-body tracking-body text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {showAllQuiet ? "Show fewer" : showMoreLabel(quiet.slice(QUIET_PREVIEW))}
                          </button>
                        </div>
                      ) : null}
                    </PageSection>
                  )}
                </>
              )}
            </AsyncPanel>
            <RunningGroup jobs={jobs.result.state === "ready" ? jobList : []} now={ticking} />
          </>
        )}

        <FoldersWithSessions workspaces={workspaces} source={source} now={now} onInstalled={reload} />
      </PageBody>
      {selected === null ? null : (
        <Aside narrow="none">
          <SelectedProject repo={selected} source={source} now={now} />
        </Aside>
      )}
    </>
  );
}

/** How many quiet projects show before "Show n more" (frame: three). */
const QUIET_PREVIEW = 3;

/** Active this week, and quiet — each most recently active first, never-run projects last. */
export function splitByWeek(repos: readonly Repo[]): { active: Repo[]; quiet: Repo[] } {
  const recent = [...repos].sort((a, b) => (b.lastHookAt ?? "").localeCompare(a.lastHookAt ?? ""));
  return {
    active: recent.filter((repo) => repo.sessions7d > 0),
    quiet: recent.filter((repo) => repo.sessions7d === 0),
  };
}

/** `Show 6 more`, naming a project that has never run when one is among them — that is news. */
export function showMoreLabel(hidden: readonly Repo[]): string {
  const never = hidden.find((repo) => repo.lastHookAt === null);
  const more = `Show ${String(hidden.length)} more`;
  return never === undefined ? more : `${more}, including ${never.name}, which has never run`;
}

/**
 * The frame's flag: a tracked "project" that is really the folder the others sit in. Sessions run
 * from a worktree or a sibling directory get filed there, so its open items and questions are work
 * that belongs to the projects under it. The frame's headline — "more than every real project
 * combined" — is said only while it is true; otherwise the flag states the counts alone.
 */
function FolderFlag({ repos }: { repos: readonly Repo[] }) {
  const container = [...repos]
    .filter((repo) => isContainerOf(repo, repos) > 0 && repo.openBacklog + repo.openNotes > 0)
    .sort((a, b) => b.openBacklog - a.openBacklog)[0];
  if (container === undefined) return null;
  const others = repos.reduce((total, other) => total + (other.id === container.id ? 0 : other.openBacklog), 0);
  const counts = `${container.name} holds ${plural(container.openBacklog, "open item")} and ${plural(container.openNotes, "question")}`;
  return (
    <div role="note" className="flex items-start gap-3 rounded-lg border border-warning bg-card px-3.5 py-3">
      <Badge variant="warning">check this</Badge>
      <div className="flex min-w-0 flex-1 flex-col gap-0.75 text-base leading-body tracking-body">
        <p className="font-semibold text-foreground">
          {container.openBacklog > others ? `${counts} — more than every real project combined` : counts}
        </p>
        <p className="text-muted-foreground">
          It is the folder your repos sit in, not a project. Sessions run from a worktree or a sibling
          directory are filed here instead of the repo they were about.
        </p>
      </div>
    </div>
  );
}

/** A keystroke inside a field is text, not a command. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** `j`/`k` move the selection down and up the projects; `Enter` opens the selected one's Ledger. */
function useListKeys(
  enabled: boolean,
  order: readonly Repo[],
  selectedId: string | null,
  select: (id: string) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || order.length === 0) return;
      const at = order.findIndex((repo) => repo.id === selectedId);
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = Math.max(0, Math.min(order.length - 1, at + (event.key === "j" ? 1 : -1)));
        select(order[next]!.id);
        return;
      }
      if (event.key === "Enter" && at >= 0 && event.target === document.body) {
        event.preventDefault();
        window.location.hash = repoHref(order[at]!.id, "ledger");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, order, selectedId, select]);
}

/**
 * What the recovery queue is doing: the running and queued rows first, then anything that failed,
 * because a failure is the other reason to look at this group at all.
 */
function RunningGroup({ jobs, now }: { jobs: JobAcrossRepos[]; now: number }) {
  const live = jobs.filter(isLive);
  const failed = jobs.filter((job) => job.status === "failed");
  const rows = [...live, ...failed];
  const shown = rows.slice(0, PREVIEW);
  return (
    <RowSection
      id="home-running"
      title="Running"
      // The failed rows are under this heading, so they are in the number above it (#138): a
      // count that leaves out rows the reader can see is a count of something else.
      count={rows.length}
      countHref={machineHref("jobs")}
      countLabel={`${String(rows.length)} jobs running, queued or failed — Jobs`}
    >
      {shown.length === 0 ? (
        <RowEmpty>Nothing is running.</RowEmpty>
      ) : (
        <RowList aria-label="Running">
          {shown.map((job) => (
            <ListRow key={`${job.repo.id}-${job.id}`} aria-label={`${job.kind} ${shortId(job.id)}`}>
              <JobStatusChip status={job.status} />
              <Badge variant="secondary" className="shrink-0">
                {job.kind}
              </Badge>
              <RowTitle href={repoHref(job.repo.id, "jobs")} className="font-mono text-xs">
                {job.session_ulid}
              </RowTitle>
              <RowMeta>{job.repo.name}</RowMeta>
              <RowMeta className="hidden sm:inline">{elapsed(job, now)}</RowMeta>
            </ListRow>
          ))}
        </RowList>
      )}
    </RowSection>
  );
}

/**
 * The folders with sessions. Absent entirely when the daemon reports none — a
 * machine whose sessions all start inside repos should see the groups above and nothing else, not
 * an empty heading explaining a concept it has no instance of. Loading and failure still render:
 * a group that silently disappears because the read failed would be a lie.
 */
function FoldersWithSessions({
  workspaces,
  source,
  now,
  onInstalled,
}: {
  workspaces: Async<Workspace[]>;
  source: AppSource;
  now: number;
  onInstalled: () => void;
}) {
  if (workspaces.state === "ready" && workspaces.value.length === 0) return null;

  return (
    <RowSection
      id="folders-heading"
      title="Folders with sessions"
      count={workspaces.state === "ready" ? workspaces.value.length : undefined}
    >
      <p className="text-xs leading-tight text-subtle-foreground">
        Agent sessions were started here, but these folders are not git repos — so they are not
        projects. Install hooks to record what a session here does into the repos it touches.
      </p>
      <AsyncPanel result={workspaces} empty="No folders with sessions.">
        {(list) => (
          <RowList aria-label="Folders with sessions">
            {list.map((workspace) => (
              <WorkspaceCard
                key={workspace.path}
                workspace={workspace}
                source={source}
                now={now}
                onInstalled={onInstalled}
              />
            ))}
          </RowList>
        )}
      </AsyncPanel>
    </RowSection>
  );
}

/** No repo enabled yet: the only useful thing on the page is the way to the wizard. */
function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-6">
      <p className="text-base leading-body tracking-body text-muted-foreground">
        No projects are tracked yet. Pick the repos to watch and workledger installs its hooks in
        each one.
      </p>
      <a href={ONBOARDING_HREF} className={buttonVariants({ variant: "outline", size: "sm" })}>
        Add projects
      </a>
    </div>
  );
}
