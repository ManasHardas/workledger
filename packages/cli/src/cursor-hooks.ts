/**
 * The `<repo>/.cursor/hooks.json` merge `workledger init` performs — the block frozen in
 * `docs/contracts/p4/hooks-cursor.md` §Configuration.
 *
 * A sibling of `settings-merge.ts`, but Cursor's schema is its own: lower-camel event names
 * (`sessionStart`, `stop`, `sessionEnd`), a flat array of `{ command }` entries with no `hooks`
 * wrapper and no `type`, and a `loop_limit` on `stop` in place of a timeout. Those exact key
 * names are the contract's, and `doctor` reports a file whose keys have drifted from them.
 *
 * The merge is additive, for the same reason `.claude/settings.json`'s is: the file is the
 * operator's, and everything already in it survives.
 */
import path from "node:path";

import { SettingsError, applyJsonFile } from "./settings-merge.js";
import type { MergeResult, SettingsIo, SettingsOutcome } from "./settings-merge.js";
import type { HookEvent } from "./commands/hook-events.js";

/** `.cursor/hooks.json`, relative to the repo root. */
export const CURSOR_HOOKS_PATH = path.join(".cursor", "hooks.json");

/** Cursor's key for each hook event, in the contract's order. */
export const CURSOR_EVENT_KEYS = ["sessionStart", "stop", "sessionEnd"] as const;

/** One of {@link CURSOR_EVENT_KEYS}. */
export type CursorEventKey = (typeof CURSOR_EVENT_KEYS)[number];

/** Cursor's key → the event name `workledger hook` is invoked with. */
export const CURSOR_EVENTS: Readonly<Record<CursorEventKey, HookEvent>> = {
  sessionStart: "SessionStart",
  stop: "Stop",
  sessionEnd: "SessionEnd",
};

/**
 * How many times Cursor may re-run `stop` after a `followup_message`.
 *
 * 2 is the contract's, and it matches the state machine's block/retry rule: one block, one retry
 * after a failed attempt, then the give-up path. A higher limit would let Cursor keep asking
 * after workledger had already stopped asking.
 */
export const CURSOR_LOOP_LIMIT = 2;

/** The command string written for one event, verbatim from hooks-cursor.md. */
export function cursorHookCommand(key: CursorEventKey): string {
  return `if command -v workledger >/dev/null 2>&1; then exec workledger hook ${CURSOR_EVENTS[key]} --harness cursor; fi`;
}

/** The entry `init` appends for one event: `stop` alone carries `loop_limit`. */
export function cursorHookEntry(key: CursorEventKey): Record<string, unknown> {
  const command = cursorHookCommand(key);
  return key === "stop" ? { command, loop_limit: CURSOR_LOOP_LIMIT } : { command };
}

/** The whole `hooks` block from hooks-cursor.md §Configuration. */
export function cursorHooksBlock(): Record<CursorEventKey, unknown[]> {
  return {
    sessionStart: [cursorHookEntry("sessionStart")],
    stop: [cursorHookEntry("stop")],
    sessionEnd: [cursorHookEntry("sessionEnd")],
  };
}

/** `true` for a JSON object — not an array, not `null`. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A hook entry this tool wrote: any command that invokes `workledger hook <event>`. */
function isOurs(entry: unknown, key: CursorEventKey): entry is Record<string, unknown> {
  return (
    isObject(entry) &&
    typeof entry["command"] === "string" &&
    entry["command"].includes(`workledger hook ${CURSOR_EVENTS[key]}`)
  );
}

/**
 * Merge the contract's block into a parsed `.cursor/hooks.json`.
 *
 * @throws {SettingsError} when `hooks` or one of its event values is not the shape the contract
 * documents.
 */
export function mergeCursorHooks(existing: Record<string, unknown>): MergeResult {
  const merged: Record<string, unknown> = { ...existing };
  const existingHooks = merged["hooks"];
  if (existingHooks !== undefined && !isObject(existingHooks)) {
    throw new SettingsError("`hooks` is not a JSON object");
  }
  const hooks: Record<string, unknown> = { ...(existingHooks ?? {}) };
  let changed = false;

  for (const key of CURSOR_EVENT_KEYS) {
    const current = hooks[key];
    if (current !== undefined && !Array.isArray(current)) {
      throw new SettingsError(`\`hooks.${key}\` is not an array`);
    }
    const entries = [...((current ?? []) as unknown[])];

    let patched = false;
    for (let i = 0; i < entries.length; i += 1) {
      if (!isOurs(entries[i], key)) continue;
      const entry = entries[i] as Record<string, unknown>;
      const wanted = { ...entry, ...cursorHookEntry(key) };
      if (
        entry["command"] !== wanted["command"] ||
        entry["loop_limit"] !== wanted["loop_limit"]
      ) {
        entries[i] = wanted;
        changed = true;
      }
      patched = true;
      break;
    }

    if (!patched) {
      entries.push(cursorHookEntry(key));
      changed = true;
    }
    hooks[key] = entries;
  }

  merged["hooks"] = hooks;
  return { settings: merged, changed };
}

/** Merge the contract's block into `<root>/.cursor/hooks.json`. */
export async function mergeCursorHooksFile(
  root: string,
  io: SettingsIo,
  ask: boolean,
): Promise<SettingsOutcome> {
  return await applyJsonFile(
    path.join(root, CURSOR_HOOKS_PATH),
    CURSOR_HOOKS_PATH,
    mergeCursorHooks,
    io,
    ask,
  );
}
