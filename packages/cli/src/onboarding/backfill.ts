/**
 * The wizard's "Method" and "Running" steps — `POST /api/onboarding/plan`, `POST
 * /api/onboarding/run` and `GET /api/onboarding/status`.
 *
 * Every number here comes from the P3 machinery rather than from a second reckoning of it:
 * `planBackfill` over `enumerateStore` says which sessions are fresh, `estimateExtraction` prices
 * a transcript the way `repair --extract` does, `createBackfilledSession` and `enqueueJob` open
 * the rows the way `workledger backfill` does, and `drainBackfillJobs` runs them with the same
 * handler. What is new is the shape — several repos at once, a `90d` window, a method rather than
 * a fallback flag — and the `source: "onboarding"` tag that lets `status` report the wizard's own
 * jobs and nothing else.
 *
 * Two refusals have their own wire status (`../../server/src/onboarding.ts`): `run` without
 * `consent: true`, and `run` with method `extract` when `ANTHROPIC_API_KEY` is absent. Both are
 * raised *before* a row is written.
 */
import { claudeCodeAdapter } from "../adapters/claude-code.js";
import { BacklogOpError } from "../backlog-ops.js";
import {
  createBackfilledSession,
  drainBackfillJobs,
  enumerateStore,
  planBackfill,
} from "../commands/backfill.js";
import { loadConfig } from "../config.js";
import { API_KEY_ENV } from "../extract/api.js";
import { estimateExtraction } from "../extract/run.js";
import { enqueueJob } from "../jobs/queue.js";
import { isEnabled } from "../ledger-fs.js";
import { withIndex } from "./io.js";
import { OnboardingRefusalError, assertRepoPaths } from "./repo-path.js";
import type { BackfillIo, BackfillPlan } from "../commands/backfill.js";
import type { IndexDb } from "../index/db.js";
import type { OnboardingIo } from "./io.js";
import type {
  Job,
  OnboardingMethod,
  OnboardingStatus,
  PlanInput,
  PlanResult,
  RunInput,
  RunResult,
} from "@workledger/server";

// Re-exported so the tests and the CLI keep one import path for the refusal.
export { OnboardingRefusalError } from "./repo-path.js";

/** The `source` every job the wizard queues carries (migration `0004_job_source`). */
export const ONBOARDING_SOURCE = "onboarding";

/** `ANTHROPIC_API_KEY`, or `undefined` for absent and empty alike. */
function apiKey(io: OnboardingIo): string | undefined {
  return io.env[API_KEY_ENV]?.trim() || undefined;
}

/** One repo's plan, priced with its own `config.yaml`. */
interface RepoPlan {
  root: string;
  plan: BackfillPlan;
  concurrency: number;
  /** The extraction cost of every fresh session, summed. */
  tokens: number;
  usd: number;
}

/** The P3 plan for each repo, in the wizard's window. */
async function planRepos(input: PlanInput, io: OnboardingIo, db: IndexDb): Promise<RepoPlan[]> {
  const plans: RepoPlan[] = [];
  for (const root of assertRepoPaths(input.repos)) {
    const config = loadConfig(root);
    const plan = planBackfill(enumerateStore(io.homeDir, root), {
      db,
      harness: claudeCodeAdapter.harness,
      since: input.since,
      now: io.now(),
      concurrency: config.backfill.concurrency,
      secondsPerSession: config.backfill.seconds_per_session,
    });
    let tokens = 0;
    let usd = 0;
    for (const session of plan.fresh) {
      // Offset 0: a backfilled session has never been described, so the span is the whole file
      // — the same `last_offset: 0` `createBackfilledSession` records.
      const estimate = estimateExtraction(session.bytes, config.extract, 0);
      tokens += estimate.inputTokens + estimate.outputTokens;
      usd += estimate.usd;
    }
    plans.push({ root, plan, concurrency: config.backfill.concurrency, tokens, usd });
  }
  return plans;
}

/** The plan step: how many sessions, and what digesting them costs by the chosen method. */
export async function backfillPlan(input: PlanInput, io: OnboardingIo): Promise<PlanResult> {
  assertRepoPaths(input.repos);
  if (input.since === "none") return { sessions: 0, estimate: null };
  return await withIndex(io, async (db) => {
    const plans = await planRepos(input, io, db);
    const sessions = plans.reduce((sum, entry) => sum + entry.plan.fresh.length, 0);
    if (input.method === "none") return { sessions, estimate: null };
    if (input.method === "extract") {
      return {
        sessions,
        estimate: {
          tokens: plans.reduce((sum, entry) => sum + entry.tokens, 0),
          usd: plans.reduce((sum, entry) => sum + entry.usd, 0),
          needsApiKey: apiKey(io) === undefined,
        },
      };
    }
    return {
      sessions,
      estimate: { seconds: plans.reduce((sum, entry) => sum + entry.plan.estimateSeconds, 0) },
    };
  });
}

/** What the run step queued, and which repos have work to drain. */
export interface QueuedBackfill extends RunResult {
  /** Repos with at least one job queued, absolute. */
  repos: string[];
}

/** The `BackfillIo` for one repo, over a shared connection. */
async function backfillIo(db: IndexDb, root: string, io: OnboardingIo): Promise<BackfillIo> {
  const ids = await import("@workledger/core/ids");
  return {
    db,
    root,
    adapter: claudeCodeAdapter,
    homeDir: io.homeDir,
    stdout: io.stderr,
    stderr: io.stderr,
    now: io.now,
    newId: ids.newSessionId,
    newBacklogId: ids.newBacklogId,
    apiKey: () => apiKey(io),
    home: io.indexHome,
  };
}

/**
 * The run step, first half: open a session row and queue a job for every fresh session.
 *
 * Returns as soon as the rows exist — the route's 202 says "queued", not "done" — and leaves the
 * draining to {@link drainOnboardingBackfill}, which `serve` starts in the background and
 * `workledger onboard` awaits. Method `resume` queues `repair` jobs, the P3 kind a resume is;
 * method `extract` queues `extract` jobs, so no harness is ever resumed for a session the operator
 * chose not to resume.
 */
export async function queueOnboardingBackfill(input: RunInput, io: OnboardingIo): Promise<QueuedBackfill> {
  assertRepoPaths(input.repos);
  if (input.consent !== true) {
    throw new OnboardingRefusalError(
      "consent-required",
      "the backfill spends the harness subscription or an API key; retry with consent: true",
    );
  }
  if (input.since === "none" || input.method === "none") return { jobs: [], repos: [] };
  if (input.method === "extract" && apiKey(io) === undefined) {
    throw new OnboardingRefusalError(
      "api-key-required",
      `extraction calls the Anthropic API; set ${API_KEY_ENV} in the server's environment first`,
    );
  }
  for (const root of assertRepoPaths(input.repos)) {
    if (!isEnabled(root)) {
      throw new BacklogOpError(`${root} is not an enabled repo; run init first`, "usage");
    }
  }

  return await withIndex(io, async (db) => {
    const jobs: Job[] = [];
    const repos: string[] = [];
    for (const entry of await planRepos(input, io, db)) {
      if (entry.plan.fresh.length === 0) continue;
      const bio = await backfillIo(db, entry.root, io);
      for (const session of entry.plan.fresh) {
        const ulid = await createBackfilledSession(session, bio);
        const { job } = enqueueJob(db, {
          kind: input.method === "extract" ? "extract" : "repair",
          sessionUlid: ulid,
          repoPath: entry.root,
          newId: bio.newId,
          now: io.now(),
          source: ONBOARDING_SOURCE,
        });
        jobs.push(job as Job);
      }
      repos.push(entry.root);
    }
    return { jobs, repos };
  });
}

/**
 * The run step, second half: drain each repo's queue with the P3 handler.
 *
 * `extractFallback` is what selects the `extract` kind in `drainBackfillJobs`, so a run whose
 * method was `extract` claims the rows the first half queued; a `resume` run claims `repair` rows
 * only. Every outcome lands on its job row, which is what `status` and `job.changed` read.
 */
export async function drainOnboardingBackfill(
  input: { repos: readonly string[]; method: OnboardingMethod },
  io: OnboardingIo,
): Promise<void> {
  if (input.method === "none") return;
  await withIndex(io, async (db) => {
    for (const root of input.repos) {
      const concurrency = loadConfig(root).backfill.concurrency;
      await drainBackfillJobs(
        { extractFallback: input.method === "extract" },
        await backfillIo(db, root, io),
        concurrency,
      );
    }
  });
}

/** The wizard's jobs by lifecycle state, over one open index. */
export function readOnboardingStatus(db: IndexDb): OnboardingStatus {
  const rows = db.connection
    .prepare<[string], { status: string; count: number }>(
      "SELECT status, COUNT(*) AS count FROM jobs WHERE source = ? GROUP BY status",
    )
    .all(ONBOARDING_SOURCE);
  const by = new Map(rows.map((row) => [row.status, row.count]));
  const done = by.get("done") ?? 0;
  const failed = (by.get("failed") ?? 0) + (by.get("cancelled") ?? 0);
  const running = (by.get("running") ?? 0) + (by.get("queued") ?? 0);
  return { total: done + failed + running, done, failed, running, complete: running === 0 };
}

/** The status step. */
export async function onboardingStatus(io: OnboardingIo): Promise<OnboardingStatus> {
  return await withIndex(io, readOnboardingStatus);
}
