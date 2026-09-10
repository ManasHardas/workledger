/**
 * The Cursor adapter — `docs/contracts/p4/hooks-cursor.md`, frozen 2026-09-09.
 *
 * Cursor is the harness that shares nothing with Claude Code's wire format, so nothing here is
 * shared with `claude-shaped.ts`:
 *
 * - the session id is `conversation_id`, not `session_id` (Cursor's `session_id` on
 *   `sessionStart` is a different, per-window identifier and is not what the ledger keys on);
 * - the repo root is `workspace_roots[0]`, not `cwd`;
 * - the author's email is `user_email`, which the ledger prefers over git's `user.email`;
 * - a block is `{ "followup_message": … }` on **stdout with exit 0**, not exit 2 on stderr;
 * - context injection is `{ "additional_context": … }`, not `hookSpecificOutput`.
 *
 * Cursor is not installed on the reference machine, so this adapter is verified by unit tests
 * over payloads synthesized from that contract — and its headless resume is unverified, which is
 * why {@link cursorAdapter} deliberately has no `resumeHeadless` and names extraction instead.
 *
 * Nothing here throws.
 */
import { EXIT_OK } from "../exit-codes.js";
import type { HookEvent } from "../commands/hook-events.js";
import type {
  BlockOutput,
  EndReasonInput,
  HarnessAdapter,
  HookInput,
  HookInputError,
  StartSource,
} from "./types.js";

import { oneOfField, statSize, textField } from "./types.js";

/** The `harness` value this adapter writes to the ledger and the index. */
export const CURSOR = "cursor";

/**
 * What `repair` prints for a Cursor session, verbatim from hooks-cursor.md §Repair and backfill.
 *
 * The Cursor CLI's headless resume is not verified on this machine, and a repair that guessed at
 * an unverified invocation would spend a session's worth of tokens to find out it guessed wrong.
 */
export const CURSOR_NO_RESUME =
  "Cursor sessions can be repaired only by extraction; run with --extract";

/** `sessionStart` sources. Cursor has no `fork`; unrecognized values read as absent. */
const START_SOURCES: readonly StartSource[] = ["startup", "resume", "clear", "compact"];

/** `sessionEnd` reasons, mapped by `hook.ts` to the ledger's `end_reason` enum. */
const END_REASONS: readonly EndReasonInput[] = [
  "clear",
  "resume",
  "logout",
  "prompt_input_exit",
  "other",
];

/** The first entry of `workspace_roots`, when it is a non-empty array of non-empty strings. */
function firstWorkspaceRoot(payload: Record<string, unknown>): string | undefined {
  const roots = payload["workspace_roots"];
  if (!Array.isArray(roots)) return undefined;
  const first = roots[0];
  return typeof first === "string" && first !== "" ? first : undefined;
}

/**
 * `loop_count > 0` — the contract's "treated like `stop_hook_active`".
 *
 * Cursor counts its own retries rather than flagging them, so any count above zero means this
 * Stop is already a re-run of one workledger asked for. Reading it as `stop_hook_active` puts it
 * through the same allow branch, which is the documented loop guard and is what keeps a session
 * from being blocked twice for one threshold crossing.
 */
function loopCountActive(payload: Record<string, unknown>): boolean {
  const count = payload["loop_count"];
  return typeof count === "number" && Number.isFinite(count) && count > 0;
}

/** The Cursor hook protocol. */
export const cursorAdapter: HarnessAdapter = {
  harness: CURSOR,

  parseHookInput(event: HookEvent, raw: string): HookInput | HookInputError {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // The parser's message quotes the text around the fault, which is the payload verbatim and
      // has been through no secret scan. Only the fact of the failure is reported.
      return { message: `workledger: hook ${event}: stdin is not valid JSON` };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { message: `workledger: hook ${event}: stdin is not a JSON object` };
    }
    const payload = parsed as Record<string, unknown>;

    // The universal field, and the half of `(harness, harness_session_id)` that makes a resumed
    // conversation reuse its ledger row instead of forking it.
    const harnessSessionId = textField(payload, "conversation_id");
    if (harnessSessionId === undefined) {
      return { message: `workledger: hook ${event}: payload has no conversation_id; allowing` };
    }

    // Listed by the contract on `sessionStart` and `sessionEnd`, but honoured wherever it
    // appears: "never blocked" is a property of the session, and a `stop` payload that carries
    // the flag is the only chance the Stop branch gets to see it.
    const background = payload["is_background_agent"] === true;

    return {
      event,
      harnessSessionId,
      // `null` in cloud agents and when transcripts are disabled; that disables the bytes
      // threshold for the session and leaves turns and minutes to do the work.
      transcriptPath: textField(payload, "transcript_path"),
      cwd: firstWorkspaceRoot(payload),
      source: event === "SessionStart" ? oneOfField(payload, "source", START_SOURCES) : undefined,
      // Cursor reports no model. `composer_mode` ("agent", "ask", …) is the nearest descriptor of
      // what ran, and the frontmatter's `model` is nullable prose, so it is recorded there rather
      // than dropped — a `model` field, if a future Cursor sends one, wins.
      model:
        event === "SessionStart"
          ? (textField(payload, "model") ?? textField(payload, "composer_mode"))
          : undefined,
      stopHookActive: event === "Stop" && loopCountActive(payload),
      reason: event === "SessionEnd" ? oneOfField(payload, "reason", END_REASONS) : undefined,
      neverBlock: background,
      userEmail: textField(payload, "user_email"),
    };
  },

  /**
   * A block is a JSON object on stdout and exit 0 — Cursor reads the decision from the document,
   * not from the exit code, and a non-zero exit here would be read as a broken hook rather than
   * as a continuation (hooks-cursor.md §Outputs).
   *
   * Cursor loops at most `loop_limit` (2) times, which is the same shape as the block/retry rule
   * the state machine already implements.
   */
  blockStop(reason: string, out: BlockOutput): number {
    out.stdout(JSON.stringify({ followup_message: reason }));
    return EXIT_OK;
  },

  injectContext(context: string): string {
    return JSON.stringify({ additional_context: context });
  },

  transcriptSize: statSize,

  // No `resumeHeadless`: see {@link CURSOR_NO_RESUME}.
  noResumeMessage: CURSOR_NO_RESUME,
};
