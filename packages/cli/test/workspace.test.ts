/**
 * Workspace-root sessions — docs/contracts/p8/daemon-and-api.md amendment 8 (#105), point 3:
 * `workledger init --workspace`, the hook fired from such a folder, `discover`'s `workspaces`,
 * `doctor`'s rows and `onboard --workspaces`.
 *
 * One temp home holds a workspace folder with two enabled repos under it and a transcript the
 * tests grow. The hook is driven in-process through `runHook`, as `hook.test.ts` drives the repo
 * path; the built binary's timing stays `hook-timing.test.ts`'s.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { CODEX_HOOKS_PATH } from "../src/codex-hooks.js";
import { CLAUDE_STORE, projectSlug } from "../src/commands/backfill.js";
import { CURSOR_HOOKS_PATH } from "../src/cursor-hooks.js";
import { buildReport } from "../src/commands/doctor.js";
import { runHook } from "../src/commands/hook.js";
import { runInitReport } from "../src/commands/init.js";
import { trackedReposUnder, workspaceProblem } from "../src/commands/init-workspace.js";
import { runOnboard } from "../src/commands/onboard.js";
import { EXIT_BLOCK, EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import { openIndex } from "../src/index/db.js";
import { workspaceCheckpointInstruction } from "../src/instruction.js";
import { discoverRepos } from "../src/onboarding/discover.js";
import { initRepos } from "../src/onboarding/init.js";
import { touchedRootsOf } from "../src/commands/hook-workspace.js";
import { MIN_REFERENCES, startedInRepo } from "../src/onboarding/touched.js";
import { SETTINGS_PATH, hookCommandString } from "../src/settings-merge.js";
import type { InitIo } from "../src/commands/init.js";
import type { HookIo } from "../src/commands/hook.js";
import type { OnboardIo } from "../src/commands/onboard.js";
import type { OnboardReport } from "../src/commands/onboard.js";
import type { SessionRow } from "../src/index/db.js";
import type { OnboardingIo } from "../src/onboarding/io.js";

const HOOK_FIXTURES = fileURLToPath(new URL("../../../test/fixtures/hooks/", import.meta.url));
const HARNESS_ID = "5be4b928-0e64-4bb2-8a9a-d006fce8b9ce";

let dir: string;
let home: string;
let indexHome: string;
let workspace: string;
let repoA: string;
let repoB: string;
let transcript: string;
let out: string[];
let err: string[];
let clock: Date;

/** An enabled repo: `.git/config` with an identity and the ledger scaffold. */
function enableRepo(root: string, thresholds = "thresholds: { bytes: 40000, minutes: 20, turns: 15 }"): void {
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(path.join(root, ".git", "config"), "[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n", "utf8");
  mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  writeFileSync(
    path.join(root, ".workledger", "config.yaml"),
    ["schema_version: 1", "harnesses: [claude-code]", thresholds, "brief: { inject: true, max_tokens: 2000 }", "stale_turns: 5", "private_paths: []", "auto_commit: false", ""].join("\n"),
    "utf8",
  );
}

function initIo(): InitIo & { out: string[]; err: string[] } {
  return {
    out,
    err,
    cwd: dir,
    homeDir: home,
    env: { PATH: "", HOME: home, WORKLEDGER_HOME: indexHome },
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    confirm: async () => true,
  };
}

function onboardingIo(): OnboardingIo {
  return { homeDir: home, env: { PATH: "", HOME: home, WORKLEDGER_HOME: indexHome }, cwd: dir, stderr: (line) => void err.push(line), now: () => clock, indexHome, tempDirs: [path.join(dir, "elsewhere")] };
}

/** One recorded hook payload, retargeted at the workspace. */
function payload(name: string, patch: Record<string, unknown> = {}): string {
  const raw = JSON.parse(readFileSync(path.join(HOOK_FIXTURES, `${name}.json`), "utf8")) as Record<string, unknown>;
  return JSON.stringify({ ...raw, cwd: workspace, transcript_path: transcript, ...patch });
}

function hookIo(stdin: string): HookIo {
  return {
    readStdin: () => Promise.resolve(stdin),
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    cwd: workspace,
    env: { WORKLEDGER_HOME: indexHome },
    homeDir: home,
    now: () => new Date(clock),
    adapter: claudeCodeAdapter,
  };
}

function rows(): SessionRow[] {
  const db = openIndex({ home: indexHome });
  try {
    return db.listSessionsByHarnessId("claude-code", HARNESS_ID);
  } finally {
    db.close();
  }
}

/** A transcript line: one tool call, the way Claude Code records it. */
function toolLine(name: string, input: Record<string, unknown>): string {
  return `${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t", name, input }] } })}\n`;
}

/** Move the fake clock forward, past the default `minutes` threshold when asked to. */
function tick(minutes: number): void {
  clock = new Date(clock.getTime() + minutes * 60_000);
}

/** Register the workspace the way `init --workspace --yes` does. */
async function enableWorkspace(): Promise<void> {
  expect((await runInitReport({ workspace, yes: true }, initIo())).code).toBe(EXIT_OK);
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "workledger-workspace-")));
  home = path.join(dir, "home");
  indexHome = path.join(dir, "wlhome");
  workspace = path.join(home, "Projects", "dome_workspace");
  repoA = path.join(workspace, "card-shopify_store");
  repoB = path.join(workspace, "card-bart_schedules");
  mkdirSync(workspace, { recursive: true });
  enableRepo(repoA);
  enableRepo(repoB);
  transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(transcript, "", "utf8");
  out = [];
  err = [];
  clock = new Date("2026-09-10T12:00:00.000Z");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("workledger init --workspace", () => {
  it("writes the three hook files with the repo commands, registers the folder, and creates no ledger", async () => {
    const report = await runInitReport({ workspace, yes: true, harness: ["codex", "cursor"] }, initIo());

    expect(report.code).toBe(EXIT_OK);
    expect(report.created).toEqual([]);
    expect(report.hooksWritten).toEqual([SETTINGS_PATH, CODEX_HOOKS_PATH, CURSOR_HOOKS_PATH]);
    expect(report.trustSteps).toHaveLength(1);
    const settings = JSON.parse(readFileSync(path.join(workspace, SETTINGS_PATH), "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(settings.hooks["Stop"]?.[0]?.hooks[0]?.command).toBe(hookCommandString("Stop"));
    expect(existsSync(path.join(workspace, ".workledger"))).toBe(false);
    expect(out).toContain("Privacy:");
    expect(out.join("\n")).toContain("card-bart_schedules, card-shopify_store");

    const db = openIndex({ home: indexHome });
    try {
      expect(db.listWorkspaces().map((row) => row.path)).toEqual([workspace]);
      expect(db.isWorkspace(workspace)).toBe(true);
      // The folder is not a repo and must not have become one in the index.
      expect(db.listRepos().map((row) => row.repo_path)).toEqual([]);
    } finally {
      db.close();
    }

    // Idempotent: a second run writes nothing.
    const again = await runInitReport({ workspace, yes: true, harness: ["codex", "cursor"] }, initIo());
    expect(again.hooksWritten).toEqual([]);
    expect(out.at(-1)).toBe("already enabled");
  });

  it("refuses a git repo and a folder with no tracked repo, touching nothing", async () => {
    expect((await runInitReport({ workspace: repoA, yes: true }, initIo())).code).toBe(EXIT_USAGE);
    expect(err.at(-1)).toContain("is a git repository");
    const empty = path.join(dir, "empty");
    mkdirSync(empty);
    expect((await runInitReport({ workspace: empty, yes: true }, initIo())).code).toBe(EXIT_USAGE);
    expect(err.at(-1)).toContain("holds no tracked repo");
    expect(existsSync(path.join(empty, SETTINGS_PATH))).toBe(false);
    expect(existsSync(path.join(repoA, SETTINGS_PATH))).toBe(false);
    // A repo selected in the same wizard call counts even before it is enabled.
    expect(workspaceProblem(empty, [path.join(empty, "soon")])).toBeUndefined();
    expect(trackedReposUnder(workspace)).toEqual([repoB, repoA]);
  });
});

describe("touched roots from the accumulated counts", () => {
  it("applies the contract's rule and ranks by references, then writes", () => {
    expect(touchedRootsOf({ [repoA]: { references: MIN_REFERENCES, writes: 0, pathInputs: 1 }, [repoB]: { references: 2, writes: 1, pathInputs: 0 } })).toEqual([repoA, repoB]);
    expect(touchedRootsOf({ [repoA]: { references: 1, writes: 1, pathInputs: 1 }, [repoB]: { references: 1, writes: 2, pathInputs: 1 } })).toEqual([repoB, repoA]);
    expect(touchedRootsOf({ [repoA]: { references: MIN_REFERENCES - 1, writes: 0, pathInputs: 4 } })).toEqual([]);
    // Bash text alone never attributes (#110); from inside another repo, only a write does.
    expect(touchedRootsOf({ [repoA]: { references: 20, writes: 0, pathInputs: 0 } })).toEqual([]);
    expect(touchedRootsOf({ [repoA]: { references: 20, writes: 0, pathInputs: 5 }, [repoB]: { references: 1, writes: 1, pathInputs: 1 } }, true)).toEqual([repoB]);
  });
});

describe("hook from a workspace session", () => {
  it("SessionStart records the session against the workspace with no repo and no ledger file", async () => {
    await enableWorkspace();
    out.length = 0;

    expect(await runHook("SessionStart", hookIo(payload("session-start-startup")))).toBe(EXIT_OK);

    expect(out).toEqual([]);
    const [row] = rows();
    expect(row).toMatchObject({ repo_path: workspace, workspace: 1, cwd: workspace, status: "open", scan_offset: 0 });
    for (const root of [repoA, repoB]) expect(readdirSync(path.join(root, ".workledger", "sessions"))).toEqual([]);
    // The workspace never becomes a repo row.
    const db = openIndex({ home: indexHome });
    try {
      expect(db.listRepos().map((r) => r.repo_path)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("is silent in a folder with a hook file that was never registered", async () => {
    mkdirSync(path.join(workspace, ".claude"), { recursive: true });
    writeFileSync(path.join(workspace, SETTINGS_PATH), "{}", "utf8");
    expect(await runHook("SessionStart", hookIo(payload("session-start-startup")))).toBe(EXIT_OK);
    expect(rows()).toEqual([]);
    expect(out).toEqual([]);
    expect(err).toEqual([]);
  });

  it("Stop under the thresholds allows without scanning", async () => {
    await enableWorkspace();
    await runHook("SessionStart", hookIo(payload("session-start-startup")));
    writeFileSync(transcript, toolLine("Read", { file_path: `${repoA}/x` }), "utf8");

    expect(await runHook("Stop", hookIo(payload("stop-hook-active-false")))).toBe(EXIT_OK);

    const [row] = rows();
    expect(row).toMatchObject({ turns_total: 1, scan_offset: 0, scan_counts: null, blocks_since_checkpoint: 0 });
    expect(rows()).toHaveLength(1);
  });

  it("Stop over a threshold blocks with one --repo command per touched repo, most-touched first, opening a row and file in each", async () => {
    await enableWorkspace();
    await runHook("SessionStart", hookIo(payload("session-start-startup")));
    // Six reads in repo A, one write in repo B; the minutes threshold is the one crossed (a
    // workspace has no config, so the defaults apply). Repo B is touched by its write alone, and
    // repo A comes first with more references.
    const lines =
      toolLine("Write", { file_path: `${repoB}/schedule.md`, content: "x" }) +
      Array.from({ length: 6 }, (_, i) => toolLine("Read", { file_path: `${repoA}/src/${i}.ts` })).join("");
    writeFileSync(transcript, lines, "utf8");
    err.length = 0;

    tick(21);

    expect(await runHook("Stop", hookIo(payload("stop-hook-active-false")))).toBe(EXIT_BLOCK);

    const all = rows();
    expect(all.map((row) => [row.repo_path, row.workspace])).toEqual([[workspace, 1], [repoB, 0], [repoA, 0]]);
    const a = all.find((row) => row.repo_path === repoA) as SessionRow;
    const b = all.find((row) => row.repo_path === repoB) as SessionRow;
    const text = err.join("\n");
    const commandA = `workledger checkpoint --session ${a.ulid} --repo ${repoA} --payload '<json>'`;
    const commandB = `workledger checkpoint --session ${b.ulid} --repo ${repoB} --payload '<json>'`;
    expect(text).toContain(commandA);
    expect(text).toContain(commandB);
    expect(text.indexOf(commandA)).toBeLessThan(text.indexOf(commandB));
    expect(text).not.toContain("Run exactly one command");
    // A ledger file per touched repo, none in the workspace; the scan is cached on the row.
    expect(readdirSync(path.join(repoA, ".workledger", "sessions"))).toEqual([`${a.ulid}.md`]);
    expect(readdirSync(path.join(repoB, ".workledger", "sessions"))).toEqual([`${b.ulid}.md`]);
    expect(existsSync(path.join(workspace, ".workledger"))).toBe(false);
    const ws = all[0] as SessionRow;
    expect(ws.scan_offset).toBe(Buffer.byteLength(lines));
    expect(JSON.parse(ws.scan_counts as string)).toEqual({ [repoA]: { references: 6, writes: 0, pathInputs: 6 }, [repoB]: { references: 1, writes: 1, pathInputs: 1 } });
    expect(ws).toMatchObject({ blocks_since_checkpoint: 1, last_block_trigger: "minutes" });

    // The next Stop scans only the new bytes; nothing new and no attempt → allowed, once.
    expect(await runHook("Stop", hookIo(payload("stop-hook-active-false")))).toBe(EXIT_OK);
    expect((rows()[0] as SessionRow).scan_offset).toBe(Buffer.byteLength(lines));

    // A failed attempt on a repo row is the retry block with its errors.
    const db = openIndex({ home: indexHome });
    try {
      db.recordAttempt(a.ulid, { at: clock.toISOString(), exit: 1, errors: "done[0].text: too long" });
    } finally {
      db.close();
    }
    err.length = 0;
    expect(await runHook("Stop", hookIo(payload("stop-hook-active-false")))).toBe(EXIT_BLOCK);
    expect(err.join("\n")).toContain("done[0].text: too long");
    expect((rows()[0] as SessionRow).blocks_since_checkpoint).toBe(2);
  });

  it("Stop over a threshold with no touched repo allows, and a checkpoint in every touched repo resets the window", async () => {
    await enableWorkspace();
    await runHook("SessionStart", hookIo(payload("session-start-startup")));
    writeFileSync(transcript, `${JSON.stringify({ type: "assistant", text: "nothing in any repo" })}\n`, "utf8");
    tick(21);
    expect(await runHook("Stop", hookIo(payload("stop-hook-active-false")))).toBe(EXIT_OK);
    expect(rows()).toHaveLength(1);
    expect((rows()[0] as SessionRow).blocks_since_checkpoint).toBe(0);

    writeFileSync(transcript, `${readFileSync(transcript, "utf8")}${toolLine("Edit", { file_path: `${repoA}/a.ts` })}`, "utf8");
    expect(await runHook("Stop", hookIo(payload("stop-hook-active-false")))).toBe(EXIT_BLOCK);
    const a = rows().find((row) => row.repo_path === repoA) as SessionRow;
    const db = openIndex({ home: indexHome });
    try {
      db.resetAfterCheckpoint(a.ulid, { offset: 0, at: clock.toISOString() });
    } finally {
      db.close();
    }
    expect(await runHook("Stop", hookIo(payload("stop-hook-active-false")))).toBe(EXIT_OK);
    expect(rows()[0]).toMatchObject({ blocks_since_checkpoint: 0, turns_since_checkpoint: 0, turns_total: 3 });
  });

  it("SessionEnd closes the workspace row and every repo row and file it opened", async () => {
    await enableWorkspace();
    await runHook("SessionStart", hookIo(payload("session-start-startup")));
    writeFileSync(transcript, toolLine("Write", { file_path: `${repoA}/a.ts` }), "utf8");
    tick(21);
    expect(await runHook("Stop", hookIo(payload("stop-hook-active-false")))).toBe(EXIT_BLOCK);

    expect(await runHook("SessionEnd", hookIo(payload("session-end-prompt_input_exit")))).toBe(EXIT_OK);

    const all = rows();
    expect(all).toHaveLength(2);
    for (const row of all) expect(row.status).toBe("ended");
    const a = all.find((row) => row.repo_path === repoA) as SessionRow;
    const file = readFileSync(path.join(repoA, ".workledger", "sessions", `${a.ulid}.md`), "utf8");
    expect(file).toContain("status: ended");
    expect(file).toContain("end_reason: clean");
  });
});

describe("the workspace block instruction", () => {
  it("lists one command per target in order, with each repo's open ids", () => {
    const text = workspaceCheckpointInstruction({
      targets: [
        { sessionId: "01A", root: "/w/a", openIds: ["WL-1"] },
        { sessionId: "01B", root: "/w/b", openIds: [] },
      ],
    });
    expect(text).toContain("run one command per repo, in this order:\n  workledger checkpoint --session 01A --repo /w/a --payload '<json>'\n  workledger checkpoint --session 01B --repo /w/b --payload '<json>'");
    expect(text).toContain("/w/a: open backlog ids for `ref` + `rel`: WL-1");
    expect(text).toContain("/w/b: no open backlog items");
    expect(text).toContain("--payload argument and nowhere else.");
  });
});

describe("discover, init and doctor with workspaces", () => {
  /** A Claude Code project for the workspace with one transcript, so it is a session start folder. */
  function recordSessionIn(cwd: string): void {
    const store = path.join(home, CLAUDE_STORE, projectSlug(cwd));
    mkdirSync(store, { recursive: true });
    writeFileSync(path.join(store, "s1.jsonl"), `${JSON.stringify({ type: "user", cwd })}\n`, "utf8");
  }

  it("discover lists the start folder with its repos and hooksInstalled false, then true after init with workspaces", async () => {
    recordSessionIn(workspace);
    recordSessionIn(repoA);
    const io = onboardingIo();

    const before = await discoverRepos({}, io);
    expect(before.workspaces).toEqual([{ path: workspace, repos: [repoA, repoB], hooksInstalled: false }]);

    const init = await initRepos({ repos: [repoA, repoB], workspaces: [workspace] }, io);
    expect(init.results.map((r) => r.ok)).toEqual([true, true]);
    expect(init.workspaces).toEqual([{ path: workspace, ok: true, hooksWritten: [SETTINGS_PATH], trustSteps: [] }]);

    expect((await discoverRepos({}, io)).workspaces).toEqual([{ path: workspace, repos: [repoA, repoB], hooksInstalled: true }]);
    // A start folder holding no candidate is not a workspace.
    const lone = path.join(home, "Projects", "notes");
    mkdirSync(lone);
    recordSessionIn(lone);
    expect((await discoverRepos({}, io)).workspaces.map((w) => w.path)).toEqual([workspace]);
  });

  it("discover lists a start folder inside another git repo as a workspace when it holds a candidate", async () => {
    // `outer` is itself a repo (a `~/Projects` under git), `outer/ws` is not, and two repos sit
    // below it. Only `a` is a candidate: a session started in it, and the walk covers none of
    // them (`outer` is outside the default root). A session started in `ws` writes under `a`.
    const outer = path.join(home, "outer");
    const ws = path.join(outer, "ws");
    const a = path.join(ws, "a");
    const b = path.join(ws, "b");
    for (const root of [outer, a, b]) mkdirSync(path.join(root, ".git"), { recursive: true });
    recordSessionIn(a);
    const store = path.join(home, CLAUDE_STORE, projectSlug(ws));
    mkdirSync(store, { recursive: true });
    writeFileSync(
      path.join(store, "s-ws.jsonl"),
      `${JSON.stringify({ type: "user", cwd: ws })}\n${JSON.stringify({
        type: "assistant",
        cwd: ws,
        message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Write", input: { file_path: path.join(a, "notes.md"), content: "x" } }] },
      })}\n`,
      "utf8",
    );

    const result = await discoverRepos({}, onboardingIo());
    expect(result.workspaces).toEqual([{ path: ws, repos: [a], hooksInstalled: false }]);
    expect(result.known.find((c) => c.path === a)).toMatchObject({ startedIn: [ws], touchedSessions: 1 });

    // A read-only session started in the same folder — five Bash mentions and one Read under
    // `a` — is attributed by the reference rule: `ws` holds a candidate, so it is a workspace
    // folder outside any repo, the git ancestor notwithstanding.
    const bash = (i: number): string =>
      `${JSON.stringify({ type: "assistant", cwd: ws, message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: `grep -n x ${a}/src/${i}.ts` } }] } })}\n`;
    writeFileSync(
      path.join(store, "s-ws-ro.jsonl"),
      `${JSON.stringify({ type: "user", cwd: ws })}\n${[0, 1, 2, 3, 4].map(bash).join("")}${JSON.stringify({
        type: "assistant",
        cwd: ws,
        message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Read", input: { file_path: path.join(a, "README.md") } }] },
      })}\n`,
      "utf8",
    );
    expect((await discoverRepos({}, onboardingIo())).known.find((c) => c.path === a)).toMatchObject({ startedIn: [ws], touchedSessions: 2 });
    expect(startedInRepo(ws, [outer, a])).toBe(false);
    expect(startedInRepo(outer, [a])).toBe(true);
    expect(startedInRepo(path.join(a, "src"), [a])).toBe(true);
    expect(startedInRepo(path.join(home, "scratch"), [a])).toBe(false);
  });

  it("doctor lists each workspace with its hook status", async () => {
    await enableWorkspace();
    const report = await buildReport({ cwd: repoA, env: { PATH: "", HOME: home, WORKLEDGER_HOME: indexHome }, homeDir: home, stdout: () => undefined, stderr: () => undefined });
    expect(report.workspaces).toEqual([{ path: workspace, hooks: { [SETTINGS_PATH]: true, [CODEX_HOOKS_PATH]: false, [CURSOR_HOOKS_PATH]: false } }]);
    expect(report.checks.find((check) => check.name === `workspace ${workspace}`)).toEqual({ name: `workspace ${workspace}`, status: "ok", detail: `hooks in ${SETTINGS_PATH}` });

    writeFileSync(path.join(workspace, SETTINGS_PATH), "{}", "utf8");
    const broken = await buildReport({ cwd: repoA, env: { PATH: "", HOME: home, WORKLEDGER_HOME: indexHome }, homeDir: home, stdout: () => undefined, stderr: () => undefined });
    expect(broken.checks.find((check) => check.name === `workspace ${workspace}`)?.status).toBe("warn");
  });

  it("onboard --workspaces runs init --workspace after the repos and reports it in the JSON", async () => {
    const tty: OnboardIo = { ...onboardingIo(), stdout: (line) => void out.push(line), interactive: false, ask: async (_q, fallback) => fallback };
    const code = await runOnboard({ json: true, select: `${repoA},${repoB}`, workspaces: workspace, since: "none", yes: true }, tty);
    expect(code).toBe(EXIT_OK);
    const report = JSON.parse(out.at(-1) as string) as OnboardReport;
    expect(report.init.workspaces).toEqual([{ path: workspace, ok: true, hooksWritten: [SETTINGS_PATH], trustSteps: [] }]);
    expect(existsSync(path.join(workspace, SETTINGS_PATH))).toBe(true);
  });
});
