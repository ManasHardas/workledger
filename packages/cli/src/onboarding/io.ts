/**
 * The environment every onboarding op reads — docs/contracts/p8/daemon-and-api.md §Onboarding
 * endpoints.
 *
 * One shape for two callers. `workledger onboard` fills it from the process; `workledger serve`
 * fills it from the `ServeIo` it already holds and hands the result to `@workledger/server` as
 * its `OnboardingOps`. Neither the ops nor the routes read `process` themselves, which is what
 * lets a test point the whole wizard at a temp home with fixture transcripts.
 */
import os from "node:os";
import process from "node:process";

import type { IndexDb } from "../index/db.js";

/** Everything the onboarding ops touch outside themselves. */
export interface OnboardingIo {
  /**
   * The operating-system home: where the harness stores (`~/.claude/projects`,
   * `~/.codex/sessions`), the default root (`~/Projects`) and the global git config live.
   */
  homeDir: string;
  /** `PATH` for the harness probes, `ANTHROPIC_API_KEY` for the extraction estimate. */
  env: Record<string, string | undefined>;
  /** Where a relative repo path resolves from. */
  cwd: string;
  /** Progress and per-repo `init` output. Nothing here is part of the wire format. */
  stderr: (line: string) => void;
  now: () => Date;
  /** Overrides `WORKLEDGER_HOME` for the index. Absent means the environment's. */
  indexHome?: string | undefined;
}

/** The real process. */
export function processOnboardingIo(): OnboardingIo {
  const indexHome = process.env["WORKLEDGER_HOME"]?.trim();
  return {
    homeDir: os.homedir(),
    env: process.env,
    cwd: process.cwd(),
    stderr: (line) => void process.stderr.write(`${line}\n`),
    now: () => new Date(),
    ...(indexHome ? { indexHome } : {}),
  };
}

/**
 * Run `body` against a freshly opened index and close it after — the connection-per-call rule
 * `commands/serve.ts` follows, for the same reason: a `serve` process must not hold a SQLite
 * handle open across its whole life while `workledger backfill` writes the same file.
 */
export async function withIndex<T>(io: OnboardingIo, body: (db: IndexDb) => Promise<T> | T): Promise<T> {
  const { openIndex } = await import("../index/db.js");
  const db = openIndex(io.indexHome === undefined ? {} : { home: io.indexHome });
  try {
    return await body(db);
  } finally {
    db.close();
  }
}
