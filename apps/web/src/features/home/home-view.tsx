import { useCallback } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { Badge } from "../../components/ui/badge.js";
import { buttonVariants } from "../../components/ui/button.js";
import {
  ListRow,
  RowEmpty,
  RowList,
  RowMeta,
  RowSection,
  RowTitle,
} from "../../components/ui/list-row.js";
import { cn } from "../../lib/cn.js";
import type { AppSource, Job, JobAcrossRepos, NoteAcrossRepos, Repo, Workspace } from "../../lib/ledger-source.js";
import { ONBOARDING_HREF, machineHref, repoHref } from "../../lib/router.js";
import { useMachine } from "../../lib/source-context.js";
import type { Async } from "../../lib/use-async.js";
import { elapsed, shortId } from "../jobs/format.js";
import { useJobList, useNow } from "../jobs/use-jobs.js";
import { useLiveAllNotes, useLiveWorkspaces } from "./live.js";
import { RepoCard } from "./repo-card.js";
import { WorkspaceCard } from "./workspace-card.js";

/** How many rows an overview group shows before it stops being an overview. */
const PREVIEW = 5;

/** A job the queue has not finished with: it is running, or it is about to. */
function isLive(job: Job): boolean {
  return job.status === "running" || job.status === "queued";
}

/**
 * Home — a status overview, not a second copy of the nav (#134).
 *
 * The nav already carries the project switcher, the five views of the current project, the folders
 * with sessions and the way to add more. So Home answers the three questions the nav cannot:
 *
 * 1. **Needs you** — the open blockers and questions, across every project.
 * 2. **Running** — what the recovery queue is doing right now, and what it failed at.
 * 3. **Projects** — one status row per project: its health, what is waiting in each view, and when
 *    it last showed a sign of life; newest first, so "what changed recently" is the top of it.
 *
 * Then **Folders with sessions**, which is where the nav's folder rows lead: a folder is not a
 * repo and has no ledger, so the nav can only name it and this group is what details it.
 *
 * Every count is a link to the thing it counts (rule 4), and every group shows the first
 * {@link PREVIEW} rows with the count beside its heading leading to the whole list.
 *
 * The repo list is the app's, not this view's: the shell needs the same repos for its switcher and
 * the legacy redirects need them to pick a target, so `App` reads them once and hands them down.
 */
export function HomeView({ repos, now = Date.now() }: { repos: Async<Repo[]>; now?: number }) {
  const source = useMachine();
  const { result: workspaces, reload } = useLiveWorkspaces(source);
  const notes = useLiveAllNotes(source);
  const jobs = useJobList(
    useCallback(() => source.listAllJobs(), [source]),
    source,
  );
  const jobList = jobs.result.state === "ready" ? jobs.result.value : [];
  const ticking = useNow(jobList.some((job) => job.status === "running"));

  const repoList = repos.state === "ready" ? repos.value : [];
  const empty = repos.state === "ready" && repoList.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="home-heading" className="text-xl font-semibold leading-title">
          Overview
        </h2>
        <a
          href={ONBOARDING_HREF}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}
        >
          Add projects
        </a>
      </div>

      {empty ? (
        <EmptyState />
      ) : (
        <>
          <NeedsYouGroup notes={notes} />
          <RunningGroup jobs={jobs.result.state === "ready" ? jobList : []} now={ticking} />
          <ProjectsGroup repos={repos} now={now} />
        </>
      )}

      <FoldersWithSessions workspaces={workspaces} source={source} now={now} onInstalled={reload} />
    </div>
  );
}

/** What is waiting on a person, across projects — the top of the machine-wide Needs you tab. */
function NeedsYouGroup({ notes }: { notes: Async<NoteAcrossRepos[]> }) {
  const list = notes.state === "ready" ? notes.value : [];
  return (
    <RowSection
      id="home-needs"
      title="Needs you"
      count={notes.state === "ready" ? list.length : undefined}
      countHref={machineHref("needs")}
      countLabel={`${String(list.length)} open questions and blockers — Needs you`}
    >
      <AsyncPanel
        result={notes}
        isEmpty={(value) => value.length === 0}
        empty="Nothing is waiting on you."
      >
        {(value) => (
          <RowList aria-label="Needs you">
            {value.slice(0, PREVIEW).map((note) => (
              <ListRow key={`${note.repo.id}-${note.session}-${String(note.cp)}-${String(note.index)}`}>
                <Badge variant={note.type === "blocker" ? "destructive" : "accent"} className="shrink-0">
                  {note.type}
                </Badge>
                <RowTitle href={repoHref(note.repo.id, "needs")}>{note.text}</RowTitle>
                <RowMeta>{note.repo.name}</RowMeta>
              </ListRow>
            ))}
          </RowList>
        )}
      </AsyncPanel>
    </RowSection>
  );
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
              <Badge variant={job.status === "failed" ? "destructive" : "default"} className="shrink-0">
                {job.status}
              </Badge>
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

/** One status row per project, most recently active first — "what changed recently, per project". */
function ProjectsGroup({ repos, now }: { repos: Async<Repo[]>; now: number }) {
  return (
    <RowSection
      id="home-projects"
      title="Projects"
      count={repos.state === "ready" ? repos.value.length : undefined}
    >
      <AsyncPanel result={repos} isEmpty={(list) => list.length === 0} empty="No projects.">
        {(list) => (
          <RowList aria-label="Projects">
            {[...list]
              .sort((a, b) => (b.lastHookAt ?? "").localeCompare(a.lastHookAt ?? ""))
              .map((repo) => (
                <RepoCard key={repo.id} repo={repo} now={now} />
              ))}
          </RowList>
        )}
      </AsyncPanel>
    </RowSection>
  );
}

/**
 * The folders the nav's own folder rows lead to. Absent entirely when the daemon reports none — a
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
      <p className="px-3 text-xs text-muted-foreground">
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
      <p className="text-sm text-muted-foreground">
        No projects are tracked yet. Pick the repos to watch and workledger installs its hooks in
        each one.
      </p>
      <a href={ONBOARDING_HREF} className={buttonVariants({ variant: "outline", size: "sm" })}>
        Add projects
      </a>
    </div>
  );
}
