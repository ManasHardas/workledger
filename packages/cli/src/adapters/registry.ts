/**
 * The harness table: `--harness <name>` → one {@link HarnessAdapter}.
 *
 * `workledger hook <Event>` takes the flag from the hook command each harness's own hook file
 * registers (`workledger hook Stop --harness codex`), which is what lets one binary serve three
 * harnesses without any of them having to be detected at run time — the file that invoked us
 * already knows which one it is. The default is `claude-code`, so a P1 hook file written before
 * P4 keeps working unchanged.
 *
 * Every adapter is a static import. They are small, they pull nothing heavier than
 * `node:child_process`, and `hook Stop`'s p95 budget is spent on `@workledger/core` and
 * `better-sqlite3` (plans/feature-p1-data-flow.md §6), both of which stay behind the lazy
 * boundaries `hook-timing.test.ts` asserts.
 */
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import type { HarnessAdapter } from "./types.js";

/** Every harness this build speaks, in the order `doctor` reports them. */
export const HARNESS_NAMES = ["claude-code", "codex", "cursor"] as const;

/** One of {@link HARNESS_NAMES}. */
export type HarnessName = (typeof HARNESS_NAMES)[number];

/** The harness assumed when no `--harness` flag is given. */
export const DEFAULT_HARNESS: HarnessName = "claude-code";

/** The adapters, keyed by the name written into the hook command. */
const ADAPTERS: Readonly<Record<HarnessName, HarnessAdapter>> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
  cursor: cursorAdapter,
};

/** `true` when `name` is a harness this build speaks. */
export function isHarnessName(name: string): name is HarnessName {
  return (HARNESS_NAMES as readonly string[]).includes(name);
}

/**
 * The adapter for `name`, or `undefined` when this build does not know it.
 *
 * `undefined` rather than a throw or a silent default: a hook invoked with a harness this binary
 * has never heard of is a mismatch between an installed hook file and an installed CLI, and the
 * caller reports it on stderr and allows rather than recording the session as the wrong harness.
 */
export function adapterFor(name: string): HarnessAdapter | undefined {
  return isHarnessName(name) ? ADAPTERS[name] : undefined;
}
