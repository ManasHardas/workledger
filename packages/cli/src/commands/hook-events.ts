/**
 * The `hook` event names, in their own module so `src/main.ts` can spell the argument's
 * `.choices()` list without statically importing the command body.
 *
 * `hook.ts` reaches `@workledger/core` and `better-sqlite3` behind lazy boundaries; pulling it
 * into the program's eager graph just to read three strings would undo that (data-flow §6).
 * This module imports nothing.
 */

/** The hook events P1 handles. */
export const HOOK_EVENTS = ["SessionStart", "Stop", "SessionEnd"] as const;

/** One of {@link HOOK_EVENTS}. */
export type HookEvent = (typeof HOOK_EVENTS)[number];
