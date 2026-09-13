import { Module, ModuleFoot, ModuleHead, MODULE_LINK, ModuleTitle } from "../../components/ui/module.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { useRepoId, useSource } from "../../lib/source-context.js";
import { RepairSheet } from "../jobs/repair-sheet.js";
import { detailHref } from "./detail-route.js";
import { formatClock, formatDayMonth } from "./format.js";
import { checkpointLabel, recap, type RecapPoint } from "./recap.js";

/** How many recap points the module has room for (Ledger frame `7:103`). */
export const ASIDE_POINTS = 4;

/**
 * The module's title: the goal up to its first `: ` or ` — `, which is where a goal written as
 * "what: how" stops naming the work and starts describing it. The whole goal when it has neither.
 */
export function shortGoal(goal: string): string {
  const cuts = [goal.indexOf(": "), goal.indexOf(" — ")].filter((at) => at > 0);
  return cuts.length === 0 ? goal : goal.slice(0, Math.min(...cuts));
}

/**
 * A session the recovery queue has something to offer: its harness died before it checkpointed,
 * or a previous scan already flagged it. `repaired` is deliberately absent — that one is done.
 */
export function needsRepair(session: ParsedSession): boolean {
  return session.frontmatter.status === "crashed" || session.frontmatter.needs_repair;
}

function dotColour(verified: RecapPoint["verified"]): string {
  if (verified === "tests-passed") return "bg-success";
  if (verified === "tests-failed") return "bg-destructive";
  return "bg-subtle-foreground";
}

/**
 * "Selected session" — the Ledger's right-column module (frame `7:98`): who ran the selected
 * session and when, the first few recap points with their evidence, and the way into the session.
 *
 * The recap is {@link recap}, the same derivation the Session view uses, so the two never
 * disagree. A point groups by commit, so its evidence names at most one; a point with none says so.
 */
export function LedgerAside({ session }: { session: ParsedSession }) {
  const repo = useRepoId();
  const source = useSource();
  const { frontmatter } = session;
  const goal = session.goal ?? "No goal recorded";
  const points = recap(session.done).slice(0, ASIDE_POINTS);
  const href = detailHref(repo, frontmatter.id);

  return (
    <Module aria-label="Selected session">
      <ModuleHead>
        <ModuleTitle>{shortGoal(goal)}</ModuleTitle>
        <p className="text-xs leading-tight text-subtle-foreground">
          {frontmatter.author.name} · {frontmatter.harness} · {formatDayMonth(frontmatter.started)}{" "}
          {formatClock(frontmatter.started)} UTC
        </p>
      </ModuleHead>
      <div className="flex min-w-0 flex-col gap-2 border-t border-hairline px-4 py-3">
        <p className="text-xs font-medium leading-tight text-muted-foreground">What happened</p>
        {points.length === 0 ? (
          <p className="text-base leading-body tracking-body text-subtle-foreground">No outcomes recorded yet.</p>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {points.map((point) => (
              <li key={point.key} className="flex min-w-0 items-start gap-2.5 py-1.5">
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColour(point.verified)}`} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="break-words text-base leading-body tracking-body text-foreground">
                    {point.lines[0]!.text}
                  </span>
                  <span className="break-words font-mono text-xs leading-tight text-subtle-foreground">
                    {checkpointLabel(point.checkpoints)} · {point.commit ?? "no commit"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ModuleFoot>
        <a className={MODULE_LINK} href={href}>
          Open the session
        </a>
        <span className="shrink-0 whitespace-nowrap text-xs leading-tight text-subtle-foreground">
          {session.remaining.length} left open
        </span>
      </ModuleFoot>
      {source.capabilities.write && needsRepair(session) ? (
        <div className="flex min-w-0 items-center border-t border-hairline px-4 pb-3.5 pt-3">
          <RepairSheet session={frontmatter.id} label="Repair session…" />
        </div>
      ) : null}
    </Module>
  );
}
