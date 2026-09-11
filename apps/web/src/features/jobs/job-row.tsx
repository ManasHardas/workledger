import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { ConfirmAction } from "../../components/ui/confirm.js";
import { ListRow, RowActions, RowMeta, RowTitle } from "../../components/ui/list-row.js";
import { repoHref } from "../../lib/router.js";
import { canCancel, canRetry, elapsed, shortId, statusVariant, waitingUntil } from "./format.js";

import type { Job, Repo } from "../../lib/ledger-source.js";

/**
 * One `jobs` row (`docs/design/direction.md` §Density): what it is, what it is doing, and how long
 * it has been at it.
 *
 * At most three chips, and each of them carries state and nothing else (rule 2): the status, the
 * kind, and — for a queued job whose `retry_after` is still ahead — that it is waiting for the
 * harness's usage window (#100). The attempt count is a number, so it sits with the other numbers
 * on the right rather than becoming a fourth chip.
 *
 * The three timestamps, the error, the resumed session's log and the link into the Ledger are the
 * evidence for the row, so they are in the right panel (rule 3, `job-panel.tsx`), which the
 * session id opens. Retry and Cancel stay on the row: they are what the operator does *to* the
 * queue, and cancelling loses work, so it is a quiet control whose confirming step is the only
 * place the destructive colour appears (#134).
 *
 * `repo`, when given, is the machine-wide tab's repo column (P8) and links to that repo's queue.
 */
export function JobRow({
  job,
  repo,
  now,
  selected,
  pending,
  error,
  onOpen,
  onCancel,
  onRetry,
  canWrite,
}: {
  job: Job;
  repo?: Repo;
  now: number;
  selected: boolean;
  pending: boolean;
  error: string | undefined;
  onOpen: () => void;
  onCancel: () => void;
  onRetry: () => void;
  canWrite: boolean;
}) {
  const waitUntil = waitingUntil(job, now);
  return (
    <ListRow selected={selected} aria-label={`${job.kind} ${shortId(job.id)}`}>
      <Badge variant={statusVariant(job.status)} className="shrink-0">
        {job.status}
      </Badge>
      <Badge variant="secondary" className="shrink-0">
        {job.kind}
      </Badge>
      {waitUntil === undefined ? null : (
        <Badge variant="outline" className="shrink-0">
          waiting
        </Badge>
      )}
      <RowTitle aria-haspopup="dialog" className="font-mono text-xs" onClick={onOpen}>
        {job.session_ulid}
      </RowTitle>
      {repo === undefined ? null : (
        <a
          href={repoHref(repo.id, "jobs")}
          aria-label={`${repo.name} — Jobs`}
          className="shrink-0 rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {repo.name}
        </a>
      )}
      {job.attempts > 1 ? <RowMeta>{`${String(job.attempts)} attempts`}</RowMeta> : null}
      <RowMeta>{elapsed(job, now)}</RowMeta>
      <RowActions>
        <Button
          variant="quiet"
          size="xs"
          disabled={!canWrite || pending || !canRetry(job.status)}
          onClick={onRetry}
        >
          Retry
        </Button>
        <ConfirmAction
          label="Cancel"
          confirmLabel="Confirm cancel"
          disabled={!canWrite || pending || !canCancel(job.status)}
          onConfirm={onCancel}
        />
      </RowActions>
      {error === undefined ? null : (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </ListRow>
  );
}
