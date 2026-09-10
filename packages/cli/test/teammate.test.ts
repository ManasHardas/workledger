/**
 * `workledger init --teammate` — docs/contracts/p5/config-and-identities.md §CLI additions, and
 * the clone-path acceptance criterion of plans/feature-p5-team.md: "Cloning an enabled repo and
 * running `init --teammate` yields a working hook set without editing `.claude/settings.json`."
 *
 * So this is an integration test and not a unit one, deliberately: the thing being asserted is a
 * property of a *clone*. The origin repo is enabled and its `.workledger/` and
 * `.claude/settings.json` are committed; the clone is a real `git clone` of it; `init
 * --teammate` runs in the clone; and then a real `hook SessionStart` payload goes through the
 * state machine and has to produce a session row. The one write that must not happen —
 * `.claude/settings.json` — is asserted by byte-comparing the file and its mtime before and
 * after.
 *
 * A test that stubbed the clone would assert nothing about the case the phase exists for: a
 * teammate whose hooks arrived through git rather than through `init`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { runInit } from "../src/commands/init.js";
import { runHook } from "../src/commands/hook.js";
import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import { openIndex } from "../src/index/db.js";
import { SETTINGS_PATH } from "../src/settings-merge.js";
import type { HookIo } from "../src/commands/hook.js";
import type { InitIo } from "../src/commands/init.js";

const HARNESS_ID = "hsess-teammate";

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

interface Fixture {
  dir: string;
  /** The repo the first person enabled and pushed. */
  origin: string;
  /** The teammate's clone of it. */
  clone: string;
  home: string;
  wlHome: string;
  out: string[];
  err: string[];
  asked: string[];
  io: InitIo;
}

/**
 * An enabled origin repo with its hooks committed, cloned into `clone/`.
 *
 * `init` itself writes the origin — running the real command rather than hand-writing the files
 * is what makes "the hook files that reach a clone" the ones the contract actually produces.
 */
function setup(options: { answer?: boolean } = {}): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-teammate-"));
  temps.push(dir);
  const origin = path.join(dir, "origin");
  const clone = path.join(dir, "clone");
  const home = path.join(dir, "home");
  const wlHome = path.join(dir, "wlhome");
  const bin = path.join(dir, "bin");
  mkdirSync(origin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  git(origin, "init", "-q", "-b", "main");
  git(origin, "config", "user.name", "Ada Lovelace");
  git(origin, "config", "user.email", "ada@example.com");
  git(origin, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(origin, "README.md"), "# origin\n", "utf8");

  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const baseIo = (cwd: string): InitIo => ({
    cwd,
    homeDir: home,
    env: { PATH: bin, HOME: home, WORKLEDGER_HOME: wlHome },
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    confirm: async (question: string) => {
      asked.push(question);
      return options.answer ?? false;
    },
  });

  return { dir, origin, clone, home, wlHome, out, err, asked, io: baseIo(clone) };
}

/** Enable `origin`, commit everything, and clone it. */
async function enableAndClone(fixture: Fixture): Promise<void> {
  const enableIo: InitIo = {
    ...fixture.io,
    cwd: fixture.origin,
  };
  expect(await runInit({ yes: true }, enableIo)).toBe(EXIT_OK);

  git(fixture.origin, "add", "-A");
  git(fixture.origin, "commit", "-q", "-m", "enable workledger");
  git(fixture.dir, "clone", "-q", fixture.origin, fixture.clone);
  git(fixture.clone, "config", "user.name", "Grace Hopper");
  git(fixture.clone, "config", "user.email", "grace@example.com");

  // The whole premise: the hook files arrived with the clone, unasked for.
  expect(readdirSync(path.join(fixture.clone, ".workledger"))).toContain("config.yaml");
  expect(readFileSync(path.join(fixture.clone, SETTINGS_PATH), "utf8")).toContain(
    "workledger hook SessionStart",
  );
  fixture.out.length = 0;
  fixture.err.length = 0;
}

/** The `.claude/settings.json` bytes and mtime, so an untouched file can be proven untouched. */
function settingsState(root: string): { text: string; mtimeMs: number } {
  const file = path.join(root, SETTINGS_PATH);
  return { text: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs };
}

/** Run one `hook SessionStart` in the clone. */
async function sessionStart(fixture: Fixture): Promise<number> {
  const io: HookIo = {
    readStdin: () =>
      Promise.resolve(
        JSON.stringify({
          session_id: HARNESS_ID,
          transcript_path: path.join(fixture.dir, "transcript.jsonl"),
          cwd: fixture.clone,
          hook_event_name: "SessionStart",
          source: "startup",
        }),
      ),
    stdout: (line) => void fixture.out.push(line),
    stderr: (line) => void fixture.err.push(line),
    cwd: fixture.clone,
    env: { WORKLEDGER_HOME: fixture.wlHome },
    homeDir: fixture.home,
    now: () => new Date("2026-09-09T12:00:00.000Z"),
    adapter: claudeCodeAdapter,
  };
  return runHook("SessionStart", io);
}

describe("workledger init --teammate", () => {
  it("onboards a clone, writes no hook file, and the hook then records a session", async () => {
    const fixture = setup();
    await enableAndClone(fixture);
    const before = settingsState(fixture.clone);

    expect(await runInit({ teammate: true, backfill: false }, fixture.io)).toBe(EXIT_OK);

    // Step 2's job: say which identity this machine's sessions will be recorded under, which is
    // the clone's git config and not the origin's.
    const printed = fixture.out.join("\n");
    expect(printed).toContain("Grace Hopper <grace@example.com>");
    expect(printed).toContain("you are set");
    // Two lines, so a teammate reads them: the "you are set" line and the doctor line.
    expect(fixture.out.at(-2)).toContain("you are set");
    expect(fixture.out.at(-1)).toContain("workledger doctor");

    // The one thing --teammate exists not to do.
    expect(settingsState(fixture.clone)).toEqual(before);
    expect(printed).not.toContain(`wrote ${SETTINGS_PATH}`);

    // And the hooks that came with the clone work: a real SessionStart opens a row.
    expect(await sessionStart(fixture)).toBe(EXIT_OK);
    const db = openIndex({ home: fixture.wlHome });
    try {
      const row = db.getSessionByHarnessId("claude-code", HARNESS_ID, fixture.clone);
      expect(row?.repo_path).toBe(fixture.clone);
      expect(row?.status).toBe("open");
    } finally {
      db.close();
    }
    // The session file the row points at is in the clone's ledger, with the teammate's name.
    const sessions = readdirSync(path.join(fixture.clone, ".workledger", "sessions"));
    expect(sessions).toHaveLength(1);
    expect(
      readFileSync(path.join(fixture.clone, ".workledger", "sessions", sessions[0] as string), "utf8"),
    ).toContain("grace@example.com");
  });

  it("offers the backfill, and does nothing when it is declined", async () => {
    const fixture = setup({ answer: false });
    await enableAndClone(fixture);

    expect(await runInit({ teammate: true }, fixture.io)).toBe(EXIT_OK);

    expect(fixture.asked).toHaveLength(1);
    expect(fixture.asked[0]).toContain("past sessions");
    expect(fixture.out.join("\n")).toContain("you are set");
  });

  it("does not offer the backfill under --no-backfill", async () => {
    const fixture = setup({ answer: true });
    await enableAndClone(fixture);

    expect(await runInit({ teammate: true, backfill: false }, fixture.io)).toBe(EXIT_OK);

    expect(fixture.asked).toEqual([]);
  });

  it("exits 4 in a repo that is not enabled", async () => {
    const fixture = setup();
    // A git repo, never `init`-ed: no `.workledger/` at all.
    mkdirSync(fixture.clone, { recursive: true });
    git(fixture.clone, "init", "-q", "-b", "main");
    git(fixture.clone, "config", "user.name", "Grace Hopper");
    git(fixture.clone, "config", "user.email", "grace@example.com");

    expect(await runInit({ teammate: true }, fixture.io)).toBe(EXIT_NOT_ENABLED);

    expect(fixture.err.join("\n")).toContain("run `workledger init` instead");
  });

  it("refuses a clone with no git identity", async () => {
    const fixture = setup();
    await enableAndClone(fixture);
    // Strip the identity the clone inherited, and point HOME at a directory with no gitconfig.
    git(fixture.clone, "config", "--unset", "user.name");
    git(fixture.clone, "config", "--unset", "user.email");

    expect(await runInit({ teammate: true }, fixture.io)).toBe(EXIT_USAGE);

    expect(fixture.err.join("\n")).toContain("user.name and user.email are empty");
  });
});
