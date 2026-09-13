import { useEffect, useMemo, useState } from "react";

import { RowEmpty } from "../../components/ui/list-row.js";
import { PageSection, SectionHead } from "../../components/ui/page.js";
import { messageOf } from "../../lib/errors.js";
import type { Repo } from "../../lib/ledger-source.js";
import { RepoIdProvider, SourceProvider, useMachine } from "../../lib/source-context.js";
import type { Async } from "../../lib/use-async.js";
import { NextView } from "../next/next-view.js";

/** One repo, and how many items its agents proposed that are still waiting. */
export interface RepoProposals {
  repo: Repo;
  count: number;
}

/**
 * Every repo's waiting proposals — `forRepo(id).listBacklog({ status: ["proposed"] })` per repo,
 * since there is no machine-wide backlog read — re-read on any `backlog.changed`.
 *
 * A repo whose read fails counts as none rather than failing the whole page: one broken ledger
 * must not hide every other project's proposals. Only the repo list failing is an error.
 */
export function useMachineProposals(repos: Async<Repo[]>): Async<RepoProposals[]> {
  const machine = useMachine();
  const [result, setResult] = useState<Async<RepoProposals[]>>({ state: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    return machine.subscribe((event) => {
      if (event.type === "backlog.changed") setNonce((n) => n + 1);
    });
  }, [machine]);

  useEffect(() => {
    if (repos.state !== "ready") {
      setResult(repos.state === "error" ? { state: "error", message: repos.message } : { state: "loading" });
      return;
    }
    let live = true;
    Promise.all(
      repos.value.map(async (repo) => {
        const items = await machine
          .forRepo(repo.id)
          .listBacklog({ status: ["proposed"] })
          .catch(() => []);
        return { repo, count: items.filter((item) => item.frontmatter.status === "proposed").length };
      }),
    ).then(
      (value) => {
        if (live) setResult({ state: "ready", value });
      },
      (error: unknown) => {
        if (live) setResult({ state: "error", message: messageOf(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [machine, repos, nonce]);

  return result;
}

/**
 * "Proposed by agents" across every project: a sub-group per repo with anything waiting, headed by
 * the repo's name, holding that repo's own proposal cards.
 *
 * Each sub-group is the repo's Review list (`NextView only="proposed"`) under that repo's scoped
 * source, so Accept, the armed Discard and the panel write through `forRepo(id)` exactly as they
 * do on the repo's own page. Several lists share the page, so none takes the keyboard.
 */
export function MachineProposals({ proposals }: { proposals: Async<RepoProposals[]> }) {
  const waiting =
    proposals.state === "ready"
      ? proposals.value.filter((entry) => entry.count > 0).sort((a, b) => a.repo.name.localeCompare(b.repo.name))
      : [];
  const total = waiting.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <PageSection
      id="review-proposals-heading"
      title="Proposed by agents"
      aside={proposals.state === "ready" ? `${String(total)} waiting` : undefined}
    >
      {proposals.state === "loading" ? (
        <p role="status" className="px-3.5 py-2 text-base leading-body tracking-body text-muted-foreground">
          Loading…
        </p>
      ) : proposals.state === "error" ? (
        <p role="alert" className="px-3.5 py-2 text-base leading-body tracking-body text-destructive">
          Could not read the backlog: {proposals.message}
        </p>
      ) : waiting.length === 0 ? (
        <RowEmpty>Nothing an agent proposed is waiting in any project.</RowEmpty>
      ) : (
        <div className="flex min-w-0 flex-col gap-6.5">
          {waiting.map(({ repo, count }) => (
            <RepoProposalGroup key={repo.id} repo={repo} count={count} />
          ))}
        </div>
      )}
    </PageSection>
  );
}

function RepoProposalGroup({ repo, count }: RepoProposals) {
  const machine = useMachine();
  // One scoped source per repo, so the list's subscriptions survive a re-render of the page.
  const source = useMemo(() => machine.forRepo(repo.id), [machine, repo.id]);
  const headingId = `review-proposals-${repo.id}`;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5">
      <SectionHead id={headingId} title={repo.name} aside={`${String(count)} waiting`} />
      <RepoIdProvider id={repo.id}>
        <SourceProvider source={source}>
          <NextView only="proposed" keyboard={false} head={false} />
        </SourceProvider>
      </RepoIdProvider>
    </section>
  );
}
