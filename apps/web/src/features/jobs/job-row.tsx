import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader } from "../../components/ui/card.js";
import { detailHref } from "../ledger/detail-route.js";
import { canCancel, canRetry, elapsed, formatWhen, shortId, statusVariant } from "./format.js";

import type { Job } from "../../lib/ledger-source.js";

/**
 * One `jobs` row: what it is, what it is doing, to which session, and what went wrong.
 *
 * Every field the contract's row carries that a human can act on is on screen — status, kind,
 * session, attempts, the three timestamps and the error — because the reason this view exists is
 * that a repair that failed at 3am must be legible at 9am without opening the index.
 *
 * The session is a link into the Ledger rather than 26 characters of ULID as text: the job is only
 * interesting next to the session it is repairing.
 */
export function JobRow({
  job,
  now,
  pending,
  error,
  onCancel,
  onRetry,
  canWrite,
}: {
  job: Job;
  now: number;
  pending: boolean;
  error: string | undefined;
  onCancel: () => void;
  onRetry: () => void;
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
          </div>
          <a
            href={detailHref(job.session_ulid)}
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
