/**
 * The job backend the server is *given*, the same way `./ops.ts` gives it the backlog writer.
 *
 * `docs/contracts/p3/api.md` puts six job routes and an excerpt route on the server, but every
 * one of them is really a read or a write of `~/.workledger/index.sqlite` — a `better-sqlite3`
 * native binding that lives in `packages/cli` and must not be pulled into this package (the same
 * reason `./health.ts` reports the index by path and size rather than opening it). `packages/cli`
 * already depends on `@workledger/server` to run `workledger serve`, so importing back the other
 * way would be a cycle, and the CLI ships as one bundled `dist/main.js` with no exports map —
 * there would be nothing to import even if the cycle were acceptable.
 *
 * So this file declares the *shape* of that backend and `packages/cli/src/commands/serve.ts`
 * satisfies it structurally, which makes a drift a compile error at the injection site rather
 * than a 500 at runtime.
 *
 * `backfill` and `estimateExtract` are optional because the CLI modules that implement them
 * (#54, #56) land beside this one rather than before it. A route whose op is absent answers 501
 * instead of pretending — see `./routes/jobs.ts`.
 */

/** One `jobs` row, verbatim — api.md: "`Job` = the `jobs` row from docs/contracts/p3/cli.md". */
export interface Job {
  id: string;
  kind: string;
  session_ulid: string;
  repo_path: string;
  status: string;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  error: string | null;
  cost_estimate_usd: number | null;
  log_path: string | null;
}

/** `POST /api/jobs/scan` — cli.md's "`<n>` orphaned, `<m>` repair job(s) queued". */
export interface ScanSummary {
  orphaned: number;
  queued: number;
}

/**
 * What extracting one session would cost — cli.md §repair step 4, "`transcript bytes since
 * offset`, model, USD at the configured rate".
 *
 * Forwarded to the client unchanged, so an implementation that carries more than these three
 * fields keeps them.
 */
export interface ExtractEstimate {
  bytes: number;
  model: string;
  usd: number;
}

/** What backfilling would cost — cli.md §backfill step 2, "count, total bytes, oldest", seconds. */
export interface BackfillEstimate {
  count: number;
  bytes: number;
  /** ISO 8601 mtime of the oldest candidate; `null` when there are none. */
  oldest: string | null;
  seconds: number;
}

/** `POST /api/jobs/backfill` body, after validation. */
export interface BackfillInput {
  since: string;
  concurrency?: number | undefined;
  extractFallback?: boolean | undefined;
  /** False means "estimate only": the op queues nothing and returns an empty `jobs` list. */
  consent: boolean;
}

/** `POST /api/jobs/repair` body, after validation. */
export interface RepairInput {
  session: string;
  /** Reconstruct the digest from the transcript when the resume path cannot run. */
  extract: boolean;
  /** The operator has agreed to the extraction spend. Only consulted when `extract` is true. */
  consent: boolean;
}

/**
 * Where one checkpoint's slice of a transcript is — data-flow §Excerpts, "bytes
 * `[offset(n-1), offset(n))` from the transcript (path from the index)".
 */
export interface ExcerptSpan {
  /** Absolute path, as the index recorded it. The file may since have been deleted. */
  transcriptPath: string;
  from: number;
  to: number;
}

/**
 * The index-backed operations, exactly as `packages/cli/src/commands/serve.ts` supplies them.
 *
 * Every method refuses by throwing an `OpError` (`./ops.ts`), which the routes map onto the
 * contract's 400 / 404 / 409; nothing here prints or decides an exit code.
 */
export interface JobOps {
  /** Jobs for this repo, newest first; `status` narrows to one lifecycle state. */
  listJobs(repoRoot: string, status?: string): Promise<Job[]>;
  /** One orphan sweep (cli.md §scan). */
  scan(repoRoot: string): Promise<ScanSummary>;
  /** Queue — and, on the resume path, start — a repair for one session. */
  repair(repoRoot: string, input: RepairInput): Promise<Job>;
  /** `queued | running` → `cancelled`. */
  cancelJob(repoRoot: string, id: string): Promise<Job>;
  /** `failed | cancelled` → `queued`. */
  retryJob(repoRoot: string, id: string): Promise<Job>;
  /**
   * The byte range of checkpoint `cp` in its session's transcript, or `undefined` when the
   * session or the checkpoint is not in the index.
   */
  excerptSpan(repoRoot: string, ulid: string, cp: number): Promise<ExcerptSpan | undefined>;
  /**
   * The extraction estimate a refused consent has to report (api.md: "extract without consent →
   * 409 `{ code: "consent-required", estimate }`"). Optional until #54 lands.
   */
  estimateExtract?(repoRoot: string, session: string): Promise<ExtractEstimate>;
  /**
   * Backfill, dry or wet. `input.consent === false` must queue nothing and come back with an
   * empty `jobs` list — the route answers 200 rather than 202 for exactly that case. Optional
   * until #56 lands.
   */
  backfill?(
    repoRoot: string,
    input: BackfillInput,
  ): Promise<{ jobs: Job[]; estimate: BackfillEstimate }>;
}
