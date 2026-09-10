/**
 * The child-process half of a headless resume, shared by every harness that has one.
 *
 * What differs between harnesses is the argv; what must not differ is the containment. Both
 * Claude Code and Codex are coding agents — processes that spawn processes — so a resume that
 * signalled only the harness would leave its tool tree running and reparented to init, still
 * holding the stdio pipes it inherited. A `repair --timeout 2` against a harness whose Bash tool
 * was mid-`sleep 30` returned at T+30 s for exactly that reason, and the fix (a process group and
 * a SIGKILL to its negative pid) belongs in one place rather than once per adapter.
 *
 * Never throws. A missing binary, a non-zero exit and a timeout are all values.
 */
import { spawn } from "node:child_process";
import process from "node:process";

import type { ChildProcess } from "node:child_process";

import type { ResumeOptions, ResumeResult } from "./types.js";

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

/**
 * Spawn `bin argv…` in its own process group, capture both streams, and settle on exit, close,
 * spawn failure or {@link ResumeOptions.timeoutMs} — whichever comes first.
 */
export async function spawnResume(
  bin: string,
  args: readonly string[],
  options: ResumeOptions,
): Promise<ResumeResult> {
  return await new Promise<ResumeResult>((resolve) => {
    const child = spawn(bin, [...args], {
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
 * `child.kill()` signals one pid, which leaves every tool the agent spawned running. `spawn` was
 * given `detached: true`, which makes the child a process-group leader, so the negative pid
 * reaches the harness and everything it started. SIGKILL rather than SIGTERM: the timeout exists
 * because the session is not making progress, and a harness that ignores a polite signal would
 * spend the whole budget again on the way out.
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
