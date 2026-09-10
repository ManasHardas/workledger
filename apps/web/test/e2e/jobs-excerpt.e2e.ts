/**
 * End-to-end (#56): the Jobs view and the provenance excerpt viewer, in Chromium, against a real
 * `workledger serve`.
 *
 * Nothing here is faked, and in particular the *ledger* is not: the fixture is built by running
 * the real `workledger hook SessionStart`, `workledger checkpoint` and `workledger scan` against a
 * throwaway repo and a throwaway `WORKLEDGER_HOME`, so the index rows the excerpt route reads and
 * the job row the queue lists were written by the CLI rather than by this file. The transcript is
 * a real `.jsonl` on disk, and the span the viewer renders is read out of it by byte offset.
 *
 * The orphan is manufactured the way the contract says one occurs (cli.md §scan): a session that
 * is still `open` whose transcript has not been touched for longer than `orphan_minutes`. The
 * queued repair is then *cancelled* from the UI rather than left to run — a real repair would
 * spawn the harness, and this test has no business doing that.
 *
 * Opt-in, like its sibling: without `WORKLEDGER_E2E=1` every test reports as skipped.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import type { ChildProcess } from "node:child_process";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BIN = path.join(REPO_ROOT, "packages", "cli", "bin", "workledger");
const BUNDLE = path.join(REPO_ROOT, "packages", "cli", "dist", "main.js");
const WEB_INDEX = path.join(REPO_ROOT, "packages", "cli", "dist", "web", "index.html");

const ENABLED = process.env["WORKLEDGER_E2E"] === "1";
const SKIP_REASON =
  "set WORKLEDGER_E2E=1 to run (needs `pnpm build` and `pnpm exec playwright install chromium`)";

/** The goal recorded on the healthy session, and the turn text its transcript span must contain. */
const GOAL = "Debounce the workledger file watcher";
const USER_TURN = "Debounce the watcher at 100 ms";
const ASSISTANT_TURN = "Done - the watcher coalesces writes.";

interface Fixture {
  repo: string;
  home: string;
  url: string;
  child: ChildProcess;
  /** The session that has a checkpoint, and therefore a transcript span. */
  healthy: string;
  /** The session `scan` marked `crashed`, and the repair job it queued. */
  orphan: string;
  log: () => string;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** Run the built CLI in `repo` against the throwaway home, with `stdin` piped in. */
function cli(repo: string, home: string, args: string[], stdin = ""): string {
  return execFileSync(process.execPath, [BIN, ...args], {
    cwd: repo,
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, WORKLEDGER_HOME: home },
  });
}

/** A `SessionStart` payload in Claude Code's recorded shape (`test/fixtures/hooks/`). */
function sessionStart(repo: string, home: string, id: string, transcript: string): string {
  const event = {
    session_id: id,
    transcript_path: transcript,
    cwd: repo,
    hook_event_name: "SessionStart",
    source: "startup",
    model: "claude-opus-4-6-20260401",
    permission_mode: "default",
  };
  const out = cli(repo, home, ["hook", "SessionStart"], JSON.stringify(event));
  const ulid = /workledger session ([0-9A-HJKMNP-TV-Z]{26})/.exec(out)?.[1];
  if (ulid === undefined) throw new Error(`hook SessionStart printed no ulid:\n${out}`);
  return ulid;
}

/**
 * A throwaway repo with two sessions: one checkpointed, one orphaned and scanned.
 *
 * `.workledger/` is copied from this repo so the temp repo is *enabled* (that is the whole of
 * `isEnabled`), and everything after that is written by the CLI.
 */
function makeFixture(): { repo: string; home: string; healthy: string; orphan: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "workledger-jobs-e2e-"));
  const repo = path.join(dir, "repo");
  const home = path.join(dir, "home");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "--quiet", "--initial-branch=main", ".");
  git(repo, "config", "user.name", "Workledger E2E");
  git(repo, "config", "user.email", "e2e@workledger.test");
  cpSync(path.join(REPO_ROOT, ".workledger"), path.join(repo, ".workledger"), { recursive: true });

  const live = path.join(dir, "live.jsonl");
  writeFileSync(
    live,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: USER_TURN } }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: ASSISTANT_TURN },
            { type: "tool_use", name: "Bash", input: {} },
          ],
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  );
  const healthy = sessionStart(repo, home, "e2e-live-0001", live);
  cli(repo, home, ["checkpoint", "--session", healthy], JSON.stringify({ goal: GOAL }));

  // The orphan: still `open`, transcript untouched for two hours — cli.md §scan's definition.
  const stale = path.join(dir, "stale.jsonl");
  writeFileSync(stale, `${JSON.stringify({ type: "user", message: { role: "user", content: "orphan" } })}\n`, "utf8");
  const orphan = sessionStart(repo, home, "e2e-orphan-0002", stale);
  const longAgo = (Date.now() - 2 * 60 * 60_000) / 1000;
  utimesSync(stale, longAgo, longAgo);
  const scan = cli(repo, home, ["scan", "--repo", repo]);
  expect(scan, "the CLI scan queued exactly the one repair").toContain("1 repair job queued");

  return { repo, home, healthy, orphan };
}

function startServer(repo: string, home: string): Promise<{ url: string; child: ChildProcess; log: () => string }> {
  const child = spawn(process.execPath, [BIN, "serve", "--no-open", "--repo", repo], {
    cwd: REPO_ROOT,
    env: { ...process.env, WORKLEDGER_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const log = () => output;
  return new Promise((resolve, reject) => {
    const fail = (why: string) => reject(new Error(`${why}\n--- serve output ---\n${output}`));
    const timer = setTimeout(() => fail("workledger serve printed no URL within 30s"), 30_000);
    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
      const found = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if (!found) return;
      clearTimeout(timer);
      resolve({ url: found[0], child, log });
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(`workledger serve could not start: ${error.message}`);
    });
  });
}

/** The `status:` line of the orphan's session file — the ledger, which is the source of truth. */
function sessionStatus(repo: string, ulid: string): string {
  const file = path.join(repo, ".workledger", "sessions", `${ulid}.md`);
  return /^status: (.*)$/m.exec(readFileSync(file, "utf8"))?.[1] ?? "";
}

test.describe("Jobs and the provenance excerpt viewer, end to end", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!ENABLED, SKIP_REASON);

  let fixture: Fixture;

  test.beforeAll(async () => {
    expect(existsSync(BUNDLE), `${BUNDLE} is missing — run \`pnpm build\` first`).toBe(true);
    expect(existsSync(WEB_INDEX), `${WEB_INDEX} is missing — run \`pnpm build\` first`).toBe(true);
    const built = makeFixture();
    const serving = await startServer(built.repo, built.home);
    fixture = { ...built, ...serving };
    // The scan the fixture ran is the one that wrote the orphan's status; assert it here so a
    // later UI failure cannot be mistaken for a setup that never produced a crashed session.
    expect(sessionStatus(built.repo, built.orphan)).toBe("crashed");
    expect(readdirSync(path.join(built.repo, ".workledger", "sessions")).length).toBeGreaterThan(2);
  });

  test.afterAll(async () => {
    if (!fixture?.child) return;
    await new Promise<void>((resolve) => {
      fixture.child.once("exit", () => resolve());
      fixture.child.kill("SIGINT");
      setTimeout(() => {
        fixture.child.kill("SIGKILL");
        resolve();
      }, 5_000).unref?.();
    });
  });

  test("Jobs lists the queued repair, scans on demand, and cancels a job", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`${fixture.url}/#/jobs`);
    await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();

    const row = page.getByRole("list", { name: "Jobs, newest first" }).getByRole("listitem").first();
    await expect(row).toContainText("repair");
    await expect(row).toContainText("queued");
    await expect(row.getByRole("link", { name: fixture.orphan })).toBeVisible();

    await test.step("Scan now reports its counts", async () => {
      // The orphan is already `crashed`, so a second sweep finds nothing — which is the number
      // the contract promises, not an absence of one.
      await page.getByRole("button", { name: "Scan now" }).click();
      await expect(page.getByText(/Scan found 0 orphans and queued 0 repairs\./)).toBeVisible();
    });

    await test.step("Cancel moves the job to cancelled", async () => {
      await row.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(row).toContainText("cancelled");
      await expect(row.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
    });

    expect(errors, "no console errors on Jobs").toEqual([]);
  });

  test("the provenance panel shows the real transcript span for a checkpoint", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`${fixture.url}/#/ledger/${fixture.healthy}`);
    await expect(page.getByText(GOAL)).toBeVisible();

    const checkpoint = page
      .getByRole("list", { name: "Checkpoints, oldest first" })
      .getByRole("listitem")
      .first();
    const toggle = checkpoint.getByRole("button", { name: "Show transcript span" });

    // Nothing is read until it is asked for.
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();

    const turns = checkpoint.getByRole("list", { name: /Transcript span for checkpoint 1/ });
    await expect(turns.getByRole("listitem")).toHaveCount(2);
    await expect(turns).toContainText(USER_TURN);
    await expect(turns).toContainText(ASSISTANT_TURN);
    // The tool call is counted, never rendered: no `input` from the transcript reaches the page.
    await expect(turns).toContainText("1 tool call");
    await expect(checkpoint).toContainText(/bytes 0–\d/);
    await expect(page.locator("body")).not.toContainText("tool_use");

    // The control names its own next action, and the keyboard alone closes it again.
    const hide = checkpoint.getByRole("button", { name: "Hide transcript span" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await hide.focus();
    await page.keyboard.press("Enter");
    await expect(turns).toHaveCount(0);
    await expect(checkpoint.getByRole("button", { name: "Show transcript span" })).toBeFocused();

    expect(errors, "no console errors on the session detail").toEqual([]);
  });
});
