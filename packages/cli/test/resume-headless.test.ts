/**
 * `claudeCodeAdapter.resumeHeadless` — the spawn half of the repair path
 * (docs/contracts/p3/cli.md §`workledger repair` step 2).
 *
 * `WORKLEDGER_CLAUDE_BIN` points at a shell script standing in for `claude`, so the argv, the
 * output capture and the timeout kill are all asserted against a real child process. The one
 * thing a stub could not establish is the one that matters most here: that a child which ignores
 * the clock is actually killed rather than waited on.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CLAUDE_BIN_ENV, MAX_RESUME_OUTPUT, claudeCodeAdapter } from "../src/adapters/claude-code.js";
import type { ResumeOptions } from "../src/adapters/types.js";

let dir: string;

/** Install a fake `claude` and return nothing — the adapter finds it through the env var. */
function fakeClaude(body: string): void {
  const bin = path.join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(bin, 0o755);
  process.env[CLAUDE_BIN_ENV] = bin;
}

function options(overrides: Partial<ResumeOptions> = {}): ResumeOptions {
  return {
    cwd: dir,
    instruction: "record a checkpoint",
    allowedTools: ["Bash(workledger checkpoint*)"],
    timeoutMs: 5000,
    ...overrides,
  };
}

/** The adapter's method, which the interface declares optional. */
const resume = claudeCodeAdapter.resumeHeadless?.bind(claudeCodeAdapter) as NonNullable<
  typeof claudeCodeAdapter.resumeHeadless
>;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "wl-resume-"));
});

afterEach(() => {
  delete process.env[CLAUDE_BIN_ENV];
  rmSync(dir, { recursive: true, force: true });
});

describe("resumeHeadless", () => {
  it("passes the contracted argv and captures both streams", async () => {
    fakeClaude('printf "%s\\n" "$@" > argv.txt; echo out; echo err >&2; exit 0');

    const result = await resume("hs-1", options());

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");

    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path.join(dir, "argv.txt"), "utf8").split("\n")).toEqual([
      "-p",
      "record a checkpoint",
      "--resume",
      "hs-1",
      "--allowedTools",
      "Bash(workledger checkpoint*)",
      "",
    ]);
  });

  it("passes no --permission-mode at all", async () => {
    // `acceptEdits` auto-approves the edit tools *regardless of* `--allowedTools`, which would
    // let an unattended repair write the repo it was only asked to describe. Headless `-p`
    // denies anything outside `--allowedTools` on its own.
    fakeClaude('printf "%s\\n" "$@" > argv.txt');

    await resume("hs-1", options());

    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path.join(dir, "argv.txt"), "utf8")).not.toContain("--permission-mode");
  });

  it("reports a non-zero exit without throwing", async () => {
    fakeClaude("exit 7");

    expect(await resume("hs-1", options())).toMatchObject({ exitCode: 7, timedOut: false });
  });

  it("kills a child that outlives the timeout", async () => {
    fakeClaude("sleep 30");

    const started = Date.now();
    const result = await resume("hs-1", options({ timeoutMs: 150 }));

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("kills the whole process group, not just the harness", async () => {
    // A coding agent is a process that spawns processes. This stub is the shape of the real
    // failure: `claude` exits the moment its tool is running in the background, and the tool
    // outlives it holding the stdio pipes it inherited. Signalling one pid returned at T+30 s.
    fakeClaude(
      [
        "sh -c 'sleep 30' &",
        "echo $! > grandchild.pid",
        // The harness itself stays alive, as a real one would while its tool works.
        "sleep 30",
      ].join("\n"),
    );

    const started = Date.now();
    const result = await resume("hs-1", options({ timeoutMs: 2000 }));
    const elapsed = Date.now() - started;

    expect(result.timedOut).toBe(true);
    expect(elapsed, `returned after ${elapsed} ms`).toBeLessThan(4000);

    const { readFileSync } = await import("node:fs");
    const pid = Number(readFileSync(path.join(dir, "grandchild.pid"), "utf8").trim());
    expect(Number.isInteger(pid)).toBe(true);
    // Signal 0 tests for existence; the grandchild must be gone with the group.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(() => process.kill(pid, 0), `pid ${pid} survived the kill`).toThrow(/ESRCH/);
  });

  it("reports a harness that is not installed as a spawn error", async () => {
    process.env[CLAUDE_BIN_ENV] = path.join(dir, "does-not-exist");

    const result = await resume("hs-1", options());

    expect(result.spawnError).toContain("ENOENT");
    expect(result.exitCode).toBeNull();
  });

  it("keeps only the tail of a very chatty session", async () => {
    // 40 000 characters, which is well past the cap; the end is what a failure is at.
    fakeClaude('i=0; while [ $i -lt 400 ]; do printf "%099d\\n" $i; i=$((i+1)); done; echo TAIL');

    const result = await resume("hs-1", options());

    expect(result.output.length).toBeLessThanOrEqual(MAX_RESUME_OUTPUT);
    expect(result.output).toContain("TAIL");
  });

  it("runs the child in the repo it was given", async () => {
    fakeClaude("pwd");

    const result = await resume("hs-1", options());

    const { realpathSync } = await import("node:fs");
    expect(result.output.trim()).toBe(realpathSync(dir));
  });
});
