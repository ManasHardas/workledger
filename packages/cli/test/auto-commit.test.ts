/**
 * `auto_commit` — docs/contracts/p5/config-and-identities.md §`.workledger/config.yaml`.
 *
 * Driven against a real `git` in a real temp repository rather than against a stub, because
 * every property the contract states is a property of what git ends up holding: *one* commit,
 * touching *only* `.workledger/`, with the contract's exact message, and none at all when the
 * tree is mid-rebase. A fake `git` would only assert that this file calls the arguments it
 * already says it calls.
 *
 * The two skip cases are the ones that matter most. An auto-commit is a convenience; a
 * convenience that commits into a half-finished merge, or that turns a successful checkpoint
 * into a non-zero exit, is a liability. Both are asserted on the exit code as well as on the
 * repository.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSessionText } from "@workledger/core";
import type { SessionFrontmatter } from "@workledger/core";

import {
  autoCommitLedger,
  checkpointMessage,
  maybeAutoCommit,
  operationInProgress,
  sessionEndMessage,
} from "../src/auto-commit.js";
import { runCheckpoint, stdinFrom } from "../src/commands/checkpoint.js";
import { runHook } from "../src/commands/hook.js";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { EXIT_OK } from "../src/exit-codes.js";
import { openIndex } from "../src/index/db.js";
import type { CheckpointIo } from "../src/commands/checkpoint.js";
import type { HookIo } from "../src/commands/hook.js";

const ULID = "01JQ8ZK4T0000000000000000A";
const HARNESS_ID = "hsess-auto-commit";
const AT = "2026-09-09T12:30:00.000Z";

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

/** Run `git` in `root`, failing the test loudly if it fails. */
function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The one-line subjects of every commit, newest first. */
function log(root: string): string[] {
  const out = git(root, "log", "--format=%s").trim();
  return out === "" ? [] : out.split("\n");
}

/** Paths the newest commit touched. */
function filesInHead(root: string): string[] {
  return git(root, "show", "--name-only", "--format=", "HEAD")
    .trim()
    .split("\n")
    .filter((line) => line !== "");
}

function frontmatter(): SessionFrontmatter {
  return {
    schema_version: 1,
    id: ULID,
    harness: "claude-code",
    harness_session_id: HARNESS_ID,
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

interface Fixture {
  root: string;
  home: string;
  transcript: string;
}

/**
 * A git repository with one ordinary commit already in it, an enabled `.workledger/` that is
 * *not* yet tracked, and one open session in the index.
 *
 * `README.md` is committed first so `HEAD` exists — a repository with no commits behaves
 * differently enough (`git show HEAD` fails, `MERGE_HEAD` cannot exist) that testing against one
 * would be testing a state no enabled repo is in.
 */
function setup(autoCommit: string): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-autocommit-"));
  temps.push(dir);
  const root = path.join(dir, "repo");
  const home = path.join(dir, "home");
  mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  mkdirSync(home, { recursive: true });

  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Ada Lovelace");
  git(root, "config", "user.email", "ada@example.com");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(root, "README.md"), "# repo\n", "utf8");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "initial");

  writeFileSync(
    path.join(root, ".workledger", "config.yaml"),
    [
      "schema_version: 1",
      "harnesses: [claude-code]",
      "thresholds: { bytes: 40000, minutes: 20, turns: 15 }",
      "brief: { inject: true, max_tokens: 2000 }",
      "stale_turns: 5",
      "private_paths: []",
      `auto_commit: ${autoCommit}`,
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    path.join(root, ".workledger", "sessions", `${ULID}.md`),
    createSessionText(frontmatter()),
    "utf8",
  );
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(transcript, "x".repeat(100), "utf8");

  const db = openIndex({ home });
  try {
    db.insertSession({
      ulid: ULID,
      repo_path: root,
      harness: "claude-code",
      harness_session_id: HARNESS_ID,
      status: "open",
      transcript_path: transcript,
      turns_total: 7,
      turns_since_checkpoint: 7,
      last_offset: 100,
    });
  } finally {
    db.close();
  }
  return { root, home, transcript };
}

const PAYLOAD = JSON.stringify({
  goal: "Ship auto_commit.",
  done: [{ text: "Wrote the module.", commit: "0447dab", verified: "tests-passed" }],
  remaining: [],
  notes: [],
});

/** Run one `workledger checkpoint` against the fixture, returning its exit code and streams. */
async function checkpoint(fixture: Fixture): Promise<{ code: number; err: string[]; out: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CheckpointIo = {
    readStdin: stdinFrom(PAYLOAD),
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    cwd: fixture.root,
    home: fixture.home,
    now: () => new Date(AT),
    newId: () => "WL-01JQ8ZK4T0000000000000000B",
  };
  return { code: await runCheckpoint({}, io), out, err };
}

/** Run one `hook SessionEnd` against the fixture. */
async function sessionEnd(fixture: Fixture): Promise<{ code: number; err: string[] }> {
  const err: string[] = [];
  const io: HookIo = {
    readStdin: () =>
      Promise.resolve(
        JSON.stringify({
          session_id: HARNESS_ID,
          transcript_path: fixture.transcript,
          cwd: fixture.root,
          hook_event_name: "SessionEnd",
          reason: "prompt_input_exit",
        }),
      ),
    stdout: () => undefined,
    stderr: (line) => void err.push(line),
    cwd: fixture.root,
    env: { WORKLEDGER_HOME: fixture.home },
    homeDir: fixture.home,
    now: () => new Date(AT),
    adapter: claudeCodeAdapter,
  };
  return { code: await runHook("SessionEnd", io), err };
}

describe("auto_commit", () => {
  it("on_checkpoint makes exactly one commit, touching only .workledger/", async () => {
    const fixture = setup("on_checkpoint");

    const result = await checkpoint(fixture);

    expect(result.code).toBe(EXIT_OK);
    expect(log(fixture.root)).toEqual([checkpointMessage(1, ULID), "initial"]);
    // The message is the contract's, character for character.
    expect(log(fixture.root)[0]).toBe(`workledger: checkpoint 1 for ${ULID}`);
    const touched = filesInHead(fixture.root);
    expect(touched.length).toBeGreaterThan(0);
    for (const file of touched) expect(file.startsWith(".workledger/")).toBe(true);
    // And nothing was pushed anywhere: there is no remote to push to, and no branch moved but
    // the one the commit was made on.
    expect(git(fixture.root, "remote").trim()).toBe("");
  });

  it("leaves work the operator had staged outside .workledger/ alone", async () => {
    const fixture = setup("on_checkpoint");
    writeFileSync(path.join(fixture.root, "src.ts"), "export const x = 1;\n", "utf8");
    git(fixture.root, "add", "src.ts");

    await checkpoint(fixture);

    expect(filesInHead(fixture.root).some((file) => file === "src.ts")).toBe(false);
    // Still staged, still uncommitted — exactly where the operator left it.
    expect(git(fixture.root, "diff", "--cached", "--name-only").trim()).toBe("src.ts");
  });

  it("auto_commit: false makes no commit at all", async () => {
    const fixture = setup("false");

    const result = await checkpoint(fixture);

    expect(result.code).toBe(EXIT_OK);
    expect(log(fixture.root)).toEqual(["initial"]);
    expect(result.err).toEqual([]);
  });

  it("on_session_end commits at SessionEnd with the contract's message", async () => {
    const fixture = setup("on_session_end");

    // A checkpoint under `on_session_end` must not commit: the mode names one moment, not both.
    await checkpoint(fixture);
    expect(log(fixture.root)).toEqual(["initial"]);

    const result = await sessionEnd(fixture);

    expect(result.code).toBe(EXIT_OK);
    expect(log(fixture.root)).toEqual([sessionEndMessage(ULID), "initial"]);
    expect(log(fixture.root)[0]).toBe(`workledger: session ${ULID} ended`);
  });

  it("skips with one stderr line, and an unchanged exit code, mid-merge", async () => {
    const fixture = setup("on_checkpoint");
    // The marker git leaves for the whole of an unfinished merge. Written directly because the
    // state, not the conflict that produced it, is what the contract keys on.
    writeFileSync(path.join(fixture.root, ".git", "MERGE_HEAD"), `${git(fixture.root, "rev-parse", "HEAD")}`, "utf8");
    expect(operationInProgress(fixture.root)).toBe("MERGE_HEAD");

    const result = await checkpoint(fixture);

    expect(result.code).toBe(EXIT_OK);
    expect(log(fixture.root)).toEqual(["initial"]);
    const skips = result.err.filter((line) => line.includes("auto_commit"));
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatch(/^workledger: /);
    expect(skips[0]).toContain("MERGE_HEAD");
  });

  it("skips a rebase and a cherry-pick the same way", () => {
    const fixture = setup("on_checkpoint");
    mkdirSync(path.join(fixture.root, ".git", "rebase-merge"), { recursive: true });
    expect(operationInProgress(fixture.root)).toBe("rebase-merge");
    expect(autoCommitLedger(fixture.root, "m").outcome).toBe("operation-in-progress");
    rmSync(path.join(fixture.root, ".git", "rebase-merge"), { recursive: true });

    writeFileSync(path.join(fixture.root, ".git", "CHERRY_PICK_HEAD"), "x\n", "utf8");
    expect(autoCommitLedger(fixture.root, "m").outcome).toBe("operation-in-progress");
  });

  it("says nothing when .workledger/ has no changes", () => {
    const fixture = setup("on_checkpoint");
    git(fixture.root, "add", ".workledger");
    git(fixture.root, "commit", "-q", "-m", "ledger");

    const result = autoCommitLedger(fixture.root, "workledger: nothing");

    expect(result.outcome).toBe("nothing-to-commit");
    expect(result.message).toBeUndefined();
    expect(log(fixture.root)).toEqual(["ledger", "initial"]);
  });

  it("skips a directory that is not a git repo, and reports a missing git", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-nogit-"));
    temps.push(dir);
    mkdirSync(path.join(dir, ".workledger"), { recursive: true });

    const plain = autoCommitLedger(dir, "workledger: nothing");
    expect(plain.outcome).toBe("not-a-git-repo");
    expect(plain.message).toMatch(/^workledger: /);

    // The ENOENT a machine without git produces, injected rather than simulated by unsetting
    // PATH — this asserts the branch, not the operating system's process loader.
    const fixture = setup("on_checkpoint");
    const missing = autoCommitLedger(fixture.root, "workledger: nothing", {
      git: () => {
        const error = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });
    expect(missing.outcome).toBe("git-missing");
    expect(missing.message).toContain("git is not on PATH");
  });

  it("reports a git that ran and failed, and never throws", () => {
    const fixture = setup("on_checkpoint");
    const failure = new Error("Command failed") as Error & { stderr: string };
    failure.stderr = "fatal: unable to write new index file\nhint: check disk space\n";

    const result = autoCommitLedger(fixture.root, "workledger: nothing", {
      git: (args) => {
        if (args[0] === "status") return " M .workledger/config.yaml\n";
        throw failure;
      },
    });

    expect(result.outcome).toBe("failed");
    // One line: the first of git's diagnostic, not the whole of it.
    expect(result.message).toBe("workledger: auto_commit failed: fatal: unable to write new index file");
  });

  it("maybeAutoCommit is inert for a mode this call site does not implement", () => {
    const fixture = setup("on_session_end");
    const lines: string[] = [];

    maybeAutoCommit({
      configured: "on_session_end",
      when: "on_checkpoint",
      root: fixture.root,
      message: "workledger: never",
      stderr: (line) => void lines.push(line),
    });

    expect(lines).toEqual([]);
    expect(log(fixture.root)).toEqual(["initial"]);
  });

  it("maybeAutoCommit swallows a thrown git and still returns", () => {
    const fixture = setup("on_checkpoint");
    const lines: string[] = [];

    maybeAutoCommit({
      configured: "on_checkpoint",
      when: "on_checkpoint",
      root: fixture.root,
      message: "workledger: boom",
      stderr: (line) => void lines.push(line),
      io: {
        git: () => {
          throw new Error("git exploded");
        },
      },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^workledger: auto_commit skipped: git status failed/);
  });
});
