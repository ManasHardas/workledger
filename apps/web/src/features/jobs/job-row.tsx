import { useCallback, useState } from "react";
import type { SyntheticEvent } from "react";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader } from "../../components/ui/card.js";
import { messageOf } from "../../lib/errors.js";
import { repoHref } from "../../lib/router.js";
import { detailHref } from "../ledger/detail-route.js";
import { canCancel, canRetry, elapsed, formatWhen, shortId, statusVariant } from "./format.js";

import type { Job, Repo } from "../../lib/ledger-source.js";

/**
 * One `jobs` row: what it is, what it is doing, to which session, and what went wrong.
 *
 * Every field the contract's row carries that a human can act on is on screen — status, kind,
 * session, attempts, the three timestamps and the error — because the reason this view exists is
 * that a repair that failed at 3am must be legible at 9am without opening the index.
 *
 * The session is a link into the Ledger rather than 26 characters of ULID as text: the job is only
 * interesting next to the session it is repairing. `repoId` is the repo that link lives under;
 * `repo`, when given, is the machine-wide tab's repo column (P8) and links to that repo's queue.
 *
 * A job with a `log_path` gets a collapsed "Log" section (#97): the resumed session's own output,
 * read through `readLog` only when opened — it is the one record of why a resume that exited 0
 * recorded nothing, and the parent supplies the read so the machine-wide tab can scope it to the
 * row's repo.
 */
export function JobRow({
  job,
  repoId,
  repo,
  now,
  pending,
  error,
  onCancel,
  onRetry,
  readLog,
  canWrite,
}: {
  job: Job;
  repoId: string;
  repo?: Repo;
  now: number;
  pending: boolean;
  error: string | undefined;
  onCancel: () => void;
  onRetry: () => void;
  readLog: () => Promise<string>;
  canWrite: boolean;
}) {
  return (
    <li aria-label={`${job.kind} ${shortId(job.id)}`}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
            <Badge variant="secondary">{job.kind}</Badge>
            {job.attempts > 1 ? (
              <Badge variant="outline">{`${String(job.attempts)} attempts`}</Badge>
            ) : null}
            <span className="font-mono text-xs text-muted-foreground">{shortId(job.id)}</span>
            {repo === undefined ? null : (
              <a
                href={repoHref(repo.id, "jobs")}
                aria-label={`${repo.name} — Jobs`}
                className="rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {repo.name}
              </a>
            )}
          </div>
          <a
            href={detailHref(repoId, job.session_ulid)}
            className="w-fit rounded-sm font-mono text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {job.session_ulid}
          </a>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
            <Field label="created" value={formatWhen(job.created_at)} />
            <Field label="started" value={formatWhen(job.started_at)} />
            <Field label="finished" value={formatWhen(job.finished_at)} />
            <Field label="elapsed" value={elapsed(job, now)} />
          </dl>

          {job.error === null || job.error === "" ? null : (
            <p className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs text-destructive">
              {job.error}
            </p>
          )}

          {error === undefined ? null : (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          {job.log_path === null ? null : <JobLog readLog={readLog} />}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite || pending || !canCancel(job.status)}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite || pending || !canRetry(job.status)}
              onClick={onRetry}
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 font-mono">{value}</dd>
    </div>
  );
}

/** The collapsed log, read on the first open and re-read on every open after. */
function JobLog({ readLog }: { readLog: () => Promise<string> }) {
  const [result, setResult] = useState<
    { state: "idle" } | { state: "loading" } | { state: "error"; message: string } | { state: "ready"; text: string }
  >({ state: "idle" });

  const onToggle = useCallback(
    (event: SyntheticEvent<HTMLDetailsElement>) => {
      if (!event.currentTarget.open) return;
      setResult({ state: "loading" });
      readLog().then(
        (text) => setResult({ state: "ready", text }),
        (error: unknown) => setResult({ state: "error", message: messageOf(error) }),
      );
    },
    [readLog],
  );

  return (
    <details className="text-xs" onToggle={onToggle}>
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Log</summary>
      {result.state === "loading" ? (
        <p role="status" className="mt-1 text-muted-foreground">
          Loading…
        </p>
      ) : result.state === "error" ? (
        <p role="alert" className="mt-1 text-destructive">
          Could not read the log: {result.message}
        </p>
      ) : result.state === "ready" ? (
        <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono">
          {result.text === "" ? "(empty)" : result.text}
        </pre>
      ) : null}
    </details>
  );
}
