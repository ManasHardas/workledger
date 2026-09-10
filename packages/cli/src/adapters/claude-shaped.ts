/**
 * The payload shape Claude Code defined and Codex adopted.
 *
 * `docs/contracts/p4/hooks-codex.md` §Inputs consumed is field-for-field the P1 Claude Code
 * contract's table with a shorter `source` list and a `reason` that is currently always `other`.
 * That is not a coincidence to be re-typed twice: it is the reason P4a is half a session, so the
 * reader lives here once and each adapter supplies only the enums it admits.
 *
 * Nothing in here throws. Malformed JSON and a missing `session_id` come back as a
 * {@link HookInputError}, because a hook that throws is a hook that wedges a session.
 */
import type { HookEvent } from "../commands/hook-events.js";
import type { EndReasonInput, HookInput, HookInputError, StartSource } from "./types.js";

import { oneOfField, textField } from "./types.js";

/** The enums one Claude-shaped harness admits. */
export interface ClaudeShapedDialect {
  /** `source` values this harness sends on `SessionStart`; anything else reads as absent. */
  startSources: readonly StartSource[];
  /** `reason` values this harness sends on `SessionEnd`; anything else reads as absent. */
  endReasons: readonly EndReasonInput[];
}

/**
 * Read one Claude-shaped payload.
 *
 * `session_id` is the one field every event must carry: it is half of the
 * `(harness, harness_session_id)` key that makes resume, fork and compact reuse a row instead of
 * forking the ledger.
 *
 * A `transcript_path` that is absent, `null` or empty comes back as `undefined`, which is what
 * disables the bytes threshold for the session and marks provenance unavailable
 * (hooks-codex.md §Inputs consumed). Turns and minutes are unaffected.
 */
export function parseClaudeShaped(
  event: HookEvent,
  raw: string,
  dialect: ClaudeShapedDialect,
): HookInput | HookInputError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // The parser's own message quotes the text around the fault, which is the payload verbatim
    // and has been through no secret scan. Only the fact of the failure is reported.
    return { message: `workledger: hook ${event}: stdin is not valid JSON` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { message: `workledger: hook ${event}: stdin is not a JSON object` };
  }
  const payload = parsed as Record<string, unknown>;

  const harnessSessionId = textField(payload, "session_id");
  if (harnessSessionId === undefined) {
    return { message: `workledger: hook ${event}: payload has no session_id; allowing` };
  }

  return {
    event,
    harnessSessionId,
    transcriptPath: textField(payload, "transcript_path"),
    cwd: textField(payload, "cwd"),
    source: event === "SessionStart" ? oneOfField(payload, "source", dialect.startSources) : undefined,
    model: event === "SessionStart" ? textField(payload, "model") : undefined,
    // Absent, null or a non-boolean all read as "no Stop hook has blocked this attempt yet",
    // which is the safe reading: it lets the never-twice guard in the index decide instead.
    stopHookActive: event === "Stop" && payload["stop_hook_active"] === true,
    reason: event === "SessionEnd" ? oneOfField(payload, "reason", dialect.endReasons) : undefined,
    // Neither Claude Code nor Codex has a session class that must never be blocked, and neither
    // reports an author: git config is the only identity for both.
    neverBlock: false,
    userEmail: undefined,
  };
}
