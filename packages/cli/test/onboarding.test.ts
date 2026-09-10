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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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
import { completeJob, listJobs } from "../src/jobs/queue.js";
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
import { CODEX_STORE, claudeProjects, codexSessions, enumerateCodexStore, slugToPath } from "../src/onboarding/stores.js";
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
  dir = mkdtempSync(path.join(os.tmpdir(), "workledger-onboard-"));
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
      [[repoB, 1], [repoA, 2]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
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

  it("enumerates a repo's Codex rollouts as store sessions, subdirectory sessions included", () => {
    const rollout = path.join(home, CODEX_STORE, "2026", "09", "08", "rollout-a.jsonl");
    expect(enumerateCodexStore(home, repoA)).toEqual([
      {
        harnessSessionId: CODEX_ID,
        file: rollout,
        bytes: statSync(rollout).size,
        mtimeMs: NOW.getTime() - 1 * DAY_MS,
        startedIso: "2026-09-08T10:00:00.000Z",
        cwd: path.join(repoA, "packages"),
      },
    ]);
    // The rollout naming a gone directory counts for no repo, and repo B has none.
    expect(enumerateCodexStore(home, repoB)).toEqual([]);
  });
});

describe("discoverRepos", () => {
  it("lists store-known repos, then .git repos under the roots, skipping node_modules and dot dirs", () => {
    const result = discoverRepos({}, io);

    expect(result.roots).toEqual([path.join(home, "Projects")]);
    expect(result.known.map((c) => c.path)).toEqual([repoA, repoB]);
    expect(result.known[0]).toEqual({
      path: repoA,
      name: "repo-a",
      hasGit: true,
      enabled: false,
      suggested: true,
      // The Codex session in `repo-a/packages` counts for the repo above it.
      harnessSessions: { "claude-code": 2, codex: 1 },
      lastSessionAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
    });
    expect(result.known[1]?.harnessSessions).toEqual({ "claude-code": 1 });
    expect(result.found.map((c) => c.path)).toEqual([repoC]);
    expect(result.found[0]).toMatchObject({ name: "repo-c", hasGit: true, enabled: false, suggested: true, harnessSessions: {}, lastSessionAt: null });
  });

  it("walks a root that is itself a repo, lists it unsuggested, and still does not enter nested repos", () => {
    const mono = path.join(dir, "mono");
    const one = path.join(mono, "one");
    const two = path.join(mono, "lib", "two");
    for (const repo of [mono, one, two, path.join(one, "inner")]) makeRepo(repo);
    const result = discoverRepos({ roots: [mono] }, io);

    expect(result.found.map((c) => [c.path, c.suggested])).toEqual([
      [mono, false],
      [two, true],
      [one, true],
    ]);
  });

  it("drops a store cwd under the temp dir from known, resolved through symlinks", () => {
    const scratch = path.join(tempDir, "scratch");
    makeRepo(scratch);
    writeTranscript(path.join(home, CLAUDE_STORE, projectSlug(scratch), "hs-gamma.jsonl"), "hs-gamma", scratch, NOW);
    const result = discoverRepos({}, io);

    expect(result.known.map((c) => c.path)).toEqual([repoA, repoB]);
    // Named as a root it is still found, and still not worth pre-checking.
    expect(discoverRepos({ roots: [tempDir] }, io).found).toMatchObject([{ path: scratch, suggested: false }]);
  });

  it("refuses a root that is relative, missing, or not a directory", () => {
    for (const [root, reason] of [
      ["Projects", "not an absolute path"],
      [path.join(dir, "nowhere"), "does not exist"],
      [path.join(repoA, ".git", "config"), "not a directory"],
    ]) {
      expect(() => discoverRepos({ roots: [root as string] }, io)).toThrow(reason);
    }
  });

  it("takes explicit roots, expands ~, and reports enabled repos as such", async () => {
    await initRepos({ repos: [repoC] }, io);
    const result = discoverRepos({ roots: ["~/Projects/repo-c", path.join(home, "Projects", "1")] }, io);

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
  it("counts Claude Code and Codex sessions and bytes per window across the selected repos, on file mtime", () => {
    const { windows } = historyWindows([repoA, repoB], io);
    const bytes = (id: string): number =>
      Buffer.byteLength(readFileSync(path.join(FIXTURES, `${id}.jsonl`), "utf8").replaceAll("__CWD__", id === "hs-alpha" ? repoB : repoA));
    // The one-day-old Codex rollout in repo A is inside every window.
    const codex = statSync(path.join(home, CODEX_STORE, "2026", "09", "08", "rollout-a.jsonl")).size;

    expect(windows["7d"]).toEqual({ sessions: 2, bytes: bytes("hs-gamma") + codex });
    expect(windows["30d"]).toEqual({ sessions: 3, bytes: bytes("hs-gamma") + bytes("hs-beta") + codex });
    expect(windows["90d"]).toEqual({ sessions: 4, bytes: bytes("hs-gamma") + bytes("hs-beta") + bytes("hs-alpha") + codex });
    expect(historyWindows([repoC], io).windows["90d"]).toEqual({ sessions: 0, bytes: 0 });
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
      expect(() => historyWindows([given], io)).toThrow(reason);
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
    // ceil(45 / 2) = 23; repo B's one (60 days old) is outside 30d and adds 23 inside 90d.
    expect(await backfillPlan({ repos: [repoA, repoB], since: "30d", method: "resume" }, io)).toEqual({
      sessions: 3,
      estimate: { seconds: 45 + 23 },
    });
    expect(await backfillPlan({ repos: [repoA, repoB], since: "90d", method: "resume" }, io)).toEqual({
      sessions: 4,
      estimate: { seconds: 45 + 23 + 23 },
    });
  });

  it("prices an extraction in tokens and USD, says whether the key is missing, and reports Codex as unsupported", async () => {
    const without = await backfillPlan({ repos: [repoA, repoB], since: "90d", method: "extract" }, io);
    expect(without.sessions).toBe(3);
    expect(without.unsupported).toEqual({ codex: 1 });
    expect(await backfillPlan({ repos: [repoB], since: "90d", method: "extract" }, io)).not.toHaveProperty("unsupported");
    expect(without.estimate).toMatchObject({ needsApiKey: true });
    const estimate = without.estimate as { tokens: number; usd: number };
    expect(estimate.tokens).toBeGreaterThan(3 * 4096);
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
  return n * (Math.ceil(bytes / 4) + 4096);
}

describe("queueOnboardingBackfill and onboardingStatus", () => {
  beforeEach(async () => {
    await initRepos({ repos: [repoA, repoB] }, io);
  });

  it("refuses without consent, writing nothing", async () => {
    await expect(
      queueOnboardingBackfill({ repos: [repoA], since: "90d", method: "resume", consent: false }, io),
    ).rejects.toMatchObject({ code: "consent-required" });
    expect(await onboardingStatus(io)).toEqual({ total: 0, done: 0, failed: 0, running: 0, complete: true });
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
    expect(queued.jobs).toHaveLength(4);
    expect(queued.jobs.map((job) => [job.kind, job.status, job.source])).toEqual(
      Array.from({ length: 4 }, () => ["repair", "queued", ONBOARDING_SOURCE]),
    );
    expect(queued.jobs.filter((job) => job.repo_path === repoA)).toHaveLength(3);
    // The ledger side of each row: a `source: backfill` session file, as `workledger backfill` writes.
    for (const job of queued.jobs) {
      expect(readFileSync(path.join(job.repo_path, ".workledger", "sessions", `${job.session_ulid}.md`), "utf8")).toContain("source: backfill");
    }
    // The Codex row is opened under its own harness with the rollout's id, which is what makes
    // the drain's `resumeSession` pick `codex exec resume` for it.
    const codexRow = withDb((db) => db.getSessionByHarnessId("codex", CODEX_ID));
    expect(codexRow).toMatchObject({ repo_path: repoA, harness: "codex", status: "ended" });
    expect(queued.jobs.map((job) => job.session_ulid)).toContain(codexRow?.ulid);
    expect(readFileSync(path.join(repoA, ".workledger", "sessions", `${codexRow?.ulid}.md`), "utf8")).toContain("harness: codex");
    expect(await onboardingStatus(io)).toEqual({ total: 4, done: 0, failed: 0, running: 4, complete: false });

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
    expect(await onboardingStatus(io)).toEqual({ total: 4, done: 1, failed: 1, running: 2, complete: false });
  });

  it("queues extract jobs for method extract once a key is present, and none for a Codex session", async () => {
    const keyed = { ...io, env: { ...io.env, ANTHROPIC_API_KEY: "sk-test" } };
    const queued = await queueOnboardingBackfill({ repos: [repoB], since: "90d", method: "extract", consent: true }, keyed);
    expect(queued.jobs.map((job) => job.kind)).toEqual(["extract"]);

    // Repo A's Codex session is left for a later resume: no row, no job.
    const forA = await queueOnboardingBackfill({ repos: [repoA], since: "90d", method: "extract", consent: true }, keyed);
    expect(forA.jobs.map((job) => job.kind)).toEqual(["extract", "extract"]);
    expect(withDb((db) => db.getSessionByHarnessId("codex", CODEX_ID))).toBeUndefined();
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
    expect((await ops.history([repoA])).windows["90d"].sessions).toBe(3);
    expect((await ops.init({ repos: [repoA] })).results[0]?.ok).toBe(true);
    expect((await ops.plan({ repos: [repoA], since: "7d", method: "resume" })).sessions).toBe(2);
    const run = await ops.run({ repos: [repoA], since: "7d", method: "resume", consent: true });
    expect(run.jobs).toHaveLength(2);
    expect(drained).toEqual([[[repoA], "resume"]]);
    expect(await ops.status()).toMatchObject({ total: 2, running: 2, complete: false });
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
    const discovered = JSON.parse(JSON.stringify(discoverRepos({}, io))) as DiscoverResult;
    const tty = terminal();
    const code = await runOnboard(
      { json: true, select: `${repoA},${repoB}`, since: "30d", method: "none", yes: true },
      tty,
    );

    expect(code).toBe(EXIT_OK);
    expect(tty.out).toHaveLength(1);
    const report = JSON.parse(tty.out[0] as string) as OnboardReport;
    expect(report.discover).toEqual(discovered);
    expect(report.history).toEqual(historyWindows([repoA, repoB], io));
    expect(report.init.results.map((r) => [r.path, r.ok, r.hooksWritten])).toEqual([
      [repoA, true, [SETTINGS_PATH, CODEX_HOOKS_PATH]],
      [repoB, true, [SETTINGS_PATH, CODEX_HOOKS_PATH]],
    ]);
    expect(report.plan).toEqual(await backfillPlan({ repos: [repoA, repoB], since: "30d", method: "none" }, io));
    expect(report.run).toEqual({ jobs: [] });
    expect(report.status).toEqual(await onboardingStatus(io));
  });

  it("stops after the plan without --yes and reports run and status as null", async () => {
    const tty = terminal();
    await runOnboard({ json: true, select: repoA, since: "90d", method: "resume" }, tty);
    const report = JSON.parse(tty.out[0] as string) as OnboardReport;
    expect(report.plan).toEqual({ sessions: 3, estimate: { seconds: 45 + 23 } });
    expect(report.run).toBeNull();
    expect(report.status).toBeNull();
    expect(listJobsAll()).toEqual([]);
  });

  it("rejects a window or method it does not know, and an empty selection", async () => {
    expect(await runOnboard({ json: true, select: repoA, since: "1y" }, terminal())).toBe(EXIT_USAGE);
    expect(await runOnboard({ json: true, select: repoA, since: "7d", method: "magic" }, terminal())).toBe(EXIT_USAGE);
    const empty = path.join(dir, "empty");
    mkdirSync(empty);
    expect(await runOnboard({ json: true, roots: empty }, { ...terminal(), homeDir: empty })).toBe(EXIT_USAGE);
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
    const answers = ["1", "7d", "none"];
    const tty: OnboardIo & { out: string[] } = {
      ...terminal(),
      interactive: true,
      ask: async (question) => {
        asked.push(question);
        return answers.shift() as string;
      },
    };

    expect(await runOnboard({}, tty)).toBe(EXIT_OK);
    expect(asked.map((q) => q.split(" ")[0])).toEqual(["Select", "since", "method"]);
    expect(tty.out.join("\n")).toContain(`[1] ${repoA}`);
    expect(tty.out.join("\n")).toContain("not started");
    expect(existsSync(path.join(repoA, ".workledger"))).toBe(true);
    expect(existsSync(path.join(repoB, ".workledger"))).toBe(false);
  });
});
