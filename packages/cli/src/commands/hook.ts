/**
 * `workledger hook <SessionStart|Stop|SessionEnd>` — docs/contracts/p1/cli.md and
 * docs/contracts/p1/hooks-claude-code.md.
 *
 * Reads the Claude Code hook JSON on stdin. Implemented by P1 slot 8 (#11); the signature is
 * registered in `src/main.ts` from slot 7 so this file is the only one that slot has to change.
 */
import { notImplemented } from "./not-implemented.js";

/** The hook events P1 handles. */
export const HOOK_EVENTS = ["SessionStart", "Stop", "SessionEnd"] as const;

/** One of {@link HOOK_EVENTS}. */
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** @returns the process exit code. Async so an implementing slot never has to widen it. */
export async function hookCommand(event: HookEvent): Promise<number> {
  // Parsed and deliberately unread: the implementing slot fills this body in, and the
  // signature above is already the contract's.
  void event;
  return notImplemented("hook");
}
