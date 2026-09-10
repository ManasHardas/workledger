/**
 * `~/.workledger/serve.json` — the one machine-wide daemon's calling card
 * (docs/contracts/p8/daemon-and-api.md §CLI).
 *
 * Written by `workledger serve` in machine mode once it is listening, read by `open` to find a
 * running daemon and by `stop` to end it, removed on a clean shutdown. The file is a *hint*: a
 * dead pid is a stale file, not a running server, so every reader checks the pid (and `open`
 * checks `/api/health` too) before trusting the URL in it. Written atomically — temp file then
 * rename — so a reader never sees half a JSON document.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** The file's basename inside `WORKLEDGER_HOME`. */
export const SERVE_STATE_FILENAME = "serve.json";

/** Where a detached daemon's stdout and stderr go, next to the state file. */
export const SERVE_LOG_FILENAME = "serve.log";

/** The daemon's port when it is free (daemon-and-api.md §CLI). */
export const DEFAULT_PORT = 7419;

/** What `serve.json` holds. */
export interface ServeState {
  /** `http://127.0.0.1:<port>`. */
  url: string;
  pid: number;
  /** ISO 8601. */
  startedAt: string;
  /** The `workledger` version that wrote the file. */
  version: string;
}

/** `<home>/serve.json`. */
export function serveStatePath(home: string): string {
  return path.join(home, SERVE_STATE_FILENAME);
}

/** `<home>/serve.log`. */
export function serveLogPath(home: string): string {
  return path.join(home, SERVE_LOG_FILENAME);
}

/** `true` when the value has the four fields, with the types they must have. */
function isServeState(value: unknown): value is ServeState {
  if (value === null || typeof value !== "object") return false;
  const { url, pid, startedAt, version } = value as Record<string, unknown>;
  return (
    typeof url === "string" &&
    url !== "" &&
    typeof pid === "number" &&
    Number.isInteger(pid) &&
    pid > 0 &&
    typeof startedAt === "string" &&
    typeof version === "string"
  );
}

/**
 * The state file, or `undefined` when there is none or it is not one — a malformed file is
 * treated exactly like a stale one, which is to say ignored and overwritten by the next `serve`.
 */
export function readServeState(home: string): ServeState | undefined {
  let text: string;
  try {
    text = readFileSync(serveStatePath(home), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isServeState(parsed) ? parsed : undefined;
}

/** Write the file atomically, creating `home` if needed. */
export function writeServeState(home: string, state: ServeState): void {
  mkdirSync(home, { recursive: true });
  const file = serveStatePath(home);
  const scratch = `${file}.${process.pid}.tmp`;
  writeFileSync(scratch, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(scratch, file);
}

/**
 * Remove the file. With `pid`, only when the file is this process's own — a daemon that is
 * shutting down must not delete the card of a newer daemon that replaced it while it was
 * winding down.
 */
export function removeServeState(home: string, pid?: number): void {
  if (pid !== undefined) {
    const current = readServeState(home);
    if (current !== undefined && current.pid !== pid) return;
  }
  rmSync(serveStatePath(home), { force: true });
}

/**
 * Is there a process with this pid? Signal 0 is the probe: `ESRCH` is "no such process", and
 * `EPERM` — someone else's process — is still a live one.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
