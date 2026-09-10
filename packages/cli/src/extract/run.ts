/**
 * The extraction fallback — docs/contracts/p3/cli.md §`workledger repair` step 4 and
 * plans/feature-p3-data-flow.md §Extraction fallback.
 *
 * Reached two ways, both of which land in {@link extractCheckpoint}: `repair <ulid> --extract`,
 * which prices the work and asks before spending anything, and `backfill --extract-fallback`,
 * where the consent was given once for the batch and a resume failure queues an `extract` job.
 *
 * Three properties this file exists to hold:
 *
 * - **Consent precedes spend.** The estimate is printed and answered *before* the transcript is
 *   read or a request is composed; a refusal exits 6 having done nothing.
 * - **The digest still goes through `checkpoint`.** The model's payload is validated by the P1
 *   schema and then written by `runCheckpoint`, so extraction gets the secret scan, the backlog
 *   resolution and the atomic render that every other write path gets. Agents never write ledger
 *   markdown directly (CLAUDE.md), and a model reconstructing one is not an exception.
 * - **The transcript goes nowhere but the request.** No cache file, no log, no job column.
 */
import process from "node:process";

import { loadConfig } from "../config.js";
import { EXIT_CONSENT_REFUSED, EXIT_JOB_FAILED, EXIT_OK } from "../exit-codes.js";
import { enqueueJob } from "../jobs/queue.js";
import { runJobs } from "../jobs/runner.js";
import { fileSize } from "../ledger-fs.js";
import {
  API_KEY_ENV,
  EXTRACT_SYSTEM_PROMPT,
  ExtractApiError,
  MAX_OUTPUT_TOKENS,
  callMessages,
  extractJson,
  redactSecrets,
} from "./api.js";
import {
  CHARS_PER_TOKEN,
  chunkRecords,
  keptRecords,
  readSlice,
} from "./transcript.js";
import type { ExtractSettings } from "../config.js";
import type { IndexDb, SessionRow } from "../index/db.js";
import type { JobResult } from "../jobs/runner.js";

/** Options `repair --extract` passes down. */
export interface ExtractOptions {
  /** Skip the spend prompt (cli.md: "ask unless `--yes`"). */
  yes?: boolean;
}

/** Everything the extraction touches outside itself. */
export interface ExtractIo {
  db: IndexDb;
  /** The enabled repo root. */
  root: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now: () => Date;
  /** Mints ids for the job row and for any `new: true` backlog item in the payload. */
  newId: () => string;
  /** Ask the spend question. Absent means "never prompt", which only `--yes` should produce. */
  confirm?: ((question: string) => Promise<boolean>) | undefined;
  /** `ANTHROPIC_API_KEY`, read per call. */
  apiKey?: (() => string | undefined) | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
  home?: string | undefined;
}

/** What one extraction would cost, before anything is spent. */
export interface ExtractEstimate {
  /** Byte offset the slice starts at — the last checkpoint's `transcript_offset`. */
  from: number;
  /** Transcript bytes since that offset. */
  bytes: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  model: string;
}

/**
 * Price a span of transcript.
 *
 * "Cost = input tokens × rate + a fixed 4k output" (data-flow §Extraction fallback). The output
 * side is fixed rather than measured because it cannot be known in advance and a payload is
 * capped at 4096 bytes anyway; over-stating it slightly is the right direction for a number an
 * operator is about to consent to.
 */
export function estimateExtraction(
  bytes: number,
  settings: ExtractSettings,
  from = 0,
): ExtractEstimate {
  const inputTokens = Math.ceil(bytes / CHARS_PER_TOKEN);
  const outputTokens = MAX_OUTPUT_TOKENS;
  const usd =
    (inputTokens / 1_000_000) * settings.usd_per_million_input +
    (outputTokens / 1_000_000) * settings.usd_per_million_output;
  return { from, bytes, inputTokens, outputTokens, usd, model: settings.model };
}

/** USD, at a precision that does not round a real cost down to `$0.00`. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** The estimate lines cli.md asks for: bytes since offset, model, USD at the configured rate. */
export function estimateLines(estimate: ExtractEstimate): string[] {
  return [
    `extract: ${estimate.bytes} transcript bytes since offset ${estimate.from} ` +
      `(~${estimate.inputTokens} input tokens)`,
    `extract: model ${estimate.model}, about ${formatUsd(estimate.usd)} ` +
      `(+${estimate.outputTokens} output tokens)`,
  ];
}

/** A session that cannot be extracted from, and why. */
export interface ExtractBlocked {
  error: string;
}

/**
 * Measure the span this session would send, without reading a byte of it.
 *
 * `last_offset` is where the previous checkpoint stopped describing the session, so the span is
 * exactly the work no digest covers — the same window the Stop hook's `bytes` threshold measures.
 */
export function estimateFor(
  session: SessionRow,
  root: string,
): ExtractEstimate | ExtractBlocked {
  const file = session.transcript_path;
  if (file === null || file === "") {
    return { error: `session ${session.ulid} has no transcript path in the index` };
  }
  const size = fileSize(file);
  if (size === undefined) {
    return { error: `the transcript for session ${session.ulid} is no longer on this machine` };
  }
  const from = Math.min(session.last_offset, size);
  const bytes = size - from;
  if (bytes <= 0) {
    return { error: `session ${session.ulid} has no transcript bytes since its last checkpoint` };
  }
  return estimateExtraction(bytes, loadConfig(root).extract, from);
}

/** The instructions wrapped around one chunk of transcript. */
function chunkPrompt(chunk: string, index: number, total: number, previous: string | null): string {
  const header =
    total === 1
      ? "Here is the session transcript."
      : `Here is part ${index + 1} of ${total} of the session transcript.`;
  const carry =
    previous === null
      ? []
      : [
          "The digest you produced for the earlier parts, to revise and extend rather than replace:",
          previous,
          "",
        ];
  const footer =
    index === total - 1
      ? "Reply with the final CheckpointPayload JSON for the whole session."
      : "Reply with a CheckpointPayload JSON covering everything so far.";
  return [header, "", ...carry, chunk, "", footer].join("\n");
}

/** What one extraction attempt produced. */
export interface ExtractOutcome extends JobResult {
  /** The exit code the command should end with; `0` on success. */
  exitCode: number;
}

/**
 * Read the slice, call the API, validate, and write the checkpoint. No prompting: whoever calls
 * this has already obtained consent.
 *
 * The `pending_trigger` write is the same mechanism the resume path uses — `checkpoint` reads the
 * column and stamps it, so the digest is marked `trigger: extract` without the checkpoint command
 * learning anything about extraction (plans/feature-p3-data-flow.md §Repair by resume).
 */
export async function extractCheckpoint(
  session: SessionRow,
  estimate: ExtractEstimate,
  io: ExtractIo,
): Promise<ExtractOutcome> {
  const { db, root } = io;
  const ulid = session.ulid;

  const key = (io.apiKey ?? (() => process.env[API_KEY_ENV]?.trim() || undefined))();
  if (key === undefined || key === "") {
    return {
      ok: false,
      exitCode: EXIT_JOB_FAILED,
      error: `${API_KEY_ENV} is not set; extraction needs an Anthropic API key in the environment`,
    };
  }

  const slice = readSlice(session.transcript_path as string, estimate.from, estimate.from + estimate.bytes);
  const records = keptRecords(slice);
  if (records.length === 0) {
    return {
      ok: false,
      exitCode: EXIT_JOB_FAILED,
      error: "the transcript span holds no user, assistant or tool-result records",
    };
  }
  const chunks = chunkRecords(records);

  let reply: string;
  let previous: string | null = null;
  try {
    for (const [index, chunk] of chunks.entries()) {
      io.stderr(`extract: chunk ${index + 1}/${chunks.length} → ${estimate.model}`);
      previous = await callMessages({
        model: estimate.model,
        system: EXTRACT_SYSTEM_PROMPT,
        user: chunkPrompt(chunk, index, chunks.length, previous),
        apiKey: key,
        ...(io.fetchImpl === undefined ? {} : { fetchImpl: io.fetchImpl }),
      });
    }
    reply = previous as string;
  } catch (error) {
    // `ExtractApiError` messages are already redacted; anything else is redacted here so a
    // stray `fetch` internal can never carry the key into the job row.
    const detail = error instanceof ExtractApiError ? error.message : redactSecrets(String(error));
    return { ok: false, exitCode: EXIT_JOB_FAILED, error: detail };
  }

  const json = extractJson(reply);
  const { validateCheckpointPayload } = await import("@workledger/core/schema");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return {
      ok: false,
      exitCode: EXIT_JOB_FAILED,
      error: "the model did not return a JSON object",
    };
  }
  const validation = validateCheckpointPayload(parsed);
  if (!validation.ok) {
    // "a failure exits 5 with the errors, no retry loop" — the field paths, never the values.
    for (const issue of validation.errors) io.stderr(`extract: ${issue.path}: ${issue.message}`);
    return {
      ok: false,
      exitCode: EXIT_JOB_FAILED,
      error: `the extracted payload failed validation (${validation.errors.length} error(s))`,
    };
  }

  const { runCheckpoint, stdinFrom } = await import("../commands/checkpoint.js");
  const before = db.countCheckpoints(ulid);
  db.updateSession(ulid, { pending_trigger: "extract", updated_at: io.now().toISOString() });
  let code: number;
  try {
    code = await runCheckpoint(
      { session: ulid },
      {
        // The validated payload, re-serialized: what reaches `checkpoint` is what the schema
        // accepted, not the model's formatting of it.
        readStdin: stdinFrom(JSON.stringify(validation.value)),
        stdout: (line) => io.stderr(line),
        stderr: (line) => io.stderr(line),
        cwd: root,
        home: io.home,
        now: io.now,
        newId: io.newId,
      },
    );
  } finally {
    if (db.getSessionByUlid(ulid)?.pending_trigger !== null) {
      db.updateSession(ulid, { pending_trigger: null, updated_at: io.now().toISOString() });
    }
  }

  if (code !== EXIT_OK || db.countCheckpoints(ulid) <= before) {
    return { ok: false, exitCode: EXIT_JOB_FAILED, error: `the checkpoint was refused (exit ${code})` };
  }

  const { markRepaired } = await import("../commands/repair.js");
  const nowIso = io.now().toISOString();
  await markRepaired(root, ulid, nowIso);
  db.updateSession(ulid, { status: "repaired", updated_at: nowIso });
  return { ok: true, exitCode: EXIT_OK, costEstimateUsd: estimate.usd };
}

/**
 * `workledger repair <ulid> --extract [--yes]`, end to end.
 *
 * The job row is created *after* consent so a refusal leaves nothing behind, and the work runs
 * through the runner rather than inline so `workledger jobs` shows the attempt and its
 * `cost_estimate_usd` like every other job.
 *
 * @returns the process exit code: `0`, `5` for any failure, `6` when the spend was refused.
 */
export async function runExtract(
  session: SessionRow,
  options: ExtractOptions,
  io: ExtractIo,
): Promise<number> {
  const estimate = estimateFor(session, io.root);
  if ("error" in estimate) {
    io.stderr(`repair: ${estimate.error}`);
    return EXIT_JOB_FAILED;
  }

  for (const line of estimateLines(estimate)) io.stderr(line);

  if (options.yes !== true) {
    const granted =
      io.confirm === undefined
        ? false
        : await io.confirm(
            `Spend about ${formatUsd(estimate.usd)} on ${estimate.model} to reconstruct ` +
              `the digest for session ${session.ulid}?`,
          );
    if (!granted) {
      io.stderr("extract: cancelled; nothing was sent and nothing was written");
      return EXIT_CONSENT_REFUSED;
    }
  }

  enqueueJob(io.db, {
    kind: "extract",
    sessionUlid: session.ulid,
    repoPath: io.root,
    newId: io.newId,
    now: io.now(),
  });

  let outcome: ExtractOutcome | undefined;
  const summary = await runJobs(io.db, {
    repoPath: io.root,
    kinds: ["extract"],
    sessionUlid: session.ulid,
    concurrency: 1,
    limit: 1,
    now: io.now,
    progress: io.stderr,
    handler: async () => {
      outcome = await extractCheckpoint(session, estimate, io);
      return outcome;
    },
  });

  if (summary.done === 1) {
    io.stdout(`repair: session ${session.ulid} repaired by extraction`);
    return EXIT_OK;
  }
  io.stderr(`repair: session ${session.ulid} not repaired — ${outcome?.error ?? "no job was run"}`);
  return outcome?.exitCode ?? EXIT_JOB_FAILED;
}
