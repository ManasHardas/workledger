/**
 * `workledger stop` — docs/contracts/p8/daemon-and-api.md §CLI: "SIGTERM the pid in
 * serve.json, remove the file; exit 0 when nothing was running", and amendment 6 (#99): a pid
 * still alive after the grace period gets `SIGKILL`, and the file goes either way.
 *
 * The daemon removes its own file on a clean shutdown; this command removes it too, so a daemon
 * that dies on the signal without reaching its cleanup still leaves nothing stale behind.
 */
import process from "node:process";

import { EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { resolveHome } from "../index/db.js";
import { processIo } from "./serve.js";
import { isPidAlive, readServeState, removeServeState } from "../serve-state.js";
import type { ServeIo } from "./serve.js";

/** What `stop` touches outside itself. */
export interface StopIo extends ServeIo {
  /** Deliver a signal. Replaced in tests, where the "daemon" is this very process. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** How long to wait for the pid to go away after SIGTERM; 5 s by default. */
  exitTimeoutMs?: number;
}

/**
 * How long a daemon gets to exit after SIGTERM before `stop` escalates to SIGKILL. Longer than
 * the daemon's own `SHUTDOWN_GRACE_MS`, so a daemon that honours its budget is never killed.
 */
export const EXIT_TIMEOUT_MS = 5000;

/** How long a SIGKILLed pid gets to disappear — the kernel's reaping, not the daemon's code. */
const KILL_TIMEOUT_MS = 1000;

/** Wait until `alive(pid)` is false or `timeoutMs` elapses. */
async function waitForExit(alive: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive();
}

/**
 * @returns `0` when the daemon stopped or nothing was running — including a daemon that had to
 * be `SIGKILL`ed; `1` when the pid survived even that, in which case the file is left in place
 * because the server it names is still up.
 */
export async function stopCommand(io: StopIo = processIo()): Promise<number> {
  const home = resolveHome(io.env["WORKLEDGER_HOME"]);
  const state = readServeState(home);
  if (state === undefined) {
    io.stdout("workledger stop: nothing is running");
    return EXIT_OK;
  }
  if (!isPidAlive(state.pid)) {
    removeServeState(home);
    io.stdout(`workledger stop: nothing is running (removed a stale serve.json for pid ${state.pid})`);
    return EXIT_OK;
  }

  const kill = io.kill ?? ((pid, signal) => process.kill(pid, signal));
  try {
    kill(state.pid, "SIGTERM");
  } catch (error) {
    io.stderr(`workledger stop: could not signal pid ${state.pid}: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }
  // In a test the "daemon" is this process, whose pid never dies; the injected `kill` aborts it
  // and the state file disappearing is the signal that it shut down cleanly.
  const gone = io.kill === undefined ? () => isPidAlive(state.pid) : () => readServeState(home) !== undefined;
  const grace = io.exitTimeoutMs ?? EXIT_TIMEOUT_MS;
  if (!(await waitForExit(gone, grace))) {
    // Past its grace period the daemon is not going to leave on its own — that was #99, a
    // process held by a connection or a child it did not close — and a live orphan that `open`
    // keeps finding is worse than a hard kill of a loopback server whose state is all on disk.
    io.stderr(`workledger stop: pid ${state.pid} is still running ${grace} ms after SIGTERM; sending SIGKILL`);
    try {
      kill(state.pid, "SIGKILL");
    } catch (error) {
      io.stderr(`workledger stop: could not signal pid ${state.pid}: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT_USAGE;
    }
    if (!(await waitForExit(gone, KILL_TIMEOUT_MS))) {
      io.stderr(`workledger stop: pid ${state.pid} is still running after SIGKILL`);
      return EXIT_USAGE;
    }
  }
  removeServeState(home);
  io.stdout(`workledger stop: stopped ${state.url} (pid ${state.pid})`);
  return EXIT_OK;
}
