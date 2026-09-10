import { useCallback, useSyncExternalStore } from "react";

import { ONBOARDING_HREF } from "../../lib/router.js";
import type { OnboardingMethod, OnboardingWindow } from "../../lib/ledger-source.js";

/**
 * The wizard's state, which lives in the hash query — `#/onboarding?step=history&repos=…` —
 * and nowhere else (docs/contracts/p8/daemon-and-api.md §Wizard routes: "a reload resumes the
 * step"). Moving between steps pushes a history entry, so the browser's Back is the wizard's
 * Back; changing a selection within a step replaces the entry, so Back does not walk through
 * every checkbox.
 *
 * The five steps, in order. `done` is also where the two "no backfill" exits land (`since=none`,
 * or `method=none` for a declined extraction).
 */
export const STEPS = ["projects", "history", "method", "running", "done"] as const;

export type Step = (typeof STEPS)[number];

/** What each step is called in the stepper. */
export const STEP_LABELS: Record<Step, string> = {
  projects: "Projects",
  history: "History",
  method: "Method",
  running: "Backfill",
  done: "Done",
};

export interface WizardState {
  step: Step;
  /** Folders added on the projects step, walked in addition to the daemon's default root. */
  roots: string[];
  /**
   * The selected repo paths. `undefined` until the operator has touched the list, which is what
   * lets the projects step tell "nothing chosen yet — pre-check the suggested ones" from "every
   * box was unticked".
   */
  repos: string[] | undefined;
  since: OnboardingWindow | undefined;
  method: OnboardingMethod | undefined;
}

const WINDOWS: readonly OnboardingWindow[] = ["7d", "30d", "90d", "none"];
const METHODS: readonly OnboardingMethod[] = ["resume", "extract", "none"];

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * A comma-separated list whose items were each percent-encoded, so a path holding a comma
 * survives. `null` (absent) and `""` (present, empty) are different answers — see `repos`.
 */
function readList(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  if (value === "") return [];
  return value.split(",").map((item) => {
    try {
      return decodeURIComponent(item);
    } catch {
      return item;
    }
  });
}

function writeList(items: readonly string[]): string {
  return items.map(encodeURIComponent).join(",");
}

/** The state a bare `#/onboarding` means: step one, nothing chosen. */
export const INITIAL_STATE: WizardState = {
  step: "projects",
  roots: [],
  repos: undefined,
  since: undefined,
  method: undefined,
};

/** Reads the wizard's state out of a hash; anything malformed falls back to the first step. */
export function parseWizardHash(hash: string): WizardState {
  const at = hash.indexOf("?");
  if (at < 0) return INITIAL_STATE;
  const params = new URLSearchParams(hash.slice(at + 1));
  return {
    step: oneOf(params.get("step"), STEPS) ?? "projects",
    roots: readList(params.get("roots")) ?? [],
    repos: readList(params.get("repos")),
    since: oneOf(params.get("since"), WINDOWS),
    method: oneOf(params.get("method"), METHODS),
  };
}

/** `#/onboarding?step=…&…`, with every unset field left out. */
export function wizardHref(state: WizardState): string {
  const params = new URLSearchParams();
  params.set("step", state.step);
  if (state.roots.length > 0) params.set("roots", writeList(state.roots));
  if (state.repos !== undefined) params.set("repos", writeList(state.repos));
  if (state.since !== undefined) params.set("since", state.since);
  if (state.method !== undefined) params.set("method", state.method);
  return `${ONBOARDING_HREF}?${params.toString()}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** Moves to `next` with a history entry: the browser's Back returns to the current step. */
export function goTo(next: WizardState): void {
  window.location.hash = wizardHref(next);
}

/**
 * Rewrites the current entry: a selection changed within a step. `replaceState` fires no
 * `hashchange`, so one is dispatched by hand for `useWizardState` (same trick as `replaceHash`).
 */
export function replaceWith(next: WizardState): void {
  const href = wizardHref(next);
  if (window.location.hash === href) return;
  window.history.replaceState(window.history.state, "", href);
  window.dispatchEvent(new Event("hashchange"));
}

/** The wizard's state, re-read on every `hashchange`. */
export function useWizardState(): WizardState {
  const snapshot = useCallback(() => window.location.hash, []);
  const hash = useSyncExternalStore(subscribe, snapshot, () => "");
  return parseWizardHash(hash);
}
