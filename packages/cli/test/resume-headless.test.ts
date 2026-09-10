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
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Bash(workledger checkpoint*)",
      "",
    ]);
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
