import { useId, useState } from "react";

import { Module, ModuleHead, ModuleTitle } from "../../components/ui/module.js";
import { cn } from "../../lib/cn.js";
import type { Line as DoneLine, ParsedSession } from "../../lib/ledger-source.js";
import { useSource } from "../../lib/source-context.js";
import { ExcerptSpan } from "./excerpt-viewer.js";
import { cpMarker, formatClock, formatCount, formatDayMonth } from "./format.js";
import { OutcomeFields, outcomeContext } from "./session-outcome.js";

/**
 * The promise this module makes about the transcript, verbatim in one place so it cannot drift
 * between the empty state and the populated one.
 */
export const TRANSCRIPT_NOTICE =
  "Transcript spans are read from this machine on demand and never enter the repo; tool inputs and outputs are counted, never shown.";

/** What a source without transcript access says instead of offering a span. */
export const NO_PROVENANCE = "This source cannot read transcripts, so there is no span to show.";

/**
 * The Session frame's right-column module (`plans/feature-p9-figma-screens.md` §Session): where
 * every line on the page came from. One row per checkpoint, carrying the frozen `Checkpoint`
 * schema's `at`, `turns`, `transcript_offset` and `trigger`, plus the commit that checkpoint's
 * outcomes recorded; on a source that can read transcripts the row is a disclosure control over
 * the span itself (design spec §8, p3/api.md §excerpt).
 *
 * The span for checkpoint `n` is `[offset(n-1), offset(n))`, so the offsets are shown as the byte
 * range they delimit and the excerpt re-states the same range against what it actually read.
 *
 * `selected` is the outcome opened on the page while the module is docked: its evidence sits at
 * the module's foot rather than in a panel of its own.
 */
export function ProvenanceModule({ session, selected }: { session: ParsedSession; selected: DoneLine | null }) {
  const { checkpoints, id } = session.frontmatter;
  const provenance = useSource().capabilities.provenance;

  return (
    <Module aria-labelledby="provenance-heading">
      <ModuleHead className="gap-1">
        <ModuleTitle id="provenance-heading">Provenance</ModuleTitle>
        <p className="text-xs leading-tight text-subtle-foreground">Exactly what was done, and where it is recorded.</p>
      </ModuleHead>

      {checkpoints.length === 0 ? (
        <p className="border-t border-hairline px-4 py-2.5 text-xs leading-tight text-muted-foreground">
          No checkpoints recorded for this session yet.
        </p>
      ) : (
        <ul aria-label="Checkpoints, oldest first" className="flex flex-col">
          {checkpoints.map((checkpoint, index) => (
            <CheckpointRow
              key={checkpoint.n}
              ulid={id}
              n={checkpoint.n}
              at={checkpoint.at}
              turns={checkpoint.turns}
              trigger={checkpoint.trigger}
              from={checkpoints[index - 1]?.transcript_offset ?? 0}
              to={checkpoint.transcript_offset}
              // The newest commit this checkpoint's outcomes recorded; `done` is newest first.
              commit={session.done.find((line) => line.cp === checkpoint.n && line.commit)?.commit ?? null}
              expandable={provenance}
            />
          ))}
        </ul>
      )}

      {selected === null ? null : (
        <div
          aria-labelledby="selected-outcome-heading"
          role="region"
          className="flex min-w-0 flex-col gap-2.5 border-t border-hairline bg-muted px-4 pb-4 pt-3.5"
        >
          <p className="text-xs font-medium leading-tight text-subtle-foreground">Selected outcome</p>
          <h3
            id="selected-outcome-heading"
            className="break-words text-base font-semibold leading-body tracking-body text-foreground"
          >
            {selected.text}
          </h3>
          <OutcomeFields line={selected} context={outcomeContext(session)} />
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-hairline px-4 py-2.5 text-xs leading-tight text-subtle-foreground">
        {provenance ? null : <p>{NO_PROVENANCE}</p>}
        <p>{TRANSCRIPT_NOTICE}</p>
      </div>
    </Module>
  );
}

function CheckpointRow({
  ulid,
  n,
  at,
  turns,
  trigger,
  from,
  to,
  commit,
  expandable,
}: {
  ulid: string;
  n: number;
  at: string;
  turns: number;
  trigger: string;
  from: number;
  to: number;
  commit: string | null;
  expandable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const spanId = useId();

  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-accent-foreground">{cpMarker(n)}</span>
        <span className="min-w-0 flex-1 text-muted-foreground">
          {formatDayMonth(at)} {formatClock(at)} UTC
        </span>
        {commit === null ? (
          <span className="shrink-0 font-mono text-subtle-foreground">—</span>
        ) : (
          <span className="shrink-0 font-mono text-foreground">{commit}</span>
        )}
      </span>
      <span className="block text-subtle-foreground">
        {formatCount(turns)} {turns === 1 ? "turn" : "turns"} · {trigger} · transcript {formatCount(from)} –{" "}
        {formatCount(to)} B
      </span>
    </>
  );

  const row = "flex w-full min-w-0 flex-col gap-0.75 px-4 py-2.5 text-left text-xs leading-tight";

  if (!expandable) {
    return (
      <li className="border-t border-hairline">
        <div className={row}>{content}</div>
      </li>
    );
  }

  return (
    <li className="border-t border-hairline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={spanId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className={cn(
          row,
          "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        {content}
        <span className="sr-only">{open ? ", hide transcript span" : ", show transcript span"}</span>
      </button>
      <div id={spanId} hidden={!open} className="px-4 pb-3">
        {open ? <ExcerptSpan ulid={ulid} cp={n} /> : null}
      </div>
    </li>
  );
}
