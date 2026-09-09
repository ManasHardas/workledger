/**
 * The Claude Code adapter — the only file that knows Claude Code's hook field names.
 *
 * Field list, output shapes and the loop-guard rule are frozen in
 * `docs/contracts/p1/hooks-claude-code.md`; a change to any consumed field is a contract
 * amendment PR, not a patch here.
 *
 * Two rules from that contract shape everything below: unknown fields are ignored, and a missing
 * *required* field logs one stderr line and exits 0. Nothing here throws.
 */
import { EXIT_BLOCK } from "../exit-codes.js";
import type { HookEvent } from "../commands/hook-events.js";
import type {
  EndReasonInput,
  HarnessAdapter,
  HookInput,
  HookInputError,
  StartSource,
} from "./types.js";

import { statSize } from "./types.js";

/** The `harness` value this adapter writes to the ledger and the index. */
export const CLAUDE_CODE = "claude-code";

/** `source` values Claude Code sends on `SessionStart`. */
const START_SOURCES: readonly StartSource[] = ["startup", "resume", "clear", "compact", "fork"];

/** `reason` values Claude Code sends on `SessionEnd`. */
const END_REASONS: readonly EndReasonInput[] = [
  "clear",
  "resume",
  "logout",
  "prompt_input_exit",
  "other",
];

/** A non-empty string field, or `undefined` for anything else (including a wrong type). */
function text(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** One member of `allowed`, or `undefined` — an unrecognized value is treated as absent. */
function oneOf<T extends string>(
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
 * The Claude Code hook protocol.
 *
 * `blockStop` uses the exit-code path rather than a JSON decision field: the field name differs
 * between documentation sections (`decision` vs `permissionDecision`) while
 * "exit 2 + stderr is the blocking message" is stable (hooks-claude-code.md §Outputs emitted).
 */
export const claudeCodeAdapter: HarnessAdapter = {
  harness: CLAUDE_CODE,

  parseHookInput(event: HookEvent, raw: string): HookInput | HookInputError {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // The parser's own message quotes the text around the fault, which is the payload
      // verbatim and has been through no secret scan. Only the fact of the failure is reported.
      return { message: `workledger: hook ${event}: stdin is not valid JSON` };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { message: `workledger: hook ${event}: stdin is not a JSON object` };
    }
    const payload = parsed as Record<string, unknown>;

    // The one field every event must carry: it is half of the `(harness, harness_session_id)`
    // key that makes resume, fork and compact reuse a row instead of forking the ledger.
    const harnessSessionId = text(payload, "session_id");
    if (harnessSessionId === undefined) {
      return { message: `workledger: hook ${event}: payload has no session_id; allowing` };
    }

    return {
      event,
      harnessSessionId,
      transcriptPath: text(payload, "transcript_path"),
      cwd: text(payload, "cwd"),
      source: event === "SessionStart" ? oneOf(payload, "source", START_SOURCES) : undefined,
      model: event === "SessionStart" ? text(payload, "model") : undefined,
      // Absent, null or a non-boolean all read as "no Stop hook has blocked this attempt yet",
      // which is the safe reading: it lets the never-twice guard in the index decide instead.
      stopHookActive: event === "Stop" && payload["stop_hook_active"] === true,
      reason: event === "SessionEnd" ? oneOf(payload, "reason", END_REASONS) : undefined,
    };
  },

  blockStop(reason: string, stderr: (line: string) => void): number {
    stderr(reason);
    return EXIT_BLOCK;
  },

  injectContext(context: string): string {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    });
  },

  transcriptSize: statSize,
};
