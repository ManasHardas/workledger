/**
 * The onboarding backend the server is *given* — docs/contracts/p8/daemon-and-api.md
 * §Onboarding endpoints — the same way `./ops.ts` gives it the backlog writer and `./jobs.ts`
 * the job queue.
 *
 * Every one of the six routes is really a call into `packages/cli`: the harness stores and the
 * `.git` walk (`src/onboarding/discover.ts`), `workledger init` itself (`commands/init.ts`), the
 * P3 backfill plan and the job queue. None of that can live here — this package must not import
 * `better-sqlite3`, and `packages/cli` already depends on it, so importing back would be a cycle
 * (and the CLI ships as one bundle with no exports map anyway). So this file declares the *shape*
 * and `packages/cli/src/commands/onboarding-ops.ts` satisfies it structurally, which makes a drift
 * a compile error at the injection site rather than a 500 in front of the wizard.
 */
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

import type { Job } from "./jobs.js";

/** The backfill windows the wizard offers; `none` is "no backfill". */
export const ONBOARDING_WINDOWS = ["7d", "30d", "90d", "none"] as const;
export type OnboardingWindow = (typeof ONBOARDING_WINDOWS)[number];

/** How the backfill digests each session; `none` is "no backfill". */
export const ONBOARDING_METHODS = ["resume", "extract", "none"] as const;
export type OnboardingMethod = (typeof ONBOARDING_METHODS)[number];

/** One repo the wizard can offer. */
export interface RepoCandidate {
  /** Absolute repo root. */
  path: string;
  /** `basename(path)`. */
  name: string;
  hasGit: boolean;
  /** `.workledger/config.yaml` exists — `init` has already run here. */
  enabled: boolean;
  /** Sessions per harness store that name this repo as their working directory. */
  harnessSessions: { "claude-code"?: number; codex?: number; cursor?: number };
  /** ISO 8601 of the newest such session, or `null` for a repo with none. */
  lastSessionAt: string | null;
}

/** `GET /api/onboarding/discover`. `found` never repeats a path already in `known`. */
export interface DiscoverResult {
  /** Repos the harness stores have sessions for — pre-checked in the wizard. */
  known: RepoCandidate[];
  /** `.git` directories under `roots` the stores do not mention. */
  found: RepoCandidate[];
  /** The roots that were walked, absolute. */
  roots: string[];
}

/** One backfill window's size. */
export interface HistoryWindow {
  sessions: number;
  /** Total transcript bytes of those sessions, from `stat`. */
  bytes: number;
}

/** `GET /api/onboarding/history`. */
export interface HistoryResult {
  windows: { "7d": HistoryWindow; "30d": HistoryWindow; "90d": HistoryWindow };
}

/** `POST /api/onboarding/init` body. */
export interface InitInput {
  repos: string[];
  /** Harnesses to enable regardless of detection — `init --harness`. */
  harnesses?: string[] | undefined;
}

/** What `init` did in one repo. */
export interface InitRepoResult {
  path: string;
  ok: boolean;
  /** Hook files written, relative to the repo root; empty for a repo that was already enabled. */
  hooksWritten: string[];
  /** Manual steps left to the operator — Codex's one-time hook trust. */
  trustSteps: string[];
  error?: string;
}

/** `POST /api/onboarding/init` response. */
export interface InitResult {
  results: InitRepoResult[];
}

/** `POST /api/onboarding/plan` body. */
export interface PlanInput {
  repos: string[];
  since: OnboardingWindow;
  method: OnboardingMethod;
}

/** Wall time the resume-based backfill is expected to take. */
export interface ResumeEstimate {
  seconds: number;
}

/** What the extraction would cost, and whether the key it needs is present. */
export interface ExtractionEstimate {
  tokens: number;
  usd: number;
  /** `ANTHROPIC_API_KEY` is absent from the server's environment. */
  needsApiKey: boolean;
}

/** `POST /api/onboarding/plan` response. `estimate` is `null` for method or window `none`. */
export interface PlanResult {
  /** Sessions in the window the index has never seen, across `repos`. */
  sessions: number;
  estimate: ResumeEstimate | ExtractionEstimate | null;
}

/** `POST /api/onboarding/run` body. */
export interface RunInput extends PlanInput {
  /** The operator agreed to the plan. The op refuses anything but `true`. */
  consent: boolean;
}

/** `POST /api/onboarding/run` response (202). */
export interface RunResult {
  jobs: Job[];
}

/**
 * `GET /api/onboarding/status` — the wizard's jobs, by lifecycle state.
 *
 * `running` counts `queued` as well as `running` (the work still ahead), `failed` counts
 * `cancelled` too (the work that will not be done), so `total = done + failed + running` always
 * holds and `complete` is simply "nothing is still ahead" — which makes a wizard that queued
 * nothing complete at once.
 */
export interface OnboardingStatus {
  total: number;
  done: number;
  failed: number;
  running: number;
  complete: boolean;
}

/**
 * The two refusals the onboarding ops raise that have their own status on the wire.
 *
 * `api-key-required` is the contract's 409 for `run` with method `extract` and no
 * `ANTHROPIC_API_KEY`; `consent-required` is `run` without `consent: true`, given the same 409 the
 * P3 repair route uses for the same refusal. Anything else an op throws goes through
 * `toApiError` like every other injected op's refusal.
 */
export type OnboardingRefusalCode =
  | "api-key-required"
  | "consent-required"
  | "invalid-repo"
  | "invalid-root";

/** An error carrying an {@link OnboardingRefusalCode}. */
export interface OnboardingRefusal extends Error {
  readonly code: OnboardingRefusalCode;
}

const REFUSALS: readonly string[] = ["api-key-required", "consent-required", "invalid-repo", "invalid-root"];

/** The HTTP status each refusal carries: the path ones are the caller's mistake, the rest a state. */
export const REFUSAL_STATUS: Readonly<Record<OnboardingRefusalCode, 400 | 409>> = {
  "api-key-required": 409,
  "consent-required": 409,
  "invalid-repo": 400,
  "invalid-root": 400,
};

/**
 * Why `given` is not a repo the wizard may touch, or `undefined` when it is one.
 *
 * Absolute, existing after symlinks are resolved, a directory, and holding a `.git` entry — a
 * directory, or the file a git worktree keeps in its place. Nothing else is ever scaffolded:
 * `init` writes hook files, and a plain directory that happens to be named in a request body
 * must not grow a `.claude/settings.json`.
 */
export function repoPathProblem(given: string): string | undefined {
  if (!path.isAbsolute(given)) return `${given} is not an absolute path`;
  let real: string;
  try {
    real = realpathSync(given);
  } catch {
    return `${given} does not exist`;
  }
  if (!isDirectory(real)) return `${given} is not a directory`;
  try {
    statSync(path.join(real, ".git"));
  } catch {
    return `${given} is not a git repository (no .git)`;
  }
  return undefined;
}

/** Why `given` cannot be walked for repos: it must be an absolute, existing directory. */
export function rootPathProblem(given: string): string | undefined {
  if (!path.isAbsolute(given)) return `${given} is not an absolute path`;
  let real: string;
  try {
    real = realpathSync(given);
  } catch {
    return `${given} does not exist`;
  }
  return isDirectory(real) ? undefined : `${given} is not a directory`;
}

function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** Is this an {@link OnboardingRefusal}? Structural, for the same reason `isOpError` is. */
export function isOnboardingRefusal(error: unknown): error is OnboardingRefusal {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && REFUSALS.includes(code);
}

/**
 * The onboarding operations, exactly as `packages/cli/src/commands/onboarding-ops.ts` supplies
 * them. Nothing here prints or decides an exit code; every refusal is a throw.
 */
export interface OnboardingOps {
  /** `roots` absent or empty means the default (`~/Projects`). */
  discover(roots?: string[]): Promise<DiscoverResult>;
  history(repos: string[]): Promise<HistoryResult>;
  init(input: InitInput): Promise<InitResult>;
  plan(input: PlanInput): Promise<PlanResult>;
  /** Queues the backfill and starts draining it; returns as soon as the rows exist. */
  run(input: RunInput): Promise<RunResult>;
  status(): Promise<OnboardingStatus>;
}
