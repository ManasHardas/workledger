/**
 * `workledger brief` — docs/contracts/p1/cli.md §`brief`, plans/feature-p1-data-flow.md §5 (#13).
 *
 * The two properties the contract fixes: exit `4` on a repo nobody enabled, and stdout that is
 * *deterministic for a given ledger*. The determinism assertion is a literal byte comparison of
 * two runs, and a comparison against `buildBrief` called directly on the same ledger — the
 * command must add nothing of its own, in particular no timestamp.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildBrief } from "@workledger/core/brief";
import { createItem } from "@workledger/core/render/backlog";
import { createSessionText } from "@workledger/core/render/session";

import { readBriefInput, runBrief } from "../src/commands/brief.js";
import { DEFAULT_CONFIG_YAML } from "../src/config.js";
import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import type { BriefIo } from "../src/commands/brief.js";

const SESSION_ULID = "01JQ8ZK4T0000000000000000A";
/** Item ids are this prefix plus one character, so they sort and stay valid ULIDs. */
const ITEM_ID = "WL-01JQ8ZK4T0000000000000000";
/** How many backlog items the fixture seeds. */
const ITEM_COUNT = 12;
const AUTHOR = { name: "Ada Lovelace", email: "ada@example.com", dome_user: null };

interface Fixture {
  root: string;
  io: BriefIo & { out: string[]; err: string[] };
}

/** A temp repo. `enabled: false` leaves `.workledger/` out; otherwise it holds one of each file. */
function setup(enabled = true): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-brief-"));
  const root = path.join(dir, "repo");
  mkdirSync(path.join(root, ".git"), { recursive: true });

  if (enabled) {
    const ledger = path.join(root, ".workledger");
    mkdirSync(path.join(ledger, "sessions"), { recursive: true });
    mkdirSync(path.join(ledger, "backlog"), { recursive: true });
    writeFileSync(path.join(ledger, "config.yaml"), DEFAULT_CONFIG_YAML, "utf8");
    writeFileSync(
      path.join(ledger, "sessions", `${SESSION_ULID}.md`),
      createSessionText({
        schema_version: 1,
        id: SESSION_ULID,
        harness: "claude-code",
        harness_session_id: "abc",
        repo: "github.com/o/r",
        branch: "main",
        author: { name: AUTHOR.name, email: AUTHOR.email },
        started: "2026-09-09T10:00:00.000Z",
        status: "ended",
        private: false,
        source: "live",
        model: null,
        needs_repair: false,
        checkpoint_failures: 0,
        checkpoints: [],
      }),
      "utf8",
    );
    // Enough items that a 64-token budget has to drop some of them.
    for (let i = 0; i < ITEM_COUNT; i += 1) {
      const id = `${ITEM_ID}${"0123456789ABCDEF"[i]!}`;
      writeFileSync(
        path.join(ledger, "backlog", `${id}.md`),
        createItem({
          id,
          title: `Wire up the brief, part ${i} of ${ITEM_COUNT}`,
          why: "Seeded by the test.",
          provenance: { harness: "claude-code", session: SESSION_ULID, checkpoint: 1, author: AUTHOR },
          now: "2026-09-09T10:00:00.000Z",
        }),
        "utf8",
      );
    }
    // A file that does not parse: the brief must skip it, not fail.
    writeFileSync(path.join(ledger, "backlog", "junk.md"), "not a ledger file\n", "utf8");
  }

  const out: string[] = [];
  const err: string[] = [];
  return {
    root,
    io: {
      out,
      err,
      cwd: root,
      env: {},
      stdout: (text) => void out.push(text),
      stderr: (line) => void err.push(line),
    },
  };
}

describe("workledger brief", () => {
  it("exits 4 on a repo that is not enabled", async () => {
    const fixture = setup(false);

    await expect(runBrief({}, fixture.io)).resolves.toBe(EXIT_NOT_ENABLED);
    expect(fixture.io.out).toEqual([]);
    expect(fixture.io.err.join("\n")).toContain("not an enabled repo");
  });

  it("prints exactly what core/brief builds from the same ledger", async () => {
    const fixture = setup();

    await expect(runBrief({}, fixture.io)).resolves.toBe(EXIT_OK);

    const expected = buildBrief(await readBriefInput(fixture.root), { maxTokens: 2000 });
    expect(fixture.io.out).toEqual([expected]);
    expect(expected).toContain(`${ITEM_ID}0`);
    // No `now` was passed, so there is no `generated` line to make two runs differ.
    expect(expected).not.toContain("generated");
  });

  it("is byte-identical across two runs", async () => {
    const fixture = setup();

    await runBrief({}, fixture.io);
    await runBrief({}, fixture.io);

    expect(fixture.io.out).toHaveLength(2);
    expect(fixture.io.out[0]).toBe(fixture.io.out[1]);
  });

  it("respects --max-tokens", async () => {
    const fixture = setup();

    await runBrief({ maxTokens: 2000 }, fixture.io);
    await runBrief({ maxTokens: 64 }, fixture.io);

    const [wide, narrow] = fixture.io.out as [string, string];
    expect(narrow.length).toBeLessThan(wide.length);
    expect(Math.ceil(narrow.length / 4)).toBeLessThanOrEqual(64);
  });

  it("reports a budget the brief cannot meet as a usage error", async () => {
    const fixture = setup();

    await expect(runBrief({ maxTokens: 1 }, fixture.io)).resolves.toBe(EXIT_USAGE);
    expect(fixture.io.out).toEqual([]);
    expect(fixture.io.err).toHaveLength(1);
  });

  it("--repo reads a repo elsewhere, and the default budget comes from config.yaml", async () => {
    const target = setup();
    const caller = setup(false);

    await expect(runBrief({ repo: target.root }, caller.io)).resolves.toBe(EXIT_OK);
    expect(caller.io.out[0]).toBe(buildBrief(await readBriefInput(target.root), { maxTokens: 2000 }));
  });

  it("skips ledger files that do not parse", async () => {
    const fixture = setup();
    const input = await readBriefInput(fixture.root);

    expect(input.backlog).toHaveLength(ITEM_COUNT);
    expect(input.sessions).toHaveLength(1);
  });
});
