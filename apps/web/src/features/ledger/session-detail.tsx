import { useState, type ReactNode } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { Aside, useAsideDocked } from "../../components/aside.js";
import { Badge } from "../../components/ui/badge.js";
import { PageBody, PageHeader, PageSection } from "../../components/ui/page.js";
import { Panel } from "../../components/ui/panel.js";
import { cn } from "../../lib/cn.js";
import type { Line as DoneLine, NoteLine, ParsedSession } from "../../lib/ledger-source.js";
import { useRepoId, useSource } from "../../lib/source-context.js";
import { RepairSheet } from "../jobs/repair-sheet.js";
import { ledgerListHref } from "./detail-route.js";
import { cpMarker, formatDayMonth, formatInstant, sessionSpan } from "./format.js";
import { useLiveSession } from "./live.js";
import { ProvenanceModule } from "./provenance-panel.js";
import { checkpointLabel, recap, type RecapPoint } from "./recap.js";
import { OutcomeFields, outcomeContext, type OutcomeContext } from "./session-outcome.js";

/**
 * One session, as the Session frame draws it (`plans/feature-p9-figma-screens.md` §Session): the
 * goal and what the session was, a recap of what happened grouped by evidence, what it left open,
 * and — in the right column — the Provenance module that says where each of those came from.
 *
 * What the frame omits stays reachable below it, in the same style (operator decision 1): notes,
 * memory, lines the parser kept verbatim, where the session ran, and Repair.
 *
 * Amendment 11 (docs/contracts/p8/daemon-and-api.md): the page is for the human. An outcome shows
 * its gist and nothing else; its detail, files, commit and verification wait until it is opened —
 * in the Provenance module when the right column is on screen, in a floating panel when it is not.
 * Discovery notes are written for the next agent, so they sit behind a disclosure.
 */
export function SessionDetail({ ulid }: { ulid: string }) {
  const session = useLiveSession(ulid);
  const repo = useRepoId();

  return (
    <>
      <SessionHeader repo={repo} name={session.state === "ready" ? sessionRepoName(session.value) : null} />
      <PageBody rhythm="session">
        <AsyncPanel result={session} empty="This session is no longer in the ledger.">
          {(value) => <SessionBody session={value} />}
        </AsyncPanel>
      </PageBody>
    </>
  );
}

/** The Session header: a way back to the Ledger, then the repo the session belongs to. */
export function SessionHeader({ repo, name }: { repo: string; name: string | null }) {
  return (
    <PageHeader>
      <a
        href={ledgerListHref(repo)}
        className="shrink-0 whitespace-nowrap rounded-sm text-base leading-body tracking-body text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Ledger
      </a>
      <p className="min-w-0 flex-1 truncate text-base font-medium leading-body tracking-body text-foreground">
        {name ?? ""}
      </p>
    </PageHeader>
  );
}

/** The last path segment: a session is about `card-shopify_store`, not about a whole absolute path. */
function lastSegment(path: string): string {
  return path.split("/").filter((part) => part !== "").at(-1) ?? path;
}

/** The repo's short name: its local root when the daemon sent one, else the frontmatter's `host/path`. */
function sessionRepoName(session: ParsedSession): string {
  return lastSegment(session.repoPath ?? session.frontmatter.repo);
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** The note types a person reads by default; everything else is `For agents`. */
const HUMAN_NOTE_TYPES: ReadonlySet<NoteLine["type"]> = new Set(["blocker", "question", "decision"]);

const STATUS_VARIANT = {
  open: "default",
  ended: "secondary",
  crashed: "destructive",
  repaired: "warning",
} as const;

/** How many recap points show before "Show all". */
const FIRST_POINTS = 4;

const BODY = "text-base leading-body tracking-body";
const META = "text-xs leading-tight text-subtle-foreground";
const LINK =
  "rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function SessionBody({ session }: { session: ParsedSession }) {
  const source = useSource();
  const docked = useAsideDocked();
  /** The outcome that is open, by position — two outcomes may share a gist. */
  const [openDone, setOpenDone] = useState<number | null>(null);
  const opened = openDone === null ? null : (session.done[openDone] ?? null);
  const open = (line: DoneLine) => setOpenDone(session.done.indexOf(line));

  const memory = session.memory ?? [];
  const humanNotes = session.notes.filter((line) => HUMAN_NOTE_TYPES.has(line.type));
  const agentNotes = session.notes.filter((line) => !HUMAN_NOTE_TYPES.has(line.type));
  // Derived at render, never stored: the outcomes already carry the evidence that groups them.
  const points = recap(session.done);

  return (
    <>
      <Goal session={session} />

      <PageSection
        id="what-happened"
        title="What happened"
        aside={
          session.done.length === 0
            ? undefined
            : `${plural(session.done.length, "outcome", "outcomes")}, grouped by evidence`
        }
        className="gap-3.5"
      >
        {session.done.length === 0 ? (
          <Empty>Nothing recorded as done yet.</Empty>
        ) : (
          <Recap points={points} total={session.done.length} onOpen={open} opensPanel={!docked} />
        )}
      </PageSection>

      <PageSection id="left-open" title="Left open">
        {session.remaining.length === 0 ? (
          <Empty>Nothing left open.</Empty>
        ) : (
          <ul className="flex flex-col">
            {session.remaining.map((line, index) => (
              <li key={`${String(line.cp)}-${String(index)}`} className="flex items-center gap-2.5 py-1.5">
                <span className={cn(BODY, "min-w-0 flex-1 break-words text-foreground")}>{line.text}</span>
                <span title={line.ref} className="shrink-0 whitespace-nowrap font-mono text-xs leading-tight text-subtle-foreground">
                  {shortRef(line.ref)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      {/* Below the frame (operator decision 1): what it omits, in the same style. */}
      <PageSection id="notes" title="Notes">
        {session.notes.length === 0 ? (
          <Empty>No notes on this session.</Empty>
        ) : (
          <div className="flex flex-col gap-2.5">
            {humanNotes.length === 0 ? (
              <Empty>Nothing here needs a person.</Empty>
            ) : (
              <Notes notes={humanNotes} />
            )}
            {agentNotes.length > 0 ? <ForAgents notes={agentNotes} /> : null}
          </div>
        )}
      </PageSection>

      {memory.length > 0 ? (
        <PageSection id="memory" title="Memory" aside="Facts this session committed to a memory file">
          <ul className="flex flex-col">
            {memory.map((entry, index) => (
              <li key={index} className="flex items-center gap-2.5 py-1.5">
                <span className={cn(BODY, "min-w-0 flex-1 break-words text-foreground")}>{entry.text}</span>
                {entry.file ? (
                  <span className="shrink-0 font-mono text-xs leading-tight text-subtle-foreground">{entry.file}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      {session.unparsed.length > 0 ? (
        <PageSection id="unparsed" title="Unparsed">
          <p className={META}>
            Lines the parser did not recognise. They are kept verbatim and re-emitted on the next write, so a hand
            edit is never deleted.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-hairline bg-card p-3 font-mono text-xs leading-tight text-muted-foreground">
            {session.unparsed.map((line) => `${line.section}: ${line.line}`).join("\n")}
          </pre>
        </PageSection>
      ) : null}

      {/*
        Two facts the ledger keeps apart (P8 amendment 10): where the harness was launched, which
        only says where the transcript lives, and which repos the session is about, which is why it
        is in this ledger. Older sessions recorded neither. `break-all`: both are absolute paths,
        which have no space to wrap at.
      */}
      {session.startedIn !== null || session.about.length > 0 ? (
        <PageSection id="where-it-ran" title="Where it ran">
          <p className={cn(META, "break-all")}>
            {[
              ...(session.startedIn === null ? [] : [`This session started in ${session.startedIn}`]),
              ...(session.about.length === 0
                ? []
                : [`${session.startedIn === null ? "This session is about" : "about"} ${session.about.map(lastSegment).join(", ")}`]),
            ].join(" · ")}
          </p>
        </PageSection>
      ) : null}

      {/*
        Repair is a write, so it is absent — not disabled — on a source that cannot write: a Dome
        card has no queue to put the job in, and a control that could only ever refuse is worse than
        no control (design spec §14.2).
      */}
      {source.capabilities.write ? (
        <PageSection id="repair" title="Repair">
          <div className="flex flex-wrap items-center gap-3">
            <p className={cn(META, "min-w-0 flex-1")}>
              Resume the session headlessly and ask it for a checkpoint.
            </p>
            <RepairSheet session={session.frontmatter.id} />
          </div>
        </PageSection>
      ) : null}

      <Aside narrow="inline">
        <ProvenanceModule session={session} selected={docked ? opened : null} />
      </Aside>

      {docked ? null : (
        <OutcomePanel
          line={opened}
          checkpointAt={opened ? session.frontmatter.checkpoints.find((c) => c.n === opened.cp)?.at : undefined}
          context={outcomeContext(session)}
          onClose={() => setOpenDone(null)}
        />
      )}
    </>
  );
}

/**
 * `WL-01M29EKZ…`, as the frame prints it: the prefix and the ULID's first eight characters — its
 * millisecond timestamp, enough to tell two items apart at a glance. The full ref is the title.
 */
const REF_CHARS = 11;
function shortRef(ref: string): string {
  return ref.length > REF_CHARS ? `${ref.slice(0, REF_CHARS)}…` : ref;
}

/**
 * The goal, then what the session was: its status, its harness, who ran it, when and for how
 * long, and how many checkpoints it recorded — including any stamped after it ended, which a
 * repair or a late hook writes and a reader should not mistake for the session still running.
 *
 * The goal carries no `[cp n]` marker: the wire's `goal` is the single current string (api.md
 * §Read models), not the list of lines core parses, so there is no checkpoint to attribute it to.
 */
function Goal({ session }: { session: ParsedSession }) {
  const { frontmatter } = session;
  const { checkpoints, ended } = frontmatter;
  const span = sessionSpan(frontmatter);
  const late = ended ? checkpoints.filter((checkpoint) => Date.parse(checkpoint.at) > Date.parse(ended)).length : 0;

  // `span.clocks` is the start alone when there is no end, or the end falls on another UTC day.
  const when = `${formatDayMonth(frontmatter.started)} ${span.clocks} UTC`;
  const meta = [
    frontmatter.author.name,
    when,
    ...(span.end === null ? [] : [span.duration]),
    `${plural(checkpoints.length, "checkpoint", "checkpoints")}${late > 0 ? `, ${String(late)} recorded after it ended` : ""}`,
  ].join(" · ");

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <h1 className="break-words text-xl font-semibold leading-title tracking-title text-foreground">
        {session.goal ?? "No goal recorded."}
      </h1>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[frontmatter.status]}>{frontmatter.status}</Badge>
        <Badge variant="secondary">{frontmatter.harness}</Badge>
        <p className={cn(META, "min-w-0")}>{meta}</p>
      </div>
    </div>
  );
}

/**
 * The recap: the first four points, each headed by its newest outcome's gist over the mono
 * evidence line (operator decision 4: no summary line). "Show all" reveals every point and, under
 * each, the rest of its outcomes; every gist, headline or not, opens that outcome. The recap
 * summarises; it does not replace what it summarises (rule 3: evidence is never inline).
 */
function Recap({
  points,
  total,
  onOpen,
  opensPanel,
}: {
  points: RecapPoint[];
  total: number;
  onOpen: (line: DoneLine) => void;
  opensPanel: boolean;
}) {
  const [all, setAll] = useState(false);
  // Something is hidden when there are more points than show, or a point holds more than its headline.
  const folded = points.length > FIRST_POINTS || total > points.length;
  const shown = all ? points : points.slice(0, FIRST_POINTS);

  return (
    <>
      <ul className="flex flex-col gap-3.5">
        {shown.map((point) => (
          <RecapCard key={point.key} point={point} expanded={all} onOpen={onOpen} opensPanel={opensPanel} />
        ))}
      </ul>
      {folded ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((prior) => !prior)}
          className={cn(LINK, BODY, "w-fit text-primary hover:underline")}
        >
          {all ? "Show fewer" : `Show all ${plural(total, "outcome", "outcomes")}`}
        </button>
      ) : null}
    </>
  );
}

function RecapCard({
  point,
  expanded,
  onOpen,
  opensPanel,
}: {
  point: RecapPoint;
  expanded: boolean;
  onOpen: (line: DoneLine) => void;
  opensPanel: boolean;
}) {
  const [headline, ...rest] = point.lines;
  if (headline === undefined) return null;

  const tone =
    point.verified === "tests-passed"
      ? "bg-success"
      : point.verified === "tests-failed"
        ? "bg-destructive"
        : "bg-subtle-foreground";
  const popup = opensPanel ? ({ "aria-haspopup": "dialog" } as const) : {};

  return (
    <li className="flex items-start gap-3.5 rounded-lg border border-hairline bg-card p-3">
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", tone)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          onClick={() => onOpen(headline)}
          {...popup}
          className={cn(LINK, BODY, "break-words font-semibold text-foreground hover:underline")}
        >
          {headline.text}
        </button>
        {expanded && rest.length > 0 ? (
          <ul className="flex flex-col">
            {rest.map((line, index) => (
              <li key={`${String(line.cp)}-${String(index)}`}>
                <button
                  type="button"
                  onClick={() => onOpen(line)}
                  {...popup}
                  className={cn(LINK, BODY, "break-words text-muted-foreground hover:text-foreground")}
                >
                  {line.text}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="break-words font-mono text-xs leading-tight text-subtle-foreground">
          {checkpointLabel(point.checkpoints)} · {point.commit ?? "no commit"} ·{" "}
          {plural(point.lines.length, "outcome", "outcomes")}
        </p>
      </div>
    </li>
  );
}

/**
 * The floating panel behind an outcome when the right column is not on screen
 * (`docs/design/direction.md` §Shell, rule 3 — "evidence is never inline").
 *
 * `components/ui/panel.tsx` underneath, so Escape closes it, focus moves into it on open and back
 * to the gist that opened it on close, and it is a non-modal floating panel on desktop and a modal
 * bottom sheet below 768 px. `line` is null when closed; the panel stays mounted so the trigger's
 * focus has somewhere to return to and so a second outcome *replaces* the contents.
 */
function OutcomePanel({
  line,
  checkpointAt,
  context,
  onClose,
}: {
  line: DoneLine | null;
  checkpointAt: string | undefined;
  context: OutcomeContext;
  onClose: () => void;
}) {
  return (
    <Panel
      open={line !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={line?.text ?? ""}
      description={
        line === null ? undefined : (
          <>
            <span className="font-mono">{cpMarker(line.cp)}</span>
            {checkpointAt ? <span className="tabular-nums">{formatInstant(checkpointAt)}</span> : null}
          </>
        )
      }
    >
      {line === null ? null : <OutcomeFields line={line} context={context} />}
    </Panel>
  );
}

/** Blocker, question and decision notes: the chip, the note, its reason, and its checkpoint. */
function Notes({ notes }: { notes: NoteLine[] }) {
  return (
    <ul className="flex flex-col">
      {notes.map((line, index) => (
        <li key={`${String(line.cp)}-${String(index)}`} className="flex items-start gap-2.5 py-1.5">
          <Badge variant={line.type === "blocker" ? "destructive" : line.type === "question" ? "accent" : "secondary"}>
            {line.type}
          </Badge>
          <span className="flex min-w-0 flex-1 flex-col gap-0.75">
            <span className={cn(BODY, "break-words text-foreground")}>{line.text}</span>
            {line.reason ? <span className={META}>{line.reason}</span> : null}
          </span>
          <span className="mt-0.5 shrink-0 font-mono text-xs leading-tight text-subtle-foreground">{cpMarker(line.cp)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Discovery notes, folded by default. A button with `aria-expanded` rather than `<details>`, so
 * the folded content is genuinely absent (not merely unrendered by the browser) and the label
 * carries the count either way.
 */
function ForAgents({ notes }: { notes: NoteLine[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(LINK, "w-fit text-xs font-medium leading-tight text-muted-foreground hover:text-foreground")}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> For agents ({notes.length})
      </button>
      {open ? <Notes notes={notes} /> : null}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={cn(BODY, "text-muted-foreground")}>{children}</p>;
}
