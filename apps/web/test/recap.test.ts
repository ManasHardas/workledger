import { describe, expect, it } from "vitest";

import { checkpointLabel, recap } from "../src/features/ledger/recap.js";
import type { Line as DoneLine } from "../src/lib/ledger-source.js";

/**
 * The recap is derived, never stored: these are the rules that let a session's own file answer
 * "what happened here" in a few points without a new field or a model call.
 */
function line(partial: Partial<DoneLine> & { cp: number; text: string }): DoneLine {
  return { files: [], ...partial } as DoneLine;
}

describe("recap", () => {
  it("groups outcomes that share a commit, even across checkpoints", () => {
    const points = recap([
      line({ cp: 2, text: "b", commit: "8f867ef" }),
      line({ cp: 1, text: "a", commit: "8f867ef" }),
      line({ cp: 1, text: "c", commit: "eb45e80" }),
    ]);

    expect(points).toHaveLength(2);
    expect(points[0]!.commit).toBe("8f867ef");
    expect(points[0]!.lines.map((l) => l.text)).toEqual(["b", "a"]);
    // A commit is one act of work even when its outcomes landed at two checkpoints.
    expect(points[0]!.checkpoints).toEqual([1, 2]);
    expect(points[1]!.commit).toBe("eb45e80");
  });

  it("groups outcomes with no commit by the checkpoint that recorded them", () => {
    const points = recap([
      line({ cp: 5, text: "read the schema" }),
      line({ cp: 5, text: "mapped the brief" }),
      line({ cp: 4, text: "built the system" }),
    ]);

    expect(points.map((p) => p.key)).toEqual(["cp:5", "cp:4"]);
    expect(points[0]!.lines).toHaveLength(2);
    expect(points[0]!.commit).toBeNull();
  });

  it("keeps the file's order, newest first", () => {
    const points = recap([
      line({ cp: 3, text: "last" }),
      line({ cp: 2, text: "middle" }),
      line({ cp: 1, text: "first" }),
    ]);
    expect(points.map((p) => p.lines[0]!.text)).toEqual(["last", "middle", "first"]);
  });

  it("lets one failure decide the point, because a point that claims passed would be lying", () => {
    expect(
      recap([
        line({ cp: 1, text: "a", commit: "abc", verified: "tests-passed" }),
        line({ cp: 1, text: "b", commit: "abc", verified: "tests-failed" }),
      ])[0]!.verified,
    ).toBe("tests-failed");

    expect(
      recap([
        line({ cp: 1, text: "a", commit: "abc", verified: "tests-passed" }),
        line({ cp: 1, text: "b", commit: "abc", verified: "not-verified" }),
      ])[0]!.verified,
    ).toBe("tests-passed");

    expect(recap([line({ cp: 1, text: "a", commit: "abc" })])[0]!.verified).toBe("unverified");
  });

  it("is empty for a session with nothing done", () => {
    expect(recap([])).toEqual([]);
  });

  it("names the span a point covers", () => {
    expect(checkpointLabel([3])).toBe("cp 3");
    expect(checkpointLabel([1, 2])).toBe("cp 1–2");
    expect(checkpointLabel([])).toBe("");
  });
});
