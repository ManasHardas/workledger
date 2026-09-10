/**
 * `initRepos` — `POST /api/onboarding/init`: `workledger init --yes` in each selected repo.
 *
 * Not a second implementation of `init`. Each repo goes through `runInitReport`, the body of the
 * command itself, with the confirmation answered `yes` and the backfill offer declined (the
 * wizard's next two steps are that offer). That is what makes the contract's "writes exactly what
 * `workledger init --yes` writes" true by construction, including its one refusal — a repo whose
 * git identity is empty — and its idempotence: a repo that is already enabled gets its missing
 * hook files and nothing else, and reports no hook written when none was.
 *
 * Every path is checked first (`./repo-path.ts`): one relative or non-git entry refuses the
 * whole request before any repo is touched, because a plain directory must never be scaffolded.
 */
import path from "node:path";

import { runInitReport } from "../commands/init.js";
import { runWorkspaceInit } from "../commands/init-workspace.js";
import { EXIT_OK } from "../exit-codes.js";
import { assertRepoPaths, assertRootPaths } from "./repo-path.js";
import type { InitIo, InitReport } from "../commands/init.js";
import type { OnboardingIo } from "./io.js";
import type { InitInput, InitRepoResult, InitResult } from "@workledger/server";

/**
 * The step. One repo's failure is reported in its own row and stops nothing else. Workspaces
 * (amendment 8) run after the repos, so a folder whose only tracked repo is one this very call
 * enables passes `init --workspace`'s "holds a tracked repo" check.
 */
export async function initRepos(input: InitInput, io: OnboardingIo): Promise<InitResult> {
  const repos = assertRepoPaths(input.repos);
  const workspaces = input.workspaces === undefined ? undefined : assertRootPaths(input.workspaces);
  const harness = input.harnesses === undefined ? {} : { harness: input.harnesses };
  const results: InitRepoResult[] = [];
  for (const repo of repos) {
    results.push(await one(repo, io, (initIo) => runInitReport({ repo, yes: true, backfill: false, ...harness }, initIo)));
  }
  if (workspaces === undefined) return { results };
  const enabled = results.filter((result) => result.ok).map((result) => result.path);
  const done: InitRepoResult[] = [];
  for (const workspace of workspaces) {
    done.push(
      await one(workspace, io, (initIo) =>
        runWorkspaceInit(path.resolve(workspace), { yes: true, backfill: false, selected: enabled, ...harness }, initIo),
      ),
    );
  }
  return { results, workspaces: done };
}

/** One `init` run, its outcome as a row. */
async function one(target: string, io: OnboardingIo, run: (initIo: InitIo) => Promise<InitReport>): Promise<InitRepoResult> {
  const err: string[] = [];
  const initIo: InitIo = {
    cwd: io.cwd,
    env: io.env,
    homeDir: io.homeDir,
    // `init`'s own narration is progress, not wire format: it goes to the log, not the result.
    stdout: io.stderr,
    stderr: (line) => {
      err.push(line);
      io.stderr(line);
    },
    confirm: async () => true,
  };
  try {
    const report = await run(initIo);
    const ok = report.code === EXIT_OK;
    return {
      path: target,
      ok,
      hooksWritten: report.hooksWritten,
      trustSteps: report.trustSteps,
      ...(ok ? {} : { error: err.length > 0 ? err.join("\n") : `init exited ${report.code}` }),
    };
  } catch (error) {
    // A hook file that is not JSON, a directory that cannot be written: `init` throws for the
    // things it cannot describe as an exit code. The wizard shows the row red with the reason.
    return {
      path: target,
      ok: false,
      hooksWritten: [],
      trustSteps: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
