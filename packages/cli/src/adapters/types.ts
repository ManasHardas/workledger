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
}

/** A required field the payload did not carry. The hook logs one line and allows. */
export interface HookInputError {
  /** A `workledger:`-prefixed line, already complete. Never quotes the payload. */
  message: string;
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
   * For Claude Code that is exit code 2 with the reason on stderr, never a JSON decision field
   * (docs/contracts/p1/hooks-claude-code.md §Outputs emitted → Stop). Returns the exit code and
   * writes the reason; the caller returns the code unchanged.
   */
  blockStop(reason: string, stderr: (line: string) => void): number;

  /**
   * How this harness is handed extra context at session start. Returns the stdout text — the
   * caller writes it — or `undefined` when the harness has no such channel.
   */
  injectContext(text: string): string | undefined;

  /** Byte size of a transcript, or `undefined` when it cannot be measured. */
  transcriptSize(transcriptPath: string | undefined): number | undefined;
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
