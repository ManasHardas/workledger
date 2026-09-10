import { useCallback, useState } from "react";

import { AsyncPanel } from "../../../components/async-panel.js";
import { Button } from "../../../components/ui/button.js";
import { codeOf, messageOf } from "../../../lib/errors.js";
import type { AppSource, ExtractionEstimate, PlanResult, ResumeEstimate } from "../../../lib/ledger-source.js";
import { useAsync } from "../../../lib/use-async.js";
import { clearBackfillRun, startBackfillRun } from "../flags.js";
import { WINDOW_LABELS, formatCount, formatDuration, formatUsd, plural } from "../format.js";
import { goTo, replaceWith, type WizardState } from "../state.js";
import { StepActions, StepFrame } from "../wizard.js";

/** Joins a path list into a dependency key; no path can hold it. */
const LIST_SEP = "\u0000";

/**
 * Step 3 — how each past session gets its checkpoint (plans/feature-p8-onboarding-home.md step 4).
 *
 * One question first: may workledger resume each session headlessly in the operator's own
 * harness? That path spends their subscription and needs no key. Yes shows the resume plan and
 * a Start button. No shows the extraction plan — tokens, dollars, and whether the daemon has an
 * `ANTHROPIC_API_KEY` at all — with Run, disabled and explained when the key is absent, and
 * Skip, which backfills nothing. Either Start is the consent `POST /api/onboarding/run` requires,
 * and it is the only place in the wizard that spends anything.
 */
export function MethodStep({ state, source }: { state: WizardState; source: AppSource }) {
  if (state.method === undefined) return <ResumeQuestion state={state} source={source} />;
  return <Plan state={state} source={source} method={state.method === "extract" ? "extract" : "resume"} />;
}

/** The question, in plain words. */
export const RESUME_QUESTION =
  "Let workledger replay each past session in Claude Code or Codex to write its summary? This uses your existing subscription and needs no API key.";

/**
 * The alternative, with its numbers already on the question — the extraction plan is asked for
 * here so "No" is a choice made against a price, not a surprise on the next screen.
 */
function extractionLine(plan: PlanResult): string {
  const estimate = plan.estimate as ExtractionEstimate | null;
  if (estimate === null) return "Otherwise workledger can summarize the transcripts with the Anthropic API.";
  return `Otherwise workledger can summarize the transcripts with the Anthropic API: about ${formatCount(estimate.tokens)} tokens, about ${formatUsd(estimate.usd)}, needs ANTHROPIC_API_KEY${estimate.needsApiKey ? " (not set on the daemon)" : ""}.`;
}

function ResumeQuestion({ state, source }: { state: WizardState; source: AppSource }) {
  const repos = state.repos ?? [];
  const since = state.since ?? "7d";
  const reposKey = repos.join(LIST_SEP);
  const extraction = useAsync(
    useCallback(
      () => source.plan({ repos: reposKey === "" ? [] : reposKey.split(LIST_SEP), since, method: "extract" }),
      [source, reposKey, since],
    ),
  );
  return (
    <StepFrame
      title="How should past sessions be digested?"
      lead={`${WINDOW_LABELS[since]}, across ${plural(repos.length, "repo")}. Each past session gets a written summary in its repo's ledger; the question is who writes it.`}
    >
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">{RESUME_QUESTION}</p>
        <p className="text-xs text-muted-foreground">
          {extraction.state === "ready"
            ? extractionLine(extraction.value)
            : extraction.state === "loading"
              ? "Otherwise workledger can summarize the transcripts with the Anthropic API — estimating what that would cost…"
              : "Otherwise workledger can summarize the transcripts with the Anthropic API; the next screen shows what that would cost."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => goTo({ ...state, method: "resume" })}>Yes, replay my sessions</Button>
          <Button variant="outline" onClick={() => goTo({ ...state, method: "extract" })}>
            No, use the Anthropic API instead
          </Button>
        </div>
      </div>
      <StepActions>
        <Button variant="ghost" onClick={() => goTo({ ...state, step: "history", since: undefined, method: undefined })}>
          Back
        </Button>
      </StepActions>
    </StepFrame>
  );
}

function Plan({ state, source, method }: { state: WizardState; source: AppSource; method: "resume" | "extract" }) {
  const repos = state.repos ?? [];
  const since = state.since ?? "7d";
  // The list's identity is its contents: the array itself is a new object on every hash read.
  const reposKey = repos.join(LIST_SEP);
  const plan = useAsync(
    useCallback(
      () => source.plan({ repos: reposKey === "" ? [] : reposKey.split(LIST_SEP), since, method }),
      [source, reposKey, since, method],
    ),
  );

  // Start is the consent. On 202 the jobs exist: remember them for the progress split and the
  // Home banner, then move on. A refusal stays on this screen with its reason.
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<unknown>(undefined);
  async function start() {
    setStarting(true);
    setFailure(undefined);
    try {
      const result = await source.run({ repos, since, method, consent: true });
      startBackfillRun(repos, result.jobs);
      goTo({ ...state, step: "running" });
    } catch (error) {
      setFailure(error);
      setStarting(false);
    }
  }

  const back = (
    <Button variant="ghost" disabled={starting} onClick={() => replaceWith({ ...state, method: undefined })}>
      Change answer
    </Button>
  );
  const failed =
    failure !== undefined ? (
      <p role="alert" className="text-sm text-destructive">
        {explainRunFailure(failure)}
      </p>
    ) : null;

  return (
    <StepFrame
      title={method === "resume" ? "Resume in your harness" : "Extract with an API key"}
      lead={
        method === "resume"
          ? "Each session below is resumed headlessly, one at a time per repo, and asked for its checkpoint. Start queues the jobs; they run on the daemon and you can leave this page."
          : "An extraction model reads each transcript and writes the checkpoint. The cost below is an estimate from transcript size; Run queues the jobs against the daemon's key."
      }
    >
      <AsyncPanel result={plan} empty="">
        {(result) =>
          result.sessions === 0 ? (
            <>
              <p className="text-sm">
                {(result.unsupported?.codex ?? 0) > 0
                  ? `${plural(result.unsupported!.codex, "Codex session")} can only be backfilled by resume and will be skipped by extraction; nothing else in ${WINDOW_LABELS[since].toLowerCase()} is missing a checkpoint. Change your answer to resume them, or finish.`
                  : `No session in ${WINDOW_LABELS[since].toLowerCase()} is missing a checkpoint. There is nothing to backfill.`}
              </p>
              <StepActions>
                {back}
                <Button className="ml-auto" onClick={() => goTo({ ...state, step: "done" })}>
                  Finish
                </Button>
              </StepActions>
            </>
          ) : method === "resume" ? (
            <>
              <ResumePlan result={result} />
              {failed}
              <StepActions>
                {back}
                <Button className="ml-auto" disabled={starting} onClick={() => void start()}>
                  {starting ? "Starting…" : `Start backfill (${plural(result.sessions, "session")})`}
                </Button>
              </StepActions>
            </>
          ) : (
            <>
              <ExtractPlan result={result} />
              {failed}
              <StepActions>
                {back}
                <Button
                  variant="outline"
                  disabled={starting}
                  className="ml-auto"
                  onClick={() => {
                    clearBackfillRun();
                    goTo({ ...state, step: "done", method: "none" });
                  }}
                >
                  Skip backfill
                </Button>
                <Button disabled={starting || needsKey(result)} onClick={() => void start()}>
                  {starting ? "Starting…" : "Run extraction"}
                </Button>
              </StepActions>
              {needsKey(result) ? (
                <p className="text-xs text-muted-foreground">
                  Run extraction is disabled because the daemon has no <code>ANTHROPIC_API_KEY</code>. Set it
                  in the environment that starts <code>workledger</code>, run <code>workledger stop</code> and{" "}
                  <code>workledger</code> again, then reload this step — or skip the backfill; new sessions
                  are recorded either way.
                </p>
              ) : null}
            </>
          )
        }
      </AsyncPanel>
    </StepFrame>
  );
}

function needsKey(result: PlanResult): boolean {
  return result.estimate !== null && "needsApiKey" in result.estimate && result.estimate.needsApiKey;
}

function ResumePlan({ result }: { result: PlanResult }) {
  const estimate = result.estimate as ResumeEstimate | null;
  return (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
      <Row label="sessions" value={formatCount(result.sessions)} />
      <Row label="estimated time" value={estimate === null ? "—" : `about ${formatDuration(estimate.seconds * 1000)}`} />
      <Row label="cost" value="your harness subscription; no API key" />
    </dl>
  );
}

function ExtractPlan({ result }: { result: PlanResult }) {
  const estimate = result.estimate as ExtractionEstimate | null;
  const codex = result.unsupported?.codex ?? 0;
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
        <Row label="sessions" value={formatCount(result.sessions)} />
        <Row label="tokens" value={estimate === null ? "—" : formatCount(estimate.tokens)} />
        <Row label="estimated cost" value={estimate === null ? "—" : formatUsd(estimate.usd)} />
        <Row
          label="ANTHROPIC_API_KEY"
          value={estimate === null ? "—" : estimate.needsApiKey ? "not set on the daemon" : "set on the daemon"}
        />
      </dl>
      {codex > 0 ? (
        // Amendment 3: the extractor reads Claude Code transcripts only.
        <p className="rounded-md bg-warning/20 p-2 text-xs">
          {plural(codex, "Codex session")} can only be backfilled by resume and will be skipped by extraction.
        </p>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </>
  );
}

/** The contract's two 409s in the operator's words; anything else is shown as the server said it. */
export function explainRunFailure(error: unknown): string {
  const code = codeOf(error);
  if (code === "api-key-required") {
    return "The daemon has no ANTHROPIC_API_KEY, so extraction cannot run. Set it where workledger starts, restart, and try again — or skip the backfill.";
  }
  if (code === "consent-required") return "The daemon did not receive consent for this run. Try again.";
  return `Could not start the backfill: ${messageOf(error)}`;
}
