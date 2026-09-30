/**
 * The OpenCode adapter and its store reader.
 *
 * OpenCode is the one harness whose hook payload is **ours**: a plugin workledger writes
 * (`src/opencode-hooks.ts`) translates OpenCode's event bus into
 * `workledger hook <Event> --harness opencode`. So the parse cases below assert the payload the
 * plugin sends, and the store cases exercise the SQLite reader `onboarding/stores.ts` uses for
 * discovery and backfill — neither reads a real `~/.local/share/opencode`.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { OPENCODE_BIN_ENV, opencodeAdapter } from "../src/adapters/opencode.js";
import { EXIT_BLOCK } from "../src/exit-codes.js";
import { inferContextFromToolCalls } from "../src/onboarding/touched.js";
import { OPENCODE_DB, OPENCODE_STORE, opencodeSessions } from "../src/onboarding/stores.js";
import type { HarnessAdapter, HookInput } from "../src/adapters/types.js";

/** A parse that succeeded, or a failed assertion naming the message that came back instead. */
function parsed(raw: string, event: Parameters<HarnessAdapter["parseHookInput"]>[0] = "SessionStart"): HookInput {
  const result = opencodeAdapter.parseHookInput(event, raw);
  if ("message" in result) throw new Error(`expected a parse, got: ${result.message}`);
  return result;
}

describe("opencodeAdapter.parseHookInput", () => {
  it("reads the plugin's payload, including never_block and user_email", () => {
    const input = parsed(
      JSON.stringify({
        session_id: "ses_abc",
        cwd: "/home/user/Projects/workledger",
        source: "startup",
        never_block: true,
        user_email: "ada@example.com",
        model: "big-pickle",
      }),
    );
    expect(input).toMatchObject({
      event: "SessionStart",
      harnessSessionId: "ses_abc",
      cwd: "/home/user/Projects/workledger",
      source: "startup",
      model: "big-pickle",
      neverBlock: true,
      userEmail: "ada@example.com",
      stopHookActive: false,
    });
    // No transcript file: OpenCode keeps sessions in SQLite, so the bytes threshold is off.
    expect(input.transcriptPath).toBeUndefined();
    expect(opencodeAdapter.transcriptSize(input.transcriptPath)).toBeUndefined();
  });

  it("reads a child session as never_block false unless the plugin says so", () => {
    expect(parsed(JSON.stringify({ session_id: "ses_a", cwd: "/x" })).neverBlock).toBe(false);
    expect(parsed(JSON.stringify({ session_id: "ses_a", never_block: "true" })).neverBlock).toBe(false);
  });

  it("admits only `other` on SessionEnd", () => {
    expect(parsed(JSON.stringify({ session_id: "ses_a", reason: "other" }), "SessionEnd").reason).toBe("other");
    expect(parsed(JSON.stringify({ session_id: "ses_a", reason: "logout" }), "SessionEnd").reason).toBeUndefined();
  });

  it("reports malformed input without quoting it, and never throws", () => {
    for (const raw of ["not json", "[]", "null", '"a string"']) {
      const result = opencodeAdapter.parseHookInput("Stop", raw);
      expect(result).toHaveProperty("message");
      expect((result as { message: string }).message).toMatch(/stdin is not (?:valid JSON|a JSON object)$/);
    }
    expect((opencodeAdapter.parseHookInput("Stop", "{}") as { message: string }).message).toContain("no session_id");
  });
});

describe("opencodeAdapter outputs", () => {
  it("blocks with exit 2 and the reason on stderr for the plugin to deliver", () => {
    const out = { stdout: [] as string[], stderr: [] as string[] };
    const code = opencodeAdapter.blockStop("checkpoint now", {
      stdout: (line) => out.stdout.push(line),
      stderr: (line) => out.stderr.push(line),
    });
    expect(code).toBe(EXIT_BLOCK);
    expect(out.stderr).toEqual(["checkpoint now"]);
    expect(out.stdout).toEqual([]);
  });

  it("injects the brief as plain text — the plugin wraps it in session.prompt", () => {
    expect(opencodeAdapter.injectContext("the brief")).toBe("the brief");
  });
});

describe("opencodeAdapter.resumeHeadless", () => {
  const resume = opencodeAdapter.resumeHeadless as NonNullable<typeof opencodeAdapter.resumeHeadless>;

  afterEach(() => {
    delete process.env[OPENCODE_BIN_ENV];
  });

  it("spawns `opencode run --session <id> <instruction>`", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wl-opencode-resume-"));
    const bin = path.join(dir, "opencode");
    writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@" > argv.txt\necho done\n', "utf8");
    chmodSync(bin, 0o755);
    process.env[OPENCODE_BIN_ENV] = bin;

    const result = await resume("ses_abc", {
      cwd: dir,
      instruction: "record a checkpoint",
      allowedTools: ["Bash(workledger checkpoint*)"],
      timeoutMs: 5000,
    });

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(readFileSync(path.join(dir, "argv.txt"), "utf8").split("\n").slice(0, 4)).toEqual([
      "run",
      "--session",
      "ses_abc",
      "record a checkpoint",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The store reader
// ---------------------------------------------------------------------------

/** One row of the real `session`/`part` shape, reduced to the columns the reader uses. */
interface StoreFixture {
  id: string;
  directory: string;
  parentId?: string;
  title?: string;
  created: number;
  updated: number;
  tool?: string;
  input?: Record<string, unknown>;
}

/** A temp `opencode.db` carrying exactly the tables `opencodeSessions` queries. */
function makeStore(home: string, sessions: StoreFixture[]): string {
  const dir = path.join(home, OPENCODE_STORE);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, OPENCODE_DB);
  const db = new Database(file);
  db.exec(
    "CREATE TABLE session (id text PRIMARY KEY, directory text, parent_id text, title text, time_created integer, time_updated integer);" +
      "CREATE TABLE part (id text PRIMARY KEY, session_id text, data text);",
  );
  const insertSession = db.prepare(
    "INSERT INTO session (id, directory, parent_id, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertPart = db.prepare("INSERT INTO part (id, session_id, data) VALUES (?, ?, ?)");
  sessions.forEach((session, index) => {
    insertSession.run(
      session.id,
      session.directory,
      session.parentId ?? null,
      session.title ?? "",
      session.created,
      session.updated,
    );
    if (session.tool !== undefined) {
      insertPart.run(`part_${index}`, session.id, JSON.stringify({ type: "tool", tool: session.tool, state: { input: session.input ?? {} } }));
    }
  });
  db.close();
  return file;
}

describe("opencodeSessions", () => {
  it("reads sessions and normalizes their tool calls to the scanner's shape", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "wl-opencode-store-"));
    const dir = path.join(home, "Projects", "workledger");
    makeStore(home, [
      { id: "ses_one", directory: dir, created: 1_700_000_000_000, updated: 1_700_000_100_000, tool: "write", input: { filePath: path.join(dir, "src", "a.ts") } },
      { id: "ses_two", directory: dir, created: 1_700_000_200_000, updated: 1_700_000_300_000, tool: "bash", input: { command: "git commit -m x" } },
      { id: "ses_child", directory: dir, parentId: "ses_one", created: 1_700_000_400_000, updated: 1_700_000_500_000 },
    ]);

    const sessions = opencodeSessions(home);
    expect(sessions.map((s) => s.harnessSessionId).sort()).toEqual(["ses_child", "ses_one", "ses_two"]);

    const one = sessions.find((s) => s.harnessSessionId === "ses_one");
    expect(one).toMatchObject({ cwd: dir, parentId: null, startedIso: new Date(1_700_000_000_000).toISOString() });
    expect(one?.toolCalls).toEqual([
      { name: "Write", input: { file_path: path.join(dir, "src", "a.ts") }, cwd: dir },
    ]);

    const two = sessions.find((s) => s.harnessSessionId === "ses_two");
    expect(two?.toolCalls).toEqual([{ name: "Bash", input: { command: "git commit -m x" }, cwd: dir }]);

    const child = sessions.find((s) => s.harnessSessionId === "ses_child");
    expect(child?.parentId).toBe("ses_one");
  });

  it("reads a missing store as no sessions, never throwing", () => {
    expect(opencodeSessions(mkdtempSync(path.join(os.tmpdir(), "wl-opencode-empty-")))).toEqual([]);
  });
});

describe("OpenCode tool calls in the context inference", () => {
  it("a normalized write under a repo qualifies that repo", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "wl-opencode-infer-"));
    const repo = path.join(home, "Projects", "proj");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    const inference = inferContextFromToolCalls(
      [{ name: "Write", input: { file_path: path.join(repo, "src", "a.ts") }, cwd: repo }],
      [repo],
      repo,
      home,
    );
    expect(inference.contextRepos[0]?.root).toBe(repo);
    expect(inference.startRepo).toBe(repo);
  });
});
