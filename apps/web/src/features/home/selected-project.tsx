import { useEffect, useMemo, useState } from "react";

import { Badge } from "../../components/ui/badge.js";
import {
  MODULE_LINK,
  Module,
  ModuleFoot,
  ModuleHead,
  ModuleSection,
  ModuleTitle,
} from "../../components/ui/module.js";
import type { AppSource, LedgerSource, Repo } from "../../lib/ledger-source.js";
import { repoHref } from "../../lib/router.js";
import { HealthBadge } from "./repo-card.js";
import { formatAgo, plural } from "./format.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** What the module reads from the project's own ledger, beyond the counts its repo row carries. */
interface Details {
  /** `n` of the newest checkpoint of the most recently active session, or `null` when none. */
  checkpoint: number | null;
  /** Outcomes recorded by the sessions that started this week. */
  outcomes: number;
  /** Backlog items still `proposed` — the ones an agent is waiting on a person to triage. */
  proposed: number;
}

/**
 * Reads a project's module details from its scoped source, again on any event for that project.
 * A failure leaves the counts the repo row already carries on screen and drops only these.
 */
function useDetails(source: LedgerSource, now: number): Details | null {
  const [details, setDetails] = useState<Details | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => source.subscribe(() => setNonce((n) => n + 1)), [source]);

  useEffect(() => {
    let live = true;
    setDetails(null);
    const since = new Date(now - WEEK_MS).toISOString();
    Promise.all([
      source.listSessions({ limit: 1000 }),
      source.listBacklog({ status: ["proposed"] }),
    ]).then(
      ([sessions, proposed]) => {
        if (!live) return;
        let newest: { at: string; n: number } | null = null;
        let outcomes = 0;
        for (const session of sessions) {
          const last = session.frontmatter.checkpoints.at(-1);
          if (last !== undefined && (newest === null || last.at > newest.at)) newest = { at: last.at, n: last.n };
          if (session.frontmatter.started >= since) outcomes += session.done.length;
        }
        setDetails({ checkpoint: newest?.n ?? null, outcomes, proposed: proposed.length });
      },
      () => {
        if (live) setDetails(null);
      },
    );
    return () => {
      live = false;
    };
    // `now` is deliberately not a dependency: it is read once per selection or event, and a
    // ticking clock must not re-read the ledger.
  }, [source, nonce]);

  return details;
}

/**
 * Home's right column (frame node `11:140`): the selected project's host, health and harnesses,
 * when it last checkpointed, what this week added up to, and what is waiting on the operator — then
 * the way into its Ledger and its session brief.
 */
export function SelectedProject({ repo, source, now }: { repo: Repo; source: AppSource; now: number }) {
  const scoped = useMemo(() => source.forRepo(repo.id), [source, repo.id]);
  const details = useDetails(scoped, now);
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [repo.id]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyBrief = () => {
    scoped.brief().then(
      (brief) => navigator.clipboard?.writeText(brief).then(() => setCopied(true)),
      () => setCopied(false),
    );
  };

  const host = repo.remote?.webBase.replace(/^[a-z]+:\/\//i, "") ?? null;

  return (
    <Module aria-label={`Selected project: ${repo.name}`}>
      <ModuleHead>
        <ModuleTitle>{repo.name}</ModuleTitle>
        {host === null ? null : (
          <p className="break-all font-mono text-xs leading-tight text-subtle-foreground">{host}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <HealthBadge health={repo.health} />
          {repo.harnesses.map((harness) => (
            <Badge key={harness} variant="secondary">
              {harness}
            </Badge>
          ))}
        </div>
      </ModuleHead>
      <ModuleSection label="Last activity">
        {formatAgo(repo.lastHookAt, now)}
        {details?.checkpoint == null ? "" : ` · checkpoint ${String(details.checkpoint)}`}
      </ModuleSection>
      <ModuleSection label="This week">
        {plural(repo.sessions7d, "session")}
        {details === null ? "" : ` · ${plural(details.outcomes, "outcome")}`}
      </ModuleSection>
      <ModuleSection label="Waiting on you">
        {plural(repo.openNotes, "answer")}
        {details === null ? "" : ` · ${plural(details.proposed, "proposed item")}`}
      </ModuleSection>
      <ModuleFoot>
        <a href={repoHref(repo.id, "ledger")} className={MODULE_LINK}>
          Open the ledger
        </a>
        <button
          type="button"
          onClick={copyBrief}
          className="shrink-0 rounded-sm text-xs leading-tight text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? "copied" : "copy brief"}
        </button>
      </ModuleFoot>
    </Module>
  );
}
