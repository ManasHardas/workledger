import type { DoctorEntry, Health } from "../../lib/ledger-source.js";

/** The three readings a `workledger doctor` row can have. */
export type Status = "ok" | "warn" | "broken";

/**
 * A harness's reading.
 *
 * Hooks that were never installed are a `warn`, not a break: a harness this machine does not use
 * is the normal case, and the fix is a `workledger install`, not a repair. Once hooks *are*
 * installed, anything doctor still complains about is a real fault, and a harness that has been
 * wired up but has never been seen means the hooks are not firing.
 */
export function harnessStatus(entry: DoctorEntry): Status {
  if (!entry.hooksInstalled) return "warn";
  if (entry.problems.length > 0) return "broken";
  return entry.lastSeenAt === null ? "warn" : "ok";
}

/** Config: unparseable is broken, parseable-but-complained-about is a warning. */
export function configStatus(config: Health["config"]): Status {
  if (!config.valid) return "broken";
  return config.problems.length > 0 ? "warn" : "ok";
}

/** The index is a cache (CLAUDE.md), so an empty one only warns — it rebuilds itself. */
export function indexStatus(index: Health["index"]): Status {
  return index.bytes > 0 ? "ok" : "warn";
}

/** No hook has ever fired: nothing is broken, but nothing is being recorded either. */
export function lastHookStatus(lastHookAt: string | null): Status {
  return lastHookAt === null ? "warn" : "ok";
}
