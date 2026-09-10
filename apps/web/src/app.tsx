import { useEffect, useMemo } from "react";

import { AppShell } from "./components/app-shell.js";
import { useLiveRepos } from "./features/home/live.js";
import { BackfillBanner, EmptyMachineRedirect } from "./features/onboarding/index.js";
import type { AppSource, Repo } from "./lib/ledger-source.js";
import { HOME_HREF, legacyTarget, replaceHash, useRoute, type Route, type ViewId } from "./lib/router.js";
import { MachineProvider, RepoIdProvider, SourceProvider } from "./lib/source-context.js";
import type { Async } from "./lib/use-async.js";
import { AllJobsView } from "./routes/all-jobs.js";
import { AllNeedsView } from "./routes/all-needs.js";
import { HealthView } from "./routes/health.js";
import { HomeView } from "./routes/home.js";
import { JobsView } from "./routes/jobs.js";
import { LedgerView } from "./routes/ledger.js";
import { NeedsYouView } from "./routes/needs-you.js";
import { NextView } from "./routes/next.js";
import { OnboardingView } from "./routes/onboarding.js";

const REPO_VIEWS: Record<ViewId, () => React.JSX.Element> = {
  ledger: LedgerView,
  next: NextView,
  needs: NeedsYouView,
  jobs: JobsView,
  health: HealthView,
};

/**
 * The whole app, parameterised by its one dependency.
 *
 * `source` is the machine-wide source (P8): Home and the `#/needs` / `#/jobs` tabs read it
 * directly, and a `#/r/<id>/…` route hands its view `source.forRepo(id)` through the same
 * `SourceProvider` the P2 views were built against, so none of them knows the daemon exists.
 */
export function App({ source }: { source: AppSource }) {
  const route = useRoute();
  const repos = useLiveRepos(source);

  return (
    <MachineProvider source={source}>
      <AppShell repos={repos.state === "ready" ? repos.value : []}>
        <Screen route={route} source={source} repos={repos} />
      </AppShell>
    </MachineProvider>
  );
}

function Screen({ route, source, repos }: { route: Route; source: AppSource; repos: Async<Repo[]> }) {
  switch (route.kind) {
    case "home":
      // A daemon with nothing enabled sends Home to the wizard; a finished backfill is announced
      // above the cards (both features/onboarding, issue #79).
      return (
        <>
          <EmptyMachineRedirect repos={repos} />
          <BackfillBanner />
          <HomeView repos={repos} />
        </>
      );
    case "onboarding":
      return <OnboardingView />;
    case "machine":
      return route.view === "needs" ? <AllNeedsView /> : <AllJobsView />;
    case "legacy":
      return <LegacyRedirect route={route} repos={repos} />;
    case "repo":
      return <RepoScreen route={route} source={source} />;
  }
}

function RepoScreen({ route, source }: { route: Extract<Route, { kind: "repo" }>; source: AppSource }) {
  // One scoped source per repo id, so a view's `useSource()` identity is stable across renders
  // and its subscriptions are not torn down on every hash change within the repo.
  const scoped = useMemo(() => source.forRepo(route.repo), [source, route.repo]);
  const View = REPO_VIEWS[route.view];
  return (
    <RepoIdProvider id={route.repo}>
      <SourceProvider source={scoped}>
        <View />
      </SourceProvider>
    </RepoIdProvider>
  );
}

/**
 * A P2 `#/ledger`-style hash: sent to the first repo's version of the view once the repo list is
 * in, or Home when there is none (daemon-and-api.md §Wizard routes). `replaceHash` so the old
 * route is not left behind the back button.
 */
function LegacyRedirect({ route, repos }: { route: Extract<Route, { kind: "legacy" }>; repos: Async<Repo[]> }) {
  const first = repos.state === "ready" ? (repos.value[0]?.id ?? null) : undefined;

  useEffect(() => {
    if (first === undefined) return;
    replaceHash(first === null ? HOME_HREF : legacyTarget(route, first));
  }, [route, first]);

  if (repos.state === "error") {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Could not list projects: {repos.message}
      </p>
    );
  }
  return (
    <p role="status" className="p-4 text-sm text-muted-foreground">
      Loading…
    </p>
  );
}
