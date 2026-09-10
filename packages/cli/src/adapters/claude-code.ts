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

import type { ChildProcess } from "node:child_process";

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

/**
 * How long `close` is waited for after `exit` before the result is settled anyway.
 *
 * Long enough for the pipes of a child that exited normally to drain, short enough that a
 * grandchild still holding them cannot turn the repair timeout into an indefinite wait.
 */
export const EXIT_GRACE_MS = 250;

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
 * The child is its own process group (`detached`), so the timeout kills everything the harness
 * spawned rather than just the harness — see {@link killTree}.
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
    "--allowedTools",
    options.allowedTools.join(" "),
  ];

  return await new Promise<ResumeResult>((resolve) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so the timeout can kill the tools the harness spawned as well as
      // the harness. See {@link killTree}.
      detached: true,
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
      killTree(child);
    }, options.timeoutMs);
    timer.unref?.();

    const settle = (result: ResumeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A grandchild that outlived the kill still holds the read ends of these pipes, and an
      // undestroyed stream keeps a handle — and this event loop — alive after the caller has its
      // answer. Nothing more will be read from them; the result is already composed.
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(result);
    };

    child.on("error", (error: Error) => {
      settle({ exitCode: null, timedOut, output, spawnError: error.message });
    });

    // `close` fires when the child has exited *and* its pipes are closed; it is the event that
    // guarantees every byte has arrived, so it is the one this resolves on when the harness ends
    // on its own. After a kill the pipes may be held by a process the signal did not reach, so
    // `exit` starts a short grace period and settles with what has been collected.
    child.on("exit", (code) => {
      const grace = setTimeout(() => settle({ exitCode: code, timedOut, output }), EXIT_GRACE_MS);
      grace.unref?.();
    });
    child.on("close", (code) => {
      settle({ exitCode: code, timedOut, output });
    });
  });
}

/**
 * SIGKILL the whole process group the harness was started in.
 *
 * `child.kill()` signals one pid. A coding agent is a process that spawns processes — its Bash
 * tool alone can leave a tree — so signalling only the harness leaves those children running,
 * reparented to init and still holding the stdio pipes they inherited. A `repair --timeout 2`
 * against a harness whose tool was mid-`sleep 30` returned at T+30 s for exactly that reason.
 *
 * `spawn` was given `detached: true`, which makes the child a process-group leader, so the
 * negative pid reaches the harness and everything it started. SIGKILL rather than SIGTERM: the
 * timeout exists because the session is not making progress, and a harness that ignores a polite
 * signal would spend the whole budget again on the way out.
 *
 * Falls back to signalling the single pid if the group is already gone (`ESRCH`) or the platform
 * refuses the call — a best-effort kill is still better than none.
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone, or this platform will not take a negative pid.
    try {
      child.kill("SIGKILL");
    } catch {
      // The child is already reaped; there is nothing left to signal.
    }
  }
}
