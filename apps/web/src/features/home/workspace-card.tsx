import { useState } from "react";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import { messageOf } from "../../lib/errors.js";
import type { AppSource, Workspace } from "../../lib/ledger-source.js";
import { announceReposChanged } from "./live.js";
import { formatRelative } from "./format.js";

/**
 * One folder from `GET /api/workspaces` (amendment 12) — Home's second group.
 *
 * Not a link, unlike {@link RepoCard}: a folder is not a repo, so it has no ledger to open. The
 * operator's rule is the whole point of the separation — "simply because transcripts are found in
 * a folder doesn't mean that folder is a repo and hence a project" — so the card states what is
 * actually known (sessions started here, tracked repos under it, hooks) and offers the one action
 * that changes anything: installing the workledger hooks into the folder, which is
 * `POST /api/onboarding/init` with `workspaces: [path]` and no repo.
 */
export function WorkspaceCard({
  workspace,
  source,
  now,
  onInstalled,
}: {
  workspace: Workspace;
  source: AppSource;
  now: number;
  onInstalled: () => void;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {workspace.hooksInstalled ? (
            <Badge variant="outline" className="border-transparent bg-success text-success-foreground">
              hooks installed
            </Badge>
          ) : (
            <Badge variant="warning">no hooks</Badge>
          )}
          {workspace.registered ? <Badge variant="secondary">registered</Badge> : null}
        </div>
        <CardTitle>{workspace.name}</CardTitle>
        <CardDescription className="break-all font-mono">{workspace.path}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Stat label="sessions" value={String(workspace.sessions)} />
          <Stat label="last session" value={formatRelative(workspace.lastSessionAt, now)} />
          <Stat label="tracked repos" value={String(workspace.repos.length)} />
        </dl>
        {workspace.hooksInstalled ? null : (
          <InstallHooks path={workspace.path} source={source} onInstalled={onInstalled} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The action. `repos: []` with the folder in `workspaces` is amendment 12's relaxation: the repos
 * under it are already tracked, and `init` must never touch one the operator did not select.
 *
 * The button reports its own failure beside itself rather than through the page's error panel —
 * the rest of Home is still perfectly readable when one folder cannot be hooked.
 */
function InstallHooks({
  path,
  source,
  onInstalled,
}: {
  path: string;
  source: AppSource;
  onInstalled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = () => {
    setBusy(true);
    setError(null);
    source.initRepos({ repos: [], workspaces: [path] }).then(
      () => {
        setBusy(false);
        // The wizard's belt (#94): whoever else is listing folders or repos re-reads too.
        announceReposChanged();
        onInstalled();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(messageOf(failure));
      },
    );
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={install}>
        {busy ? "Installing…" : "Install hooks"}
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          Could not install hooks: {error}
        </p>
      )}
    </div>
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
