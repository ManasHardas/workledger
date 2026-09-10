/**
 * The harness-adapter seam.
 *
 * `commands/hook.ts` holds the state machine (plans/feature-p1-data-flow.md §2) and knows
 * nothing about any harness's wire format; an adapter holds the field names and the
 * output conventions of one harness and knows nothing about the state machine. P1 ships one
 * implementation (`claude-code.ts`); P4 adds siblings, and adding one must not touch `hook.ts`.
 */
import { statSync } from "node:fs";

import type { HookEvent } from "../commands/hook-events.js";
import type { UsageLimit } from "./usage-limit.js";

/** Why a `SessionStart` fired, normalized across harnesses. */
export type StartSource = "startup" | "resume" | "clear" | "compact" | "fork";

/** Why a session ended, as the harness reported it — mapped to the ledger's enum by `hook.ts`. */
export type EndReasonInput = "clear" | "resume" | "logout" | "prompt_input_exit" | "other";

/** One hook payload after the adapter has read it. Unknown fields are dropped here. */
export interface HookInput {
  /** The event the payload belongs to — echoed back so a mismatched payload is visible. */
  event: HookEvent;
  /** The harness's own session identifier; half of the index's `(harness, id)` reuse key. */
  harnessSessionId: string;
  /** Absolute path of the transcript file, when the harness reports one. */
  transcriptPath: string | undefined;
  /** The harness's working directory, where the repo-root walk starts. */
  cwd: string | undefined;
  /** `SessionStart` only. */
  source: StartSource | undefined;
  /** `SessionStart` only; recorded in the session frontmatter. */
  model: string | undefined;
  /** `Stop` only: the documented loop guard. Absent is read as `false`. */
  stopHookActive: boolean;
  /** `SessionEnd` only. */
  reason: EndReasonInput | undefined;
  /**
   * The harness told us this session must never be blocked, whatever the thresholds say.
   *
   * Distinct from {@link HookInput.stopHookActive}, which means "a Stop hook has already blocked
   * this attempt": this one is a property of the session, not of the attempt. Cursor's background
   * agents are the case it exists for — nobody is at the keyboard to read a `followup_message`,
   * so the contract records them and never blocks them (docs/contracts/p4/hooks-cursor.md
   * §Inputs consumed).
   */
  neverBlock: boolean;
  /**
   * The author's email as the harness reported it, when it reports one.
   *
   * Cursor's payloads carry `user_email`; the ledger prefers it over git's `user.email` because
   * it is the identity the session actually ran as (hooks-cursor.md §Inputs consumed). Absent for
   * every other harness, where git config is the only source.
   */
  userEmail: string | undefined;
}

/** A required field the payload did not carry. The hook logs one line and allows. */
export interface HookInputError {
  /** A `workledger:`-prefixed line, already complete. Never quotes the payload. */
  message: string;
}

/** What {@link HarnessAdapter.resumeHeadless} is asked to do. */
export interface ResumeOptions {
  /** Working directory the resumed session is pinned to — the enabled repo root. */
  cwd: string;
  /** The prompt handed to the resumed agent (`src/instruction.ts`). */
  instruction: string;
  /**
   * The only tools the resumed session may use. `repair` passes
   * `["Bash(workledger checkpoint*)"]`: the point of the resume is one checkpoint, and a
   * repair that could edit files would be a second session's worth of work nobody asked for.
   */
  allowedTools: readonly string[];
  /** Kill the child after this long and report `timedOut`. */
  timeoutMs: number;
  /** Extra environment for the child, merged over the parent's. */
  env?: Record<string, string | undefined>;
}

/** What one headless resume did. */
export interface ResumeResult {
  /** The child's exit code, or `null` when it was killed. */
  exitCode: number | null;
  /** `true` when {@link ResumeOptions.timeoutMs} elapsed and the child was killed. */
  timedOut: boolean;
  /** stdout and stderr, interleaved, capped. Never written to the repo. */
  output: string;
  /** Present when the harness could not be spawned at all. */
  spawnError?: string;
}

/**
 * The two streams a block may be written to.
 *
 * Claude Code and Codex block with exit 2 and the reason on stderr; Cursor blocks with a JSON
 * object on *stdout* and exit 0 (docs/contracts/p4/hooks-cursor.md §Outputs). The state machine
 * hands an adapter both and lets it choose, rather than encoding either convention in `hook.ts`.
 */
export interface BlockOutput {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** What one harness's hook protocol looks like on the wire. */
export interface HarnessAdapter {
  /** The `harness` value written to the ledger and to the index. */
  readonly harness: string;

  /**
   * Read one payload. Never throws: malformed JSON and a missing required field both come back
   * as a {@link HookInputError}, because a hook that throws is a hook that blocks a session.
   */
  parseHookInput(event: HookEvent, raw: string): HookInput | HookInputError;

  /**
   * How this harness is told to keep going instead of stopping.
   *
   * For Claude Code and Codex that is exit code 2 with the reason on stderr, never a JSON
   * decision field (docs/contracts/p1/hooks-claude-code.md §Outputs emitted → Stop); for Cursor
   * it is `{ "followup_message": … }` on stdout with exit 0. Returns the exit code and writes the
   * reason; the caller returns the code unchanged.
   */
  blockStop(reason: string, out: BlockOutput): number;

  /**
   * How this harness is handed extra context at session start. Returns the stdout text — the
   * caller writes it — or `undefined` when the harness has no such channel.
   */
  injectContext(text: string): string | undefined;

  /** Byte size of a transcript, or `undefined` when it cannot be measured. */
  transcriptSize(transcriptPath: string | undefined): number | undefined;

  /**
   * Why this harness has no headless resume, in the words `repair` should print.
   *
   * Set only on an adapter that omits {@link HarnessAdapter.resumeHeadless}; `repair` prefers it
   * over its own generic wording so a harness can name its own fallback
   * (docs/contracts/p4/hooks-cursor.md §Repair and backfill).
   */
  readonly noResumeMessage?: string;

  /**
   * Resume one of this harness's sessions headlessly and run `instruction` in it.
   *
   * The repair path of docs/contracts/p3/cli.md: the resumed agent already holds the transcript,
   * so workledger never parses one (plans/feature-p3-data-flow.md §Repair by resume). Optional
   * because a harness with no headless resume is a legitimate adapter — `repair` reports exit 5
   * and names the extraction fallback rather than assuming the method exists.
   *
   * Never throws: a harness that is not installed comes back as `spawnError`.
   */
  resumeHeadless?(sessionId: string, options: ResumeOptions): Promise<ResumeResult>;

  /**
   * Whether a resume's output says the harness's subscription window is spent, and when it
   * resets — #100. Optional because only a harness whose wording is known can answer it: an
   * adapter without one has every non-zero exit reported as an ordinary failure, never as a
   * wait. Pure; `now` is the caller's clock so the reset instant is testable.
   */
  detectUsageLimit?(output: string, now: Date): UsageLimit | undefined;
}

/** A non-empty string field, or `undefined` for anything else (including a wrong type). */
export function textField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** One member of `allowed`, or `undefined` — an unrecognized value is treated as absent. */
export function oneOfField<T extends string>(
  payload: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = payload[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * The default {@link HarnessAdapter.transcriptSize}: a `stat`, with every failure read as "no
 * measurement". A transcript the harness has not created yet is the common case at
 * `SessionStart`, and it is not an error.
 */
export function statSize(transcriptPath: string | undefined): number | undefined {
  if (transcriptPath === undefined || transcriptPath === "") return undefined;
  try {
    const size = statSync(transcriptPath).size;
    return Number.isFinite(size) ? size : undefined;
  } catch {
    return undefined;
  }
}
