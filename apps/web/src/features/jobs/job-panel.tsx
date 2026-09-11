import { useCallback, useEffect, useState } from "react";

import { Panel } from "../../components/ui/panel.js";
import { messageOf } from "../../lib/errors.js";
import { detailHref } from "../ledger/detail-route.js";
import { elapsed, formatWhen, shortId, waitingSentence, waitingUntil } from "./format.js";

import type { Job } from "../../lib/ledger-source.js";

/**
 * The evidence behind a job row, in the right panel (`docs/design/direction.md` rule 3).
 *
 * Every field the contract's row carries that a human can act on is here — the three timestamps,
 * the elapsed span, the attempt count, the error and the resumed session's own log — because the
 * reason this view exists is that a repair that failed at 3am must be legible at 9am without
 * opening the index. None of it belongs in the list: an error is several lines of a shell's
 * output, and a log is a file.
 *
 * The session is a link into the Ledger rather than 26 characters of ULID as text: the job is only
 * interesting next to the session it is repairing. `repoId` is the repo that link lives under.
 *
 * `readLog` is supplied by the parent so the machine-wide tab can scope the read to the row's own
 * repo; it runs when the panel opens on a job that has a `log_path`, and again on every re-open.
 */
export function JobPanel({
  job,
  repoId,
  now,
  readLog,
  onClose,
}: {
  job: Job | null;
  repoId: string;
  now: number;
  readLog: () => Promise<string>;
  onClose: () => void;
}) {
  return (
    <Panel
      open={job !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={job === null ? "" : `${job.kind} ${shortId(job.id)}`}
      description={
        job === null ? undefined : (
          <>
            <span>{job.status}</span>
            <span className="font-mono">{job.id}</span>
          </>
        )
      }
    >
      {job === null ? null : <Body job={job} repoId={repoId} now={now} readLog={readLog} />}
    </Panel>
  );
}

function Body({
  job,
  repoId,
  now,
  readLog,
}: {
  job: Job;
  repoId: string;
  now: number;
  readLog: () => Promise<string>;
}) {
  const waitUntil = waitingUntil(job, now);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <Field label="Session">
        <a
          href={detailHref(repoId, job.session_ulid)}
          className="w-fit rounded-sm font-mono text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {job.session_ulid}
        </a>
      </Field>

      <Field label="Timing">
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-xs">
          <Row label="created" value={formatWhen(job.created_at)} />
          <Row label="started" value={formatWhen(job.started_at)} />
          <Row label="finished" value={formatWhen(job.finished_at)} />
          <Row label="elapsed" value={elapsed(job, now)} />
          <Row label="attempts" value={String(job.attempts)} />
        </dl>
      </Field>

      {waitUntil !== undefined ? (
        <p role="status" className="text-xs text-muted-foreground">
          {waitingSentence(waitUntil, now)}
        </p>
      ) : job.error === null || job.error === "" ? null : (
        <Field label="Error">
          <p className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs text-destructive">
            {job.error}
          </p>
        </Field>
      )}

      {job.log_path === null ? null : (
        <Field label="Log">
          <JobLog readLog={readLog} />
        </Field>
      )}
    </div>
  );
}

/** The resumed session's output, read when the panel opens and on every re-open after. */
function JobLog({ readLog }: { readLog: () => Promise<string> }) {
  const [result, setResult] = useState<
    { state: "loading" } | { state: "error"; message: string } | { state: "ready"; text: string }
  >({ state: "loading" });

  const read = useCallback(() => {
    let live = true;
    setResult({ state: "loading" });
    readLog().then(
      (text) => {
        if (live) setResult({ state: "ready", text });
      },
      (error: unknown) => {
        if (live) setResult({ state: "error", message: messageOf(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [readLog]);

  useEffect(read, [read]);

  if (result.state === "loading") {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (result.state === "error") {
    return (
      <p role="alert" className="text-xs text-destructive">
        Could not read the log: {result.message}
      </p>
    );
  }
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">
      {result.text === "" ? "(empty)" : result.text}
    </pre>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">{label}</p>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 font-mono tabular-nums">{value}</dd>
    </div>
  );
}
