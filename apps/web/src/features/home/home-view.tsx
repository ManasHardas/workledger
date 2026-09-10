import { AsyncPanel } from "../../components/async-panel.js";
import { buttonVariants } from "../../components/ui/button.js";
import { cn } from "../../lib/cn.js";
import type { Repo } from "../../lib/ledger-source.js";
import { ONBOARDING_HREF, machineHref } from "../../lib/router.js";
import type { Async } from "../../lib/use-async.js";
import { RepoCard } from "./repo-card.js";

/**
 * Home — every repo the daemon serves, one card each, plus the way into the machine-wide tabs
 * and the wizard (plans/feature-p8-onboarding-home.md §Scope 2).
 *
 * The list is the app's, not this view's: the shell needs the same repos for its switcher and
 * the legacy redirects need them to pick a target, so `App` reads them once and hands them down.
 */
export function HomeView({ repos, now = Date.now() }: { repos: Async<Repo[]>; now?: number }) {
  return (
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
