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
import { spawn } from "node:child_process";
import process from "node:process";

import { EXIT_BLOCK } from "../exit-codes.js";
import type { HookEvent } from "../commands/hook-events.js";
import type {
  EndReasonInput,
  HarnessAdapter,
  HookInput,
  HookInputError,
  ResumeOptions,
  ResumeResult,
  StartSource,
} from "./types.js";

import { statSize } from "./types.js";

/** The `harness` value this adapter writes to the ledger and the index. */
export const CLAUDE_CODE = "claude-code";

/** The executable a headless resume spawns. Overridable so a test can stand in for it. */
export const CLAUDE_BIN_ENV = "WORKLEDGER_CLAUDE_BIN";

/**
 * How much of the child's output is kept.
 *
 * The output is a harness log, not a transcript, but it is model text all the same and it ends up
 * in a job's `error` column when a repair fails. A cap keeps a runaway session from putting
 * megabytes of it in the index; only the tail is kept, because the failure is at the end.
 */
export const MAX_RESUME_OUTPUT = 16_000;

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

  resumeHeadless,
};

/**
 * `claude -p <instruction> --resume <id> --permission-mode acceptEdits --allowedTools …`.
 *
 * `acceptEdits` rather than a prompt because there is no human at this session: the resume is
 * spawned by `workledger repair` and a permission prompt would simply hang until the timeout.
 * What keeps that safe is `--allowedTools`, which the caller pins to the checkpoint command — the
 * resumed agent can run `workledger checkpoint` and nothing else.
 *
 * The resumed session drives workledger's own hooks: `SessionStart` reuses the index row by
 * `(harness, harness_session_id)` (plans/feature-p1-data-flow.md §2), so the checkpoint lands on
 * the crashed session rather than forking a new one, and the `pending_trigger` the runner set on
 * that row is what makes it stamp `trigger: repair`.
 *
 * Never throws. A missing binary, a non-zero exit and a timeout are all values.
 */
async function resumeHeadless(sessionId: string, options: ResumeOptions): Promise<ResumeResult> {
  const bin = process.env[CLAUDE_BIN_ENV]?.trim() || "claude";
  const args = [
    "-p",
    options.instruction,
    "--resume",
    sessionId,
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    options.allowedTools.join(" "),
  ];

  return await new Promise<ResumeResult>((resolve) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;
    let settled = false;

    const collect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      // Trimmed as it arrives rather than at the end, so a session that prints for minutes never
      // holds more than the cap in memory.
      if (output.length > MAX_RESUME_OUTPUT) output = output.slice(-MAX_RESUME_OUTPUT);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const timer = setTimeout(() => {
      timedOut = true;
      // SIGKILL, not SIGTERM: the timeout exists because the session is not making progress, and
      // a harness that ignores a polite signal would spend the whole budget again on the way out.
      child.kill("SIGKILL");
    }, options.timeoutMs);
    timer.unref?.();

    const settle = (result: ResumeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on("error", (error: Error) => {
      settle({ exitCode: null, timedOut, output, spawnError: error.message });
    });
    child.on("close", (code) => {
      settle({ exitCode: code, timedOut, output });
    });
  });
}
