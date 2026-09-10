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
import { findRepoRoot } from "../src/ledger-fs.js";
import { openIndex } from "../src/index/db.js";
import { workspaceCheckpointInstruction } from "../src/instruction.js";
import { discoverRepos } from "../src/onboarding/discover.js";
import { initRepos } from "../src/onboarding/init.js";
import { listWorkspaces } from "../src/onboarding/workspaces.js";
import { MIN_REFERENCES, rankContext, startedInRepo } from "../src/onboarding/touched.js";
import type { TouchTally } from "../src/onboarding/touched.js";
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

describe("context repos from the accumulated counts (amendment 10)", () => {
  const roots = (counts: Record<string, TouchTally>, startRepo?: string): string[] =>
    rankContext(new Map(Object.entries(counts)), startRepo).map((context) => context.root);

  it("applies the contract's rule and ranks by writes, then path inputs, then references", () => {
    // A write outranks any number of reads; among reads, path inputs outrank references.
    expect(roots({ [repoA]: { references: MIN_REFERENCES, writes: 0, pathInputs: 1 }, [repoB]: { references: 2, writes: 1, pathInputs: 0 } })).toEqual([repoB, repoA]);
    expect(roots({ [repoA]: { references: 1, writes: 1, pathInputs: 1 }, [repoB]: { references: 1, writes: 2, pathInputs: 1 } })).toEqual([repoB, repoA]);
    expect(roots({ [repoA]: { references: MIN_REFERENCES - 1, writes: 0, pathInputs: 4 } })).toEqual([]);
    // Bash text alone never qualifies (#110).
    expect(roots({ [repoA]: { references: 20, writes: 0, pathInputs: 0 } })).toEqual([]);
  });

  it("from inside a repo, another root qualifies only by a write, and the own repo is the fallback and the tiebreak", () => {
    expect(roots({ [repoA]: { references: 20, writes: 0, pathInputs: 5 }, [repoB]: { references: 1, writes: 1, pathInputs: 1 } }, repoB)).toEqual([repoB]);
    expect(roots({ [repoA]: { references: 20, writes: 0, pathInputs: 5 }, [repoB]: { references: 1, writes: 1, pathInputs: 1 } }, repoA)).toEqual([repoB, repoA]);
    // Nothing qualifies: the repo the session started in, marked as the fallback.
    expect(rankContext(new Map([[repoA, { references: 2, writes: 0, pathInputs: 1 }], [repoB, { references: 0, writes: 0, pathInputs: 0 }]]), repoA)).toEqual([
      { root: repoA, references: 2, writes: 0, pathInputs: 1, fallback: true },
    ]);
    // A tie goes to the start directory's repo; a workspace session (no start repo) has no fallback.
    expect(roots({ [repoA]: { references: 1, writes: 1, pathInputs: 1 }, [repoB]: { references: 1, writes: 1, pathInputs: 1 } }, repoB)).toEqual([repoB, repoA]);
    expect(roots({ [repoA]: { references: 1, writes: 0, pathInputs: 1 } })).toEqual([]);
    // Started inside a repo the caller did not ask about: the write rule for every root, no fallback.
    expect(rankContext(new Map([[repoA, { references: 9, writes: 0, pathInputs: 9 }]]), undefined, true)).toEqual([]);
  });
});

describe("hook from a workspace session", () => {
  it("SessionStart records the session against the workspace with no repo and no ledger file", async () => {
    await enableWorkspace();
    out.length = 0;

    expect(await runHook("SessionStart", hookIo(payload("session-start-startup")))).toBe(EXIT_OK);

    expect(out).toEqual([]);
    const [row] = rows();
    expect(row).toMatchObject({ repo_path: workspace, workspace: 1, start_dir: workspace, status: "open", scan_offset: 0 });
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

  it("Stop over a threshold blocks with one --repo command per context repo, best first, opening a row and file in each", async () => {
    await enableWorkspace();
    await runHook("SessionStart", hookIo(payload("session-start-startup")));
    // Six reads in repo A, one write in repo B; the minutes threshold is the one crossed (a
    // workspace has no config, so the defaults apply). Repo A qualifies by its reads, repo B by
    // its write alone — and the write ranks first (amendment 10: writes, then path inputs).
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
    expect(text.indexOf(commandB)).toBeLessThan(text.indexOf(commandA));
    expect(text).not.toContain("Run exactly one command");
    // A ledger file per context repo, none in the workspace, each saying where the session
    // started and what it is about; the scan and the inference are cached on the row.
    expect(readdirSync(path.join(repoA, ".workledger", "sessions"))).toEqual([`${a.ulid}.md`]);
    expect(readdirSync(path.join(repoB, ".workledger", "sessions"))).toEqual([`${b.ulid}.md`]);
    const fileA = readFileSync(path.join(repoA, ".workledger", "sessions", `${a.ulid}.md`), "utf8");
    expect(fileA).toContain(`started_in: ${workspace}`);
    expect(fileA).toContain(`  - ${repoB}\n  - ${repoA}`);
    expect(existsSync(path.join(workspace, ".workledger"))).toBe(false);
    const ws = all[0] as SessionRow;
    expect(ws.scan_offset).toBe(Buffer.byteLength(lines));
    expect(JSON.parse(ws.scan_counts as string)).toEqual({ [repoA]: { references: 6, writes: 0, pathInputs: 6 }, [repoB]: { references: 1, writes: 1, pathInputs: 1 } });
    expect(JSON.parse(ws.context_repos as string).map((context: { root: string }) => context.root)).toEqual([repoB, repoA]);
    expect(a).toMatchObject({ start_dir: workspace, context_repos: ws.context_repos });
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

  it("GET /api/workspaces lists every non-repo start folder, repos or not, newest session first (amendment 12)", async () => {
    // Three start folders: the workspace with two repos under it, a plain folder with none, and
    // a subdirectory of a repo — which belongs to the repo and must never be listed.
    const lone = path.join(home, "Projects", "notes");
    mkdirSync(lone);
    recordSessionIn(workspace);
    recordSessionIn(lone);
    recordSessionIn(path.join(repoA, "src"));
    recordSessionIn(repoA);

    const before = await listWorkspaces(onboardingIo());
    expect(before.map((w) => w.path)).toEqual([workspace, lone]);
    expect(before[0]).toMatchObject({ name: "dome_workspace", repos: [repoB, repoA], hooksInstalled: false, registered: false, sessions: 1 });
    // A transcript in a folder does not make it a project: `notes` is listed with no repo at all.
    expect(before[1]).toMatchObject({ name: "notes", repos: [], hooksInstalled: false, sessions: 1 });
    expect(before.every((w) => w.lastSessionAt !== null)).toBe(true);

    // Home's "Install hooks": init with the folder and no repo flips `hooksInstalled`, and
    // `init --workspace` is what makes it `registered`.
    await initRepos({ repos: [], workspaces: [workspace] }, onboardingIo());
    const after = await listWorkspaces(onboardingIo());
    expect(after[0]).toMatchObject({ path: workspace, hooksInstalled: true, registered: true });
    expect(after[1]).toMatchObject({ path: lone, hooksInstalled: false, registered: false });
  });

  it("keeps listing folders under a HOME that holds the daemon's own ~/.workledger (#119 review)", async () => {
    // The daemon's index home defaults to `~/.workledger`. It is a directory, not a ledger: it
    // holds `index.sqlite` and `serve.json`, never a `config.yaml`. A repo-root test that
    // accepted the bare directory made `$HOME` itself a repo, and every folder under it — the
    // very folders amendment 12 exists to list — resolved to `$HOME` and vanished.
    mkdirSync(path.join(home, ".workledger"), { recursive: true });
    writeFileSync(path.join(home, ".workledger", "index.sqlite"), "", "utf8");
    writeFileSync(path.join(home, ".workledger", "serve.json"), "{}", "utf8");
    expect(findRepoRoot(home)).toBeUndefined();

    const scratch = path.join(home, "scratchpad");
    mkdirSync(scratch);
    recordSessionIn(scratch);

    const folders = await listWorkspaces(onboardingIo());
    expect(folders.map((w) => w.path)).toEqual([scratch]);
    expect(folders[0]).toMatchObject({ name: "scratchpad", repos: [], sessions: 1 });

    // A `.workledger/` with a `config.yaml` in it *is* a repo root, git or no git: that is the
    // marker `init` writes, and a folder inside such a repo is the repo's, never a workspace.
    const enabled = path.join(home, "plain");
    mkdirSync(path.join(enabled, ".workledger"), { recursive: true });
    expect(findRepoRoot(enabled)).toBeUndefined();
    writeFileSync(path.join(enabled, ".workledger", "config.yaml"), "schema_version: 1\n", "utf8");
    expect(findRepoRoot(enabled)).toBe(enabled);
    expect(findRepoRoot(path.join(enabled, "src"))).toBe(enabled);
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
