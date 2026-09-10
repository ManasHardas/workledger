/**
 * End-to-end (#81): the whole onboarding, with nothing faked but the harness.
 *
 * `onboarding.e2e.ts` drives the wizard against a fixture daemon; this file drives it against
 * the real one. A temp `HOME` carries a Claude Code store with one transcript for each of two
 * temp git repos, `node packages/cli/bin/workledger open --no-browser` starts the real detached
 * daemon over a temp `WORKLEDGER_HOME`, and a real Chromium walks projects → history (7d) →
 * method (resume) → running → done → Home → each repo's Ledger. The only stand-in is `claude`:
 * a shell script on `PATH` that, when the drain resumes a session headlessly, reads the ulid
 * out of the repair instruction and runs the real `workledger checkpoint` against the repo — so
 * a checkpoint file lands in `.workledger/sessions/` the way a resumed harness would land it,
 * and the drain's "did a checkpoint come out of it" check sees a real one (`resume-headless.test.ts`
 * and `e2e-repair.test.ts` in packages/cli are the two halves this joins).
 *
 * Every assertion that matters is made on disk or against the daemon's API, not only on the
 * page: `.workledger/config.yaml` and `.claude/settings.json` in both repos, the checkpoint in
 * each session file, the stub's call log, and `GET /api/onboarding/status`.
 *
 * Opt-in like its siblings: without `WORKLEDGER_E2E=1` every test reports as skipped. Needs
 * `pnpm build` (the bin shim imports the bundle) and a downloaded Chromium. Never run against a
 * real repo — every path here is under one `mkdtemp`, and the daemon is stopped in `afterEach`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

/** Monorepo root — this file is `apps/web/test/e2e/`. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
/** The bin shim under test; it dynamic-imports `packages/cli/dist/main.js`. */
const BIN = path.join(REPO_ROOT, "packages", "cli", "bin", "workledger");
const BUNDLE = path.join(REPO_ROOT, "packages", "cli", "dist", "main.js");
const WEB_INDEX = path.join(REPO_ROOT, "packages", "cli", "dist", "web", "index.html");
/** The CLI's transcript fixtures; `packages/cli/test/onboarding.test.ts` lays them out the same way. */
const FIXTURES = path.join(REPO_ROOT, "packages", "cli", "test", "fixtures", "transcripts");

const ENABLED = process.env["WORKLEDGER_E2E"] === "1";
const SKIP_REASON = "set WORKLEDGER_E2E=1 to run (needs `pnpm build` and `pnpm exec playwright install chromium`)";

/** What the stub's checkpoint says the session was for — the text the Ledger must show. */
const GOAL = "Backfilled by the end-to-end stub";
const DAY_MS = 24 * 60 * 60 * 1000;

/** One repo per fixture transcript; the ids are the `sessionId` inside each fixture. */
const REPOS = [
  { name: "alpha", fixture: "hs-gamma", ageDays: 1 },
  { name: "beta", fixture: "hs-beta", ageDays: 2 },
] as const;

// ---------------------------------------------------------------------------
// Fixture: a temp HOME with a Claude store, two git repos, a stub claude, a real daemon
// ---------------------------------------------------------------------------

interface Fixture {
  /** Everything lives under here; removed after the test. */
  root: string;
  /** The `HOME` the daemon sees: `~/.claude/projects` and `~/Projects` are under it. */
  home: string;
  /** The `WORKLEDGER_HOME` the daemon sees: `index.sqlite`, `serve.json`, `serve.log`. */
  wlhome: string;
  /** Absolute paths of the two repos, in `REPOS` order. */
  repos: string[];
  /** Where the stub `claude` appends the harness session id of every resume it is asked for. */
  callLog: string;
  env: NodeJS.ProcessEnv;
  /** The URL `open` printed, once the daemon is up. */
  url: string;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** `packages/cli/src/commands/backfill.ts` `projectSlug`: the Claude store's directory name for a cwd. */
function projectSlug(repoPath: string): string {
  return repoPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * A fixture transcript for `cwd`, dated `at`: every record's `timestamp` is rewritten so the
 * session is inside the 7-day window whenever the test runs (the checked-in dates are fixed), and
 * the file's mtime — what the history step counts by — is set to the same instant.
 */
function writeTranscript(file: string, fixture: string, cwd: string, at: Date): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const text = readFileSync(path.join(FIXTURES, `${fixture}.jsonl`), "utf8")
    .replaceAll("__CWD__", cwd)
    .replaceAll(/"timestamp":"[^"]+"/g, `"timestamp":"${at.toISOString()}"`);
  writeFileSync(file, text, "utf8");
  utimesSync(file, at, at);
}

/**
 * The stand-in for `claude`. The adapter runs it as
 * `claude -p <instruction> --resume <id> --allowedTools …` with the repo as cwd and the daemon's
 * environment; the instruction names `workledger checkpoint --session <ulid>`, which is what a
 * real resumed session would run. The stub runs exactly that, with a minimal valid payload.
 */
function writeClaudeStub(bin: string, callLog: string): void {
  const stub = path.join(bin, "claude");
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      "set -e",
      // `workledger init` probes the harness with `claude --version`; anything but a headless
      // resume is answered and never logged, so the call log is exactly the resumes.
      'if [ "$1" = "--version" ]; then echo "0.0.0 (e2e stub)"; exit 0; fi',
      'if [ "$1" != "-p" ]; then exit 0; fi',
      `printf '%s\\n' "$4" >> ${JSON.stringify(callLog)}`,
      `ULID=$(printf '%s\\n' "$2" | sed -n 's/.*--session \\([0-9A-Z]\\{26\\}\\).*/\\1/p' | head -n 1)`,
      'if [ -z "$ULID" ]; then echo "stub claude: no --session <ulid> in the instruction" >&2; exit 1; fi',
      `printf '%s' ${JSON.stringify(JSON.stringify({ goal: GOAL, done: [], remaining: [], notes: [] }))} | exec ${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} checkpoint --session "$ULID"`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(stub, 0o755);
}

/** Lay everything out on disk; nothing is started yet. */
function makeFixture(): Omit<Fixture, "url"> {
  const root = mkdtempSync(path.join(tmpdir(), "workledger-e2e-full-"));
  const home = path.join(root, "home");
  const wlhome = path.join(root, "wlhome");
  const bin = path.join(root, "bin");
  const callLog = path.join(root, "claude-calls.log");
  for (const at of [home, wlhome, bin]) mkdirSync(at, { recursive: true });

  const now = Date.now();
  const repos = REPOS.map(({ name, fixture, ageDays }) => {
    const repo = path.join(home, "Projects", name);
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "--quiet", "--initial-branch=main", ".");
    git(repo, "config", "user.name", "Workledger E2E");
    git(repo, "config", "user.email", "e2e@workledger.test");
    writeTranscript(
      path.join(home, ".claude", "projects", projectSlug(repo), `${fixture}.jsonl`),
      fixture,
      repo,
      new Date(now - ageDays * DAY_MS),
    );
    return repo;
  });
  writeClaudeStub(bin, callLog);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    WORKLEDGER_HOME: wlhome,
    PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
  };
  // The adapter must find the stub through PATH, the way a user's `claude` is found; and the
  // extract path must have no key, so "No, use the Anthropic API instead" stays a dead end.
  delete env["WORKLEDGER_CLAUDE_BIN"];
  delete env["ANTHROPIC_API_KEY"];

  return { root, home, wlhome, repos, callLog, env };
}

/** The daemon's log, for a failure message worth reading. */
function serveLog(fixture: Pick<Fixture, "wlhome">): string {
  const file = path.join(fixture.wlhome, "serve.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "(no serve.log)";
}

/**
 * `workledger open --no-browser`: starts the real detached daemon over the temp home and returns
 * once `/api/health` answers; the URL is what it prints.
 */
function openDaemon(fixture: Omit<Fixture, "url">): string {
  const result = spawnSync(process.execPath, [BIN, "open", "--no-browser"], {
    cwd: fixture.root,
    env: fixture.env,
    encoding: "utf8",
    timeout: 60_000,
  });
  const found = /http:\/\/127\.0\.0\.1:\d+/.exec(result.stdout);
  if (result.status !== 0 || found === null) {
    throw new Error(
      `workledger open failed (exit ${String(result.status)})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n--- serve.log ---\n${serveLog(fixture)}`,
    );
  }
  return found[0];
}

/** `workledger stop`, then a SIGKILL on whatever pid `serve.json` still names — nothing may outlive the test. */
function stopDaemon(fixture: Omit<Fixture, "url">): void {
  const stateFile = path.join(fixture.wlhome, "serve.json");
  let pid: number | undefined;
  try {
    pid = (JSON.parse(readFileSync(stateFile, "utf8")) as { pid?: number }).pid;
  } catch {
    pid = undefined;
  }
  const result = spawnSync(process.execPath, [BIN, "stop"], { cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0 && pid !== undefined) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/** `.workledger/sessions/*.md` of one repo. */
function sessionFiles(repo: string): string[] {
  const dir = path.join(repo, ".workledger", "sessions");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")).sort() : [];
}

/** The `hooks` block of a repo's `.claude/settings.json`, as the event → commands map. */
function hookCommands(repo: string): Record<string, string[]> {
  const settings = JSON.parse(readFileSync(path.join(repo, ".claude", "settings.json"), "utf8")) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  };
  const out: Record<string, string[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    out[event] = groups.flatMap((group) => (group.hooks ?? []).map((hook) => hook.command ?? ""));
  }
  return out;
}

async function status(url: string): Promise<{ total: number; done: number; failed: number; running: number; complete: boolean }> {
  const response = await fetch(`${url}/api/onboarding/status`);
  return (await response.json()) as { total: number; done: number; failed: number; running: number; complete: boolean };
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

/** `/` → the wizard → both repos pre-checked → Continue → both initialised on disk → history 7d → method. */
async function walkToMethod(page: Page, fixture: Fixture): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${fixture.url}/`);

  // A daemon with no enabled repo redirects Home to the wizard.
  await expect(page).toHaveURL(/#\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Choose the repos to track" })).toBeVisible();
  // Both repos come from the Claude store ("known"), have a `.git`, and so are pre-checked.
  for (const { name } of REPOS) await expect(page.getByRole("checkbox", { name, exact: true })).toBeChecked();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Repos enabled" })).toBeVisible();
  await expect(page.getByText(".claude/settings.json").first()).toBeVisible();
  for (const repo of fixture.repos) {
    expect(existsSync(path.join(repo, ".workledger", "config.yaml")), `${repo}/.workledger/config.yaml`).toBe(true);
    const hooks = hookCommands(repo);
    for (const event of ["SessionStart", "Stop", "SessionEnd"]) {
      expect(hooks[event]?.some((command) => command.includes(`workledger hook ${event}`)), `${repo} hook ${event}`).toBe(true);
    }
  }
  const repos = (await (await fetch(`${fixture.url}/api/repos`)).json()) as Array<{ path: string }>;
  expect(repos.map((repo) => repo.path).sort()).toEqual([...fixture.repos].sort());

  await page.getByRole("button", { name: "Next: choose history" }).click();
  await expect(page.getByRole("heading", { name: "How much history to backfill" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Last 7 days/ })).toContainText("2 sessions");
  await page.getByRole("button", { name: /Last 7 days/ }).click();
  await expect(page.getByRole("heading", { name: "How should past sessions be digested?" })).toBeVisible();
}

/** Home lists both repos, each with `sessions` sessions in the last week. */
async function expectHome(page: Page, sessions: number): Promise<void> {
  await expect(page.getByRole("heading", { name: "Projects", level: 2 })).toBeVisible();
  for (const { name } of REPOS) {
    const card = page.getByRole("link", { name, exact: true });
    await expect(card).toBeVisible();
    await expect(card.locator("dt", { hasText: "sessions · 7d" }).locator("xpath=following-sibling::dd")).toHaveText(String(sessions));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("onboarding, full system", () => {
  test.skip(!ENABLED, SKIP_REASON);
  test.skip(ENABLED && !existsSync(BUNDLE), `${BUNDLE} is missing — run pnpm build`);
  test.skip(ENABLED && !existsSync(WEB_INDEX), `${WEB_INDEX} is missing — run pnpm build`);
  // A real daemon start, two inits, two resumes and a browser: more than the config's 60 s.
  test.describe.configure({ timeout: 180_000 });

  let fixture: Fixture;

  test.beforeEach(() => {
    const laid = makeFixture();
    fixture = { ...laid, url: openDaemon(laid) };
  });

  test.afterEach(() => {
    stopDaemon(fixture);
    const info = test.info();
    if (info.status !== info.expectedStatus) {
      // Keep the temp tree for a post-mortem, and put the daemon's log in the report.
      info.annotations.push({ type: "serve.log", description: serveLog(fixture) });
      info.annotations.push({ type: "fixture", description: fixture.root });
      return;
    }
    rmSync(fixture.root, { recursive: true, force: true });
  });

  test("resume backfills both repos through the real daemon and the checkpoints land on disk", async ({ page }) => {
    await walkToMethod(page, fixture);

    await page.getByRole("button", { name: "Yes, replay my sessions" }).click();
    await expect(page.getByRole("heading", { name: "Resume in your harness" })).toBeVisible();
    await page.getByRole("button", { name: "Start backfill (2 sessions)" }).click();

    await expect(page.getByRole("heading", { name: "Backfilling" })).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Backfilled 2 sessions across 2 repos" })).toBeVisible({ timeout: 90_000 });

    // The daemon's own count, not the page's.
    expect(await status(fixture.url)).toEqual({ total: 2, done: 2, failed: 0, running: 0, complete: true });
    // The stub was resumed once per harness session, and each checkpoint is in the ledger.
    expect(readFileSync(fixture.callLog, "utf8").trim().split("\n").sort()).toEqual(REPOS.map((r) => r.fixture).sort());
    for (const repo of fixture.repos) {
      const files = sessionFiles(repo);
      expect(files, `${repo} sessions`).toHaveLength(1);
      const text = readFileSync(path.join(repo, ".workledger", "sessions", files[0] as string), "utf8");
      expect(text).toContain("source: backfill");
      expect(text).toContain("status: repaired");
      expect(text).toContain("trigger: repair");
      expect(text).toContain(GOAL);
    }

    await page.getByRole("link", { name: "Go to home" }).click();
    await expectHome(page, 1);
    await expect(page.getByRole("status").filter({ hasText: "Backfilled" })).toContainText("Backfilled 2 sessions across 2 repos.");

    // Each repo's Ledger shows its one backfilled, repaired session.
    for (const { name } of REPOS) {
      await page.goto(`${fixture.url}/#/`);
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(/#\/r\/[^/]+\/ledger$/);
      // The Ledger opens on the "Open" scope; a backfilled session is `repaired`, so it is under "All".
      await page.getByRole("tab", { name: "All" }).click();
      const card = page.getByRole("link", { name: GOAL });
      await expect(card).toBeVisible();
      await expect(card).toContainText("repaired");
      await expect(card).toContainText("1 checkpoint");
    }
  });

  test("declining the resume and skipping the backfill queues nothing, and both repos are still on Home", async ({ page }) => {
    await walkToMethod(page, fixture);

    await page.getByRole("button", { name: "No, use the Anthropic API instead" }).click();
    await expect(page.getByRole("heading", { name: "Extract with an API key" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run extraction" })).toBeDisabled();
    await page.getByRole("button", { name: "Skip backfill" }).click();
    await expect(page.getByRole("heading", { name: "Nothing was backfilled" })).toBeVisible();

    expect(await status(fixture.url)).toMatchObject({ total: 0, done: 0, failed: 0, running: 0 });
    expect(existsSync(fixture.callLog)).toBe(false);
    for (const repo of fixture.repos) {
      expect(existsSync(path.join(repo, ".workledger", "config.yaml"))).toBe(true);
      expect(sessionFiles(repo)).toEqual([]);
    }
    const repos = (await (await fetch(`${fixture.url}/api/repos`)).json()) as Array<{ path: string }>;
    expect(repos.map((repo) => repo.path).sort()).toEqual([...fixture.repos].sort());

    await page.getByRole("link", { name: "Go to home" }).click();
    // Reloaded on purpose: without a backfill no SSE frame arrives, and Home's repo list is
    // not re-read on the in-app navigation — it shows the empty state until a reload (#94).
    // The daemon already lists both repos (asserted above); this checks what Home renders from it.
    await page.reload();
    await expectHome(page, 0);
    await expect(page.getByRole("status").filter({ hasText: "Backfilled" })).toHaveCount(0);
  });
});
