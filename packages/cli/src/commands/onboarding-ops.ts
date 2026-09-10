/**
 * The onboarding backend `workledger serve` injects into `@workledger/server` — the P8 sibling
 * of `jobOps` in `./serve.ts`, for the same reason: the server declares the shape
 * (`OnboardingOps`) and this file satisfies it from `src/onboarding/`, so a drift is a `tsc`
 * error here rather than a 500 in front of the wizard.
 *
 * `run` answers as soon as the rows exist and drains them in the background; the outcome of each
 * job lands on its row, which `GET /api/onboarding/status` and `job.changed` both read.
 *
 * @param startDrain what a consented run hands its queue to. Injectable because the default
 * resumes every backfilled session in a child process, which a test must be able to decline
 * without also declining the queueing this function is responsible for.
 */
import os from "node:os";

import { backfillPlan, drainOnboardingBackfill, onboardingStatus, queueOnboardingBackfill } from "../onboarding/backfill.js";
import { discoverRepos } from "../onboarding/discover.js";
import { historyWindows } from "../onboarding/history.js";
import { initRepos } from "../onboarding/init.js";
import { listWorkspaces } from "../onboarding/workspaces.js";
import type { OnboardingIo } from "../onboarding/io.js";
import type { ServeIo } from "./serve.js";
import type { OnboardingMethod, OnboardingOps } from "@workledger/server";

/** The ops' view of `serve`'s environment: `HOME` for the stores, `WORKLEDGER_HOME` for the index. */
export function onboardingIoFor(io: ServeIo): OnboardingIo {
  const indexHome = io.env["WORKLEDGER_HOME"]?.trim();
  return {
    homeDir: io.env["HOME"]?.trim() || os.homedir(),
    env: io.env,
    cwd: io.cwd,
    stderr: io.stderr,
    now: () => new Date(),
    ...(indexHome ? { indexHome } : {}),
  };
}

/** The injection. */
export function onboardingOps(
  io: ServeIo,
  startDrain: (repos: string[], method: OnboardingMethod) => void = (repos, method) => {
    // Nothing is thrown out of here: an unhandled rejection would take the whole `serve` process
    // down over one backfill, and every per-job failure is already on its row.
    void drainOnboardingBackfill({ repos, method }, onboardingIoFor(io)).catch((error: unknown) => {
      io.stderr(`serve: onboarding backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  },
): OnboardingOps {
  const oio = onboardingIoFor(io);
  return {
    discover: async (roots) => discoverRepos({ roots }, oio),
    history: async (repos) => historyWindows(repos, oio),
    init: (input) => initRepos(input, oio),
    plan: (input) => backfillPlan(input, oio),
    run: async (input) => {
      const queued = await queueOnboardingBackfill(input, oio);
      if (queued.repos.length > 0) startDrain(queued.repos, input.method);
      return { jobs: queued.jobs };
    },
    status: () => onboardingStatus(oio),
    workspaces: () => listWorkspaces(oio),
  };
}
