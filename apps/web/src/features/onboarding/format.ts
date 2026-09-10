/**
 * Display helpers for the wizard. Counts, bytes, durations and money are the jobs queue's own
 * (`../jobs/format.ts`) so an estimate reads the same here as it does on the Jobs tab.
 */
import type { OnboardingWindow, RepoCandidate } from "../../lib/ledger-source.js";

export { formatBytes, formatCount, formatDuration, formatUsd } from "../jobs/format.js";
export { formatRelative, plural } from "../home/format.js";

/** How each harness is named on a badge. */
const HARNESS_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

export function harnessLabel(harness: string): string {
  return HARNESS_LABELS[harness] ?? harness;
}

/** `[["claude-code", 41], ["codex", 3]]` — the harnesses with sessions, most sessions first. */
export function harnessCounts(candidate: RepoCandidate): [string, number][] {
  return Object.entries(candidate.harnessSessions)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .sort((a, b) => b[1] - a[1]);
}

/** What the history cards are titled. */
export const WINDOW_LABELS: Record<OnboardingWindow, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All history",
  none: "No backfill",
};

/** The four windows with counts, in the order the cards show them (`all`: amendment 9). */
export const COUNTED_WINDOWS = ["7d", "30d", "90d", "all"] as const;

/** `path` is a strict ancestor of `other`. */
export function isAncestorOf(path: string, other: string): boolean {
  const base = path.endsWith("/") ? path : `${path}/`;
  return other !== path && other.startsWith(base);
}

/** The hint under a known-but-not-suggested repo: only an ancestor gets one (amendment 2). */
export function unsuggestedHint(candidate: RepoCandidate, all: readonly RepoCandidate[]): string | null {
  return all.some((other) => isAncestorOf(candidate.path, other.path)) ? "contains other repos" : null;
}
