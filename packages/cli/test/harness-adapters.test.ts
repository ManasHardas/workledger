/**
 * The Codex and Cursor adapters — docs/contracts/p4/hooks-codex.md and
 * docs/contracts/p4/hooks-cursor.md.
 *
 * Every case is fixture-driven, from `test/fixtures/hooks/{codex,cursor}/`. The Codex payloads
 * are shaped from the frozen contract against `codex-cli 0.150.1`; the Cursor ones are
 * synthesized from its contract, because Cursor is not installed on the reference machine and
 * that contract says so in as many words — the unit tests are what carry P4b.
 *
 * Two layers are exercised, deliberately. `parseHookInput` and the two output methods are
 * asserted directly, because the field names are the whole content of an adapter. And the state
 * machine is driven end to end through `runHook` against a temp repo, because "a background agent
 * is never blocked" and "a null `transcript_path` disables the bytes threshold" are claims about
 * what the *session* does, not about what a parser returns.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CODEX_BIN_ENV, CODEX_SANDBOX, codexAdapter } from "../src/adapters/codex.js";
import { CURSOR_NO_RESUME, cursorAdapter } from "../src/adapters/cursor.js";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { DEFAULT_HARNESS, HARNESS_NAMES, adapterFor } from "../src/adapters/registry.js";
import { EXIT_BLOCK, EXIT_OK } from "../src/exit-codes.js";
import { openIndex } from "../src/index/db.js";
import { runHook } from "../src/commands/hook.js";
import { sessionFile } from "../src/ledger-fs.js";
import type { HarnessAdapter, HookInput } from "../src/adapters/types.js";
import type { HookEvent } from "../src/commands/hook-events.js";
import type { HookIo } from "../src/commands/hook.js";
import type { SessionRow } from "../src/index/db.js";

const FIXTURES = fileURLToPath(new URL("../../../test/fixtures/hooks/", import.meta.url));

/** The harness session id the Codex fixtures carry. */
const CODEX_ID = "0199c3f1-4a2b-7c3d-8e4f-5a6b7c8d9e0f";
/** The `conversation_id` the Cursor fixtures carry. */
const CURSOR_ID = "conv_01JQ8ZK4T0000000000000000";

/** A temp repo, a temp `WORKLEDGER_HOME` and a transcript the tests can grow. */
interface Fixture {
  dir: string;
  root: string;
  home: string;
  transcript: string;
  stdout: string[];
  stderr: string[];
  clock: Date;
}

afterEach(() => {
  delete process.env[CODEX_BIN_ENV];
});

/** A repo with `.workledger/` and a bytes threshold low enough for one `grow` to cross. */
function setup(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-p4-"));
  const root = path.join(dir, "repo");
  const home = path.join(dir, "home");
  mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    path.join(root, ".workledger", "config.yaml"),
    [
      "schema_version: 1",
      "harnesses: [claude-code, codex, cursor]",
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
  };
}

/**
 * One fixture payload, retargeted at the temp repo.
 *
 * Only the machine-specific fields are rewritten — the repo root under each harness's own key,
 * and the transcript path unless the fixture deliberately carries `null`. The field *names* are
 * the contract's, and those are what an adapter reads.
 */
function payload(
  fixture: Fixture,
  harness: "codex" | "cursor",
  name: string,
  patch: Record<string, unknown> = {},
): string {
  const raw = JSON.parse(
    readFileSync(path.join(FIXTURES, harness, `${name}.json`), "utf8"),
  ) as Record<string, unknown>;
  const root =
    harness === "codex" ? { cwd: fixture.root } : { workspace_roots: [fixture.root] };
  const transcript =
    raw["transcript_path"] === null ? {} : { transcript_path: fixture.transcript };
  return JSON.stringify({ ...raw, ...root, ...transcript, ...patch });
}

/** The `HookIo` for one invocation. */
function io(fixture: Fixture, adapter: HarnessAdapter, stdin: string): HookIo {
  return {
    readStdin: () => Promise.resolve(stdin),
    stdout: (line) => fixture.stdout.push(line),
    stderr: (line) => fixture.stderr.push(line),
    cwd: fixture.root,
    env: { WORKLEDGER_HOME: fixture.home },
    homeDir: fixture.home,
    now: () => new Date(fixture.clock),
    adapter,
  };
}

/** Run one event of one harness with one fixture payload. */
async function run(
  fixture: Fixture,
  harness: "codex" | "cursor",
  event: HookEvent,
  name: string,
  patch: Record<string, unknown> = {},
): Promise<number> {
  const adapter = harness === "codex" ? codexAdapter : cursorAdapter;
  return runHook(event, io(fixture, adapter, payload(fixture, harness, name, patch)));
}

/** The index row for one harness's session. */
function row(fixture: Fixture, harness: string, id: string): SessionRow | undefined {
  const db = openIndex({ home: fixture.home });
  try {
    return db.getSessionByHarnessId(harness, id);
  } finally {
    db.close();
  }
}

/** Grow the transcript so `bytes_since` crosses its threshold. */
function grow(fixture: Fixture, bytes: number): void {
  writeFileSync(fixture.transcript, "x".repeat(bytes), "utf8");
}

/** A parse that succeeded, or a failed assertion naming the message that came back instead. */
function parsed(adapter: HarnessAdapter, event: HookEvent, raw: string): HookInput {
  const result = adapter.parseHookInput(event, raw);
  if ("message" in result) throw new Error(`expected a parse, got: ${result.message}`);
  return result;
}

/** One fixture file, read raw. */
function fixtureText(harness: "codex" | "cursor", name: string): string {
  return readFileSync(path.join(FIXTURES, harness, `${name}.json`), "utf8");
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe("the harness registry", () => {
  it("resolves every name P4 speaks and nothing else", () => {
    expect(HARNESS_NAMES).toEqual(["claude-code", "codex", "cursor"]);
    expect(adapterFor("claude-code")).toBe(claudeCodeAdapter);
    expect(adapterFor("codex")).toBe(codexAdapter);
    expect(adapterFor("cursor")).toBe(cursorAdapter);
    expect(adapterFor("opencode")).toBeUndefined();
    expect(adapterFor("")).toBeUndefined();
    expect(adapterFor(DEFAULT_HARNESS)).toBe(claudeCodeAdapter);
  });

  it("every adapter reports the harness name it is registered under", () => {
    for (const name of HARNESS_NAMES) expect(adapterFor(name)?.harness).toBe(name);
  });
});

// ---------------------------------------------------------------------------
// Codex — parsing
// ---------------------------------------------------------------------------

describe("codexAdapter.parseHookInput", () => {
  it("reads every SessionStart source Codex sends", () => {
    for (const source of ["startup", "resume", "clear", "compact"]) {
      const input = parsed(codexAdapter, "SessionStart", fixtureText("codex", `session-start-${source}`));
      expect(input).toMatchObject({
        harnessSessionId: CODEX_ID,
        source,
        model: "gpt-5.3-codex",
        neverBlock: false,
        userEmail: undefined,
      });
      expect(input.transcriptPath).toContain("rollout-");
    }
  });

  it("reads `fork` as absent — Codex has no fork source", () => {
    const raw = JSON.stringify({ session_id: CODEX_ID, source: "fork" });
    expect(parsed(codexAdapter, "SessionStart", raw).source).toBeUndefined();
  });

  it("reads a null transcript_path as no transcript at all", () => {
    for (const [event, name] of [
      ["SessionStart", "session-start-null-transcript"],
      ["Stop", "stop-null-transcript"],
    ] as Array<[HookEvent, string]>) {
      const input = parsed(codexAdapter, event, fixtureText("codex", name));
      expect(input.transcriptPath).toBeUndefined();
      expect(codexAdapter.transcriptSize(input.transcriptPath)).toBeUndefined();
    }
  });

  it("reads stop_hook_active both ways and ignores turn_id", () => {
    expect(parsed(codexAdapter, "Stop", fixtureText("codex", "stop-hook-active-false")).stopHookActive).toBe(false);
    expect(parsed(codexAdapter, "Stop", fixtureText("codex", "stop-hook-active-true")).stopHookActive).toBe(true);
    expect(parsed(codexAdapter, "Stop", fixtureText("codex", "stop-hook-active-false"))).not.toHaveProperty("turnId");
  });

  it("admits only `other` on SessionEnd, which the ledger maps to unknown", () => {
    expect(parsed(codexAdapter, "SessionEnd", fixtureText("codex", "session-end-other")).reason).toBe("other");
    // Anything else lands as absent, which `hook.ts` reads as `other` → `unknown` too.
    const raw = JSON.stringify({ session_id: CODEX_ID, reason: "logout" });
    expect(parsed(codexAdapter, "SessionEnd", raw).reason).toBeUndefined();
  });

  it("reports malformed input without quoting it, and never throws", () => {
    for (const raw of ["not json", "[]", "null", '"a string"']) {
      const result = codexAdapter.parseHookInput("Stop", raw);
      expect(result).toHaveProperty("message");
      expect((result as { message: string }).message).toMatch(/^workledger: hook Stop: stdin is not (?:valid JSON|a JSON object)$/);
    }
    const noId = codexAdapter.parseHookInput("Stop", "{}");
    expect((noId as { message: string }).message).toContain("no session_id");
  });
});

describe("codexAdapter outputs", () => {
  it("blocks with exit 2 and the reason on stderr, never on stdout", () => {
    const out = { stdout: [] as string[], stderr: [] as string[] };
    const code = codexAdapter.blockStop("checkpoint now", {
      stdout: (line) => out.stdout.push(line),
      stderr: (line) => out.stderr.push(line),
    });
    expect(code).toBe(EXIT_BLOCK);
    expect(out.stderr).toEqual(["checkpoint now"]);
    expect(out.stdout).toEqual([]);
  });

  it("injects with Claude Code's hookSpecificOutput shape", () => {
    expect(JSON.parse(codexAdapter.injectContext("brief") as string)).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "brief" },
    });
  });
});

// ---------------------------------------------------------------------------
// Codex — the state machine
// ---------------------------------------------------------------------------

describe("hook <Event> --harness codex", () => {
  it("SessionStart opens a session recorded as codex and injects the brief", async () => {
    const fixture = setup();

    expect(await run(fixture, "codex", "SessionStart", "session-start-startup")).toBe(EXIT_OK);

    const session = row(fixture, "codex", CODEX_ID);
    expect(session).toBeDefined();
    expect(session?.status).toBe("open");
    // The ledger row keys on `(harness, harness_session_id)`; a Claude Code session with the same
    // id would be a different row entirely.
    expect(row(fixture, "claude-code", CODEX_ID)).toBeUndefined();
    const text = readFileSync(sessionFile(fixture.root, session?.ulid as string), "utf8");
    expect(text).toContain("harness: codex");
    expect(JSON.parse(fixture.stdout[0] as string)).toHaveProperty(
      "hookSpecificOutput.additionalContext",
    );
  });

  it("resume, clear and compact reuse the row rather than forking the ledger", async () => {
    const fixture = setup();
    await run(fixture, "codex", "SessionStart", "session-start-startup");
    const first = row(fixture, "codex", CODEX_ID)?.ulid;

    for (const source of ["resume", "clear", "compact"]) {
      expect(await run(fixture, "codex", "SessionStart", `session-start-${source}`)).toBe(EXIT_OK);
      expect(row(fixture, "codex", CODEX_ID)?.ulid).toBe(first);
    }
  });

  it("Stop allows below the thresholds and blocks with exit 2 once bytes cross", async () => {
    const fixture = setup();
    await run(fixture, "codex", "SessionStart", "session-start-startup");

    expect(await run(fixture, "codex", "Stop", "stop-hook-active-false")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);

    grow(fixture, 50_000);
    expect(await run(fixture, "codex", "Stop", "stop-hook-active-false")).toBe(EXIT_BLOCK);
    expect(fixture.stderr.join("\n")).toContain("workledger checkpoint");
    expect(row(fixture, "codex", CODEX_ID)?.last_block_trigger).toBe("bytes");
  });

  it("stop_hook_active: true always allows, even over the threshold", async () => {
    const fixture = setup();
    await run(fixture, "codex", "SessionStart", "session-start-startup");
    grow(fixture, 50_000);

    expect(await run(fixture, "codex", "Stop", "stop-hook-active-true")).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
    expect(row(fixture, "codex", CODEX_ID)?.blocks_since_checkpoint).toBe(0);
  });

  it("a null transcript_path disables the bytes threshold but not turns", async () => {
    const fixture = setup();
    await run(fixture, "codex", "SessionStart", "session-start-null-transcript");
    // A transcript that grew hugely is invisible: the payload names no file to measure.
    grow(fixture, 5_000_000);

    for (let i = 0; i < 14; i += 1) {
      expect(await run(fixture, "codex", "Stop", "stop-null-transcript")).toBe(EXIT_OK);
    }
    expect(fixture.stderr).toEqual([]);

    // The 15th turn crosses `thresholds.turns`, which a missing transcript does not disable.
    expect(await run(fixture, "codex", "Stop", "stop-null-transcript")).toBe(EXIT_BLOCK);
    expect(row(fixture, "codex", CODEX_ID)?.last_block_trigger).toBe("turns");
  });

  it("SessionEnd records end_reason unknown and exits 0 with no output", async () => {
    const fixture = setup();
    await run(fixture, "codex", "SessionStart", "session-start-startup");
    fixture.stdout.length = 0;

    expect(await run(fixture, "codex", "SessionEnd", "session-end-other")).toBe(EXIT_OK);

    expect(fixture.stdout).toEqual([]);
    const session = row(fixture, "codex", CODEX_ID);
    expect(session?.status).toBe("ended");
    const text = readFileSync(sessionFile(fixture.root, session?.ulid as string), "utf8");
    expect(text).toContain("end_reason: unknown");
    expect(text).toContain("status: ended");
  });
});

// ---------------------------------------------------------------------------
// Codex — headless resume
// ---------------------------------------------------------------------------

describe("codexAdapter.resumeHeadless", () => {
  const resume = codexAdapter.resumeHeadless?.bind(codexAdapter) as NonNullable<
    typeof codexAdapter.resumeHeadless
  >;

  it("spawns `codex exec resume --sandbox workspace-write <id> <instruction>`", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wl-codex-resume-"));
    const bin = path.join(dir, "codex");
    writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@" > argv.txt\necho done\n', "utf8");
    chmodSync(bin, 0o755);
    process.env[CODEX_BIN_ENV] = bin;

    const result = await resume("session-42", {
      cwd: dir,
      instruction: "record a checkpoint",
      allowedTools: ["Bash(workledger checkpoint*)"],
      timeoutMs: 5000,
    });

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(readFileSync(path.join(dir, "argv.txt"), "utf8").split("\n").slice(0, 6)).toEqual([
      "exec",
      "resume",
      "--sandbox",
      CODEX_SANDBOX,
      "session-42",
      "record a checkpoint",
    ]);
  });

  it("kills the whole process group when the timeout elapses", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wl-codex-timeout-"));
    const bin = path.join(dir, "codex");
    // A grandchild holding the inherited pipes: signalling only the harness would leave this
    // running and the promise waiting on a stream that never closes.
    writeFileSync(bin, "#!/bin/sh\nsleep 30 &\nsleep 30\n", "utf8");
    chmodSync(bin, 0o755);
    process.env[CODEX_BIN_ENV] = bin;

    const started = Date.now();
    const result = await resume("session-42", {
      cwd: dir,
      instruction: "record a checkpoint",
      allowedTools: [],
      timeoutMs: 300,
    });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("reports a missing binary as a spawnError rather than throwing", async () => {
    process.env[CODEX_BIN_ENV] = path.join(os.tmpdir(), "no-such-codex-binary");
    const result = await resume("session-42", {
      cwd: os.tmpdir(),
      instruction: "x",
      allowedTools: [],
      timeoutMs: 2000,
    });
    expect(result.spawnError).toBeDefined();
    expect(result.exitCode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cursor — parsing
// ---------------------------------------------------------------------------

describe("cursorAdapter.parseHookInput", () => {
  it("reads conversation_id, workspace_roots[0] and user_email", () => {
    const input = parsed(cursorAdapter, "SessionStart", fixtureText("cursor", "session-start"));
    expect(input).toMatchObject({
      harnessSessionId: CURSOR_ID,
      cwd: "/home/user/Projects/workledger",
      userEmail: "ada@example.com",
      neverBlock: false,
      model: "agent",
    });
  });

  it("refuses a payload with no conversation_id, whatever else it carries", () => {
    const raw = JSON.stringify({ session_id: "sess_7f3a", workspace_roots: ["/tmp"] });
    const result = cursorAdapter.parseHookInput("SessionStart", raw);
    expect((result as { message: string }).message).toContain("no conversation_id");
  });

  it("reads a malformed or empty workspace_roots as no cwd", () => {
    for (const roots of [[], [""], ["ok"], "not-an-array", undefined]) {
      const raw = JSON.stringify({ conversation_id: CURSOR_ID, workspace_roots: roots });
      const input = parsed(cursorAdapter, "SessionStart", raw);
      expect(input.cwd).toBe(roots === "not-an-array" || roots === undefined ? undefined : roots[0] === "ok" ? "ok" : undefined);
    }
  });

  it("treats loop_count > 0 like stop_hook_active", () => {
    expect(parsed(cursorAdapter, "Stop", fixtureText("cursor", "stop")).stopHookActive).toBe(false);
    expect(parsed(cursorAdapter, "Stop", fixtureText("cursor", "stop-loop-count")).stopHookActive).toBe(true);
    for (const loop_count of [-1, 0, "2", null, undefined]) {
      const raw = JSON.stringify({ conversation_id: CURSOR_ID, loop_count });
      expect(parsed(cursorAdapter, "Stop", raw).stopHookActive).toBe(false);
    }
  });

  it("marks a background agent neverBlock on every event that reports it", () => {
    for (const [event, name] of [
      ["SessionStart", "session-start-background"],
      ["Stop", "stop-background"],
    ] as Array<[HookEvent, string]>) {
      expect(parsed(cursorAdapter, event, fixtureText("cursor", name)).neverBlock).toBe(true);
    }
    expect(parsed(cursorAdapter, "Stop", fixtureText("cursor", "stop")).neverBlock).toBe(false);
  });

  it("reads a null transcript_path as no transcript", () => {
    const input = parsed(cursorAdapter, "SessionStart", fixtureText("cursor", "session-start-background"));
    expect(input.transcriptPath).toBeUndefined();
    expect(cursorAdapter.transcriptSize(input.transcriptPath)).toBeUndefined();
  });

  it("maps sessionEnd reasons through the ledger's enum", () => {
    expect(parsed(cursorAdapter, "SessionEnd", fixtureText("cursor", "session-end-prompt_input_exit")).reason).toBe("prompt_input_exit");
    expect(parsed(cursorAdapter, "SessionEnd", fixtureText("cursor", "session-end-other")).reason).toBe("other");
  });

  it("reports malformed input without quoting it, and never throws", () => {
    for (const raw of ["not json", "[]", "null"]) {
      const result = cursorAdapter.parseHookInput("Stop", raw);
      expect((result as { message: string }).message).toMatch(/stdin is not (?:valid JSON|a JSON object)$/);
    }
  });
});

describe("cursorAdapter outputs", () => {
  it("blocks with a followup_message on stdout and exit 0, never exit 2", () => {
    const out = { stdout: [] as string[], stderr: [] as string[] };
    const code = cursorAdapter.blockStop("checkpoint now", {
      stdout: (line) => out.stdout.push(line),
      stderr: (line) => out.stderr.push(line),
    });
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(out.stdout[0] as string)).toEqual({ followup_message: "checkpoint now" });
    expect(out.stderr).toEqual([]);
  });

  it("injects with additional_context, not hookSpecificOutput", () => {
    expect(JSON.parse(cursorAdapter.injectContext("brief") as string)).toEqual({
      additional_context: "brief",
    });
  });

  it("has no headless resume and names extraction instead", () => {
    expect(cursorAdapter.resumeHeadless).toBeUndefined();
    expect(cursorAdapter.noResumeMessage).toBe(CURSOR_NO_RESUME);
    expect(CURSOR_NO_RESUME).toBe(
      "Cursor sessions can be repaired only by extraction; run with --extract",
    );
  });
});

// ---------------------------------------------------------------------------
// Cursor — the state machine
// ---------------------------------------------------------------------------

describe("hook <Event> --harness cursor", () => {
  it("SessionStart records user_email as the author and injects additional_context", async () => {
    const fixture = setup();

    expect(await run(fixture, "cursor", "SessionStart", "session-start")).toBe(EXIT_OK);

    const session = row(fixture, "cursor", CURSOR_ID);
    expect(session).toBeDefined();
    const text = readFileSync(sessionFile(fixture.root, session?.ulid as string), "utf8");
    expect(text).toContain("harness: cursor");
    expect(text).toContain("ada@example.com");
    expect(JSON.parse(fixture.stdout[0] as string)).toHaveProperty("additional_context");
  });

  it("Stop blocks with a followup_message on stdout and exit 0", async () => {
    const fixture = setup();
    await run(fixture, "cursor", "SessionStart", "session-start");
    fixture.stdout.length = 0;
    grow(fixture, 50_000);

    expect(await run(fixture, "cursor", "Stop", "stop")).toBe(EXIT_OK);

    const block = JSON.parse(fixture.stdout[0] as string) as { followup_message: string };
    expect(block.followup_message).toContain("workledger checkpoint");
    expect(fixture.stderr).toEqual([]);
    expect(row(fixture, "cursor", CURSOR_ID)?.blocks_since_checkpoint).toBe(1);
  });

  it("loop_count > 0 allows and raises no block, however far past the threshold", async () => {
    const fixture = setup();
    await run(fixture, "cursor", "SessionStart", "session-start");
    fixture.stdout.length = 0;
    grow(fixture, 50_000);

    expect(await run(fixture, "cursor", "Stop", "stop-loop-count")).toBe(EXIT_OK);

    expect(fixture.stdout).toEqual([]);
    expect(row(fixture, "cursor", CURSOR_ID)?.blocks_since_checkpoint).toBe(0);
    // The turn is still counted: a session that is never checkpointed must still reach
    // `SessionEnd` with an honest `turns_total`.
    expect(row(fixture, "cursor", CURSOR_ID)?.turns_total).toBe(1);
  });

  it("a background agent is recorded, counted and never blocked", async () => {
    const fixture = setup();
    await run(fixture, "cursor", "SessionStart", "session-start-background");
    fixture.stdout.length = 0;
    grow(fixture, 50_000);

    expect(await run(fixture, "cursor", "Stop", "stop-background")).toBe(EXIT_OK);

    expect(fixture.stdout).toEqual([]);
    const session = row(fixture, "cursor", CURSOR_ID);
    expect(session?.blocks_since_checkpoint).toBe(0);
    expect(session?.turns_total).toBe(1);
    // Recorded, and not private: the contract asks for `private: false`.
    expect(session?.private).toBe(0);
  });

  it("SessionEnd maps prompt_input_exit to clean and exits 0 with no output", async () => {
    const fixture = setup();
    await run(fixture, "cursor", "SessionStart", "session-start");
    fixture.stdout.length = 0;

    expect(await run(fixture, "cursor", "SessionEnd", "session-end-prompt_input_exit")).toBe(EXIT_OK);

    expect(fixture.stdout).toEqual([]);
    const session = row(fixture, "cursor", CURSOR_ID);
    expect(session?.status).toBe("ended");
    expect(readFileSync(sessionFile(fixture.root, session?.ulid as string), "utf8")).toContain(
      "end_reason: clean",
    );
  });

  it("routes the repo-root walk through workspace_roots[0]", async () => {
    const fixture = setup();
    // No `cwd` key at all, and `HookIo.cwd` pointing somewhere unrelated: the only way to reach
    // the enabled repo is the Cursor field.
    const stdin = payload(fixture, "cursor", "session-start");
    const code = await runHook("SessionStart", {
      ...io(fixture, cursorAdapter, stdin),
      cwd: os.tmpdir(),
    });

    expect(code).toBe(EXIT_OK);
    expect(row(fixture, "cursor", CURSOR_ID)).toBeDefined();
  });
});
