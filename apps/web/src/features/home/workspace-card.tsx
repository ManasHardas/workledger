import { useState } from "react";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { ListRow, RowMeta } from "../../components/ui/list-row.js";
import { messageOf } from "../../lib/errors.js";
import type { AppSource, InitResult, Workspace } from "../../lib/ledger-source.js";
import { announceReposChanged } from "./live.js";
import { formatRelative } from "./format.js";

/**
 * One folder from `GET /api/workspaces` (amendment 12) — Home's second group, as a row.
 *
 * Not a link, unlike {@link RepoCard}: a folder is not a repo, so it has no ledger to open. The
 * operator's rule is the whole point of the separation — "simply because transcripts are found in
 * a folder doesn't mean that folder is a repo and hence a project" — so the row states what is
 * actually known (hooks, sessions started here, when the last one was) and offers the one action
 * that changes anything: installing the workledger hooks into the folder, which is
 * `POST /api/onboarding/init` with `workspaces: [path]` and no repo.
 *
 * The nav lists these folders by name; this row is what the nav's link leads to, so it carries
 * what the nav cannot — the path, the recency, and the action.
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
    <ListRow aria-label={workspace.name}>
      {/* `basis-48` rather than a column below `sm`: see the note in `next/backlog-item.tsx` —
          `flex-col` plus `flex-wrap` wraps into a second column and grows the row sideways. */}
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
        {workspace.hooksInstalled ? (
          <Badge variant="outline" className="shrink-0 border-transparent bg-success text-success-foreground">
            hooks
          </Badge>
        ) : (
          <Badge variant="warning" className="shrink-0">
            no hooks
          </Badge>
        )}
        <span className="min-w-0 flex-1 truncate text-sm" title={workspace.path}>
          {workspace.name}
        </span>
        <span className="hidden min-w-0 shrink truncate font-mono text-xs text-subtle-foreground md:inline">
          {workspace.path}
        </span>
      </div>
      <RowMeta>{`${String(workspace.sessions)} sessions`}</RowMeta>
      <RowMeta>{`${String(workspace.repos.length)} tracked repos`}</RowMeta>
      <RowMeta className="hidden sm:inline">{formatRelative(workspace.lastSessionAt, now)}</RowMeta>
      {workspace.hooksInstalled ? null : (
        <InstallHooks path={workspace.path} source={source} onInstalled={onInstalled} />
      )}
    </ListRow>
  );
}

/**
 * A refusal `init` reports *inside* a 200, or `null` when the folder was hooked.
 *
 * `POST /api/onboarding/init` is a per-path batch: the transport succeeds and each row carries
 * its own `ok` and `error`. A folder that holds no tracked repo is refused exactly that way
 * ("… holds no tracked repo …") — and amendment 12 lists precisely such folders, so this is the
 * common case here, not the rare one. Reading only the promise would make the click a silent
 * no-op (#119 review). A response with no row for the folder is a refusal too: the daemon was
 * asked to hook it and said nothing about it.
 */
function refusalIn(result: InitResult, folder: string): string | null {
  const row = result.workspaces?.find((each) => each.path === folder);
  if (row === undefined) return "the daemon reported nothing for this folder";
  return row.ok ? null : (row.error ?? "the daemon refused without a reason");
}

/**
 * The action. `repos: []` with the folder in `workspaces` is amendment 12's relaxation: the repos
 * under it are already tracked, and `init` must never touch one the operator did not select.
 *
 * A quiet control, like every other per-row action (#134). It reports its own failure beside
 * itself rather than through the page's error panel — the rest of Home is still perfectly readable
 * when one folder cannot be hooked — and it stays enabled, because every refusal here is one the
 * operator can act on (add a repo under the folder, fix the permissions) and then retry.
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
      (result) => {
        setBusy(false);
        const refused = refusalIn(result, path);
        if (refused !== null) {
          setError(refused);
          return;
        }
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
    <>
      <Button variant="quiet" size="xs" disabled={busy} onClick={install}>
        {busy ? "Installing…" : "Install hooks"}
      </Button>
      {error === null ? null : (
        <p role="alert" className="basis-full text-xs text-destructive">
          Could not install hooks: {error}
        </p>
      )}
    </>
  );
}
