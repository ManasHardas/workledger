/**
 * `workledger hook` — the session state machine of plans/feature-p1-data-flow.md §2.
 *
 * The payloads are the recorded ones under `test/fixtures/hooks/`, with only the three
 * machine-specific fields (`cwd`, `transcript_path`, `session_id`) rewritten for a temp repo:
 * the point of a captured fixture is that the *field names and value shapes* are Claude Code's,
 * and those are what the adapter reads.
 *
 * The state machine is driven in-process through `runHook`, not through a child process. Its
 * observable behaviour is the exit code, the two streams, the index row and the ledger file, and
 * `HookIo` hands every one of those to the test — while a child process would put the branch
 * coverage Clause #3 measures out of reach. `hook-timing.test.ts` is where the built binary runs.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_BLOCKED_BY,
  MAX_FILES_PER_ITEM,
  MAX_GOAL_CHARS,
  MAX_NOTE_TEXT_CHARS,
  MAX_PAYLOAD_BYTES,
  MAX_SECTION_ITEMS,
  MAX_TEXT_CHARS,
} from "@workledger/core";
import { createItem } from "@workledger/core/render/backlog";

import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { DEFAULT_CONFIG, isPrivatePath, parseConfig } from "../src/config.js";
import { EXIT_BLOCK, EXIT_OK } from "../src/exit-codes.js";
import { gitInfo, normalizeRemote, parseIni } from "../src/git-info.js";
import { openIndex } from "../src/index/db.js";
import { checkpointInstruction, INSTRUCTION_VERSION, MAX_PREVIOUS_ERRORS } from "../src/instruction.js";
import { runHook, firstCrossed, minutesSince, END_REASON_MAP } from "../src/commands/hook.js";
import { sessionFile } from "../src/ledger-fs.js";
import type { HookEvent } from "../src/commands/hook-events.js";
import type { HookIo } from "../src/commands/hook.js";
import type { SessionRow } from "../src/index/db.js";

const FIXTURES = fileURLToPath(new URL("../../../test/fixtures/hooks/", import.meta.url));

/** The harness session id every fixture carries. */
const HARNESS_ID = "5be4b928-0e64-4bb2-8a9a-d006fce8b9ce";

/** A temp repo, a temp `WORKLEDGER_HOME` and a transcript file the tests can grow. */
interface Fixture {
  dir: string;
  root: string;
  home: string;
  transcript: string;
  stdout: string[];
  stderr: string[];
  /** Advanced by `tick` so `minutes_since` is a controlled input, never the wall clock. */
  clock: Date;
  env: Record<string, string | undefined>;
}

const created: string[] = [];

afterEach(() => {
  created.length = 0;
});

/** A repo with `.workledger/` and the config from cli.md, plus a one-line transcript. */
function setup(config?: string): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-hook-"));
  created.push(dir);
  const root = path.join(dir, "repo");
  const home = path.join(dir, "home");
  mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    path.join(root, ".workledger", "config.yaml"),
    config ??
      [
        "schema_version: 1",
        "harnesses: [claude-code]",
        "thresholds: { bytes: 40000, minutes: 20, turns: 15 }",
        "brief: { inject: true, max_tokens: 2000 }",
        "stale_turns: 5",
        "orphan_minutes: 30",
        "private_paths: []",
        "auto_commit: false",
        "",
      ].join("\n"),
    "utf8",
  );
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(transcript, "x".repeat(100), "utf8");
  return {
    dir,
    root,
    home,
    transcript,
    stdout: [],
    stderr: [],
    clock: new Date("2026-09-09T12:00:00.000Z"),
    env: {},
  };
}

/** One recorded payload, retargeted at the fixture's repo. */
function payload(fixture: Fixture, name: string, patch: Record<string, unknown> = {}): string {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as Record<
    string,
    unknown
  >;
  return JSON.stringify({
    ...raw,
    cwd: fixture.root,
    transcript_path: fixture.transcript,
    ...patch,
  });
}

/** The `HookIo` for one invocation. */
function io(fixture: Fixture, stdin: string): HookIo {
  return {
    readStdin: () => Promise.resolve(stdin),
    stdout: (line) => fixture.stdout.push(line),
    stderr: (line) => fixture.stderr.push(line),
    cwd: fixture.root,
    env: { WORKLEDGER_HOME: fixture.home, ...fixture.env },
    homeDir: fixture.home,
    now: () => new Date(fixture.clock),
    adapter: claudeCodeAdapter,
  };
}

/** Run one event with one recorded fixture. */
async function run(
  fixture: Fixture,
  event: HookEvent,
  name: string,
  patch: Record<string, unknown> = {},
): Promise<number> {
  return runHook(event, io(fixture, payload(fixture, name, patch)));
}

/** Move the fake clock forward. */
function tick(fixture: Fixture, minutes: number): void {
  fixture.clock = new Date(fixture.clock.getTime() + minutes * 60_000);
}

/** Grow the transcript so `bytes_since` crosses its threshold. */
function grow(fixture: Fixture, bytes: number): void {
  writeFileSync(fixture.transcript, "x".repeat(bytes), "utf8");
}

/** The one index row, read through a short-lived connection. */
function row(fixture: Fixture, harnessId = HARNESS_ID): SessionRow | undefined {
  const db = openIndex({ home: fixture.home });
  try {
    return db.getSessionByHarnessId("claude-code", harnessId, fixture.root);
  } finally {
    db.close();
  }
}

/** Mutate the index the way `workledger checkpoint` would. */
function withDb(fixture: Fixture, fn: (db: ReturnType<typeof openIndex>) => void): void {
  const db = openIndex({ home: fixture.home });
  try {
    fn(db);
  } finally {
    db.close();
  }
}

/** The session `.md` files in the fixture's ledger. */
function sessionFiles(fixture: Fixture): string[] {
  return readdirSync(path.join(fixture.root, ".workledger", "sessions")).filter((n) =>
    n.endsWith(".md"),
  );
}

/** Start a session and return its ulid. */
async function start(fixture: Fixture, source = "startup"): Promise<string> {
  const code = await run(fixture, "SessionStart", `session-start-${source}`);
  expect(code).toBe(EXIT_OK);
  const started = row(fixture);
  expect(started).toBeDefined();
  return (started as SessionRow).ulid;
}

/** Drive `n` Stops that are expected to allow. */
async function stopTimes(fixture: Fixture, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
  }
}

// ---------------------------------------------------------------------------
// Stop — thresholds
// ---------------------------------------------------------------------------

describe("hook Stop thresholds", () => {
  it("Stop under all thresholds allows", async () => {
    const fixture = setup();
    await start(fixture);
    fixture.stdout.length = 0;

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr).toEqual([]);
    const after = row(fixture) as SessionRow;
    expect(after.turns_total).toBe(1);
    expect(after.turns_since_checkpoint).toBe(1);
    expect(after.blocks_since_checkpoint).toBe(0);
  });

  it("Stop blocks on bytes", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    grow(fixture, 100_000);

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    expect(fixture.stderr.join("\n")).toContain(`--session ${ulid}`);
    expect((row(fixture) as SessionRow).last_block_trigger).toBe("bytes");
  });

  it("Stop blocks on minutes", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    tick(fixture, 21);

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    expect(fixture.stderr.join("\n")).toContain(`--session ${ulid}`);
    expect((row(fixture) as SessionRow).last_block_trigger).toBe("minutes");
  });

  it("Stop blocks on turns", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    await stopTimes(fixture, 14);

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    expect(fixture.stderr.join("\n")).toContain(`--session ${ulid}`);
    expect((row(fixture) as SessionRow).last_block_trigger).toBe("turns");
  });

  it("the block instruction lists the open backlog ids", async () => {
    const fixture = setup();
    const id = "WL-01JQ8ZK4T0000000000000000A";
    writeFileSync(
      path.join(fixture.root, ".workledger", "backlog", `${id}.md`),
      backlogItem(id),
      "utf8",
    );
    await start(fixture);
    grow(fixture, 100_000);

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    expect(fixture.stderr.join("\n")).toContain(id);
  });

  it("threshold precedence is bytes, then minutes, then turns", async () => {
    const fixture = setup();
    await start(fixture);
    grow(fixture, 100_000);
    tick(fixture, 60);
    // 14 allowed Stops would themselves cross the byte threshold, so the counters are moved
    // directly: the point of this test is which trigger a *simultaneous* crossing records.
    withDb(fixture, (db) => {
      db.updateSession((row(fixture) as SessionRow).ulid, { turns_since_checkpoint: 20 });
    });

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    expect((row(fixture) as SessionRow).last_block_trigger).toBe("bytes");
  });

  it("minutes wins over turns when bytes has not crossed", async () => {
    const fixture = setup();
    await start(fixture);
    tick(fixture, 60);
    withDb(fixture, (db) => {
      db.updateSession((row(fixture) as SessionRow).ulid, { turns_since_checkpoint: 20 });
    });

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    expect((row(fixture) as SessionRow).last_block_trigger).toBe("minutes");
  });

  it("stop_hook_active true always allows", async () => {
    const fixture = setup();
    await start(fixture);
    grow(fixture, 100_000);
    tick(fixture, 60);

    expect(await run(fixture, "Stop", "stop-hook-active-true")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
    expect((row(fixture) as SessionRow).blocks_since_checkpoint).toBe(0);
  });

  it("a Stop for a session the index has never seen allows", async () => {
    const fixture = setup();
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stop — the block / ignored / retry / give-up rule
// ---------------------------------------------------------------------------

describe("hook Stop block state", () => {
  it("an ignored block never repeats", async () => {
    const fixture = setup();
    await start(fixture);
    grow(fixture, 100_000);
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    fixture.stderr.length = 0;

    // No checkpoint attempt since the block: the counters keep running and nothing blocks again.
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
    const after = row(fixture) as SessionRow;
    expect(after.blocks_since_checkpoint).toBe(1);
    expect(after.turns_since_checkpoint).toBe(2);
  });

  it("a block ignored for a full turn threshold resets the counters without a failure", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    grow(fixture, 100_000);
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);

    await stopTimes(fixture, 15);

    const after = row(fixture) as SessionRow;
    expect(after.blocks_since_checkpoint).toBe(0);
    expect(after.turns_since_checkpoint).toBe(0);
    expect(after.last_offset).toBe(100_000);
    expect(readFileSync(sessionFile(fixture.root, ulid), "utf8")).toContain(
      "checkpoint_failures: 0",
    );
  });

  it("a failed attempt gets exactly one retry block, then checkpoint_failures", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    grow(fixture, 100_000);
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    fixture.stderr.length = 0;

    // `workledger checkpoint` rejected the payload and cached why (data-flow §2).
    tick(fixture, 1);
    withDb(fixture, (db) => {
      db.recordAttempt(ulid, {
        at: fixture.clock.toISOString(),
        exit: 1,
        errors: "done[0].text: expected a string",
      });
    });

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    const retry = fixture.stderr.join("\n");
    expect(retry).toContain("previous attempt failed:");
    expect(retry).toContain("done[0].text: expected a string");
    expect((row(fixture) as SessionRow).blocks_since_checkpoint).toBe(2);
    fixture.stderr.length = 0;

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
    const after = row(fixture) as SessionRow;
    expect(after.blocks_since_checkpoint).toBe(0);
    expect(after.turns_since_checkpoint).toBe(0);
    expect(readFileSync(sessionFile(fixture.root, ulid), "utf8")).toContain(
      "checkpoint_failures: 1",
    );

    // The give-up reset moved the thresholds, so the very next Stop does not block again.
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
  });

  it("a failure recorded before the block does not raise the retry block", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    withDb(fixture, (db) => {
      db.recordAttempt(ulid, { at: fixture.clock.toISOString(), exit: 1, errors: "stale" });
    });
    grow(fixture, 100_000);

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    expect(fixture.stderr.join("\n")).not.toContain("previous attempt failed:");
    fixture.stderr.length = 0;

    // The block cleared the stale attempt, so the next Stop reads "ignored" and allows.
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
  });

  it("an attempt that succeeded after the block falls through to allow", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    grow(fixture, 100_000);
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);

    // `blocks_since_checkpoint` still 1 with a successful attempt on record is the `else` §2's
    // `blocks_since == 1` branch has no arm for; the contract note pins it as allow.
    tick(fixture, 1);
    withDb(fixture, (db) => {
      db.updateSession(ulid, {
        last_attempt_at: fixture.clock.toISOString(),
        last_attempt_exit: 0,
        last_attempt_errors: null,
      });
    });
    fixture.stderr.length = 0;

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
  });

  it("a successful checkpoint clears the block state", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    grow(fixture, 100_000);
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);

    tick(fixture, 1);
    withDb(fixture, (db) => {
      db.resetAfterCheckpoint(ulid, { offset: 100_000, at: fixture.clock.toISOString() });
    });

    const reset = row(fixture) as SessionRow;
    expect(reset.blocks_since_checkpoint).toBe(0);
    fixture.stderr.length = 0;
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
  });

  it("transcript rotation resets last_offset", async () => {
    const fixture = setup();
    await start(fixture);
    grow(fixture, 30_000);
    await stopTimes(fixture, 1);
    expect((row(fixture) as SessionRow).last_offset).toBe(100);

    // The harness rotated the file: it is now smaller than the recorded offset.
    withDb(fixture, (db) => {
      db.updateSession((row(fixture) as SessionRow).ulid, { last_offset: 30_000 });
    });
    grow(fixture, 40);

    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toHaveLength(1);
    expect(fixture.stderr[0]).toContain("workledger: hook Stop: transcript shrank");
    expect((row(fixture) as SessionRow).last_offset).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// SessionStart
// ---------------------------------------------------------------------------

describe("hook SessionStart", () => {
  it("emits the additionalContext JSON with the ulid on the brief's first line", async () => {
    const fixture = setup();
    const ulid = await start(fixture);

    expect(fixture.stdout).toHaveLength(1);
    const emitted = JSON.parse(fixture.stdout[0] as string) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(emitted.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const first = emitted.hookSpecificOutput.additionalContext.split("\n")[0] as string;
    expect(first).toContain(ulid);
    expect(first).toContain(`--session ${ulid}`);
  });

  it("writes the session frontmatter and opens the index row", async () => {
    const fixture = setup();
    const ulid = await start(fixture);

    const text = readFileSync(sessionFile(fixture.root, ulid), "utf8");
    expect(text).toContain(`id: ${ulid}`);
    expect(text).toContain("harness: claude-code");
    expect(text).toContain(`harness_session_id: ${HARNESS_ID}`);
    expect(text).toContain("status: open");
    expect(text).toContain("private: false");
    expect(text).toContain("model: claude-opus-4-6-20260401");

    const opened = row(fixture) as SessionRow;
    expect(opened.repo_path).toBe(fixture.root);
    expect(opened.status).toBe("open");
    expect(opened.last_offset).toBe(100);
    expect(opened.last_checkpoint_at).toBe(fixture.clock.toISOString());
  });

  it("resume, fork and compact reuse the row for a known harness_session_id", async () => {
    for (const source of ["resume", "fork", "compact"]) {
      const fixture = setup();
      const ulid = await start(fixture);
      fixture.stdout.length = 0;

      expect(await run(fixture, "SessionStart", `session-start-${source}`)).toBe(EXIT_OK);
      expect((row(fixture) as SessionRow).ulid).toBe(ulid);
      expect(sessionFiles(fixture)).toHaveLength(1);
      // compact rewrote the context, so the brief goes back in (hooks-claude-code.md).
      expect(fixture.stdout).toHaveLength(1);
      expect(fixture.stdout[0]).toContain(ulid);
    }
  });

  it("an unknown harness_session_id on resume creates a new ulid", async () => {
    const fixture = setup();
    const first = await start(fixture);

    expect(
      await run(fixture, "SessionStart", "session-start-resume", { session_id: "other-session" }),
    ).toBe(EXIT_OK);
    const second = row(fixture, "other-session") as SessionRow;
    expect(second).toBeDefined();
    expect(second.ulid).not.toBe(first);
    expect(sessionFiles(fixture)).toHaveLength(2);
  });

  it("clear mints a second session when the harness reports a new id", async () => {
    const fixture = setup();
    await start(fixture);
    expect(
      await run(fixture, "SessionStart", "session-start-clear", { session_id: "cleared" }),
    ).toBe(EXIT_OK);
    expect(sessionFiles(fixture)).toHaveLength(2);
  });

  it("brief.inject false writes the record and injects nothing", async () => {
    const fixture = setup(
      ["schema_version: 1", "brief:", "  inject: false", "  max_tokens: 2000", ""].join("\n"),
    );
    const ulid = await start(fixture);
    expect(fixture.stdout).toEqual([]);
    expect(existsSync(sessionFile(fixture.root, ulid))).toBe(true);
  });

  it("a max_tokens below the brief's floor is reported and the session still opens", async () => {
    const fixture = setup(
      ["schema_version: 1", "brief: { inject: true, max_tokens: 1 }", ""].join("\n"),
    );
    const ulid = await start(fixture);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr.join("\n")).toContain("brief not injected");
    expect(existsSync(sessionFile(fixture.root, ulid))).toBe(true);
  });

  it("a backlog or session file that does not parse is skipped, not fatal", async () => {
    const fixture = setup();
    writeFileSync(
      path.join(fixture.root, ".workledger", "backlog", "broken.md"),
      "not a ledger file\n",
      "utf8",
    );
    writeFileSync(
      path.join(fixture.root, ".workledger", "sessions", "broken.md"),
      "not a ledger file\n",
      "utf8",
    );
    await start(fixture);
    expect(fixture.stdout).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SessionEnd
// ---------------------------------------------------------------------------

describe("hook SessionEnd", () => {
  it("maps each reason", async () => {
    const cases: Array<[string, string]> = [
      ["prompt_input_exit", "clean"],
      ["clear", "clear"],
      ["resume", "resume"],
      ["logout", "logout"],
      ["other", "unknown"],
    ];
    for (const [reason, mapped] of cases) {
      const fixture = setup();
      const ulid = await start(fixture);
      expect(await run(fixture, "SessionEnd", `session-end-${reason}`)).toBe(EXIT_OK);
      expect(fixture.stdout).toHaveLength(1); // the SessionStart brief, nothing from SessionEnd

      const text = readFileSync(sessionFile(fixture.root, ulid), "utf8");
      expect(text).toContain(`end_reason: ${mapped}`);
      expect(text).toContain("status: ended");
      expect(text).toContain(`ended: ${fixture.clock.toISOString()}`);
      expect((row(fixture) as SessionRow).status).toBe("ended");
    }
  });

  it("needs_repair is true only past stale_turns", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    await stopTimes(fixture, 5);
    expect(await run(fixture, "SessionEnd", "session-end-clear")).toBe(EXIT_OK);
    expect(readFileSync(sessionFile(fixture.root, ulid), "utf8")).toContain("needs_repair: false");

    const over = setup();
    const overUlid = await start(over);
    await stopTimes(over, 6);
    expect(await run(over, "SessionEnd", "session-end-clear")).toBe(EXIT_OK);
    expect(readFileSync(sessionFile(over.root, overUlid), "utf8")).toContain("needs_repair: true");
  });

  it("a SessionEnd for an unknown session is a silent no-op", async () => {
    const fixture = setup();
    expect(await run(fixture, "SessionEnd", "session-end-clear")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
  });

  it("a SessionEnd whose ledger file was deleted still closes the index row", async () => {
    const fixture = setup();
    const ulid = await start(fixture);
    writeFileSync(sessionFile(fixture.root, ulid), "not a ledger file\n", "utf8");
    expect(await run(fixture, "SessionEnd", "session-end-logout")).toBe(EXIT_OK);
    expect((row(fixture) as SessionRow).status).toBe("ended");
  });
});

// ---------------------------------------------------------------------------
// Guards: disable, private, not-enabled, malformed input
// ---------------------------------------------------------------------------

describe("hook guards", () => {
  it("WORKLEDGER_DISABLE=1 exits 0 with no output on every event", async () => {
    for (const [event, name] of [
      ["SessionStart", "session-start-startup"],
      ["Stop", "stop-hook-active-false"],
      ["SessionEnd", "session-end-clear"],
    ] as Array<[HookEvent, string]>) {
      const fixture = setup();
      fixture.env["WORKLEDGER_DISABLE"] = "1";
      expect(await run(fixture, event, name)).toBe(EXIT_OK);
      expect(fixture.stdout).toEqual([]);
      expect(fixture.stderr).toEqual([]);
      expect(sessionFiles(fixture)).toEqual([]);
    }
  });

  it("WORKLEDGER_PRIVATE=1 writes a boundary-only record, emits no brief, and never blocks", async () => {
    const fixture = setup();
    fixture.env["WORKLEDGER_PRIVATE"] = "1";
    const ulid = await start(fixture);
    expect(fixture.stdout).toEqual([]);
    expect(readFileSync(sessionFile(fixture.root, ulid), "utf8")).toContain("private: true");
    expect((row(fixture) as SessionRow).private).toBe(1);

    grow(fixture, 100_000);
    tick(fixture, 60);
    expect(await run(fixture, "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
    expect((row(fixture) as SessionRow).blocks_since_checkpoint).toBe(0);
  });

  it("a repo listed in private_paths is private without the environment variable", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-hook-"));
    created.push(dir);
    const fixture = setup(
      ["schema_version: 1", "private_paths:", `  - ${path.join(dir, "repo")}`, ""].join("\n"),
    );
    // The config names *this* fixture's repo only if the paths line up, so it is rewritten.
    writeFileSync(
      path.join(fixture.root, ".workledger", "config.yaml"),
      ["schema_version: 1", "private_paths:", `  - ${fixture.root}`, ""].join("\n"),
      "utf8",
    );
    const ulid = await start(fixture);
    expect(fixture.stdout).toEqual([]);
    expect(readFileSync(sessionFile(fixture.root, ulid), "utf8")).toContain("private: true");
  });

  it("a cwd outside an enabled repo exits 0 silently", async () => {
    const fixture = setup();
    const outside = mkdtempSync(path.join(os.tmpdir(), "workledger-plain-"));
    created.push(outside);
    expect(
      await run(fixture, "SessionStart", "session-start-startup", { cwd: outside }),
    ).toBe(EXIT_OK);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr).toEqual([]);
    expect(sessionFiles(fixture)).toEqual([]);
  });

  it("CLAUDE_PROJECT_DIR overrides the payload cwd", async () => {
    const fixture = setup();
    const outside = mkdtempSync(path.join(os.tmpdir(), "workledger-plain-"));
    created.push(outside);
    fixture.env["CLAUDE_PROJECT_DIR"] = fixture.root;
    expect(
      await run(fixture, "SessionStart", "session-start-startup", { cwd: outside }),
    ).toBe(EXIT_OK);
    expect(sessionFiles(fixture)).toHaveLength(1);
  });

  it("malformed stdin exits 0 with one workledger: stderr line", async () => {
    const fixture = setup();
    expect(await runHook("Stop", io(fixture, "{not json"))).toBe(EXIT_OK);
    expect(fixture.stderr).toHaveLength(1);
    expect(fixture.stderr[0]).toMatch(/^workledger: hook Stop: /);

    fixture.stderr.length = 0;
    expect(await runHook("Stop", io(fixture, "[]"))).toBe(EXIT_OK);
    expect(fixture.stderr[0]).toContain("not a JSON object");

    fixture.stderr.length = 0;
    expect(await runHook("Stop", io(fixture, "{}"))).toBe(EXIT_OK);
    expect(fixture.stderr[0]).toContain("no session_id");
  });

  it("an exception anywhere in the machine is one stderr line and exit 0", async () => {
    const fixture = setup();
    const failing: HookIo = {
      ...io(fixture, "{}"),
      readStdin: () => Promise.reject(new Error("stdin exploded")),
    };
    expect(await runHook("Stop", failing)).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual(["workledger: hook Stop: stdin exploded"]);
  });
});

// ---------------------------------------------------------------------------
// Units the state machine is assembled from
// ---------------------------------------------------------------------------

describe("threshold helpers", () => {
  it("firstCrossed follows the contract's precedence", () => {
    const t = { bytes: 100, minutes: 10, turns: 5 };
    expect(firstCrossed({ bytes: 100, minutes: 10, turns: 5 }, t)).toBe("bytes");
    expect(firstCrossed({ bytes: 99, minutes: 10, turns: 5 }, t)).toBe("minutes");
    expect(firstCrossed({ bytes: 99, minutes: 9, turns: 5 }, t)).toBe("turns");
    expect(firstCrossed({ bytes: 99, minutes: 9, turns: 4 }, t)).toBeUndefined();
  });

  it("minutesSince reads a null or unparseable instant as zero", () => {
    const now = new Date("2026-09-09T12:30:00.000Z");
    expect(minutesSince(null, now)).toBe(0);
    expect(minutesSince("not a date", now)).toBe(0);
    expect(minutesSince("2026-09-09T12:00:00.000Z", now)).toBe(30);
    expect(minutesSince("2026-09-09T13:00:00.000Z", now)).toBe(0);
  });

  it("END_REASON_MAP is the contract's mapping", () => {
    expect(END_REASON_MAP).toEqual({
      prompt_input_exit: "clean",
      clear: "clear",
      resume: "resume",
      logout: "logout",
      other: "unknown",
    });
  });
});

describe("the checkpoint instruction", () => {
  it("names the session verbatim and lists the open ids", () => {
    const text = checkpointInstruction({
      sessionId: "01JQ8ZK4T0000000000000000A",
      openIds: ["WL-1", "WL-2"],
    });
    expect(text).toContain(`instruction v${INSTRUCTION_VERSION}`);
    expect(text).toContain("--session 01JQ8ZK4T0000000000000000A");
    expect(text).toContain("WL-1, WL-2");
    expect(text).not.toContain("previous attempt failed:");
  });

  it("is v3: one --payload argument, the string rule, no heredocs or pipes, reason on decisions (#97)", () => {
    expect(INSTRUCTION_VERSION).toBe(3);
    const text = checkpointInstruction({ sessionId: "01JQ8ZK4T0000000000000000A", openIds: [] });
    expect(text).toContain("workledger checkpoint --session 01JQ8ZK4T0000000000000000A --payload '<json>'");
    expect(text).toContain("At most 16384 bytes");
    expect(text).toContain("no single quote (') and no backslash (\\) anywhere in the JSON");
    expect(text).toContain("apostrophe as \u2019");
    expect(text).toContain("Heredocs, pipes and stdin are not permitted in headless sessions");
    expect(text).toContain("decision notes require reason");
    expect(text).not.toContain("pipe a CheckpointPayload JSON on stdin");
    expect(checkpointInstruction({ sessionId: "x", openIds: [], sinceCheckpoint: 2 })).toContain(
      "since checkpoint 2",
    );
  });

  it("states every cap the schema enforces, in the schema's numbers (#101)", () => {
    const text = checkpointInstruction({ sessionId: "x", openIds: [] });
    const caps = text.slice(text.indexOf("Caps:"), text.indexOf("Strings:"));
    expect(caps).toContain(`goal ≤ ${MAX_GOAL_CHARS} chars`);
    expect(caps).toContain(`text, why and reason ≤ ${MAX_TEXT_CHARS} chars`);
    expect(caps).toContain(`notes text ≤ ${MAX_NOTE_TEXT_CHARS}`);
    expect(caps).toContain(`files ≤ ${MAX_FILES_PER_ITEM}`);
    expect(caps).toContain(`blocked_by ≤ ${MAX_BLOCKED_BY}`);
    expect(caps).toContain(`≤ ${MAX_SECTION_ITEMS} items per section`);
    expect(caps).toContain(`≤ ${MAX_PAYLOAD_BYTES} bytes total`);
    expect(text).toContain(`At most ${MAX_PAYLOAD_BYTES} bytes`);
  });

  it("tells the agent to mint an item when the backlog is empty", () => {
    expect(checkpointInstruction({ sessionId: "x", openIds: [] })).toContain('"new": true');
  });

  it("appends the cached errors on the retry, truncating a long one", () => {
    const long = "e".repeat(5000);
    const text = checkpointInstruction({ sessionId: "x", openIds: [], previousErrors: long });
    expect(text).toContain("previous attempt failed:");
    expect(text).toContain("… (truncated)");
    const base = checkpointInstruction({ sessionId: "x", openIds: [] }).length;
    expect(text.length).toBeLessThan(base + MAX_PREVIOUS_ERRORS + 100);
    expect(checkpointInstruction({ sessionId: "x", openIds: [], previousErrors: "  " })).not.toContain(
      "previous attempt failed:",
    );
  });
});

describe("the Claude Code adapter", () => {
  it("ignores unknown fields and reads only its own", () => {
    const parsed = claudeCodeAdapter.parseHookInput(
      "SessionStart",
      JSON.stringify({
        session_id: "s",
        transcript_path: "/t.jsonl",
        cwd: "/repo",
        source: "compact",
        model: "m",
        permission_mode: "default",
        future_field: 42,
      }),
    );
    expect(parsed).toEqual({
      event: "SessionStart",
      harnessSessionId: "s",
      transcriptPath: "/t.jsonl",
      cwd: "/repo",
      source: "compact",
      model: "m",
      stopHookActive: false,
      reason: undefined,
      // Claude Code has neither a never-block session class nor a reported author; both are the
      // adapter's answer, not an absence the state machine has to guess at.
      neverBlock: false,
      userEmail: undefined,
    });
  });

  it("treats an unrecognized source or reason as absent", () => {
    const start = claudeCodeAdapter.parseHookInput(
      "SessionStart",
      JSON.stringify({ session_id: "s", source: "teleport" }),
    );
    expect(start).toMatchObject({ source: undefined });
    const end = claudeCodeAdapter.parseHookInput(
      "SessionEnd",
      JSON.stringify({ session_id: "s", reason: "combusted" }),
    );
    expect(end).toMatchObject({ reason: undefined });
  });

  it("reads stop_hook_active only for Stop, and only when it is exactly true", () => {
    const on = claudeCodeAdapter.parseHookInput(
      "Stop",
      JSON.stringify({ session_id: "s", stop_hook_active: true }),
    );
    expect(on).toMatchObject({ stopHookActive: true });
    for (const value of ["true", 1, null]) {
      const off = claudeCodeAdapter.parseHookInput(
        "Stop",
        JSON.stringify({ session_id: "s", stop_hook_active: value }),
      );
      expect(off).toMatchObject({ stopHookActive: false });
    }
  });

  it("never quotes the payload in a parse error", () => {
    const failed = claudeCodeAdapter.parseHookInput("Stop", '{"session_id": ghp_secret}');
    expect(failed).toEqual({ message: "workledger: hook Stop: stdin is not valid JSON" });
  });

  it("blockStop is exit 2 with the reason on stderr, and writes no stdout", () => {
    const lines: string[] = [];
    const out: string[] = [];
    const code = claudeCodeAdapter.blockStop("do the thing", {
      stdout: (line) => out.push(line),
      stderr: (line) => lines.push(line),
    });
    expect(code).toBe(EXIT_BLOCK);
    expect(lines).toEqual(["do the thing"]);
    expect(out).toEqual([]);
  });

  it("transcriptSize reports undefined rather than throwing", () => {
    expect(claudeCodeAdapter.transcriptSize(undefined)).toBeUndefined();
    expect(claudeCodeAdapter.transcriptSize("")).toBeUndefined();
    expect(claudeCodeAdapter.transcriptSize("/nope/nowhere.jsonl")).toBeUndefined();
  });
});

describe("the config loader", () => {
  it("reads the file init writes", () => {
    const parsed = parseConfig(
      [
        "schema_version: 1",
        "harnesses: [claude-code]",
        "thresholds: { bytes: 1000, minutes: 2, turns: 3 }  # inline comment",
        "brief: { inject: false, max_tokens: 500 }",
        "stale_turns: 9",
        "orphan_minutes: 30",
        'private_paths: ["~/secret", /var/tmp]',
        "auto_commit: false",
      ].join("\n"),
    );
    expect(parsed.thresholds).toEqual({ bytes: 1000, minutes: 2, turns: 3 });
    expect(parsed.brief).toEqual({ inject: false, max_tokens: 500 });
    expect(parsed.stale_turns).toBe(9);
    expect(parsed.private_paths).toEqual(["~/secret", "/var/tmp"]);
  });

  it("reads block mappings and block sequences too", () => {
    const parsed = parseConfig(
      [
        "# a comment",
        "thresholds:",
        "  bytes: 11",
        "  minutes: 22",
        "private_paths:",
        "  - /a",
        '  - "/b"',
        "",
      ].join("\n"),
    );
    expect(parsed.thresholds).toEqual({ bytes: 11, minutes: 22, turns: 15 });
    expect(parsed.private_paths).toEqual(["/a", "/b"]);
  });

  it("falls back to the default for every value it cannot read", () => {
    const parsed = parseConfig(
      ["thresholds: { bytes: 0, minutes: nope, turns: 1.5 }", "stale_turns: -3", "brief: [1]", "junk"].join(
        "\n",
      ),
    );
    expect(parsed).toEqual(DEFAULT_CONFIG);
  });

  it("an empty document is the defaults", () => {
    expect(parseConfig("")).toEqual(DEFAULT_CONFIG);
  });

  it("isPrivatePath matches a path, a parent and a star prefix, never a sibling", () => {
    expect(isPrivatePath("/w/a", ["/w/a"], "/home/u")).toBe(true);
    expect(isPrivatePath("/w/a/b", ["/w/a"], "/home/u")).toBe(true);
    expect(isPrivatePath("/w/ab", ["/w/a"], "/home/u")).toBe(false);
    expect(isPrivatePath("/w/abc", ["/w/a*"], "/home/u")).toBe(true);
    expect(isPrivatePath("/home/u/p", ["~/p"], "/home/u")).toBe(true);
    expect(isPrivatePath("/w/a", ["", "  "], "/home/u")).toBe(false);
  });
});

describe("git-info", () => {
  it("reads the remote, the branch and the identity out of git's own files", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-git-"));
    created.push(dir);
    const repo = path.join(dir, "repo");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    writeFileSync(
      path.join(repo, ".git", "config"),
      [
        "[core]",
        "\tbare = false",
        '[remote "origin"]',
        "\turl = git@github.com:owner/name.git",
        "[user]",
        "\tname = Repo Local",
        "\temail = local@example.com",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/p1/12-hook\n", "utf8");

    const info = gitInfo(repo, dir);
    expect(info).toEqual({
      repo: "github.com/owner/name",
      branch: "p1/12-hook",
      author: { name: "Repo Local", email: "local@example.com" },
    });
  });

  it("falls back to the directory basename and a detached HEAD", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-git-"));
    created.push(dir);
    const repo = path.join(dir, "plain");
    mkdirSync(repo, { recursive: true });
    expect(gitInfo(repo, dir)).toEqual({
      repo: "plain",
      branch: null,
      author: { name: "unknown", email: "unknown" },
    });
  });

  it("follows a gitdir pointer file and the global identity", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-git-"));
    created.push(dir);
    const repo = path.join(dir, "worktree");
    const real = path.join(dir, "gitdir");
    mkdirSync(repo, { recursive: true });
    mkdirSync(real, { recursive: true });
    writeFileSync(path.join(repo, ".git"), `gitdir: ${real}\n`, "utf8");
    writeFileSync(path.join(real, "HEAD"), "0f1e2d3c4b5a\n", "utf8");
    writeFileSync(path.join(real, "config"), "[core]\n\tbare = false\n", "utf8");
    writeFileSync(
      path.join(dir, ".gitconfig"),
      "[user]\n\tname = Global\n\temail = global@example.com\n",
      "utf8",
    );

    const info = gitInfo(repo, dir);
    expect(info.branch).toBeNull();
    expect(info.author).toEqual({ name: "Global", email: "global@example.com" });
  });

  it("normalizes both remote spellings", () => {
    expect(normalizeRemote("git@github.com:o/r.git")).toBe("github.com/o/r");
    expect(normalizeRemote("https://github.com/o/r.git")).toBe("github.com/o/r");
    expect(normalizeRemote("https://user@example.com/o/r/")).toBe("example.com/o/r");
    expect(normalizeRemote("/srv/git/bare")).toBe("/srv/git/bare");
    expect(normalizeRemote("   ")).toBeUndefined();
  });

  it("ignores INI comments and keys outside a section", () => {
    const ini = parseIni(["# comment", "; also", "stray = 1", "[user]", "name = X", ""].join("\n"));
    expect([...ini]).toEqual([["user.name", "X"]]);
  });
});

/** A `backlog/WL-<ulid>.md` the block instruction can list, rendered by core rather than typed. */
function backlogItem(id: string): string {
  return createItem({
    id,
    title: "Wire up the hook",
    why: "Seeded by the test.",
    provenance: {
      harness: "claude-code",
      session: "01JQ8ZK4T0000000000000000B",
      checkpoint: 1,
      author: { name: "Tester", email: "tester@example.com", dome_user: null },
    },
    now: "2026-09-09T10:00:00.000Z",
  });
}
