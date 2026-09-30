/**
 * The OpenCode adapter.
 *
 * OpenCode has no external hook command the way Claude Code, Codex and Cursor do. Its extension
 * point is a **plugin** — a TypeScript module opencode loads from `.opencode/plugins/` — and that
 * plugin is workledger's (`src/opencode-hooks.ts` renders it). The plugin translates opencode's
 * event bus into the three workledger events and invokes
 * `workledger hook <Event> --harness opencode` with the payload below on stdin.
 *
 * Because the plugin is ours, the payload is ours too, and it is deliberately close to the
 * Claude-shaped one: `session_id`, `cwd`, `transcript_path`, `source`, `model`,
 * `stop_hook_active`, `reason`. Two fields are opencode's own:
 *
 * - `never_block` — opencode subagents are sessions with a `parentID`; nobody is at the keyboard
 *   for them, so the plugin marks them and this adapter carries the flag through to the state
 *   machine's `stopHookActive || neverBlock` allow branch (the same reason Cursor has it).
 * - `user_email` — set when the plugin can read the signed-in account's address; absent otherwise.
 *
 * There is no `transcript_path`: opencode keeps sessions in `~/.local/share/opencode/opencode.db`,
 * not in a per-session JSONL, so the plugin sends `null`. That disables the bytes threshold for
 * opencode sessions and marks provenance spans unavailable; turns and minutes still apply
 * (docs/contracts/p4/hooks-opencode.md). The SQLite store is read by `onboarding/stores.ts` for
 * discovery and backfill, not on the live path.
 *
 * Nothing here throws.
 */
import process from "node:process";

import { EXIT_BLOCK } from "../exit-codes.js";
import { spawnResume } from "./spawn-resume.js";
import type { HookEvent } from "../commands/hook-events.js";
import type {
  BlockOutput,
  EndReasonInput,
  HarnessAdapter,
  HookInput,
  HookInputError,
  ResumeOptions,
  ResumeResult,
  StartSource,
} from "./types.js";

import { oneOfField, statSize, textField } from "./types.js";

/** The `harness` value this adapter writes to the ledger and the index. */
export const OPENCODE = "opencode";

/** The executable a headless resume spawns. Overridable so a test can stand in for it. */
export const OPENCODE_BIN_ENV = "WORKLEDGER_OPENCODE_BIN";

/** `source` values the plugin sends on SessionStart. OpenCode has no `fork` event. */
const START_SOURCES: readonly StartSource[] = ["startup", "resume", "clear", "compact"];

/**
 * `reason` values the plugin sends on SessionEnd. `session.deleted` and `session.error` both map
 * to `other` → `unknown`; opencode distinguishes no other end reasons.
 */
const END_REASONS: readonly EndReasonInput[] = ["other"];

/** `true` only for the literal boolean `true`, so junk reads as absent. */
function booleanField(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true;
}

/** The OpenCode hook protocol. */
export const opencodeAdapter: HarnessAdapter = {
  harness: OPENCODE,

  parseHookInput(event: HookEvent, raw: string): HookInput | HookInputError {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // Never quote the payload: it has not been through a secret scan.
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
      // The plugin sends `null`; `textField` reads that as absent, which is the contract's
      // "no transcript" — bytes threshold off, spans unavailable.
      transcriptPath: textField(payload, "transcript_path"),
      cwd: textField(payload, "cwd"),
      source: event === "SessionStart" ? oneOfField(payload, "source", START_SOURCES) : undefined,
      model: event === "SessionStart" ? textField(payload, "model") : undefined,
      stopHookActive: event === "Stop" && booleanField(payload, "stop_hook_active"),
      reason: event === "SessionEnd" ? oneOfField(payload, "reason", END_REASONS) : undefined,
      neverBlock: booleanField(payload, "never_block"),
      userEmail: textField(payload, "user_email"),
    };
  },

  /**
   * The plugin is the one that continues the session: it runs this command, reads the exit code,
   * and on `EXIT_BLOCK` feeds stderr back with `client.session.prompt`. So the wire convention is
   * the Claude-shaped one — exit 2, reason on stderr — even though opencode itself has no
   * hook-block primitive. The state machine's never-twice guard is what keeps the plugin's
   * continuation from looping.
   */
  blockStop(reason: string, out: BlockOutput): number {
    out.stderr(reason);
    return EXIT_BLOCK;
  },

  /**
   * The brief, as plain text. The plugin injects it with `session.prompt({ noReply: true })` at
   * `session.created`; unlike the other harnesses there is no `hookSpecificOutput` envelope to
   * wrap it in.
   */
  injectContext(context: string): string {
    return context;
  },

  transcriptSize: statSize,

  resumeHeadless,

  // OpenCode's `run` has no usage-window wording we can key on, so a failed resume is reported as
  // an ordinary failure rather than a wait (`detectUsageLimit` stays undefined).
};

/**
 * `opencode run --session <id> "<instruction>"`.
 *
 * The plugin is loaded for the resumed run too, so the checkpoint lands on the crashed session by
 * `(harness, harness_session_id)` and the runner's `pending_trigger` stamps it `repair`, exactly
 * as the other harnesses' resumes do.
 *
 * `opencode run` offers no `--allowedTools` equivalent, so unlike Claude Code's resume this cannot
 * pin the resumed agent to the checkpoint command; the instruction is the only constraint, and the
 * contract records that as a known difference (hooks-opencode.md §Headless resume). The child runs
 * in its own process group so the timeout kills what it spawned — see `spawn-resume.ts`.
 *
 * Never throws.
 */
async function resumeHeadless(sessionId: string, options: ResumeOptions): Promise<ResumeResult> {
  const bin = process.env[OPENCODE_BIN_ENV]?.trim() || "opencode";
  return await spawnResume(
    bin,
    ["run", "--session", sessionId, options.instruction],
    options,
  );
}
