/**
 * `workledger jobs [--json] [--repo <path>] [--cancel <id>] [--retry <id>]` —
 * docs/contracts/p3/cli.md §Jobs.
 *
 * The operator's view of the queue `scan` fills and `repair` drains. Every state change it can
 * make is one call into `src/jobs/queue.ts`; what is here is the argument handling and the table.
 */
import process from "node:process";

import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { cancelJob, listJobs, retryJob } from "../jobs/queue.js";
import { findRepoRoot, isEnabled } from "../ledger-fs.js";
import type { IndexDb } from "../index/db.js";
import type { JobRow } from "../jobs/queue.js";

/** Options commander parses for `jobs`. */
export interface JobsOptions {
  repo?: string;
  json?: boolean;
  /** Job id: `queued` → `cancelled`, `running` → `cancelled`. */
  cancel?: string;
  /** Job id: `failed | cancelled` → `queued`. */
  retry?: string;
}

/** Everything the command touches outside itself. */
export interface JobsIo {
  db: IndexDb;
  root: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now: () => Date;
}

/** `2026-09-09T12:34:56.000Z` → `2026-09-09 12:34`; `null` → `-`. */
function short(at: string | null): string {
  if (at === null) return "-";
  return at.length >= 16 ? `${at.slice(0, 10)} ${at.slice(11, 16)}` : at;
}

/** The listing, one job per line, padded so the columns line up. */
export function jobsTable(jobs: readonly JobRow[]): string[] {
  if (jobs.length === 0) return ["jobs: none"];
  const width = (pick: (job: JobRow) => string): number =>
    jobs.reduce((max, job) => Math.max(max, pick(job).length), 0);
  const kindWidth = width((job) => job.kind);
  const statusWidth = width((job) => job.status);
  return jobs.map((job) =>
    [
      job.id,
      job.kind.padEnd(kindWidth),
      job.status.padEnd(statusWidth),
      job.session_ulid,
      `attempts=${job.attempts}`,
      short(job.created_at),
      job.error === null ? "" : `— ${job.error.split("\n")[0] ?? ""}`,
    ]
      .filter((cell) => cell !== "")
      .join("  "),
  );
}

/** @returns the process exit code. */
export function runJobsCommand(options: JobsOptions, io: JobsIo): number {
  if (options.cancel !== undefined && options.retry !== undefined) {
    io.stderr("jobs: --cancel and --retry are mutually exclusive");
    return EXIT_USAGE;
  }

  if (options.cancel !== undefined || options.retry !== undefined) {
    const id = options.cancel ?? (options.retry as string);
    const result =
      options.cancel !== undefined ? cancelJob(io.db, id, io.now()) : retryJob(io.db, id);
    if ("message" in result) {
      io.stderr(`jobs: ${result.message}`);
      return EXIT_USAGE;
    }
    io.stdout(
      options.json === true
        ? JSON.stringify(result)
        : `jobs: ${result.id} ${options.cancel !== undefined ? "cancelled" : "queued"}`,
    );
    return EXIT_OK;
  }

  const jobs = listJobs(io.db, io.root);
  if (options.json === true) {
    io.stdout(JSON.stringify({ repo: io.root, jobs }));
  } else {
    for (const line of jobsTable(jobs)) io.stdout(line);
  }
  return EXIT_OK;
}

/** @returns the process exit code. */
export async function jobsCommand(options: JobsOptions): Promise<number> {
  const from = options.repo ?? process.cwd();
  const root = findRepoRoot(from);
  if (root === undefined || !isEnabled(root)) {
    process.stderr.write(`workledger: ${from} is not an enabled repo; run \`workledger init\` first\n`);
    return EXIT_NOT_ENABLED;
  }

  const { openIndex } = await import("../index/db.js");
  const home = process.env["WORKLEDGER_HOME"]?.trim();
  const db = openIndex(home ? { home } : {});
  try {
    return runJobsCommand(options, {
      db,
      root,
      stdout: (line) => void process.stdout.write(`${line}\n`),
      stderr: (line) => void process.stderr.write(`${line}\n`),
      now: () => new Date(),
    });
  } finally {
    db.close();
  }
}
