/**
 * `historyWindows` — the wizard's "History" step (`GET /api/onboarding/history`): how many
 * sessions, and how many transcript bytes, each backfill window would cover.
 *
 * Counted the way the backfill itself will count them, so the card the operator picks from and
 * the plan they consent to agree: the same `enumerateStore` over the Claude Code store and
 * `enumerateCodexStore` over the Codex one, the same `filterSince` on file mtime (a session that
 * was active yesterday is inside the 7-day window however long ago it started). Both harnesses
 * resume headlessly, so every session counted here is one the resume plan can digest.
 */
import { enumerateStore, filterSince } from "../commands/backfill.js";
import { assertRepoPaths } from "./repo-path.js";
import { enumerateCodexStore } from "./stores.js";
import type { OnboardingIo } from "./io.js";
import type { HistoryResult, HistoryWindow } from "@workledger/server";

/** The three windows, in the order the wizard shows them. */
const WINDOWS = ["7d", "30d", "90d"] as const;

/** The step. Repos that are not enabled yet are counted too — the wizard asks before `init`. */
export function historyWindows(repos: readonly string[], io: OnboardingIo): HistoryResult {
  const now = io.now();
  const windows: Record<(typeof WINDOWS)[number], HistoryWindow> = {
    "7d": { sessions: 0, bytes: 0 },
    "30d": { sessions: 0, bytes: 0 },
    "90d": { sessions: 0, bytes: 0 },
  };
  for (const repo of assertRepoPaths(repos)) {
    const sessions = [...enumerateStore(io.homeDir, repo), ...enumerateCodexStore(io.homeDir, repo)];
    for (const window of WINDOWS) {
      for (const session of filterSince(sessions, window, now)) {
        windows[window].sessions += 1;
        windows[window].bytes += session.bytes;
      }
    }
  }
  return { windows };
}
