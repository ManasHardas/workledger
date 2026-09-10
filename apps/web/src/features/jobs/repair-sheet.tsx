import { useCallback, useEffect, useState } from "react";

import { ActionSheet } from "../../components/ui/action-sheet.js";
import { Button } from "../../components/ui/button.js";
import { codeOf, detailOf } from "../../lib/errors.js";
import { useSource } from "../../lib/source-context.js";
import { explain } from "./backfill-sheet.js";
import { formatBytes, formatUsd } from "./format.js";
import { useAction } from "./use-jobs.js";

import type { ExtractEstimate } from "../../lib/ledger-source.js";

/** The 409 of p3/api.md: `extract` without `consent`, with the estimate riding on the refusal. */
export const CONSENT_REQUIRED = "consent-required";

/** `{ bytes, model, usd }` off an error body, or `undefined` when the build could not price it. */
export function estimateFrom(error: unknown): ExtractEstimate | undefined {
  const estimate = detailOf(error)?.["estimate"];
  if (typeof estimate !== "object" || estimate === null) return undefined;
  const { bytes, model, usd } = estimate as Partial<ExtractEstimate>;
  if (typeof bytes !== "number" || typeof model !== "string" || typeof usd !== "number") {
    return undefined;
  }
  return { bytes, model, usd };
}

/**
 * "Repair this session" — the resume path, and the extraction path behind an explicit consent.
 *
 * The order is the contract's, not a preference. A repair is a headless resume of the session
 * asking it for a digest (design D4/D5); that costs the operator nothing but time, so it is the
 * button. Extraction reads the transcript and pays an API model to summarise it, so it is never
 * what a click on "Repair" does — it is offered only after the resume has failed, or when the
 * operator asks for it, and only ever through this sheet.
 *
 * The consent step is two round-trips on purpose. The first asks with `consent: false` and is
 * *expected* to be refused: the refusal is what carries the estimate (p3/api.md), so the number in
 * front of the operator is the server's, computed against this session's real transcript, and not
 * a guess this component made. Only the second call, after a click on a button that names the
 * price, carries `consent: true`.
 */
export function RepairSheet({
  session,
  label = "Repair…",
  onQueued,
}: {
  session: string;
  label?: string;
  onQueued?: () => void;
}) {
  const source = useSource();
  const [open, setOpen] = useState(false);
  /** The estimate the 409 carried, once the operator has asked about extraction. */
  const [consent, setConsent] = useState<{ estimate: ExtractEstimate | undefined } | null>(null);

  const resume = useAction(useCallback(() => source.repair({ session }), [source, session]));
  const probe = useAction(
    useCallback(() => source.repair({ session, extract: true }), [source, session]),
  );
  const extract = useAction(
    useCallback(
      () => source.repair({ session, extract: true, consent: true }),
      [source, session],
    ),
  );

  const resumeReset = resume.reset;
  const probeReset = probe.reset;
  const extractReset = extract.reset;
  useEffect(() => {
    if (open) return;
    setConsent(null);
    resumeReset();
    probeReset();
    extractReset();
  }, [open, resumeReset, probeReset, extractReset]);

  // The probe's refusal is the success case: it is what carries the estimate. A probe that was
  // *not* refused means this server does not gate extraction, and the job it queued is real.
  useEffect(() => {
    if (probe.state.state === "failed" && codeOf(probe.state.error) === CONSENT_REQUIRED) {
      setConsent({ estimate: estimateFrom(probe.state.error) });
    }
  }, [probe.state]);

  const queued =
    resume.state.state === "done" ||
    extract.state.state === "done" ||
    (probe.state.state === "done" ? true : false);

  useEffect(() => {
    if (queued) onQueued?.();
  }, [queued, onQueued]);

  const resumeState = resume.state;
  const busy =
    resume.state.state === "running" ||
    probe.state.state === "running" ||
    extract.state.state === "running";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ActionSheet
        open={open}
        onOpenChange={setOpen}
        title="Repair this session"
        description={
          consent === null
            ? "A repair resumes the session headlessly and asks it for a checkpoint. It spends no tokens on an API model."
            : "Extraction reads the transcript on this machine and pays an API model to summarise it."
        }
        footer={footer()}
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-mono text-xs text-muted-foreground">{session}</p>

          {queued ? (
            <p role="status">Queued. The Jobs view follows it from here.</p>
          ) : consent !== null ? (
            <ConsentBody estimate={consent.estimate} />
          ) : resumeState.state === "failed" ? (
            <p role="alert" className="text-destructive">
              Resume is unavailable for this session: {explain(resumeState.error)}. Extraction from
              the transcript is the fallback, and it spends tokens.
            </p>
          ) : null}

          {extract.state.state === "failed" ? (
            <p role="alert" className="text-destructive">
              {explain(extract.state.error)}
            </p>
          ) : null}
          {probe.state.state === "failed" && codeOf(probe.state.error) !== CONSENT_REQUIRED ? (
            <p role="alert" className="text-destructive">
              {explain(probe.state.error)}
            </p>
          ) : null}
        </div>
      </ActionSheet>
    </>
  );

  function footer() {
    if (queued) return <Button onClick={() => setOpen(false)}>Close</Button>;
    if (consent !== null) {
      return (
        <>
          <Button variant="ghost" onClick={() => setConsent(null)}>
            Back
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => extract.run()}>
            {consent.estimate === undefined
              ? "Spend tokens and extract"
              : `Spend ~${formatUsd(consent.estimate.usd)} and extract`}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => probe.run()}>
          Extract from transcript…
        </Button>
        <Button disabled={busy} onClick={() => resume.run()}>
          {resume.state.state === "running" ? "Queueing…" : "Repair by resume"}
        </Button>
      </>
    );
  }
}

/** What the operator is agreeing to spend, in the server's numbers. */
function ConsentBody({ estimate }: { estimate: ExtractEstimate | undefined }) {
  if (estimate === undefined) {
    return (
      <p>
        This build could not price the extraction. It will still send the transcript span to the
        configured API model, and the key is read from <code>ANTHROPIC_API_KEY</code> and never
        stored.
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
      <Row label="transcript" value={formatBytes(estimate.bytes)} />
      <Row label="model" value={estimate.model} />
      <Row label="estimated cost" value={formatUsd(estimate.usd)} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 font-mono">{value}</dd>
    </div>
  );
}
