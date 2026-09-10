import { AsyncPanel } from "../../components/async-panel.js";
import { buttonVariants } from "../../components/ui/button.js";
import { cn } from "../../lib/cn.js";
import type { AppSource, Repo, Workspace } from "../../lib/ledger-source.js";
import { ONBOARDING_HREF, machineHref } from "../../lib/router.js";
import { useMachine } from "../../lib/source-context.js";
import type { Async } from "../../lib/use-async.js";
import { useLiveWorkspaces } from "./live.js";
import { RepoCard } from "./repo-card.js";
import { WorkspaceCard } from "./workspace-card.js";

/**
 * Home — two groups, in the operator's order (daemon-and-api.md amendment 11, UI):
 *
 * 1. **Projects**: the git repos `GET /api/repos` serves, one card each.
 * 2. **Folders with sessions**: `GET /api/workspaces` — folders agent sessions were started in
 *    that are *not* git repos, each with its hooks state and a way to install them.
 *
 * The order is the point, not the decoration. "Git repos tend to be projects and simply because
 * transcripts are found in a folder doesn't mean that folder is a repo and hence a project": the
 * second group is evidence of activity, not a list of projects, so it sits below and never mixes
 * into the first.
 *
 * The repo list is the app's, not this view's: the shell needs the same repos for its switcher and
 * the legacy redirects need them to pick a target, so `App` reads them once and hands them down.
 * The folders are this view's alone, so it reads them itself.
 */
export function HomeView({ repos, now = Date.now() }: { repos: Async<Repo[]>; now?: number }) {
  const source = useMachine();
  const { result: workspaces, reload } = useLiveWorkspaces(source);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="home-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="home-heading" className="text-xl font-semibold">
            Projects
          </h2>
          <nav aria-label="Across projects" className="flex gap-1">
            <TabLink href={machineHref("needs")}>Needs you</TabLink>
            <TabLink href={machineHref("jobs")}>Jobs</TabLink>
          </nav>
          <a href={ONBOARDING_HREF} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}>
            Add projects
          </a>
        </div>
        <AsyncPanel result={repos} empty="No projects.">
          {(list) =>
            list.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Projects">
                {list.map((repo) => (
                  <li key={repo.id}>
                    <RepoCard repo={repo} now={now} />
                  </li>
                ))}
              </ul>
            )
          }
        </AsyncPanel>
      </section>
      <FoldersWithSessions workspaces={workspaces} source={source} now={now} onInstalled={reload} />
    </div>
  );
}

/**
 * The second group. Absent entirely when the daemon reports no such folder — a machine whose
 * sessions all start inside repos should see the Projects list and nothing else, not an empty
 * heading explaining a concept it has no instance of. Loading and failure still render: a group
 * that silently disappears because the read failed would be a lie.
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
    <section aria-labelledby="folders-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="folders-heading" className="text-xl font-semibold">
          Folders with sessions
        </h2>
        <p className="text-sm text-muted-foreground">
          Agent sessions were started here, but these folders are not git repos — so they are not
          projects. Install hooks to record what a session here does into the repos it touches.
        </p>
      </div>
      <AsyncPanel result={workspaces} empty="No folders with sessions.">
        {(list) => (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Folders with sessions">
            {list.map((workspace) => (
              <li key={workspace.path}>
                <WorkspaceCard
                  workspace={workspace}
                  source={source}
                  now={now}
                  onInstalled={onInstalled}
                />
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>
    </section>
  );
}

function TabLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="rounded-md px-3 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </a>
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
      <a href={ONBOARDING_HREF} className={buttonVariants({ size: "sm" })}>
        Add projects
      </a>
    </div>
  );
}
