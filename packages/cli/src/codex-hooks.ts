/**
 * The `<repo>/.codex/hooks.json` merge `workledger init` performs — the block frozen in
 * `docs/contracts/p4/hooks-codex.md` §Configuration.
 *
 * A sibling of `settings-merge.ts` and deliberately the same shape as it: Codex reuses Claude
 * Code's three-event hook schema (`hooks.<Event>[].hooks[]` with `type`, `command`, `timeout`),
 * so the only differences are the file it lives in, the `--harness codex` flag written into every
 * command, and `SessionEnd`'s timeout.
 *
 * The merge is *additive*. A user's `hooks.json` is theirs: every key it already carries
 * survives, every hook it already registers survives, and the three workledger groups are
 * appended after them. Running `init` twice changes nothing.
 *
 * One thing has no analogue in P1: Codex requires the operator to **trust** a project's hooks
 * once before it will run them. `init` prints that step rather than trying to write the trust
 * record itself — the whole point of the trust prompt is that the file was reviewed by a person.
 */
import path from "node:path";

import { HOOKED_EVENTS, SettingsError, applyJsonFile } from "./settings-merge.js";
import type { HookedEvent, MergeResult, SettingsIo, SettingsOutcome } from "./settings-merge.js";

/** `.codex/hooks.json`, relative to the repo root. */
export const CODEX_HOOKS_PATH = path.join(".codex", "hooks.json");

/**
 * Per-event timeout in seconds, frozen by the contract.
 *
 * `SessionStart` and `Stop` get 10 s, the same as Claude Code's. `SessionEnd` gets 3: Codex
 * defaults that event to 1 s, and while the hook targets < 200 ms, a 1 s ceiling leaves no room
 * for a cold Node start on a loaded machine.
 */
export const CODEX_HOOK_TIMEOUTS: Readonly<Record<HookedEvent, number>> = {
  SessionStart: 10,
  Stop: 10,
  SessionEnd: 3,
};

/**
 * The command string written for one event, verbatim from hooks-codex.md.
 *
 * The `if`/`fi` form is the contract's, and the reason is the one P1 spelled out: an `if` whose
 * condition is false and which has no `else` exits 0, so an absent binary is a clean 0 with no
 * output — while the plain `A && B` form exits 1. `exec` preserves the CLI's own exit code,
 * including the Stop block's 2.
 */
export function codexHookCommand(event: HookedEvent): string {
  return `if command -v workledger >/dev/null 2>&1; then exec workledger hook ${event} --harness codex; fi`;
}

/** The group `init` appends for one event. */
export function codexHookGroup(event: HookedEvent): Record<string, unknown> {
  return {
    hooks: [
      { type: "command", command: codexHookCommand(event), timeout: CODEX_HOOK_TIMEOUTS[event] },
    ],
  };
}

/** The whole `hooks` block from hooks-codex.md §Configuration. */
export function codexHooksBlock(): Record<HookedEvent, unknown[]> {
  return {
    SessionStart: [codexHookGroup("SessionStart")],
    Stop: [codexHookGroup("Stop")],
    SessionEnd: [codexHookGroup("SessionEnd")],
  };
}

/** `true` for a JSON object — not an array, not `null`. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A hook entry this tool wrote: any command that invokes `workledger hook <event>`. */
function isOurs(entry: unknown, event: HookedEvent): entry is Record<string, unknown> {
  return (
    isObject(entry) &&
    typeof entry["command"] === "string" &&
    entry["command"].includes(`workledger hook ${event}`)
  );
}

/**
 * Merge the contract's block into a parsed `.codex/hooks.json`.
 *
 * For each event: an entry that already invokes `workledger hook <event>` has its `command`,
 * `type` and `timeout` corrected in place — so a file written by an older build is fixed rather
 * than duplicated — and everything else about its group is left alone. Otherwise the contract's
 * group is appended after the existing ones, which keeps foreign hooks first and intact.
 *
 * @throws {SettingsError} when `hooks` or one of its event values is not the shape the contract
 * documents.
 */
export function mergeCodexHooks(existing: Record<string, unknown>): MergeResult {
  const merged: Record<string, unknown> = { ...existing };
  const existingHooks = merged["hooks"];
  if (existingHooks !== undefined && !isObject(existingHooks)) {
    throw new SettingsError("`hooks` is not a JSON object");
  }
  const hooks: Record<string, unknown> = { ...(existingHooks ?? {}) };
  let changed = false;

  for (const event of HOOKED_EVENTS) {
    const current = hooks[event];
    if (current !== undefined && !Array.isArray(current)) {
      throw new SettingsError(`\`hooks.${event}\` is not an array`);
    }
    const groups = [...((current ?? []) as unknown[])];

    let patched = false;
    for (let i = 0; i < groups.length && !patched; i += 1) {
      const group = groups[i];
      if (!isObject(group) || !Array.isArray(group["hooks"])) continue;
      const entries = [...(group["hooks"] as unknown[])];
      for (let j = 0; j < entries.length; j += 1) {
        if (!isOurs(entries[j], event)) continue;
        const entry = entries[j] as Record<string, unknown>;
        const wanted = {
          ...entry,
          type: "command",
          command: codexHookCommand(event),
          timeout: CODEX_HOOK_TIMEOUTS[event],
        };
        if (
          entry["command"] !== wanted["command"] ||
          entry["timeout"] !== wanted["timeout"] ||
          entry["type"] !== "command"
        ) {
          entries[j] = wanted;
          groups[i] = { ...group, hooks: entries };
          changed = true;
        }
        patched = true;
        break;
      }
    }

    if (!patched) {
      groups.push(codexHookGroup(event));
      changed = true;
    }
    hooks[event] = groups;
  }

  merged["hooks"] = hooks;
  return { settings: merged, changed };
}

/** Merge the contract's block into `<root>/.codex/hooks.json`. */
export async function mergeCodexHooksFile(
  root: string,
  io: SettingsIo,
  ask: boolean,
): Promise<SettingsOutcome> {
  return await applyJsonFile(
    path.join(root, CODEX_HOOKS_PATH),
    CODEX_HOOKS_PATH,
    mergeCodexHooks,
    io,
    ask,
  );
}
