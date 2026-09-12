import type { Line as DoneLine } from "../../lib/ledger-source.js";

/**
 * The session recap: a few points over all of a session's outcomes (P9, operator: "just a recap of
 * the session ... an overall picture in a few points, not the complete details").
 *
 * **Nothing is stored and no model is called.** The ledger has no recap field and the brief is
 * deterministic, so the grouping has to come from what the outcomes already carry: their evidence.
 * Outcomes recorded against the same commit were one piece of work; outcomes with no commit were
 * one checkpoint's worth of work. That is the whole rule, and it means the recap of a session can
 * be recomputed from its file at any time and will not drift from it.
 *
 * The order is the file's — newest first — so the first point is what happened last.
 */
export interface RecapPoint {
  /** A stable key for React and for tests: the commit, or the checkpoint it came from. */
  key: string;
  /** The outcomes in this point, newest first. Never empty. */
  lines: DoneLine[];
  /** The commit they share, or `null` for work that recorded none. */
  commit: string | null;
  /** The checkpoints the point spans, ascending. */
  checkpoints: number[];
  /**
   * The point's verification, rolled up from its outcomes: a single failure makes the point
   * failed, because a point that says "passed" while one of its claims failed would be a lie.
   */
  verified: "tests-passed" | "tests-failed" | "unverified";
}

/** `tests-failed` wins over `tests-passed`, which wins over silence. */
function rollUp(lines: DoneLine[]): RecapPoint["verified"] {
  let passed = false;
  for (const line of lines) {
    if (line.verified === "tests-failed") return "tests-failed";
    if (line.verified === "tests-passed") passed = true;
  }
  return passed ? "tests-passed" : "unverified";
}

/**
 * Group a session's outcomes into recap points.
 *
 * Outcomes sharing a commit become one point wherever they sit in the list — a commit is a single
 * act of work even when its outcomes were recorded across two checkpoints. Outcomes with no commit
 * group by the checkpoint that recorded them.
 */
export function recap(done: readonly DoneLine[]): RecapPoint[] {
  const points = new Map<string, RecapPoint>();

  for (const line of done) {
    const key = line.commit === undefined ? `cp:${String(line.cp)}` : `commit:${line.commit}`;
    const existing = points.get(key);
    if (existing === undefined) {
      points.set(key, {
        key,
        lines: [line],
        commit: line.commit ?? null,
        checkpoints: [line.cp],
        verified: "unverified",
      });
      continue;
    }
    existing.lines.push(line);
    if (!existing.checkpoints.includes(line.cp)) existing.checkpoints.push(line.cp);
  }

  return [...points.values()].map((point) => ({
    ...point,
    checkpoints: [...point.checkpoints].sort((a, b) => a - b),
    verified: rollUp(point.lines),
  }));
}

/** `cp 1–2`, or `cp 3` — how a point names the span it covers. */
export function checkpointLabel(checkpoints: readonly number[]): string {
  const first = checkpoints[0];
  const last = checkpoints[checkpoints.length - 1];
  if (first === undefined || last === undefined) return "";
  return first === last ? `cp ${String(first)}` : `cp ${String(first)}–${String(last)}`;
}
