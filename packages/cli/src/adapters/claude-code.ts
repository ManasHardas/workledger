/**
 * The Claude Code adapter — the only file that knows Claude Code's hook field names.
 *
 * Field list, output shapes and the loop-guard rule are frozen in
 * `docs/contracts/p1/hooks-claude-code.md`; a change to any consumed field is a contract
 * amendment PR, not a patch here.
 *
 * Two rules from that contract shape everything below: unknown fields are ignored, and a missing
 * *required* field logs one stderr line and exits 0. Nothing here throws.
 *
 * The payload reader and the resume spawner both live next door — `claude-shaped.ts` and
 * `spawn-resume.ts` — because P4 gave Codex the same wire format and the same containment
 * requirements (docs/contracts/p4/hooks-codex.md). What stays here is what is Claude Code's
 * alone: the enums it sends, and its `claude -p --resume` argv.
 */
import process from "node:process";

import { EXIT_BLOCK } from "../exit-codes.js";
import { parseClaudeShaped } from "./claude-shaped.js";
import { spawnResume } from "./spawn-resume.js";
import { detectUsageLimit } from "./usage-limit.js";
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

import { statSize } from "./types.js";

// Re-exported so `MAX_RESUME_OUTPUT` and `EXIT_GRACE_MS` keep the one import path they have had
// since P3; the values themselves are shared with every other harness that resumes.
export { EXIT_GRACE_MS, MAX_RESUME_OUTPUT } from "./spawn-resume.js";

/** The `harness` value this adapter writes to the ledger and the index. */
export const CLAUDE_CODE = "claude-code";

/** The executable a headless resume spawns. Overridable so a test can stand in for it. */
export const CLAUDE_BIN_ENV = "WORKLEDGER_CLAUDE_BIN";

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
    return parseClaudeShaped(event, raw, { startSources: START_SOURCES, endReasons: END_REASONS });
  },

  blockStop(reason: string, out: BlockOutput): number {
    out.stderr(reason);
    return EXIT_BLOCK;
  },

  injectContext(context: string): string {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    });
  },

  transcriptSize: statSize,

  resumeHeadless,

  // "You've hit your session limit · resets 1am (America/Los_Angeles)" and its siblings — the
  // one exit 1 a repair must wait out rather than report (#100).
  detectUsageLimit,

  detectSessionNotFound,
};

/**
 * "No conversation found with session ID: <id>" — what `claude --resume` prints when the
 * directory it is run in has no session by that id (#114). Claude Code keeps sessions per
 * project slug of the working directory, so this is the resume having been spawned somewhere
 * other than where the session was started, not a session that is gone.
 */
export function detectSessionNotFound(output: string): boolean {
  return /No conversation found with session ID/i.test(output);
}

/**
 * `claude -p <instruction> --resume <id> --allowedTools "Bash(workledger checkpoint*)"`.
 *
 * **No `--permission-mode`.** An earlier draft passed `acceptEdits` so an unattended session
 * would not hang on a prompt, but that flag auto-approves the edit tools *regardless of*
 * `--allowedTools` — which would have let a maintenance command write the repo it was only
 * supposed to describe. Headless `-p` denies anything outside `--allowedTools` on its own, and a
 * denial is the outcome we want here: the resumed agent may run the pinned checkpoint command
 * and nothing else, and a resume that asks for more should fail rather than be granted it.
 *
 * The resumed session drives workledger's own hooks: `SessionStart` reuses the index row by
 * `(harness, harness_session_id)` (plans/feature-p1-data-flow.md §2), so the checkpoint lands on
 * the crashed session rather than forking a new one, and the `pending_trigger` the runner set on
 * that row is what makes it stamp `trigger: repair`.
 *
 * The child is its own process group, so the timeout kills everything the harness spawned rather
 * than just the harness — see `spawn-resume.ts`.
 *
 * Never throws. A missing binary, a non-zero exit and a timeout are all values.
 */
async function resumeHeadless(sessionId: string, options: ResumeOptions): Promise<ResumeResult> {
  const bin = process.env[CLAUDE_BIN_ENV]?.trim() || "claude";
  return await spawnResume(
    bin,
    [
      "-p",
      options.instruction,
      "--resume",
      sessionId,
      "--allowedTools",
      options.allowedTools.join(" "),
    ],
    options,
  );
}
