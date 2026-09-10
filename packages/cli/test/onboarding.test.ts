/**
 * The onboarding ops — docs/contracts/p8/daemon-and-api.md §Onboarding endpoints — and
 * `workledger onboard --json`'s parity with them.
 *
 * One temp `HOME` laid out the way the two harness stores lay theirs out: the Claude Code
 * fixtures under `~/.claude/projects/<slug>/` for two temp repos (two sessions in one, one in the
 * other), one Codex rollout under `~/.codex/sessions/YYYY/MM/DD/` naming the first repo, and a
 * `~/Projects` holding both plus a third repo with no history, a `node_modules` and a dot
 * directory that must be skipped. Everything the ops read is real: real `readdir`s, real
 * `stat`s, real first lines, a real `index.sqlite` under a temp `WORKLEDGER_HOME`.
 *
 * The drain is never started here: a `resume` would spawn `claude`. What is asserted is the half
 * the wizard is built on — that the rows exist, are tagged, and are what `status` counts.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CLAUDE_STORE, projectSlug } from "../src/commands/backfill.js";
import { CODEX_HOOKS_PATH } from "../src/codex-hooks.js";
import { CURSOR_HOOKS_PATH } from "../src/cursor-hooks.js";
import { runOnboard } from "../src/commands/onboard.js";
import { onboardingOps } from "../src/commands/onboarding-ops.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import { openIndex } from "../src/index/db.js";
import { claimJob, completeJob, deferJob, listJobs } from "../src/jobs/queue.js";
import {
  ONBOARDING_SOURCE,
  OnboardingRefusalError,
  backfillPlan,
  onboardingStatus,
  queueOnboardingBackfill,
} from "../src/onboarding/backfill.js";
import { discoverRepos } from "../src/onboarding/discover.js";
import { historyWindows } from "../src/onboarding/history.js";
import { initRepos } from "../src/onboarding/init.js";
import { attributeTranscripts } from "../src/onboarding/attribution.js";
import { withIndex } from "../src/onboarding/io.js";
import { CODEX_STORE, claudeProjects, claudeTranscripts, codexSessions, slugToPath } from "../src/onboarding/stores.js";
import { SETTINGS_PATH } from "../src/settings-merge.js";
import type { OnboardIo } from "../src/commands/onboard.js";
import type { OnboardingIo } from "../src/onboarding/io.js";
import type { OnboardReport } from "../src/commands/onboard.js";
import type { DiscoverResult } from "@workledger/server";

/** `packages/cli/test/fixtures/transcripts/`. */
const FIXTURES = fileURLToPath(new URL("./fixtures/transcripts/", import.meta.url));

/** A fixed clock, so the windows are tested against a `now` the test controls. */
const NOW = new Date("2026-09-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** The `session_meta.payload.id` of the Codex rollout in repo A — what `codex exec resume` takes. */
const CODEX_ID = "01a088e8-eb9b-7432-9576-e640049f4668";

/** Which fixture lands in which repo, and how old it is: one per window boundary. */
const LAYOUT: Array<{ id: string; repo: "a" | "b"; ageDays: number }> = [
  { id: "hs-gamma", repo: "a", ageDays: 5 },
  { id: "hs-beta", repo: "a", ageDays: 20 },
  { id: "hs-alpha", repo: "b", ageDays: 60 },
];

let dir: string;
let home: string;
let indexHome: string;
let repoA: string;
let repoB: string;
let repoC: string;
/** The test's own "OS temp dir", reached through a symlink so the realpath comparison is exercised. */
let tempDir: string;
let err: string[];
let io: OnboardingIo;

/** A repo with a `.git/config` carrying an identity, so `init` has nothing to refuse. */
function makeRepo(root: string): void {
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(path.join(root, ".git", "config"), "[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n", "utf8");
}

/** A transcript at `file` with `__CWD__` resolved and its mtime set to `at`. */
function writeTranscript(file: string, id: string, cwd: string, at: Date): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, readFileSync(path.join(FIXTURES, `${id}.jsonl`), "utf8").replaceAll("__CWD__", cwd), "utf8");
  utimesSync(file, at, at);
}

beforeEach(() => {
  // Resolved: on macOS `os.tmpdir()` is itself a symlink, and discovery reports resolved paths.
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "workledger-onboard-")));
  home = path.join(dir, "home");
  indexHome = path.join(dir, "wlhome");
  const projects = path.join(home, "Projects");
  repoA = path.join(projects, "repo-a");
  repoB = path.join(projects, "nested", "repo_b");
  repoC = path.join(projects, "repo-c");
  for (const root of [repoA, repoB, repoC]) makeRepo(root);
  // Skipped by the walk: a dependency's checkout and a hidden directory.
  makeRepo(path.join(projects, "node_modules", "dep"));
  makeRepo(path.join(projects, ".hidden", "secret"));
  // Too deep: `Projects/1/2/3/deep` is four levels down, the walk stops at three.
  makeRepo(path.join(projects, "1", "2", "3", "deep"));
  // Everything here is under the real `os.tmpdir()`, so the temp filter is pointed elsewhere.
  tempDir = path.join(dir, "tmp");
  mkdirSync(tempDir, { recursive: true });
  symlinkSync(tempDir, path.join(dir, "tmp-link"));

  for (const { id, repo, ageDays } of LAYOUT) {
    const cwd = repo === "a" ? repoA : repoB;
    writeTranscript(
      path.join(home, CLAUDE_STORE, projectSlug(cwd), `${id}.jsonl`),
      id,
      cwd,
      new Date(NOW.getTime() - ageDays * DAY_MS),
    );
  }
  // A Codex rollout for repo A, first record `session_meta` (hooks-codex.md), plus one whose
  // first record is not a session_meta and one naming a directory that no longer exists.
  const rollouts = path.join(home, CODEX_STORE, "2026", "09", "08");
  mkdirSync(rollouts, { recursive: true });
  const meta = (cwd: string): string =>
    `${JSON.stringify({ timestamp: "2026-09-08T10:00:00.000Z", type: "session_meta", payload: { id: CODEX_ID, cwd, timestamp: "2026-09-08T10:00:00.000Z" } })}\n`;
  writeFileSync(path.join(rollouts, "rollout-a.jsonl"), meta(path.join(repoA, "packages")), "utf8");
  writeFileSync(path.join(rollouts, "rollout-gone.jsonl"), meta(path.join(dir, "gone")), "utf8");
  writeFileSync(path.join(rollouts, "rollout-odd.jsonl"), '{"type":"event_msg"}\n', "utf8");
  // One transcript far outside every dated window, so `all` (amendment 9) has something to add.
  writeTranscript(path.join(home, CLAUDE_STORE, projectSlug(repoB), "hs-old.jsonl"), "hs-alpha", repoB, new Date(NOW.getTime() - 200 * DAY_MS));
  // One started in a subdirectory of repo A — its own slug, the repo's session (#105 review).
  mkdirSync(path.join(repoA, "src"), { recursive: true });
  writeTranscript(path.join(home, CLAUDE_STORE, projectSlug(path.join(repoA, "src")), "hs-sub.jsonl"), "hs-gamma", path.join(repoA, "src"), new Date(NOW.getTime() - 45 * DAY_MS));
  // Only `packages/` is a subdirectory session; the directory has to exist for the cwd to resolve.
  mkdirSync(path.join(repoA, "packages"), { recursive: true });
  const at = new Date(NOW.getTime() - 1 * DAY_MS);
  utimesSync(path.join(rollouts, "rollout-a.jsonl"), at, at);

  err = [];
  io = {
    homeDir: home,
    env: { PATH: "", HOME: home, WORKLEDGER_HOME: indexHome },
    cwd: dir,
    stderr: (line) => void err.push(line),
    now: () => NOW,
    indexHome,
    tempDirs: [path.join(dir, "tmp-link")],
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the harness stores", () => {
  it("inverts a Claude Code project slug against the filesystem", () => {
    expect(slugToPath(projectSlug(repoA))).toBe(repoA);
    expect(slugToPath(projectSlug(repoB))).toBe(repoB);
    expect(slugToPath(projectSlug(path.join(dir, "nowhere")))).toBeUndefined();
    expect(slugToPath("not-absolute")).toBeUndefined();
  });

  it("counts transcripts per project directory from metadata", () => {
    const projects = claudeProjects(home).sort((x, y) => x.slug.localeCompare(y.slug));
    expect(projects.map((p) => [p.cwd, p.sessions])).toEqual(
      [[repoB, 2], [repoA, 2], [path.join(repoA, "src"), 1]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    const files = claudeTranscripts(home).sort((x, y) => x.file.localeCompare(y.file));
    expect(files.map((t) => [t.harnessSessionId, t.cwd]).sort()).toEqual(
      [["hs-alpha", repoB], ["hs-beta", repoA], ["hs-gamma", repoA], ["hs-old", repoB], ["hs-sub", path.join(repoA, "src")]].sort(),
    );
    expect(files.every((t) => t.bytes > 0 && t.mtimeMs > 0)).toBe(true);
  });

  it("reads the cwd, id and timestamp off a Codex rollout's session_meta and nothing else", () => {
    const sessions = codexSessions(home).sort((x, y) => x.file.localeCompare(y.file));
    expect(sessions.map((s) => s.cwd)).toEqual([path.join(repoA, "packages"), path.join(dir, "gone"), null]);
    expect(sessions.map((s) => [s.id, s.startedIso])).toEqual([
      [CODEX_ID, "2026-09-08T10:00:00.000Z"],
      [CODEX_ID, "2026-09-08T10:00:00.000Z"],
      [null, null],
    ]);
  });

  it("files a repo's Codex rollouts as store sessions, subdirectory sessions included", async () => {
    const rollout = path.join(home, CODEX_STORE, "2026", "09", "08", "rollout-a.jsonl");
    const about = await withIndex(io, (db) => attributeTranscripts(home, [repoA, repoB], db));
    // A rollout with only its `session_meta` names no path: repo A's by the fallback (amendment 10).
    expect(about.get(repoA)?.codex).toEqual([
      {
        harnessSessionId: CODEX_ID,
        file: rollout,
        bytes: statSync(rollout).size,
        mtimeMs: NOW.getTime() - 1 * DAY_MS,
        startedIso: "2026-09-08T10:00:00.000Z",
        cwd: path.join(repoA, "packages"),
        context: [{ root: repoA, writes: 0, pathInputs: 0, references: 0, fallback: true }],
      },
    ]);
    // The rollout naming a gone directory counts for no repo, and repo B has none.
    expect(about.get(repoB)?.codex).toEqual([]);
  });
});

describe("discoverRepos", () => {
  it("lists store-known repos, then .git repos under the roots, skipping node_modules and dot dirs", async () => {
    const result = await discoverRepos({}, io);

    expect(result.roots).toEqual([path.join(home, "Projects")]);
    expect(result.known.map((c) => c.path)).toEqual([repoA, repoB]);
    expect(result.known[0]).toEqual({
      path: repoA,
      name: "repo-a",
      hasGit: true,
      enabled: false,
      suggested: true,
      // The Codex session in `repo-a/packages` and the Claude Code one in `repo-a/src` count
      // for the repo above them.
      harnessSessions: { "claude-code": 3, codex: 1 },
      lastSessionAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
      startedIn: [],
      touchedSessions: 0,
      // Three transcripts write under the repo; the Codex rollout names no path and is the
      // repo's only because it started inside it (amendment 10).
      about: { content: 3, fallback: 1 },
    });
    expect(result.known[1]).toMatchObject({ harnessSessions: { "claude-code": 2 }, about: { content: 2, fallback: 0 } });
    expect(result.workspaces).toEqual([]);
    expect(result.found.map((c) => c.path)).toEqual([repoC]);
    expect(result.found[0]).toMatchObject({ name: "repo-c", hasGit: true, enabled: false, suggested: true, harnessSessions: {}, lastSessionAt: null });
  });

  it("walks a root that is itself a repo, lists it unsuggested, and still does not enter nested repos", async () => {
    const mono = path.join(dir, "mono");
    const one = path.join(mono, "one");
    const two = path.join(mono, "lib", "two");
    for (const repo of [mono, one, two, path.join(one, "inner")]) makeRepo(repo);
    const result = await discoverRepos({ roots: [mono] }, io);

    expect(result.found.map((c) => [c.path, c.suggested])).toEqual([
      [mono, false],
      [two, true],
      [one, true],
    ]);
  });

  it("resolves and dedupes roots, so a trailing slash or a symlink never repeats a known repo", async () => {
    const projects = path.join(home, "Projects");
    const link = path.join(dir, "projects-link");
    symlinkSync(projects, link);
    const result = await discoverRepos({ roots: [`${projects}/`, link, projects] }, io);

    expect(result.roots).toEqual([projects]);
    expect(result.known.map((c) => c.path)).toEqual([repoA, repoB]);
    expect(result.found.map((c) => [c.path, c.suggested])).toEqual([[repoC, true]]);
  });

  it("drops a store cwd under the temp dir from known, resolved through symlinks", async () => {
    const scratch = path.join(tempDir, "scratch");
    makeRepo(scratch);
    writeTranscript(path.join(home, CLAUDE_STORE, projectSlug(scratch), "hs-gamma.jsonl"), "hs-gamma", scratch, NOW);
    const result = await discoverRepos({}, io);

    expect(result.known.map((c) => c.path)).toEqual([repoA, repoB]);
    // Named as a root it is still found, and still not worth pre-checking.
    expect((await discoverRepos({ roots: [tempDir] }, io)).found).toMatchObject([{ path: scratch, suggested: false }]);
  });

  it("refuses a root that is relative, missing, or not a directory", async () => {
    for (const [root, reason] of [
      ["Projects", "not an absolute path"],
      [path.join(dir, "nowhere"), "does not exist"],
      [path.join(repoA, ".git", "config"), "not a directory"],
    ]) {
      await expect(discoverRepos({ roots: [root as string] }, io)).rejects.toThrow(reason);
    }
  });

  it("takes explicit roots, expands ~, and reports enabled repos as such", async () => {
    await initRepos({ repos: [repoC] }, io);
    const result = await discoverRepos({ roots: ["~/Projects/repo-c", path.join(home, "Projects", "1")] }, io);

    expect(result.roots).toEqual([repoC, path.join(home, "Projects", "1")]);
    // `1/2/3/deep` is four levels under `Projects` and three under `Projects/1`: out of reach
    // from the default root, in reach from this one.
    expect(result.found.map((c) => [c.path, c.enabled])).toEqual([
      [path.join(home, "Projects", "1", "2", "3", "deep"), false],
      [repoC, true],
    ]);
  });
});

describe("historyWindows", () => {
  it("counts Claude Code and Codex sessions and bytes per window across the selected repos, on file mtime", async () => {
    const { windows } = await historyWindows([repoA, repoB], io);
    const bytes = (id: string): number =>
      Buffer.byteLength(readFileSync(path.join(FIXTURES, `${id}.jsonl`), "utf8").replaceAll("__CWD__", id === "hs-alpha" ? repoB : repoA));
    // The one-day-old Codex rollout in repo A is inside every window.
    const codex = statSync(path.join(home, CODEX_STORE, "2026", "09", "08", "rollout-a.jsonl")).size;

    expect(windows["7d"]).toEqual({ sessions: 2, bytes: bytes("hs-gamma") + codex });
    expect(windows["30d"]).toEqual({ sessions: 3, bytes: bytes("hs-gamma") + bytes("hs-beta") + codex });
    // The 45-day-old session started in `repo-a/src` is repo A's, as discover counts it.
    const sub = statSync(path.join(home, CLAUDE_STORE, projectSlug(path.join(repoA, "src")), "hs-sub.jsonl")).size;
    expect(windows["90d"]).toEqual({ sessions: 5, bytes: bytes("hs-gamma") + bytes("hs-beta") + bytes("hs-alpha") + codex + sub });
    // `all` (amendment 9): the 200-day-old transcript in repo B, which no dated window sees.
    expect(windows.all).toEqual({ sessions: 6, bytes: bytes("hs-gamma") + bytes("hs-beta") + 2 * bytes("hs-alpha") + codex + sub });
    expect((await historyWindows([repoC], io)).windows["90d"]).toEqual({ sessions: 0, bytes: 0 });
  });
});

describe("initRepos", () => {
  it("runs the real init in each repo, reports the hook files and trust steps, and is idempotent", async () => {
    const first = await initRepos({ repos: [repoA, repoB] }, io);

    // The fake home has a Codex store, so `init` detects Codex and writes its hook file too —
    // and names the trust step, which is the one thing it cannot do for the operator.
    const trust = [expect.stringContaining(CODEX_HOOKS_PATH) as string];
    expect(first.results).toEqual([
      { path: repoA, ok: true, hooksWritten: [SETTINGS_PATH, CODEX_HOOKS_PATH], trustSteps: trust },
      { path: repoB, ok: true, hooksWritten: [SETTINGS_PATH, CODEX_HOOKS_PATH], trustSteps: trust },
    ]);
    for (const root of [repoA, repoB]) {
      expect(existsSync(path.join(root, ".workledger", "config.yaml"))).toBe(true);
      expect(existsSync(path.join(root, SETTINGS_PATH))).toBe(true);
      expect(existsSync(path.join(root, CODEX_HOOKS_PATH))).toBe(true);
    }
    const files = (): string[] =>
      [".workledger/config.yaml", ".workledger/README.md", SETTINGS_PATH, CODEX_HOOKS_PATH].map((file) => readFileSync(path.join(repoA, file), "utf8"));
    const before = files();

    const again = await initRepos({ repos: [repoA] }, io);

    expect(again.results).toEqual([{ path: repoA, ok: true, hooksWritten: [], trustSteps: trust }]);
    expect(files()).toEqual(before);
  });

  it("adds a missing hook file to an enabled repo and changes nothing else", async () => {
    await initRepos({ repos: [repoA] }, io);
    const config = readFileSync(path.join(repoA, ".workledger", "config.yaml"), "utf8");
    const settings = readFileSync(path.join(repoA, SETTINGS_PATH), "utf8");

    const result = await initRepos({ repos: [repoA], harnesses: ["cursor"] }, io);

    expect(result.results[0]).toMatchObject({ ok: true, hooksWritten: [CURSOR_HOOKS_PATH] });
    expect(existsSync(path.join(repoA, CURSOR_HOOKS_PATH))).toBe(true);
    // "never edits a repo that already has `.workledger/` beyond adding missing hook files".
    expect(readFileSync(path.join(repoA, ".workledger", "config.yaml"), "utf8")).toBe(config);
    expect(readFileSync(path.join(repoA, SETTINGS_PATH), "utf8")).toBe(settings);
  });

  it("reports a repo init refuses in its own row and continues with the rest", async () => {
    const anonymous = path.join(dir, "anon");
    mkdirSync(path.join(anonymous, ".git"), { recursive: true });

    const result = await initRepos({ repos: [anonymous, repoB] }, io);

    expect(result.results.map((r) => r.ok)).toEqual([false, true]);
    expect(result.results[0]?.error).toContain("user.name");
  });

  it("refuses a relative path, a missing path, a plain directory and a symlink to one, touching nothing", async () => {
    const plain = path.join(dir, "plain");
    mkdirSync(plain);
    const link = path.join(dir, "link");
    symlinkSync(plain, link);
    const cases: Array<[string, string]> = [
      [path.relative(dir, repoA), "not an absolute path"],
      [path.join(dir, "missing"), "does not exist"],
      [plain, "not a git repository"],
      [link, "not a git repository"],
    ];
    for (const [given, reason] of cases) {
      const refusal = await initRepos({ repos: [repoA, given] }, io).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(OnboardingRefusalError);
      expect((refusal as OnboardingRefusalError).code).toBe("invalid-repo");
      expect((refusal as OnboardingRefusalError).message).toContain(reason);
      // Every op refuses the same way, and the plan and run before they open the index.
      await expect(historyWindows([given], io)).rejects.toThrow(reason);
      await expect(backfillPlan({ repos: [given], since: "7d", method: "none" }, io)).rejects.toThrow(reason);
      await expect(queueOnboardingBackfill({ repos: [given], since: "7d", method: "none", consent: true }, io)).rejects.toThrow(reason);
    }
    // The valid repo listed first was not scaffolded either: the request is refused whole.
    expect(existsSync(path.join(repoA, ".workledger"))).toBe(false);
    expect(existsSync(path.join(plain, ".workledger"))).toBe(false);
    expect(existsSync(path.join(plain, SETTINGS_PATH))).toBe(false);
  });
});

describe("backfillPlan", () => {
  beforeEach(async () => {
    await initRepos({ repos: [repoA, repoB] }, io);
  });

  it("prices a resume in seconds from each repo's config, Codex sessions included", async () => {
    // Repo A's 2 Claude Code sessions at 45 s over concurrency 2 → 45, plus its Codex session's
    // ceil(45 / 2) = 23; repo B's one (60 days old) is outside 30d and adds 23 inside 90d, where
    // repo A's third Claude Code session (45 days old, started in `src/`) makes ceil(135 / 2) = 68.
    expect(await backfillPlan({ repos: [repoA, repoB], since: "30d", method: "resume" }, io)).toEqual({
      sessions: 3,
      estimate: { seconds: 45 + 23 },
    });
    expect(await backfillPlan({ repos: [repoA, repoB], since: "90d", method: "resume" }, io)).toEqual({
      sessions: 5,
      estimate: { seconds: 68 + 23 + 23 },
    });
  });

  it("prices an extraction in tokens and USD, says whether the key is missing, and reports Codex as unsupported", async () => {
    const without = await backfillPlan({ repos: [repoA, repoB], since: "90d", method: "extract" }, io);
    expect(without.sessions).toBe(4);
    expect(without.unsupported).toEqual({ codex: 1 });
    expect(await backfillPlan({ repos: [repoB], since: "90d", method: "extract" }, io)).not.toHaveProperty("unsupported");
    expect(without.estimate).toMatchObject({ needsApiKey: true });
    const estimate = without.estimate as { tokens: number; usd: number };
    expect(estimate.tokens).toBeGreaterThan(3 * 16384);
    expect(estimate.usd).toBeGreaterThan(0);

    const keyed = await backfillPlan(
      { repos: [repoA], since: "7d", method: "extract" },
      { ...io, env: { ...io.env, ANTHROPIC_API_KEY: "sk-test" } },
    );
    expect(keyed).toEqual({
      sessions: 1,
      estimate: { tokens: estimateTokens(1), usd: expect.any(Number) as number, needsApiKey: false },
      unsupported: { codex: 1 },
    });
  });

  it("is null for method none and empty for window none", async () => {
    expect(await backfillPlan({ repos: [repoA], since: "30d", method: "none" }, io)).toEqual({ sessions: 3, estimate: null });
    expect(await backfillPlan({ repos: [repoA], since: "none", method: "resume" }, io)).toEqual({ sessions: 0, estimate: null });
  });
});

/** Input tokens of `n` hs-gamma-sized transcripts plus the fixed output allowance each. */
function estimateTokens(n: number): number {
  const bytes = Buffer.byteLength(readFileSync(path.join(FIXTURES, "hs-gamma.jsonl"), "utf8").replaceAll("__CWD__", repoA));
  return n * (Math.ceil(bytes / 4) + 16384);
}

describe("queueOnboardingBackfill and onboardingStatus", () => {
  beforeEach(async () => {
    await initRepos({ repos: [repoA, repoB] }, io);
  });

  it("refuses without consent, writing nothing", async () => {
    await expect(
      queueOnboardingBackfill({ repos: [repoA], since: "90d", method: "resume", consent: false }, io),
    ).rejects.toMatchObject({ code: "consent-required" });
    expect(await onboardingStatus(io)).toEqual({ total: 0, done: 0, failed: 0, running: 0, waiting: 0, retryAfter: null, complete: true });
  });

  it("refuses extraction without an API key, in the shape the route turns into 409", async () => {
    const refusal = await queueOnboardingBackfill(
      { repos: [repoA], since: "90d", method: "extract", consent: true },
      io,
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(OnboardingRefusalError);
    expect((refusal as OnboardingRefusalError).code).toBe("api-key-required");
    expect(listJobsAll()).toEqual([]);
  });

  it("refuses a repo that is not enabled", async () => {
    await expect(
      queueOnboardingBackfill({ repos: [repoC], since: "90d", method: "resume", consent: true }, io),
    ).rejects.toMatchObject({ code: "usage" });
  });

  it("queues one tagged repair job per fresh session in the window, Codex included, and status follows them", async () => {
    const queued = await queueOnboardingBackfill(
      { repos: [repoA, repoB], since: "90d", method: "resume", consent: true },
      io,
    );

    expect(queued.repos).toEqual([repoA, repoB]);
    expect(queued.jobs).toHaveLength(5);
    expect(queued.jobs.map((job) => [job.kind, job.status, job.source])).toEqual(
      Array.from({ length: 5 }, () => ["repair", "queued", ONBOARDING_SOURCE]),
    );
    expect(queued.jobs.filter((job) => job.repo_path === repoA)).toHaveLength(4);
    // The subdirectory session is repo A's row, with its own start directory kept and the
    // inference that filed it there (amendment 10).
    const sub = withDb((db) => db.getSessionByHarnessId("claude-code", "hs-sub", repoA));
    expect(sub).toMatchObject({ repo_path: repoA, start_dir: path.join(repoA, "src") });
    expect(JSON.parse(sub?.context_repos as string)).toEqual([{ root: repoA, writes: 1, pathInputs: 1, references: 1 }]);
    const file = readFileSync(path.join(repoA, ".workledger", "sessions", `${sub?.ulid}.md`), "utf8");
    expect(file).toContain(`started_in: ${path.join(repoA, "src")}`);
    expect(file).toContain(`about:\n  - ${repoA}`);
    // The ledger side of each row: a `source: backfill` session file, as `workledger backfill` writes.
    for (const job of queued.jobs) {
      expect(readFileSync(path.join(job.repo_path, ".workledger", "sessions", `${job.session_ulid}.md`), "utf8")).toContain("source: backfill");
    }
    // The Codex row is opened under its own harness with the rollout's id, which is what makes
    // the drain's `resumeSession` pick `codex exec resume` for it.
    const codexRow = withDb((db) => db.getSessionByHarnessId("codex", CODEX_ID, repoA));
    expect(codexRow).toMatchObject({ repo_path: repoA, harness: "codex", status: "ended" });
    expect(queued.jobs.map((job) => job.session_ulid)).toContain(codexRow?.ulid);
    expect(readFileSync(path.join(repoA, ".workledger", "sessions", `${codexRow?.ulid}.md`), "utf8")).toContain("harness: codex");
    expect(await onboardingStatus(io)).toEqual({ total: 5, done: 0, failed: 0, running: 5, waiting: 0, retryAfter: null, complete: false });

    // A second run finds nothing fresh: the sessions are in the index now.
    const again = await queueOnboardingBackfill({ repos: [repoA, repoB], since: "90d", method: "resume", consent: true }, io);
    expect(again).toEqual({ jobs: [], repos: [] });

    // Only the wizard's rows count: a P3 job beside them moves nothing.
    const db = openIndex({ home: indexHome });
    try {
      const [first, second] = queued.jobs;
      completeJob(db, (first as { id: string }).id, NOW);
      db.connection.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run((second as { id: string }).id);
      db.connection
        .prepare("INSERT INTO jobs (id, kind, session_ulid, repo_path, status, attempts, created_at) VALUES ('P3', 'repair', 'S', ?, 'queued', 0, ?)")
        .run(repoA, NOW.toISOString());
    } finally {
      db.close();
    }
    expect(await onboardingStatus(io)).toEqual({ total: 5, done: 1, failed: 1, running: 3, waiting: 0, retryAfter: null, complete: false });
  });

  it("queues extract jobs for method extract once a key is present, and none for a Codex session", async () => {
    const keyed = { ...io, env: { ...io.env, ANTHROPIC_API_KEY: "sk-test" } };
    const queued = await queueOnboardingBackfill({ repos: [repoB], since: "90d", method: "extract", consent: true }, keyed);
    expect(queued.jobs.map((job) => job.kind)).toEqual(["extract"]);

    // Repo A's Codex session is left for a later resume: no row, no job.
    const forA = await queueOnboardingBackfill({ repos: [repoA], since: "90d", method: "extract", consent: true }, keyed);
    expect(forA.jobs.map((job) => job.kind)).toEqual(["extract", "extract", "extract"]);
    expect(withDb((db) => db.getSessionByHarnessId("codex", CODEX_ID, repoA))).toBeUndefined();
  });

  it("queues nothing for method none or window none", async () => {
    expect(await queueOnboardingBackfill({ repos: [repoA], since: "90d", method: "none", consent: true }, io)).toEqual({ jobs: [], repos: [] });
    expect(await queueOnboardingBackfill({ repos: [repoA], since: "none", method: "resume", consent: true }, io)).toEqual({ jobs: [], repos: [] });
  });
});

/** `fn` over the temp index, closed afterwards. */
function withDb<T>(fn: (db: ReturnType<typeof openIndex>) => T): T {
  const db = openIndex({ home: indexHome });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Every job in the temp index, across repos. */
function listJobsAll(): unknown[] {
  const db = openIndex({ home: indexHome });
  try {
    return [...listJobs(db, repoA), ...listJobs(db, repoB)];
  } finally {
    db.close();
  }
}

describe("the injected OnboardingOps", () => {
  it("satisfies the server's shape from serve's io and hands the drain the queued repos", async () => {
    const drained: Array<[string[], string]> = [];
    const ops = onboardingOps(
      { cwd: dir, env: io.env, stdout: () => {}, stderr: (line) => void err.push(line) },
      (repos, method) => void drained.push([repos, method]),
    );

    // Built from serve's io, the temp filter is the real one and this whole fixture is under
    // `os.tmpdir()`: the stores' repos are dropped from `known`, and the walk lists them unsuggested.
    const discovered = await ops.discover();
    expect(discovered.known).toEqual([]);
    expect(discovered.found.map((c) => [c.path, c.suggested])).toEqual([[repoB, false], [repoA, false], [repoC, false]]);
    expect((await ops.history([repoA])).windows["90d"].sessions).toBe(4);
    expect((await ops.init({ repos: [repoA] })).results[0]?.ok).toBe(true);
    expect((await ops.plan({ repos: [repoA], since: "7d", method: "resume" })).sessions).toBe(2);
    const run = await ops.run({ repos: [repoA], since: "7d", method: "resume", consent: true });
    expect(run.jobs).toHaveLength(2);
    expect(drained).toEqual([[[repoA], "resume"]]);
    expect(await ops.status()).toMatchObject({ total: 2, running: 2, waiting: 0, retryAfter: null, complete: false });
  });
});

describe("workledger onboard --json", () => {
  /** A terminal that is never asked. */
  function terminal(): OnboardIo & { out: string[] } {
    const out: string[] = [];
    return {
      ...io,
      out,
      stdout: (line) => void out.push(line),
      interactive: false,
      ask: async () => {
        throw new Error("asked without a terminal");
      },
    };
  }

  it("emits the six API objects, byte-for-byte what the ops return", async () => {
    // Discovery runs before `init`, so the snapshot to compare against is taken before it too.
    const discovered = JSON.parse(JSON.stringify(await discoverRepos({}, io))) as DiscoverResult;
    const tty = terminal();
    const code = await runOnboard(
      { json: true, select: `${repoA},${repoB}`, since: "30d", method: "none", yes: true },
      tty,
    );

    expect(code).toBe(EXIT_OK);
    expect(tty.out).toHaveLength(1);
    const report = JSON.parse(tty.out[0] as string) as OnboardReport;
    expect(report.discover).toEqual(discovered);
    expect(report.history).toEqual(await historyWindows([repoA, repoB], io));
    expect(report.init.results.map((r) => [r.path, r.ok, r.hooksWritten])).toEqual([
      [repoA, true, [SETTINGS_PATH, CODEX_HOOKS_PATH]],
      [repoB, true, [SETTINGS_PATH, CODEX_HOOKS_PATH]],
    ]);
    expect(report.plan).toEqual(await backfillPlan({ repos: [repoA, repoB], since: "30d", method: "none" }, io));
    expect(report.run).toEqual({ jobs: [] });
    expect(report.status).toEqual(await onboardingStatus(io));
  });

  it("without a terminal and without --select prints the discovery, writes nothing, and exits 0", async () => {
    const discovered = JSON.parse(JSON.stringify(await discoverRepos({}, io))) as DiscoverResult;
    const tty = terminal();
    expect(await runOnboard({ json: true }, tty)).toBe(EXIT_OK);
    expect(tty.out).toHaveLength(1);
    expect(JSON.parse(tty.out[0] as string)).toEqual(discovered);
    expect(err.at(-1)).toBe("workledger onboard: no repos selected; pass --select <paths> (and --yes to skip confirmation)");

    const plain = terminal();
    expect(await runOnboard({}, plain)).toBe(EXIT_OK);
    expect(plain.out.join("\n")).toContain(`[1] ${repoA}  (known; 3 claude-code · 1 codex)`);
    expect(plain.out.join("\n")).toContain(`[3] ${repoC}  (found; no agent sessions)`);

    for (const repo of [repoA, repoB, repoC]) expect(existsSync(path.join(repo, ".workledger"))).toBe(false);
    expect(listJobsAll()).toEqual([]);
  });

  it("without a terminal refuses --select without --yes as a usage error, writing nothing", async () => {
    const tty = terminal();
    expect(await runOnboard({ json: true, select: repoA, since: "90d", method: "resume" }, tty)).toBe(EXIT_USAGE);
    expect(tty.out).toEqual([]);
    expect(err.at(-1)).toContain("pass --select <paths> (and --yes to skip confirmation)");
    expect(existsSync(path.join(repoA, ".workledger"))).toBe(false);
    expect(listJobsAll()).toEqual([]);
  });

  it("accepts --since all (amendment 9): every attributed transcript, whatever its age", async () => {
    const tty = terminal();
    expect(await runOnboard({ json: true, select: repoB, since: "all", method: "none", yes: true }, tty)).toBe(EXIT_OK);
    const report = JSON.parse(tty.out[0] as string) as OnboardReport;
    // Repo B: the 60-day-old session and the 200-day-old one.
    expect(report.history.windows.all.sessions).toBe(2);
    expect(report.history.windows["90d"].sessions).toBe(1);
    expect(report.plan).toEqual({ sessions: 2, estimate: null });
  });

  it("rejects a window or method it does not know, and an empty selection", async () => {
    expect(await runOnboard({ json: true, select: repoA, since: "1y", yes: true }, terminal())).toBe(EXIT_USAGE);
    expect(await runOnboard({ json: true, select: repoA, since: "7d", method: "magic", yes: true }, terminal())).toBe(EXIT_USAGE);
    const empty = path.join(dir, "empty");
    mkdirSync(empty);
    expect(await runOnboard({ json: true, roots: empty, yes: true }, { ...terminal(), homeDir: empty })).toBe(EXIT_USAGE);
    expect(err.join("\n")).toContain("no repos selected");
  });

  it("refuses a relative --select and a relative --roots as usage errors, touching nothing", async () => {
    expect(await runOnboard({ json: true, select: path.relative(dir, repoA), since: "7d", method: "none", yes: true }, terminal())).toBe(EXIT_USAGE);
    expect(err.at(-1)).toContain("not an absolute path");
    expect(await runOnboard({ json: true, roots: "Projects", since: "7d", method: "none", yes: true }, terminal())).toBe(EXIT_USAGE);
    expect(err.at(-1)).toContain("not an absolute path");
    const plain = path.join(dir, "plain");
    mkdirSync(plain);
    expect(await runOnboard({ json: true, select: plain, since: "7d", method: "none", yes: true }, terminal())).toBe(EXIT_USAGE);
    expect(existsSync(path.join(plain, ".workledger"))).toBe(false);
    expect(existsSync(path.join(repoA, ".workledger"))).toBe(false);
  });

  it("narrates the steps on a terminal and asks the missing questions", async () => {
    const asked: string[] = [];
    const defaults: string[] = [];
    const answers = ["1", "7d", "none"];
    const tty: OnboardIo & { out: string[] } = {
      ...terminal(),
      interactive: true,
      ask: async (question, fallback) => {
        asked.push(question);
        defaults.push(fallback);
        return answers.shift() as string;
      },
    };

    expect(await runOnboard({}, tty)).toBe(EXIT_OK);
    expect(asked.map((q) => q.split(" ")[0])).toEqual(["Select", "since", "method"]);
    // Both known repos are suggested, so both are pre-checked.
    expect(defaults[0]).toBe("1,2");
    expect(tty.out.join("\n")).toContain(`[1] ${repoA}`);
    expect(tty.out.join("\n")).toContain("not started");
    expect(existsSync(path.join(repoA, ".workledger"))).toBe(true);
    expect(existsSync(path.join(repoB, ".workledger"))).toBe(false);
  });
});

describe("touched-path attribution (amendment 8, #105)", () => {
  let ws: string;
  let cardA: string;
  let cardB: string;
  let claudeFile: string;
  let codexFile: string;
  const CLAUDE_ID = "hs-ws";
  const CODEX_WS_ID = "01a0ffff-0000-7000-8000-000000000001";

  /** A Claude Code assistant record carrying one tool call, recorded in the workspace. */
  function toolUse(name: string, input: Record<string, unknown>): string {
    return `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-08T10:00:00.000Z",
      cwd: ws,
      message: { role: "assistant", content: [{ type: "tool_use", id: "t", name, input }] },
    })}\n`;
  }

  /** A Codex `exec` call, recorded in the workspace. */
  function exec(cmd: string): string {
    return `${JSON.stringify({
      timestamp: "2026-09-08T10:00:00.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call", name: "exec", input: `const r = await tools.exec_command(${JSON.stringify({ cmd, workdir: ws })});` },
    })}\n`;
  }

  beforeEach(() => {
    // A workspace folder that is not a repo, holding two repos — the dome_workspace shape.
    ws = path.join(home, "Projects", "ws");
    cardA = path.join(ws, "card-a");
    cardB = path.join(ws, "card-b");
    for (const root of [cardA, cardB]) makeRepo(root);
    mkdirSync(path.join(cardA, "src"), { recursive: true });

    // Started in the workspace: writes in both repos, so it counts for both.
    claudeFile = path.join(home, CLAUDE_STORE, projectSlug(ws), `${CLAUDE_ID}.jsonl`);
    mkdirSync(path.dirname(claudeFile), { recursive: true });
    writeFileSync(
      claudeFile,
      `${JSON.stringify({ type: "user", timestamp: "2026-09-08T09:59:00.000Z", cwd: ws, message: { role: "user", content: "go" } })}\n` +
        toolUse("Edit", { file_path: "card-a/src/a.ts", old_string: "a", new_string: "b" }) +
        toolUse("Read", { file_path: path.join(cardB, "README.md") }) +
        toolUse("Bash", { command: "cd card-b && echo note >> README.md" }),
      "utf8",
    );
    const claudeAt = new Date(NOW.getTime() - 2 * DAY_MS);
    utimesSync(claudeFile, claudeAt, claudeAt);

    // A Codex rollout started there too: five references to card-a, one of them a `cd` into it
    // (enough, #110), three shell mentions of card-b (not).
    codexFile = path.join(home, CODEX_STORE, "2026", "09", "08", "rollout-ws.jsonl");
    writeFileSync(
      codexFile,
      `${JSON.stringify({ timestamp: "2026-09-08T10:00:00.000Z", type: "session_meta", payload: { id: CODEX_WS_ID, cwd: ws, timestamp: "2026-09-08T10:00:00.000Z" } })}\n` +
        ["cat card-a/src/a.ts", "ls card-a", "rg x card-a/src", "wc -l card-a/src/a.ts", "cd card-a && head README.md"].map(exec).join("") +
        ["ls card-b", "cat card-b/README.md", "rg y card-b"].map(exec).join(""),
      "utf8",
    );
    const codexAt = new Date(NOW.getTime() - 1 * DAY_MS);
    utimesSync(codexFile, codexAt, codexAt);
  });

  it("discover lists a repo the workspace session touched as known, with startedIn and touchedSessions", async () => {
    const result = await discoverRepos({}, io);
    const a = result.known.find((c) => c.path === cardA);
    const b = result.known.find((c) => c.path === cardB);

    expect(a).toEqual({
      path: cardA,
      name: "card-a",
      hasGit: true,
      enabled: false,
      suggested: true,
      harnessSessions: { "claude-code": 1, codex: 1 },
      lastSessionAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
      startedIn: [ws],
      touchedSessions: 2,
      about: { content: 2, fallback: 0 },
    });
    expect(b).toMatchObject({ harnessSessions: { "claude-code": 1 }, startedIn: [ws], touchedSessions: 1 });
    expect(result.found.map((c) => c.path)).toEqual([repoC]);
    // The workspace is where the sessions started and nothing more (amendment 10): no session
    // is about it, so it is not a project; it is the `workspaces` slot's.
    expect(result.known.find((c) => c.path === ws)).toBeUndefined();
    expect(result.workspaces.map((w) => w.path)).toEqual([ws]);
    // The other repos' sessions started inside them and are not touched sessions.
    expect(result.known.find((c) => c.path === repoA)).toMatchObject({ startedIn: [], touchedSessions: 0 });
  });

  it("files a session started in one repo into the repo it wrote in, and into its own only as the fallback (amendment 10)", async () => {
    // Started in repo-c: ten Reads and cds into card-a — routine sibling browsing, not work
    // there. Nothing qualifies, so the session is repo-c's by the fallback alone.
    const file = path.join(home, CLAUDE_STORE, projectSlug(repoC), "hs-c.jsonl");
    mkdirSync(path.dirname(file), { recursive: true });
    const record = (name: string, input: Record<string, unknown>): string =>
      `${JSON.stringify({ type: "assistant", timestamp: "2026-09-08T10:00:00.000Z", cwd: repoC, message: { role: "assistant", content: [{ type: "tool_use", id: "t", name, input }] } })}\n`;
    const browsing =
      `${JSON.stringify({ type: "user", timestamp: "2026-09-08T09:59:00.000Z", cwd: repoC, message: { role: "user", content: "go" } })}\n` +
      Array.from({ length: 5 }, (_, i) => record("Read", { file_path: path.join(cardA, "src", `${i}.ts`) })).join("") +
      Array.from({ length: 5 }, () => record("Bash", { command: `cd ${cardA} && git log -1` })).join("");
    writeFileSync(file, browsing, "utf8");
    utimesSync(file, NOW, NOW);

    const before = await discoverRepos({}, io);
    expect(before.known.find((c) => c.path === cardA)).toMatchObject({ startedIn: [ws], touchedSessions: 2 });
    expect(before.known.find((c) => c.path === repoC)).toMatchObject({ harnessSessions: { "claude-code": 1 }, about: { content: 0, fallback: 1 } });
    expect((await historyWindows([repoC], io)).windows.all.sessions).toBe(1);

    // One write under card-a: the session is about card-a, and not about repo-c at all — the
    // start directory is where the transcript lives, not where the digest goes.
    writeFileSync(file, browsing + record("Write", { file_path: path.join(cardA, "notes.md"), content: "x" }), "utf8");
    utimesSync(file, NOW, NOW);
    const after = await discoverRepos({}, io);
    expect(after.known.find((c) => c.path === cardA)).toMatchObject({ startedIn: [repoC, ws].sort(), touchedSessions: 3, about: { content: 3, fallback: 0 } });
    expect(after.known.find((c) => c.path === repoC)).toBeUndefined();
    expect(after.found.map((c) => c.path)).toEqual([repoC]);
    expect((await historyWindows([repoC], io)).windows.all.sessions).toBe(0);
    expect((await historyWindows([cardA], io)).windows.all.sessions).toBe(3);

    // Backfilled into card-a with its start directory and the inference on the row.
    await initRepos({ repos: [cardA] }, io);
    const queued = await queueOnboardingBackfill({ repos: [cardA], since: "7d", method: "resume", consent: true }, io);
    const row = withDb((db) => db.getSessionByHarnessId("claude-code", "hs-c", cardA));
    expect(queued.jobs.map((job) => job.session_ulid)).toContain(row?.ulid);
    expect(row).toMatchObject({ repo_path: cardA, start_dir: repoC });
    expect(JSON.parse(row?.context_repos as string)).toEqual([{ root: cardA, writes: 1, pathInputs: 11, references: 11 }]);
    expect(withDb((db) => db.getSessionByHarnessId("claude-code", "hs-c", repoC))).toBeUndefined();
  });

  it("history counts the touched session once per repo it touched", async () => {
    const { windows } = await historyWindows([cardA, cardB], io);
    const claude = statSync(claudeFile).size;
    const codex = statSync(codexFile).size;
    expect(windows["7d"]).toEqual({ sessions: 3, bytes: 2 * claude + codex });
    expect(windows.all).toEqual(windows["7d"]);
    expect((await historyWindows([cardB], io)).windows["7d"]).toEqual({ sessions: 1, bytes: claude });
    // Scanned once: a second call is served from the index cache with the same answer.
    expect((await historyWindows([cardA, cardB], io)).windows["90d"]).toEqual(windows["90d"]);
  });

  it("run queues one repair job per (session, repo), each row carrying the session's own start directory", async () => {
    await initRepos({ repos: [cardA, cardB] }, io);
    expect((await backfillPlan({ repos: [cardA, cardB], since: "7d", method: "resume" }, io)).sessions).toBe(3);

    const queued = await queueOnboardingBackfill({ repos: [cardA, cardB], since: "7d", method: "resume", consent: true }, io);

    expect(queued.repos).toEqual([cardA, cardB]);
    expect(queued.jobs.map((job) => [job.kind, job.repo_path]).sort()).toEqual([
      ["repair", cardA],
      ["repair", cardA],
      ["repair", cardB],
    ]);
    const forA = withDb((db) => db.getSessionByHarnessId("claude-code", CLAUDE_ID, cardA));
    const forB = withDb((db) => db.getSessionByHarnessId("claude-code", CLAUDE_ID, cardB));
    const codexA = withDb((db) => db.getSessionByHarnessId("codex", CODEX_WS_ID, cardA));
    expect(forA).toMatchObject({ repo_path: cardA, start_dir: ws, transcript_path: claudeFile, status: "ended" });
    expect(forB).toMatchObject({ repo_path: cardB, start_dir: ws, transcript_path: claudeFile });
    expect(forA?.ulid).not.toBe(forB?.ulid);
    expect(forA?.context_repos).toBe(forB?.context_repos);
    expect(codexA).toMatchObject({ repo_path: cardA, start_dir: ws, harness: "codex" });
    expect(withDb((db) => db.getSessionByHarnessId("codex", CODEX_WS_ID, cardB))).toBeUndefined();
    expect(new Set(queued.jobs.map((job) => job.session_ulid))).toEqual(new Set([forA?.ulid, forB?.ulid, codexA?.ulid]));
    for (const job of queued.jobs) {
      expect(existsSync(path.join(job.repo_path, ".workledger", "sessions", `${job.session_ulid}.md`))).toBe(true);
    }
    expect(await onboardingStatus(io)).toMatchObject({ total: 3, running: 3 });

    // Indexed now, for each repo: nothing fresh a second time.
    expect(await queueOnboardingBackfill({ repos: [cardA, cardB], since: "7d", method: "resume", consent: true }, io)).toEqual({ jobs: [], repos: [] });
  });
});

describe("onboarding status and the usage window (#100)", () => {
  it("counts a job held for the harness's reset as waiting, with the earliest reset, and not complete", async () => {
    const ops = onboardingOps(
      { cwd: dir, env: io.env, stdout: () => {}, stderr: (line) => void err.push(line) },
      () => {},
    );
    expect((await ops.init({ repos: [repoA] })).results[0]?.ok).toBe(true);
    const run = await ops.run({ repos: [repoA], since: "7d", method: "resume", consent: true });
    expect(run.jobs).toHaveLength(2);

    // `status` reads the wall clock, so the reset has to be ahead of *that*, not of the fixture's.
    const reset = new Date(Date.now() + 60 * 60_000).toISOString();
    withDb((db) => {
      const claimed = claimJob(db, { repoPath: repoA, now: NOW })!;
      deferJob(db, claimed.id, { retryAfter: reset, error: "limit" });
    });

    expect(await ops.status()).toEqual({ total: 2, done: 0, failed: 0, running: 1, waiting: 1, retryAfter: reset, complete: false });
    expect((await ops.status()).total).toBe(2);
  });
});
