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
import { runInitReport } from "../commands/init.js";
import { EXIT_OK } from "../exit-codes.js";
import { assertRepoPaths } from "./repo-path.js";
import type { InitIo } from "../commands/init.js";
import type { OnboardingIo } from "./io.js";
import type { InitInput, InitRepoResult, InitResult } from "@workledger/server";

/** The step. One repo's failure is reported in its own row and stops nothing else. */
export async function initRepos(input: InitInput, io: OnboardingIo): Promise<InitResult> {
  const results: InitRepoResult[] = [];
  for (const repo of assertRepoPaths(input.repos)) {
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
      const report = await runInitReport(
        {
          repo,
          yes: true,
          backfill: false,
          ...(input.harnesses === undefined ? {} : { harness: input.harnesses }),
        },
        initIo,
      );
      const ok = report.code === EXIT_OK;
      results.push({
        path: repo,
        ok,
        hooksWritten: report.hooksWritten,
        trustSteps: report.trustSteps,
        ...(ok ? {} : { error: err.length > 0 ? err.join("\n") : `init exited ${report.code}` }),
      });
    } catch (error) {
      // A hook file that is not JSON, a directory that cannot be written: `init` throws for the
      // things it cannot describe as an exit code. The wizard shows the row red with the reason.
      results.push({
        path: repo,
        ok: false,
        hooksWritten: [],
        trustSteps: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { results };
}
