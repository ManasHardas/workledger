/**
 * `workledger onboard [--json] [--roots <a,b>] [--select <paths>] [--since 7d|30d|90d|none]
 * [--method resume|extract|none] [--yes]` — docs/contracts/p8/daemon-and-api.md §CLI, "terminal
 * parity for the wizard".
 *
 * The same six calls the web wizard makes, in the same order, against the same functions
 * (`src/onboarding/`): discover, select, history, init, plan, consent, run, status. On a terminal
 * with a flag missing it asks; with `--json`, `--yes`, or no terminal it takes the flag or the
 * default and never asks. `--json` prints one object whose six members are exactly what the six
 * endpoints return, which is what the parity test compares.
 *
 * Plain `readline` for the prompts: the CLI bundle carries no dependency but `better-sqlite3`.
 */
import process from "node:process";

import { EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import {
  backfillPlan,
  drainOnboardingBackfill,
  onboardingStatus,
  queueOnboardingBackfill,
} from "../onboarding/backfill.js";
import { discoverRepos } from "../onboarding/discover.js";
import { historyWindows } from "../onboarding/history.js";
import { initRepos } from "../onboarding/init.js";
import { processOnboardingIo } from "../onboarding/io.js";
import { OnboardingRefusalError } from "../onboarding/repo-path.js";
import type { OnboardingIo } from "../onboarding/io.js";
import type {
  DiscoverResult,
  HistoryResult,
  InitResult,
  OnboardingMethod,
  OnboardingStatus,
  OnboardingWindow,
  PlanResult,
  RepoCandidate,
  RunResult,
} from "@workledger/server";

/** Options commander parses for `onboard`. */
export interface OnboardOptions {
  json?: boolean;
  /** Comma-separated roots to walk for `.git` directories; default `~/Projects`. */
  roots?: string;
  /** Comma-separated repo paths to enable; default every `suggested` `known` repo. */
  select?: string;
  since?: string;
  method?: string;
  /** Answer every prompt with its default and consent to the backfill. */
  yes?: boolean;
}

/** {@link OnboardingIo} plus the terminal. */
export interface OnboardIo extends OnboardingIo {
  stdout: (line: string) => void;
  /** `true` when a person can be asked. */
  interactive: boolean;
  /** Ask one line; the default is what Enter answers. Only called when `interactive`. */
  ask: (question: string, fallback: string) => Promise<string>;
}

/** The one document `--json` prints: the six endpoints' objects, `null` for a step not reached. */
export interface OnboardReport {
  discover: DiscoverResult;
  history: HistoryResult;
  init: InitResult;
  plan: PlanResult;
  run: RunResult | null;
  status: OnboardingStatus | null;
}

const WINDOWS: readonly OnboardingWindow[] = ["7d", "30d", "90d", "none"];
const METHODS: readonly OnboardingMethod[] = ["resume", "extract", "none"];
const DEFAULT_WINDOW: OnboardingWindow = "30d";
const DEFAULT_METHOD: OnboardingMethod = "resume";

/** The real terminal. */
export function processOnboardIo(): OnboardIo {
  return {
    ...processOnboardingIo(),
    stdout: (line) => void process.stdout.write(`${line}\n`),
    interactive: process.stdin.isTTY === true && process.stderr.isTTY === true,
    ask: async (question, fallback) => {
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = (await rl.question(`${question} [${fallback}] `)).trim();
        return answer === "" ? fallback : answer;
      } finally {
        rl.close();
      }
    },
  };
}

/** `a, b ,,c` → `["a", "b", "c"]`. */
function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** `n/a`, `2 claude-code · 1 codex`. */
function sessionsLabel(candidate: RepoCandidate): string {
  const parts = Object.entries(candidate.harnessSessions).map(([harness, n]) => `${n} ${harness}`);
  return parts.length === 0 ? "no agent sessions" : parts.join(" · ");
}

/**
 * Which repos to enable.
 *
 * `--select` wins; otherwise the default is every `known` repo (the ones with agent history)
 * that is `suggested` — the wizard's pre-check — and on a terminal the operator can pick by
 * number from the combined list instead.
 */
async function selectRepos(
  discover: DiscoverResult,
  options: OnboardOptions,
  io: OnboardIo,
  ask: boolean,
): Promise<string[] | undefined> {
  const selected = csv(options.select);
  if (selected.length > 0) return selected;
  const all = [...discover.known, ...discover.found];
  const preselected = discover.known.map((candidate, index) => [candidate, index + 1] as const).filter(([c]) => c.suggested);
  const fallback = preselected.map(([candidate]) => candidate.path);
  if (!ask) return fallback.length > 0 ? fallback : undefined;

  io.stdout("Projects:");
  all.forEach((candidate, index) => {
    const mark = candidate.enabled ? "enabled" : index < discover.known.length ? "known" : "found";
    io.stdout(`  [${index + 1}] ${candidate.path}  (${mark}; ${sessionsLabel(candidate)})`);
  });
  if (all.length === 0) return undefined;
  const answer = await io.ask(
    "Select repos to track (numbers, comma-separated)",
    preselected.map(([, n]) => String(n)).join(",") || "none",
  );
  if (answer === "none") return undefined;
  const picks: string[] = [];
  for (const token of csv(answer)) {
    const n = Number(token);
    const candidate = Number.isInteger(n) ? all[n - 1] : undefined;
    if (candidate === undefined) {
      io.stderr(`workledger onboard: ${token} is not one of the listed numbers`);
      return undefined;
    }
    picks.push(candidate.path);
  }
  return picks;
}

/** One of `allowed`, from the flag, the prompt, or the default. */
async function choose<T extends string>(
  name: string,
  given: string | undefined,
  allowed: readonly T[],
  fallback: T,
  io: OnboardIo,
  ask: boolean,
): Promise<T | undefined> {
  const value = given ?? (ask ? await io.ask(`${name} (${allowed.join("/")})`, fallback) : fallback);
  if ((allowed as readonly string[]).includes(value)) return value as T;
  io.stderr(`workledger onboard: --${name} must be one of ${allowed.join(", ")}; got ${value}`);
  return undefined;
}

/** `95s`, `4m 15s`, `$0.12` — the estimate in the units the operator waits or pays in. */
function estimateLabel(plan: PlanResult): string {
  const estimate = plan.estimate;
  if (estimate === null) return "no backfill";
  if ("seconds" in estimate) {
    const minutes = Math.floor(estimate.seconds / 60);
    const rest = estimate.seconds % 60;
    return `about ${minutes === 0 ? `${rest}s` : rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`} by resuming`;
  }
  const usd = estimate.usd > 0 && estimate.usd < 0.01 ? "<$0.01" : `$${estimate.usd.toFixed(2)}`;
  return `about ${estimate.tokens} tokens, ${usd}${estimate.needsApiKey ? " (ANTHROPIC_API_KEY is not set)" : ""}`;
}

/** The command, with its environment injected. @returns the process exit code. */
export async function runOnboard(options: OnboardOptions, io: OnboardIo): Promise<number> {
  try {
    return await onboard(options, io);
  } catch (error) {
    // A path that is not a repo, a root that is not a directory: the ops refuse it with the
    // same code the API answers 400 with, and here that is a usage error.
    if (!(error instanceof OnboardingRefusalError)) throw error;
    io.stderr(`workledger onboard: ${error.message}`);
    return EXIT_USAGE;
  }
}

async function onboard(options: OnboardOptions, io: OnboardIo): Promise<number> {
  const json = options.json === true;
  const ask = io.interactive && !json && options.yes !== true;
  const say = (line: string): void => {
    if (!json) io.stdout(line);
  };

  // 1. Discover.
  const roots = csv(options.roots);
  const discover = discoverRepos(roots.length === 0 ? {} : { roots }, io);
  say(`workledger onboard: ${discover.known.length} repo(s) with agent sessions, ${discover.found.length} more under ${discover.roots.join(", ")}`);

  // 2. Select.
  const repos = await selectRepos(discover, options, io, ask);
  if (repos === undefined || repos.length === 0) {
    io.stderr("workledger onboard: no repos selected; pass --select <paths> or --roots <dirs>");
    return EXIT_USAGE;
  }

  // 3. History.
  const history = historyWindows(repos, io);
  for (const window of ["7d", "30d", "90d"] as const) {
    const { sessions, bytes } = history.windows[window];
    say(`  ${window.padEnd(4)} ${sessions} session(s), ${bytes} bytes`);
  }
  const since = await choose("since", options.since, WINDOWS, DEFAULT_WINDOW, io, ask);
  if (since === undefined) return EXIT_USAGE;

  // 4. Init.
  const init = await initRepos({ repos }, io);
  for (const result of init.results) {
    say(
      result.ok
        ? `  ${result.path}: enabled${result.hooksWritten.length === 0 ? " (already)" : `; wrote ${result.hooksWritten.join(", ")}`}`
        : `  ${result.path}: FAILED — ${result.error ?? "unknown error"}`,
    );
    for (const step of result.trustSteps) say(`    → ${step}`);
  }
  const enabled = init.results.filter((result) => result.ok).map((result) => result.path);

  // 5. Method and plan.
  const method = await choose("method", options.method, METHODS, DEFAULT_METHOD, io, ask);
  if (method === undefined) return EXIT_USAGE;
  const plan = await backfillPlan({ repos: enabled, since, method }, io);
  say(`  plan: ${plan.sessions} session(s) in ${since}; ${estimateLabel(plan)}`);

  // 6. Consent, run, status.
  let consent = options.yes === true;
  if (!consent && ask && plan.sessions > 0 && method !== "none" && since !== "none") {
    consent = /^y(es)?$/i.test(await io.ask("Start the backfill? (y/N)", "N"));
  }
  const report: OnboardReport = { discover, history, init, plan, run: null, status: null };
  if (consent) {
    const queued = await queueOnboardingBackfill({ repos: enabled, since, method, consent: true }, io);
    report.run = { jobs: queued.jobs };
    say(`  queued ${queued.jobs.length} job(s)`);
    // The invoking process is the runner, as it is for `workledger backfill`.
    await drainOnboardingBackfill({ repos: queued.repos, method }, io);
    report.status = await onboardingStatus(io);
    say(`  backfill: ${report.status.done} digested, ${report.status.failed} failed`);
  } else if (!json) {
    say("  not started; re-run with --yes to backfill, or open `workledger` for the wizard");
  }

  if (json) io.stdout(JSON.stringify(report));
  return EXIT_OK;
}

/** @returns the process exit code. */
export async function onboardCommand(options: OnboardOptions): Promise<number> {
  return runOnboard(options, processOnboardIo());
}
