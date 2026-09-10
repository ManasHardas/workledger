import type { DoctorEntry, Health } from "../../lib/ledger-source.js";

/** The three readings a `workledger doctor` row can have. */
export type Status = "ok" | "warn" | "broken";

/**
 * `true` when `installed` is in the family `tested` names — `2.4.x` matches `2.4.1`.
 *
 * The same rule as `versionMatches` in `packages/cli/src/commands/doctor.ts`, restated rather than
 * imported: `apps/web` reads the wire and never the CLI, and `/api/health` sends the two version
 * strings without the verdict. Four lines of duplication is the price of that boundary.
 */
export function versionMatches(installed: string, tested: string): boolean {
  const wanted = tested.split(".");
  const found = installed.split(".");
  return wanted.every((part, i) => part === "x" || part === found[i]);
}

/**
 * What `workledger doctor` complains about in this harness row, in doctor's own words. Empty when
 * the row reads ok.
 *
 * A harness that is not on PATH also has no version, but saying so twice is noise the terminal can
 * afford and a card cannot, so the version line is skipped when the binary is missing.
 */
export function harnessProblems(entry: DoctorEntry): string[] {
  const problems: string[] = [];
  if (entry.binary === null) {
    problems.push(`\`${entry.harness}\` is not on PATH`);
  } else if (entry.version === null) {
    problems.push(`installed version unknown; contract tested against ${entry.contract_tested_version}`);
  } else if (!versionMatches(entry.version, entry.contract_tested_version)) {
    problems.push(`installed ${entry.version}, contract tested against ${entry.contract_tested_version}`);
  }
  if (!entry.store_readable) problems.push(`${entry.store} is not readable`);
  return problems;
}

/**
 * A harness's reading.
 *
 * Never `broken`, and deliberately so: `workledger doctor` grades every harness check `warn` or
 * `ok` (`buildReport` in `packages/cli/src/commands/doctor.ts`), because a harness this machine
 * does not use is the normal case and an unreadable store degrades what workledger can observe
 * without breaking the ledger, which is files. This page is that report as a page, so a row must
 * not read `broken` here and `warn` in the terminal for the same machine.
 */
export function harnessStatus(entry: DoctorEntry): Status {
  return harnessProblems(entry).length > 0 ? "warn" : "ok";
}

/** The harness row's detail line: the probe `/api/health` actually sends. */
export function harnessDetail(entry: DoctorEntry): string {
  const version = entry.version ?? "version unknown";
  return [
    entry.binary ?? "not on PATH",
    `${version} · contract tested against ${entry.contract_tested_version}`,
    `${entry.store}${entry.projects === null ? "" : ` · ${count(entry.projects, "project")}`}`,
    `last activity ${entry.last_activity ?? "never"}`,
  ].join(" · ");
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
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
