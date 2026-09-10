/**
 * The touched-path scanner — docs/contracts/p8/daemon-and-api.md amendment 8 as tightened by
 * #110: a transcript counts for a repo when it has one write under that root, or references it
 * at least 5 times of which at least one is a non-Bash path tool input or a Bash `cd` into it;
 * Bash command text alone never attributes.
 *
 * Fixtures are built here rather than committed: a workspace folder that is not a repo, three
 * repos under it, and one transcript per harness whose tool calls touch them — `alpha` with a
 * write, `beta` with reads only and fewer than five of them, `gamma` through a `git commit` run
 * after a `cd`. The transcript's own cwd is the workspace, so every relative path has to be
 * resolved against the record's cwd (Claude Code) or the call's `workdir` (Codex) to land anywhere.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openIndex } from "../src/index/db.js";
import { MIN_REFERENCES, meetsRule, scanTranscript, touchedRoots } from "../src/onboarding/touched.js";
import type { IndexDb } from "../src/index/db.js";

let dir: string;
let ws: string;
let alpha: string;
let beta: string;
let gamma: string;
let home: string;

/** One JSONL line. */
function line(record: unknown): string {
  return `${JSON.stringify(record)}\n`;
}

/** A Claude Code assistant record carrying one tool call. */
function toolUse(name: string, input: Record<string, unknown>): string {
  return line({
    type: "assistant",
    timestamp: "2026-09-10T10:00:00.000Z",
    cwd: ws,
    message: { role: "assistant", content: [{ type: "text", text: "…" }, { type: "tool_use", id: "t", name, input }] },
  });
}

/** The Claude Code transcript: started in the workspace, working in the repos below it. */
function claudeTranscript(): string {
  return [
    // The real store's first lines carry no cwd at all; the first user record does.
    line({ type: "last-prompt", sessionId: "s" }),
    line({ type: "user", timestamp: "2026-09-10T09:59:00.000Z", cwd: ws, message: { role: "user", content: "go" } }),
    toolUse("Read", { file_path: "alpha/src/a.ts" }),
    toolUse("Bash", { command: "cd alpha && cat src/a.ts 2>&1", description: "read" }),
    toolUse("Bash", { command: `ls ${beta}/src` }),
    toolUse("Read", { file_path: path.join(beta, "src", "b.ts") }),
    toolUse("Grep", { pattern: "TODO", path: "beta" }),
    toolUse("Glob", { pattern: `${beta}/**/*.ts` }),
    toolUse("Edit", { file_path: path.join(alpha, "src", "a.ts"), old_string: "a", new_string: "b" }),
    toolUse("Bash", { command: `cd ${gamma}; git commit -m "wip"` }),
    // A bare word is a path when something by that name is there: `src` under alpha is, `wip` is not.
    toolUse("Bash", { command: "cd alpha && ls src && echo wip" }),
    // Paths outside every candidate, and a URL that must not resolve against the cwd.
    toolUse("Bash", { command: "curl https://example.com/x/y > /tmp/out.txt" }),
    toolUse("Read", { file_path: "~/.zshrc" }),
    // A tool result far longer than any candidate path, on one line, as the real store writes them.
    line({
      type: "user",
      timestamp: "2026-09-10T10:01:00.000Z",
      cwd: ws,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x".repeat(600_000) }] },
    }),
    line({ type: "assistant", timestamp: "2026-09-10T10:02:00.000Z", cwd: ws, message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
  ].join("");
}

/** A Codex `response_item` record. */
function responseItem(payload: Record<string, unknown>): string {
  return line({ timestamp: "2026-09-10T10:00:00.000Z", type: "response_item", payload });
}

/** The Codex rollout: the same work in Codex's own record shapes. */
function codexTranscript(): string {
  const exec = (cmd: string, workdir: string = ws): string =>
    responseItem({
      type: "custom_tool_call",
      name: "exec",
      input: `const r = await tools.exec_command(${JSON.stringify({ cmd, workdir, yield_time_ms: 10000 })});`,
    });
  return [
    line({ timestamp: "2026-09-10T09:59:00.000Z", type: "session_meta", payload: { id: "01a0-codex", cwd: ws, timestamp: "2026-09-10T09:59:00.000Z" } }),
    line({ timestamp: "2026-09-10T09:59:01.000Z", type: "turn_context", payload: { turn_id: "t1", cwd: ws } }),
    exec("cat alpha/src/a.ts"),
    responseItem({
      type: "function_call",
      name: "shell",
      arguments: JSON.stringify({ command: ["bash", "-lc", "cd alpha && sed -n 1,5p src/a.ts"], workdir: ws }),
    }),
    responseItem({ type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n*** Update File: alpha/src/a.ts\n@@\n-a\n+b\n*** End Patch\n" }),
    exec("ls beta/src"),
    exec("rg foo beta/src/b.ts"),
    responseItem({ type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["cat", `${beta}/README.md`] }) }),
    responseItem({ type: "custom_tool_call_output", call_id: "c", output: `${beta}/README.md ${beta}/README.md ${beta}/README.md` }),
    exec("git commit -m wip", gamma),
  ].join("");
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "workledger-touched-")));
  ws = path.join(dir, "workspace");
  alpha = path.join(ws, "alpha");
  beta = path.join(ws, "beta");
  gamma = path.join(ws, "gamma");
  home = path.join(dir, "home");
  for (const repo of [alpha, beta, gamma]) mkdirSync(path.join(repo, ".git"), { recursive: true });
  // The one path a bare shell word is checked against.
  mkdirSync(path.join(alpha, "src"), { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("scanTranscript", () => {
  it("counts references and writes per candidate root in a Claude Code transcript, resolving relative paths and cd", async () => {
    const file = path.join(dir, "claude.jsonl");
    writeFileSync(file, claudeTranscript(), "utf8");

    const scan = await scanTranscript(file, [alpha, beta, gamma], { homeDir: home });

    expect(scan.cwd).toBe(ws);
    // alpha: Read (relative), cd alpha, src/a.ts after the cd, Edit (absolute) — the Edit writes —
    // then the second cd and the bare `src` that exists. Path inputs: the Read, both cds, the Edit.
    expect(scan.roots.get(alpha)).toEqual({ references: 6, writes: 1, pathInputs: 4 });
    // beta: ls, Read, Grep path, Glob pattern — four reads, no write; the Read and the Grep `path`
    // are path inputs, the Bash `ls` and the Glob pattern are not.
    expect(scan.roots.get(beta)).toEqual({ references: 4, writes: 0, pathInputs: 2 });
    // gamma: the cd (a path input), and `git commit` after it writes where the shell is.
    expect(scan.roots.get(gamma)).toEqual({ references: 1, writes: 1, pathInputs: 1 });
  });

  it("counts a Codex rollout the same way from its own record shapes", async () => {
    const file = path.join(dir, "rollout.jsonl");
    writeFileSync(file, codexTranscript(), "utf8");

    const scan = await scanTranscript(file, [alpha, beta, gamma], { homeDir: home });

    expect(scan.cwd).toBe(ws);
    // alpha: exec cat, shell cd + sed, apply_patch (a write); the cd and the patch are path inputs.
    expect(scan.roots.get(alpha)).toEqual({ references: 4, writes: 1, pathInputs: 2 });
    // beta: three shell reads, none a path input; the tool *output* naming it three more times is
    // not an input.
    expect(scan.roots.get(beta)).toEqual({ references: 3, writes: 0, pathInputs: 0 });
    // gamma: a `git commit` with the call's workdir there.
    expect(scan.roots.get(gamma)).toEqual({ references: 0, writes: 1, pathInputs: 0 });
  });

  it("applies the attribution rule: one write, or five references with at least one path input (#110)", () => {
    expect(MIN_REFERENCES).toBe(5);
    expect(meetsRule({ references: 5, writes: 0, pathInputs: 1 })).toBe(true);
    expect(meetsRule({ references: 4, writes: 0, pathInputs: 4 })).toBe(false);
    // Bash text alone: twenty mentions, no path input, no write — never attributed.
    expect(meetsRule({ references: 20, writes: 0, pathInputs: 0 })).toBe(false);
    expect(meetsRule({ references: 0, writes: 1, pathInputs: 0 })).toBe(true);
    expect(meetsRule({ references: 0, writes: 0, pathInputs: 0 })).toBe(false);
  });

  it("does not attribute a transcript whose only references are Bash command text, however many", async () => {
    const file = path.join(dir, "bash-only.jsonl");
    const commands = Array.from({ length: 20 }, (_, i) => toolUse("Bash", { command: `grep -n foo ${gamma}/src/file${i}.ts` })).join("");
    writeFileSync(file, commands, "utf8");
    const scan = await scanTranscript(file, [gamma], { homeDir: home });
    expect(scan.roots.get(gamma)).toEqual({ references: 20, writes: 0, pathInputs: 0 });
    expect(meetsRule(scan.roots.get(gamma)!)).toBe(false);

    // One `cd` into the root among them is the path input the rule asks for.
    writeFileSync(file, commands + toolUse("Bash", { command: `cd ${gamma} && git status` }), "utf8");
    const withCd = await scanTranscript(file, [gamma], { homeDir: home });
    expect(withCd.roots.get(gamma)).toEqual({ references: 21, writes: 0, pathInputs: 1 });
    expect(meetsRule(withCd.roots.get(gamma)!)).toBe(true);

    // So is one Read of a file under it.
    writeFileSync(file, commands + toolUse("Read", { file_path: `${gamma}/README.md` }), "utf8");
    const withRead = await scanTranscript(file, [gamma], { homeDir: home });
    expect(withRead.roots.get(gamma)).toEqual({ references: 21, writes: 0, pathInputs: 1 });
    expect(meetsRule(withRead.roots.get(gamma)!)).toBe(true);
  });

  it("counts tool inputs only: a tool result or assistant text naming a root twenty times is not a reference", async () => {
    const file = path.join(dir, "results.jsonl");
    const mentions = Array.from({ length: 20 }, (_, i) => `${gamma}/src/file${i}.ts`).join("\n");
    writeFileSync(
      file,
      [
        line({ type: "user", timestamp: "2026-09-10T09:59:00.000Z", cwd: ws, message: { role: "user", content: `please look at ${gamma} and ${gamma}/src` } }),
        toolUse("Bash", { command: "ls" }),
        line({ type: "user", timestamp: "2026-09-10T10:01:00.000Z", cwd: ws, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: mentions }] } }),
        line({ type: "assistant", timestamp: "2026-09-10T10:02:00.000Z", cwd: ws, message: { role: "assistant", content: [{ type: "text", text: `I will now edit ${gamma}/src/a.ts and ${mentions}` }] } }),
        // A tool result that happens to contain the literal text `"tool_use"` is still a result.
        line({ type: "user", timestamp: "2026-09-10T10:03:00.000Z", cwd: ws, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: `{"type":"tool_use","name":"Write","input":{"file_path":"${gamma}/x"}}` }] } }),
      ].join(""),
      "utf8",
    );
    const scan = await scanTranscript(file, [gamma], { homeDir: home });
    expect(scan.roots.get(gamma)).toEqual({ references: 0, writes: 0, pathInputs: 0 });
    expect(meetsRule(scan.roots.get(gamma)!)).toBe(false);
  });

  it("credits a path to the deepest candidate root when candidates nest", async () => {
    const file = path.join(dir, "nested.jsonl");
    writeFileSync(file, toolUse("Read", { file_path: path.join(alpha, "src", "a.ts") }), "utf8");
    const scan = await scanTranscript(file, [ws, alpha], { homeDir: home });
    expect(scan.roots.get(alpha)).toEqual({ references: 1, writes: 0, pathInputs: 1 });
    expect(scan.roots.get(ws)).toEqual({ references: 0, writes: 0, pathInputs: 0 });
  });

  it("yields zero counts for a file it cannot parse, and reads no cwd from it", async () => {
    const file = path.join(dir, "odd.jsonl");
    writeFileSync(file, "not json\n{\"type\":\"assistant\"}\n", "utf8");
    const scan = await scanTranscript(file, [alpha], { homeDir: home });
    expect(scan.cwd).toBeUndefined();
    expect(scan.roots.get(alpha)).toEqual({ references: 0, writes: 0, pathInputs: 0 });
  });
});

describe("touchedRoots (the index cache)", () => {
  let db: IndexDb;

  beforeEach(() => {
    db = openIndex({ home: path.join(dir, "wlhome") });
  });

  afterEach(() => {
    db.close();
  });

  it("scans once per (transcript, mtime, size, root) and serves later lookups from the index", async () => {
    const file = path.join(dir, "claude.jsonl");
    writeFileSync(file, claudeTranscript(), "utf8");
    const at = new Date("2026-09-10T12:00:00.000Z");
    utimesSync(file, at, at);

    const first = await touchedRoots(db, file, [alpha, beta], { cwd: ws, homeDir: home });
    expect([...first.entries()]).toEqual([
      [alpha, { references: 6, writes: 1, pathInputs: 4 }],
      [beta, { references: 4, writes: 0, pathInputs: 2 }],
    ]);
    expect(db.listTranscriptTouches(file).map((row) => [row.root, row.references, row.writes, row.pathInputs])).toEqual([
      [alpha, 6, 1, 4],
      [beta, 4, 0, 2],
    ]);

    // Same size, same mtime, different bytes: the cache answers, the file is not read.
    const size = statSync(file).size;
    writeFileSync(file, "y".repeat(size), "utf8");
    utimesSync(file, at, at);
    expect(await touchedRoots(db, file, [alpha, beta], { cwd: ws, homeDir: home })).toEqual(first);

    // A root the cache has not seen is scanned — against the file as it is now — and the
    // cached rows for the others are kept.
    const widened = await touchedRoots(db, file, [alpha, gamma], { cwd: ws, homeDir: home });
    expect(widened.get(alpha)).toEqual({ references: 6, writes: 1, pathInputs: 4 });
    expect(widened.get(gamma)).toEqual({ references: 0, writes: 0, pathInputs: 0 });
    expect(db.listTranscriptTouches(file).map((row) => row.root)).toEqual([alpha, beta, gamma]);

    // A changed file is rescanned for every root asked.
    writeFileSync(file, claudeTranscript(), "utf8");
    const again = await touchedRoots(db, file, [gamma], { cwd: ws, homeDir: home });
    expect(again.get(gamma)).toEqual({ references: 1, writes: 1, pathInputs: 1 });
    expect(db.listTranscriptTouches(file).map((row) => row.root)).toEqual([gamma]);
  });

  it("returns zero counts and caches nothing for a transcript that is gone", async () => {
    const missing = path.join(dir, "gone.jsonl");
    const result = await touchedRoots(db, missing, [alpha], { cwd: ws, homeDir: home });
    expect(result.get(alpha)).toEqual({ references: 0, writes: 0, pathInputs: 0 });
    expect(db.listTranscriptTouches(missing)).toEqual([]);
  });
});
