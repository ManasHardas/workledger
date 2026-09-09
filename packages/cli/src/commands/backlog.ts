/**
 * `workledger backlog <accept|discard|done|edit|assign|rank> …` — docs/contracts/p1/cli.md.
 *
 * Reserved. P2 introduces the UI, which calls these; until then invoking the command prints
 * "not available until P2" and exits 1. Unlike the other five commands this is not a stub —
 * it is the command's final P1 behaviour, so no later slot replaces this file.
 */

/** Sub-commands the P2 UI will call. Listed so `--help` documents the reserved surface. */
export const BACKLOG_ACTIONS = ["accept", "discard", "done", "edit", "assign", "rank"] as const;

/** The message the contract fixes for every P1 invocation. */
export const BACKLOG_MESSAGE = "not available until P2";

/** @returns the process exit code — always 1 in P1. */
export function backlogCommand(): number {
  // stderr, not stdout: the command exits non-zero and a caller piping stdout must not receive
  // this line as data.
  process.stderr.write(`workledger backlog: ${BACKLOG_MESSAGE}\n`);
  return 1;
}
