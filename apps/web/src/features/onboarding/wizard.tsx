import type { ReactNode } from "react";

import { cn } from "../../lib/cn.js";
import { HOME_HREF } from "../../lib/router.js";
import { useMachine } from "../../lib/source-context.js";
import { STEPS, STEP_LABELS, useWizardState, type Step, type WizardState } from "./state.js";
import { DoneStep } from "./steps/done.js";
import { HistoryStep } from "./steps/history.js";
import { MethodStep } from "./steps/method.js";
import { ProjectsStep } from "./steps/projects.js";
import { RunningStep } from "./steps/running.js";

/**
 * `#/onboarding` — plans/feature-p8-onboarding-home.md steps 2–6, one screen per step.
 *
 * Every step says what is about to happen before the operator commits, and what was done after:
 * this is the flow they walk once and judge. The state is the URL (`./state.ts`); a step that
 * needs a selection an earlier step did not leave behind sends the operator back to it rather
 * than guessing.
 */
export function OnboardingWizard() {
  const source = useMachine();
  const state = useWizardState();
  const step = reachableStep(state);

  return (
    <section aria-labelledby="onboarding-heading" className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="onboarding-heading" className="text-xl font-semibold">
          Add projects
        </h2>
        <a
          href={HOME_HREF}
          className="rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Home
        </a>
      </div>
      <Stepper current={step} />
      <StepScreen step={step} state={state} source={source} />
    </section>
  );
}

/**
 * The step the URL asks for, unless it needs something the URL does not hold — `history`
 * without repos, `running` without a method — in which case the last step that makes sense.
 * A reload always resumes *somewhere* real.
 */
export function reachableStep(state: WizardState): Step {
  const repos = state.repos ?? [];
  if (state.step === "projects") return "projects";
  if (repos.length === 0) return "projects";
  if (state.step === "history") return "history";
  if (state.since === undefined) return "history";
  if (state.step === "method") return "method";
  if (state.since === "none" || state.method === "none") return "done";
  if (state.method === undefined) return "method";
  return state.step;
}

function StepScreen({ step, state, source }: { step: Step; state: WizardState; source: ReturnType<typeof useMachine> }) {
  switch (step) {
    case "projects":
      return <ProjectsStep state={state} source={source} />;
    case "history":
      return <HistoryStep state={state} source={source} />;
    case "method":
      return <MethodStep state={state} source={source} />;
    case "running":
      return <RunningStep state={state} source={source} />;
    case "done":
      return <DoneStep state={state} source={source} />;
  }
}

/** Where the operator is, out of five. Not links: a step is reached by finishing the one before. */
function Stepper({ current }: { current: Step }) {
  const at = STEPS.indexOf(current);
  return (
    <ol aria-label="Steps" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={step === current ? "step" : undefined}
          className={cn(
            "flex items-center gap-1.5",
            index < at && "text-muted-foreground",
            index === at && "font-semibold text-foreground",
            index > at && "text-muted-foreground/70",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] tabular-nums",
              index < at && "border-transparent bg-success text-success-foreground",
              index === at && "border-primary bg-primary text-primary-foreground",
              index > at && "border-border",
            )}
          >
            {index < at ? "✓" : String(index + 1)}
          </span>
          {STEP_LABELS[step]}
        </li>
      ))}
    </ol>
  );
}

/** The frame every step renders in: a title, one sentence on what is about to happen, the body. */
export function StepFrame({
  title,
  lead,
  children,
}: {
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>
      {children}
    </div>
  );
}

/** The row of buttons under a step: Back on the left, the way forward on the right. */
export function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">{children}</div>;
}
