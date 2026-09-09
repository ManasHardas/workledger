/**
 * `workledger checkpoint` — the contract's eight steps, driven end to end.
 *
 * Every test runs against a temp repo and a temp `WORKLEDGER_HOME`; nothing here may touch the
 * real `$HOME` or the real ledger. The secret case is synthesized in code rather than committed:
 * `test/fixtures/` must scan clean, so a planted credential may never reach disk (issue #11).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createItem, createSessionText } from "@workledger/core";
import type { SessionFrontmatter } from "@workledger/core";

import { runCheckpoint, stdinFrom } from "../src/commands/checkpoint.js";
import type { CheckpointIo, CheckpointOptions } from "../src/commands/checkpoint.js";
import { EXIT_OK, EXIT_SECRET, EXIT_USAGE } from "../src/exit-codes.js";
import { openIndex } from "../src/index/db.js";
import { listOpenBacklogIds, readTextFile, writeFileAtomic } from "../src/ledger-fs.js";

const INVALID_FIXTURES = path.join(
  import.meta.dirname,
  "..",
  "..",
  "core",
  "test",
  "fixtures",
  "checkpoint-payload",
  "invalid",
);

/** Crockford base32, the ULID alphabet — `I`, `L`, `O` and `U` are excluded by design. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A deterministic, valid 26-character ULID for a small integer. */
function ulidOf(value: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < 26; i += 1) {
    out = (CROCKFORD[rest % 32] as string) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** A deterministic, valid backlog id for a small integer. */
function backlogIdOf(value: number): string {
  return `WL-${ulidOf(value)}`;
}

const ULID_A = "01JQ8ZK4T0000000000000000A";
const ULID_B = "01JQ8ZK4T0000000000000000B";
const AT = "2026-09-09T12:30:00.000Z";

/** A minimal payload that satisfies the checkpoint-1 goal rule. */
const MINIMAL = {
  goal: "Ship the validated write path.",
  done: [{ text: "Wrote the command.", commit: "0447dab", verified: "tests-passed" }],
  remaining: [{ text: "Add the hook wiring.", why: "Slot 9 needs it.", new: true }],
  notes: [{ type: "question", text: "Should --dry-run print counts?" }],
};

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function frontmatter(ulid: string): SessionFrontmatter {
  return {
    schema_version: 1,
    id: ulid,
    harness: "claude-code",
    harness_session_id: `hsess-${ulid}`,
    repo: "github.com/manashardas/workledger",
    branch: "main",
    author: { name: "Ada Lovelace", email: "ada@example.com", dome_user: null },
    started: "2026-09-09T12:00:00Z",
    ended: null,
    end_reason: null,
    status: "open",
    private: false,
    source: "live",
    model: null,
    needs_repair: false,
    checkpoint_failures: 0,
    checkpoints: [],
  };
}

/** A temp repo with a `.workledger/` ledger, a temp index home, and one or more open sessions. */
interface Fixture {
  root: string;
  home: string;
  sessionPath: (ulid: string) => string;
  backlogDir: string;
}

function setup(ulids: readonly string[] = [ULID_A]): Fixture {
  const root = tempDir("workledger-repo-");
  const home = tempDir("workledger-home-");
  const sessions = path.join(root, ".workledger", "sessions");
  const backlog = path.join(root, ".workledger", "backlog");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(backlog, { recursive: true });

  const db = openIndex({ home });
  try {
    for (const ulid of ulids) {
      writeFileSync(path.join(sessions, `${ulid}.md`), createSessionText(frontmatter(ulid)), "utf8");
      db.insertSession({
        ulid,
        repo_path: root,
        harness: "claude-code",
        harness_session_id: `hsess-${ulid}`,
        status: "open",
        turns_total: 7,
        turns_since_checkpoint: 7,
        blocks_since_checkpoint: 1,
        last_block_trigger: "bytes",
        last_offset: 100,
      });
    }
  } finally {
    db.close();
  }

  return {
    root,
    home,
    sessionPath: (ulid) => path.join(sessions, `${ulid}.md`),
    backlogDir: backlog,
  };
}

/** Captured output of one `runCheckpoint` call. */
interface Capture {
  out: string[];
  err: string[];
  io: CheckpointIo;
}

function makeIo(fixture: Fixture, payload: string, ids: string[] = []): Capture {
  const out: string[] = [];
  const err: string[] = [];
  let minted = 0;
  const nextId = (): string => ids[minted] ?? backlogIdOf(9_000 + minted);
  const io: CheckpointIo = {
    readStdin: stdinFrom(payload),
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    cwd: fixture.root,
    home: fixture.home,
    now: () => new Date(AT),
    newId: () => {
      const id = nextId();
      minted += 1;
      return id;
    },
  };
  return { out, err, io };
}

async function run(
  fixture: Fixture,
  payload: unknown,
  options: CheckpointOptions = {},
  ids: string[] = [],
): Promise<Capture & { code: number }> {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const capture = makeIo(fixture, raw, ids);
  const code = await runCheckpoint(options, capture.io);
  return { ...capture, code };
}

/** Write one open backlog item so a `ref` + `rel` payload has something legal to point at. */
function seedBacklogItem(fixture: Fixture, id: string): void {
  writeFileSync(
    path.join(fixture.backlogDir, `${id}.md`),
    createItem({
      id,
      title: "An existing open item.",
      why: "Seeded by the test.",
      provenance: {
        harness: "claude-code",
        session: ULID_A,
        checkpoint: 1,
        author: { name: "Ada Lovelace", email: "ada@example.com", dome_user: null },
      },
      now: "2026-09-09T11:00:00Z",
    }),
    "utf8",
  );
}

describe("workledger checkpoint", () => {
  it("a valid payload writes the session file, the backlog item and the index row", async () => {
    const fixture = setup();
    const minted = backlogIdOf(11);
    const { code, out, err } = await run(fixture, MINIMAL, {}, [minted]);

    expect(err).toEqual([]);
    expect(code).toBe(EXIT_OK);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(
      /^checkpoint \d+ recorded: \d+ done, \d+ remaining \(\d+ new, \d+ closed\), \d+ question\(s\)$/,
    );

    const session = readFileSync(fixture.sessionPath(ULID_A), "utf8");
    expect(session).toContain("- [cp 1] Ship the validated write path.");
    expect(session).toContain("- [cp 1] Wrote the command.");
    expect(session).toContain(`- [cp 1] → ${minted} (new) Add the hook wiring.`);
    expect(session).toContain("- question [cp 1]: Should --dry-run print counts?");
    expect(session).toContain(`trigger: bytes`);

    const item = readTextFile(path.join(fixture.backlogDir, `${minted}.md`));
    expect(item).toBeDefined();
    expect(item).toContain("status: proposed");
    expect(listOpenBacklogIds(fixture.root)).toEqual([minted]);

    const db = openIndex({ home: fixture.home });
    try {
      expect(db.listCheckpoints(ULID_A)).toEqual([
        {
          session_ulid: ULID_A,
          n: 1,
          at: AT,
          transcript_offset: 100,
          turns: 7,
          trigger: "bytes",
        },
      ]);
      const row = db.getSessionByUlid(ULID_A);
      expect(row?.turns_since_checkpoint).toBe(0);
      expect(row?.blocks_since_checkpoint).toBe(0);
      expect(row?.last_attempt_exit).toBe(0);
      expect(row?.last_checkpoint_at).toBe(AT);
    } finally {
      db.close();
    }
  });

  it("prints the step-8 ack byte for byte", async () => {
    const fixture = setup();
    const { code, out } = await run(fixture, MINIMAL);
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("checkpoint 1 recorded: 1 done, 1 remaining (1 new, 0 closed), 1 question(s)");
  });

  it("stamps the next checkpoint n + 1 on a second run", async () => {
    const fixture = setup();
    expect((await run(fixture, MINIMAL)).code).toBe(EXIT_OK);

    const second = await run(fixture, {
      done: [{ text: "Kept going.", commit: "abc1234", verified: "not-verified" }],
      remaining: [],
      notes: [],
    });
    expect(second.code).toBe(EXIT_OK);
    expect(second.out[0]).toBe(
      "checkpoint 2 recorded: 1 done, 0 remaining (0 new, 0 closed), 0 question(s)",
    );

    const session = readFileSync(fixture.sessionPath(ULID_A), "utf8");
    expect(session).toContain("- [cp 2] Kept going.");
    // A second checkpoint is not a block-driven one: the counters were reset by the first.
    expect(session).toContain("trigger: manual");

    const db = openIndex({ home: fixture.home });
    try {
      expect(db.listCheckpoints(ULID_A).map((row) => row.n)).toEqual([1, 2]);
    } finally {
      db.close();
    }
  });

  it("advances and closes existing backlog items named by ref", async () => {
    const fixture = setup();
    const updated = backlogIdOf(21);
    const closed = backlogIdOf(22);
    seedBacklogItem(fixture, updated);
    seedBacklogItem(fixture, closed);

    const { code, out } = await run(fixture, {
      goal: "Land both mutations.",
      remaining: [
        { text: "Advance it.", why: "Still going.", ref: updated, rel: "updates" },
        { text: "Finish it.", why: "Done now.", ref: closed, rel: "closes" },
      ],
    });

    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("checkpoint 1 recorded: 0 done, 2 remaining (0 new, 1 closed), 0 question(s)");
    expect(readTextFile(path.join(fixture.backlogDir, `${closed}.md`))).toContain("status: done");
    expect(readTextFile(path.join(fixture.backlogDir, `${updated}.md`))).toContain(
      "- [cp 1] Still going.",
    );
    expect(listOpenBacklogIds(fixture.root)).toEqual([updated]);
  });

  it("an unknown WL ref exits 1 and lists the open ids on stderr", async () => {
    const fixture = setup();
    const known = backlogIdOf(31);
    const missing = backlogIdOf(32);
    seedBacklogItem(fixture, known);

    const { code, err } = await run(fixture, {
      goal: "Point at nothing.",
      remaining: [
        {
          text: "Advance it.",
          why: "Still going.",
          ref: missing,
          rel: "updates",
        },
      ],
    });

    expect(code).toBe(EXIT_USAGE);
    expect(err.some((line) => line === `open backlog ids: ${known}`)).toBe(true);
    expect(err.some((line) => line.startsWith("remaining[0].ref:"))).toBe(true);
    expect(existsSync(path.join(fixture.backlogDir, `${missing}.md`))).toBe(false);
  });

  it("each invalid fixture class exits 1 with '<json-path>: <message>'", async () => {
    const fixtures = readdirSync(INVALID_FIXTURES).filter((name) => name.endsWith(".json"));
    expect(fixtures.length).toBeGreaterThan(10);

    for (const name of fixtures) {
      const fixture = setup();
      const raw = readFileSync(path.join(INVALID_FIXTURES, name), "utf8");
      const before = readFileSync(fixture.sessionPath(ULID_A), "utf8");
      const { code, err, out } = await run(fixture, raw);

      expect(code, name).toBe(EXIT_USAGE);
      expect(out, name).toEqual([]);
      expect(err.length, name).toBeGreaterThan(0);
      for (const line of err) expect(line, name).toMatch(/^[^:]+: .+$/);
      expect(readFileSync(fixture.sessionPath(ULID_A), "utf8"), name).toBe(before);
    }
  });

  it("a payload with no goal at checkpoint 1 exits 1", async () => {
    const fixture = setup();
    const { code, err } = await run(fixture, { done: [], remaining: [], notes: [] });
    expect(code).toBe(EXIT_USAGE);
    expect(err).toContain("goal: required at checkpoint 1");
  });

  it("a 4,097-byte payload is rejected before parsing", async () => {
    const fixture = setup();
    // Deliberately not valid JSON: the cap must fire before the parser ever sees it.
    const oversize = `{"goal":"${"a".repeat(4_097)}"`;
    const { code, err } = await run(fixture, oversize);

    expect(code).toBe(EXIT_USAGE);
    expect(err[0]).toMatch(/^\(payload\): \d+ bytes on stdin, over the 4096-byte limit$/);
  });

  it("malformed JSON exits 1 without writing", async () => {
    const fixture = setup();
    const before = readFileSync(fixture.sessionPath(ULID_A), "utf8");
    const { code, err } = await run(fixture, "{not json");
    expect(code).toBe(EXIT_USAGE);
    expect(err[0]).toMatch(/^\(payload\): /);
    expect(readFileSync(fixture.sessionPath(ULID_A), "utf8")).toBe(before);
  });

  it("two open sessions is a usage error listing both ulids", async () => {
    const fixture = setup([ULID_A, ULID_B]);
    const { code, err } = await run(fixture, MINIMAL);

    expect(code).toBe(EXIT_USAGE);
    expect(err.join("\n")).toContain(ULID_A);
    expect(err.join("\n")).toContain(ULID_B);
    expect(err.some((line) => line.includes("2 open sessions"))).toBe(true);
  });

  it("--session picks one of two open sessions, and an unknown ulid is a usage error", async () => {
    const fixture = setup([ULID_A, ULID_B]);
    const chosen = await run(fixture, MINIMAL, { session: ULID_B });
    expect(chosen.code).toBe(EXIT_OK);
    expect(readFileSync(fixture.sessionPath(ULID_B), "utf8")).toContain("- [cp 1] Wrote the command.");

    const unknown = await run(fixture, MINIMAL, { session: "01JQ8ZK4T0000000000000000Z" });
    expect(unknown.code).toBe(EXIT_USAGE);
    expect(unknown.err[0]).toContain("no session 01JQ8ZK4T0000000000000000Z");
  });

  it("WORKLEDGER_SESSION resolves the session when the index lookup is ambiguous", async () => {
    const fixture = setup([ULID_A, ULID_B]);
    const capture = makeIo(fixture, JSON.stringify(MINIMAL));
    capture.io.envSession = ULID_B;
    await expect(runCheckpoint({}, capture.io)).resolves.toBe(EXIT_OK);
    expect(readFileSync(fixture.sessionPath(ULID_B), "utf8")).toContain("[cp 1]");
  });

  it("a planted secret exits 3, names only the field, and writes nothing", async () => {
    const fixture = setup();
    const before = readFileSync(fixture.sessionPath(ULID_A), "utf8");
    // Synthesized here, never committed: test/fixtures/ must scan clean (issue #11 comment).
    const token = ["ghp", "_", "A1b2C3d4E5f6G7h8i9J0k1L2m3"].join("");

    const { code, out, err } = await run(fixture, {
      goal: "Wire the deploy.",
      done: [{ text: `Exported ${token} to the runner.`, commit: "0447dab", verified: "tests-passed" }],
    });

    expect(code).toBe(EXIT_SECRET);
    expect(err).toEqual(["secret detected at done[0].text (github-token)"]);
    expect(out).toEqual([]);
    expect(`${out.join("\n")}\n${err.join("\n")}`).not.toContain(token);
    expect(readFileSync(fixture.sessionPath(ULID_A), "utf8")).toBe(before);
    expect(readdirSync(fixture.backlogDir)).toEqual([]);

    const db = openIndex({ home: fixture.home });
    try {
      const row = db.getSessionByUlid(ULID_A);
      expect(row?.last_attempt_exit).toBe(EXIT_SECRET);
      expect(row?.last_attempt_errors).not.toContain(token);
    } finally {
      db.close();
    }
  });

  it("a failed attempt records last_attempt_at and last_attempt_exit; a success resets them", async () => {
    const fixture = setup();
    const failed = await run(fixture, { done: [] });
    expect(failed.code).toBe(EXIT_USAGE);

    const db = openIndex({ home: fixture.home });
    try {
      const row = db.getSessionByUlid(ULID_A);
      expect(row?.last_attempt_at).toBe(AT);
      expect(row?.last_attempt_exit).toBe(EXIT_USAGE);
      expect(row?.last_attempt_errors).toBe("goal: required at checkpoint 1");
      expect(row?.turns_since_checkpoint).toBe(7);
    } finally {
      db.close();
    }

    expect((await run(fixture, MINIMAL)).code).toBe(EXIT_OK);

    const after = openIndex({ home: fixture.home });
    try {
      const row = after.getSessionByUlid(ULID_A);
      expect(row?.last_attempt_exit).toBe(0);
      expect(row?.last_attempt_errors).toBeNull();
      expect(row?.turns_since_checkpoint).toBe(0);
      expect(row?.blocks_since_checkpoint).toBe(0);
    } finally {
      after.close();
    }
  });

  it("--dry-run writes nothing and prints the dry-run: line", async () => {
    const fixture = setup();
    const before = readFileSync(fixture.sessionPath(ULID_A), "utf8");

    const { code, out } = await run(fixture, MINIMAL, { dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe(
      "dry-run: checkpoint 1 recorded: 1 done, 1 remaining (1 new, 0 closed), 1 question(s)",
    );
    expect(readFileSync(fixture.sessionPath(ULID_A), "utf8")).toBe(before);
    expect(readdirSync(fixture.backlogDir)).toEqual([]);

    const db = openIndex({ home: fixture.home });
    try {
      expect(db.listCheckpoints(ULID_A)).toEqual([]);
      // A rehearsal is not an attempt: the Stop hook must not read it as a failed checkpoint.
      expect(db.getSessionByUlid(ULID_A)?.last_attempt_at).toBeNull();
    } finally {
      db.close();
    }
  });

  it("--dry-run reports a secret with exit 3 and still writes nothing", async () => {
    const fixture = setup();
    const token = ["ghp", "_", "Z9y8X7w6V5u4T3s2R1q0P9o8N7"].join("");
    const { code, err } = await run(
      fixture,
      { goal: `Rotate ${token} tomorrow.` },
      { dryRun: true },
    );
    expect(code).toBe(EXIT_SECRET);
    expect(err).toEqual(["secret detected at goal (github-token)"]);
  });

  it("warns on stderr about unparsed session lines and keeps them", async () => {
    const fixture = setup();
    const file = fixture.sessionPath(ULID_A);
    writeFileAtomic(file, readFileSync(file, "utf8").replace("## Notes", "## Notes\nhand typed"));

    const { code, err } = await run(fixture, MINIMAL);

    expect(code).toBe(EXIT_OK);
    expect(err).toEqual([`workledger: sessions/${ULID_A}.md: 1 unparsed line(s) under notes`]);
    expect(readFileSync(file, "utf8")).toContain("hand typed");
  });

  it("exits 4 when the repo is not enabled", async () => {
    const root = tempDir("workledger-bare-");
    mkdirSync(path.join(root, ".git"));
    const fixture: Fixture = {
      root,
      home: tempDir("workledger-home-"),
      sessionPath: () => "",
      backlogDir: "",
    };
    const { code, err } = await run(fixture, MINIMAL);
    expect(code).toBe(4);
    expect(err[0]).toContain("is not an enabled repo");
  });

  it("completes in under 1 s for a 4 KB payload and a 500-item backlog", async () => {
    const fixture = setup();
    for (let i = 0; i < 500; i += 1) seedBacklogItem(fixture, backlogIdOf(1_000 + i));

    const payload = {
      goal: "Fill the payload to the 4 KB cap.",
      done: Array.from({ length: 12 }, (_, i) => ({
        text: `Did unit ${i} of work, described at the length a real digest reaches.`.padEnd(180, "."),
        commit: "0447dab",
        verified: "tests-passed" as const,
      })),
    };
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThanOrEqual(4096);
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeGreaterThan(2048);

    const started = performance.now();
    const { code } = await run(fixture, payload);
    const elapsed = performance.now() - started;

    expect(code).toBe(EXIT_OK);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("ledger-fs", () => {
  it("writes atomically and leaves no scratch file behind", () => {
    const dir = tempDir("workledger-atomic-");
    const file = path.join(dir, "nested", "item.md");
    writeFileAtomic(file, "first\n");
    writeFileAtomic(file, "second\n");

    expect(readFileSync(file, "utf8")).toBe("second\n");
    expect(readdirSync(path.dirname(file))).toEqual(["item.md"]);
    expect(statSync(file).isFile()).toBe(true);
  });

  it("skips backlog files that do not parse and returns ids sorted", () => {
    const fixture = setup();
    seedBacklogItem(fixture, backlogIdOf(42));
    seedBacklogItem(fixture, backlogIdOf(41));
    writeFileSync(path.join(fixture.backlogDir, "broken.md"), "not a ledger file\n", "utf8");
    writeFileSync(path.join(fixture.backlogDir, "ignored.txt"), "---\n---\n", "utf8");

    expect(listOpenBacklogIds(fixture.root)).toEqual([backlogIdOf(41), backlogIdOf(42)]);
  });

  it("returns undefined for a file that is not there", () => {
    expect(readTextFile(path.join(tempDir("workledger-missing-"), "nope.md"))).toBeUndefined();
  });
});
