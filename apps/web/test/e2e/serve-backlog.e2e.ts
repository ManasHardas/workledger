/**
 * End-to-end (#41): `workledger serve` over a temp copy of this repo's ledger, driven in Chromium.
 *
 * What makes this the E2E and not a bigger integration test: nothing here is faked. A real
 * `packages/cli/bin/workledger serve` process serves a real temp git repo through the real bundled
 * `apps/web`, a real browser clicks the real buttons, and the assertions are made against the
 * markdown files on disk — the ledger is the source of truth (CLAUDE.md), so a green UI that did
 * not change a file is a failure, not a pass.
 *
 * Opt-in. Without `WORKLEDGER_E2E=1` every test reports as skipped: the suite needs a built CLI
 * (`pnpm build`) and a downloaded Chromium (`pnpm exec playwright install chromium`), neither of
 * which CI provides.
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import type { ChildProcess } from "node:child_process";
import type { Page } from "@playwright/test";

/** Monorepo root — this file is `apps/web/test/e2e/`. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
/** The bin shim under test. Not `pnpm workledger`: the E2E runs what a user would run. */
const BIN = path.join(REPO_ROOT, "packages", "cli", "bin", "workledger");
/** The bundle the shim imports, and the built UI next to it. Both are `pnpm build` output. */
const BUNDLE = path.join(REPO_ROOT, "packages", "cli", "dist", "main.js");
const WEB_INDEX = path.join(REPO_ROOT, "packages", "cli", "dist", "web", "index.html");

/** The git identity the temp repo is given, which is what every human history stamp must say. */
const GIT_NAME = "Workledger E2E";
const GIT_EMAIL = "e2e@workledger.test";
/** The title typed into the inline editor. Plain ASCII, so YAML emits it unquoted. */
const NEW_TITLE = "Accepted and renamed by the end-to-end test";

const ENABLED = process.env["WORKLEDGER_E2E"] === "1";
const SKIP_REASON =
  "set WORKLEDGER_E2E=1 to run (needs `pnpm build` and `pnpm exec playwright install chromium`)";

// ---------------------------------------------------------------------------
// Fixture: a temp repo, a temp WORKLEDGER_HOME, and a real serve process
// ---------------------------------------------------------------------------

interface Serving {
  /** The temp git repo whose `.workledger/` is being served. */
  repo: string;
  /** The URL `serve` printed. */
  url: string;
  /** The repo's id from `GET /api/repos` (P8): every per-repo route lives under `#/r/<id>/`. */
  id: string;
  child: ChildProcess;
  /** Everything the process wrote, for a failure message worth reading. */
  log: () => string;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** The narrowest viewport the UI must fit without a horizontal scrollbar (#88, #89). */
const MOBILE_WIDTH = 375;
/** The path length the Health view is held to at that width (#89). */
const LONG_PATH = 90;

/**
 * A throwaway git repo holding a copy of this repo's own ledger.
 *
 * A copy rather than the repo itself because the test *writes*: it accepts and renames a backlog
 * item, and the ledger it does that to must not be one anybody is keeping.
 *
 * The path is padded to at least `LONG_PATH` characters so the Health view is served a repo path
 * that has to wrap at 375 px (#89) — a bare `tmpdir()` is shorter than that on macOS and Linux.
 */
function makeRepo(): string {
  let dir = mkdtempSync(path.join(tmpdir(), "workledger-e2e-"));
  while (dir.length < LONG_PATH) dir = path.join(dir, "a-long-directory-name");
  const repo = path.join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "--quiet", "--initial-branch=main", ".");
  git(repo, "config", "user.name", GIT_NAME);
  git(repo, "config", "user.email", GIT_EMAIL);
  cpSync(path.join(REPO_ROOT, ".workledger"), path.join(repo, ".workledger"), { recursive: true });
  return repo;
}

/** Start `serve` on `repo` and resolve once it has printed its URL. */
function startServer(repo: string): Promise<Serving> {
  const home = mkdtempSync(path.join(tmpdir(), "workledger-home-"));
  const child = spawn(process.execPath, [BIN, "serve", "--no-open", "--repo", repo], {
    cwd: REPO_ROOT,
    env: { ...process.env, WORKLEDGER_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const log = () => output;

  return new Promise<Serving>((resolve, reject) => {
    const fail = (why: string) => reject(new Error(`${why}\n--- serve output ---\n${output}`));
    const timer = setTimeout(() => fail("workledger serve printed no URL within 30s"), 30_000);
    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
      const found = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if (!found) return;
      clearTimeout(timer);
      const url = found[0];
      // `serve --repo` is single-repo mode, and `/api/repos` still lists that one repo.
      fetch(`${url}/api/repos`)
        .then((response) => response.json() as Promise<{ id: string }[]>)
        .then((repos) => {
          const id = repos[0]?.id;
          if (id === undefined) fail("GET /api/repos listed no repo");
          else resolve({ repo, url, id, child, log });
        }, (error: unknown) => fail(`GET /api/repos failed: ${String(error)}`));
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(`workledger serve could not start: ${error.message}`);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(`workledger serve exited early with code ${code}`);
    });
  });
}

async function stopServer(serving: Serving): Promise<void> {
  if (serving.child.exitCode !== null || serving.child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    serving.child.once("exit", () => resolve());
    serving.child.kill("SIGINT");
    setTimeout(() => {
      serving.child.kill("SIGKILL");
      resolve();
    }, 5_000).unref?.();
  });
}

// ---------------------------------------------------------------------------
// Reading the ledger the test is asserting against
// ---------------------------------------------------------------------------

/** The `--- … ---` block at the top of a ledger file. */
function frontmatterOf(text: string): string {
  const end = text.indexOf("\n---", 4);
  return end < 0 ? text : text.slice(0, end + 4);
}

function field(text: string, name: string): string | undefined {
  return new RegExp(`^${name}: (.*)$`, "m").exec(frontmatterOf(text))?.[1];
}

/** Every backlog file in the served repo, as `{ id, path, text }`. */
function backlogFiles(repo: string): { id: string; file: string; text: string }[] {
  const dir = path.join(repo, ".workledger", "backlog");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      return { id: name.replace(/\.md$/, ""), file, text: readFileSync(file, "utf8") };
    });
}

/** The `## Goal` lines of every session file, `- [cp N] ` prefix stripped. */
function sessionGoals(repo: string): string[] {
  const dir = path.join(repo, ".workledger", "sessions");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => readFileSync(path.join(dir, name), "utf8"))
    .map((text) => /^## Goal\n(?:- \[cp \d+\] )(.*)$/m.exec(text)?.[1] ?? "")
    .filter((goal) => goal !== "");
}

/**
 * The history entries stamped with a human `by` — the only ones a UI edit may produce.
 *
 * An agent-originated entry carries `session:`/`checkpoint:` instead (design spec §4.2), so
 * matching on `name:`/`email:` under `by:` is what separates "a human did this" from "a checkpoint
 * did this" without parsing the whole document.
 */
function humanHistory(text: string): { op: string; diff: string }[] {
  const entry = /^ {4}by:\n {6}name: (.*)\n {6}email: (.*)\n {4}op: (.*)\n {4}diff: (.*)$/gm;
  const found: { op: string; diff: string }[] = [];
  for (const match of frontmatterOf(text).matchAll(entry)) {
    expect(match[1], "history entry is stamped with the temp repo's git user").toBe(GIT_NAME);
    expect(match[2], "history entry is stamped with the temp repo's git email").toBe(GIT_EMAIL);
    found.push({ op: match[3] ?? "", diff: match[4] ?? "" });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

/** Console errors and uncaught exceptions, collected from the moment a page is created. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** The page's full layout width — anything past the viewport is a horizontal scrollbar. */
function scrollWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth);
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

test.describe("workledger serve, end to end", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!ENABLED, SKIP_REASON);

  let serving: Serving;
  /** The item the test accepts and renames, as it looked before the browser touched it. */
  let target: { id: string; file: string; title: string };

  test.beforeAll(async () => {
    expect(existsSync(BUNDLE), `${BUNDLE} is missing — run \`pnpm build\` first`).toBe(true);
    expect(existsSync(WEB_INDEX), `${WEB_INDEX} is missing — run \`pnpm build\` first`).toBe(true);
    const repo = makeRepo();
    serving = await startServer(repo);
    const proposed = backlogFiles(repo).find((item) => field(item.text, "status") === "proposed");
    expect(proposed, "the copied ledger has a proposed backlog item to accept").toBeDefined();
    target = {
      id: proposed!.id,
      file: proposed!.file,
      title: field(proposed!.text, "title") ?? "",
    };
  });

  test.afterAll(async () => {
    if (serving) await stopServer(serving);
  });

  test("Home lists the served repo and links into its Ledger; #/ledger redirects there", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto(`${serving.url}/#/`);
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    const card = page.getByRole("list", { name: "Projects" }).getByRole("link", { name: "repo" });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("href", `#/r/${serving.id}/ledger`);
    await expect(card.getByText(serving.repo)).toBeVisible();
    await expect(page.getByRole("link", { name: "Add projects" })).toHaveAttribute("href", "#/onboarding");

    // The P2 route is redirected to the first (here: only) repo without a history entry.
    await page.goto(`${serving.url}/#/ledger`);
    await expect(page).toHaveURL(`${serving.url}/#/r/${serving.id}/ledger`);
    await expect(page.getByRole("combobox", { name: "Project" })).toHaveValue(serving.id);
    expect(errors, "no console errors on Home").toEqual([]);
  });

  test("Ledger lists the three sessions with their goals", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`${serving.url}/#/r/${serving.id}/ledger`);

    // "Open" is the default tab and every copied session has ended, so the scope has to be All.
    await page.getByRole("tab", { name: "All" }).click();

    const cards = page.getByRole("list", { name: "Sessions, newest first" }).getByRole("listitem");
    await expect(cards).toHaveCount(3);

    const goals = sessionGoals(serving.repo);
    expect(goals, "three session files, three goals").toHaveLength(3);
    for (const goal of goals) {
      await expect(page.getByRole("heading", { name: goal, exact: true })).toBeVisible();
    }
    expect(errors, "no console errors on Ledger").toEqual([]);
  });

  test("Accept + inline rename writes the file, and a second tab sees it live", async ({
    context,
  }) => {
    const editor = await context.newPage();
    const editorErrors = watchConsole(editor);
    await editor.goto(`${serving.url}/#/r/${serving.id}/next`);

    const item = () => editor.getByRole("listitem", { name: target.title, exact: true });
    await expect(item(), "the proposed item is on Next").toBeVisible();

    // The watcher tab is opened and settled *before* the write, so the 2 s budget below measures
    // the SSE stream and nothing else.
    const watcher = await context.newPage();
    const watcherErrors = watchConsole(watcher);
    await watcher.goto(`${serving.url}/#/r/${serving.id}/next`);
    await expect(watcher.getByRole("listitem", { name: target.title, exact: true })).toBeVisible();

    await test.step("Accept moves the item into the Accepted group", async () => {
      await item().getByRole("button", { name: "Accept", exact: true }).click();
      await expect(
        editor.getByRole("list", { name: "Accepted" }).getByRole("listitem", {
          name: target.title,
          exact: true,
        }),
      ).toBeVisible();
    });

    await test.step("Edit renames the item in place", async () => {
      await item().getByRole("button", { name: "Edit", exact: true }).click();
      const title = item().getByRole("textbox", { name: "Title" });
      await expect(title).toHaveValue(target.title);
      await title.fill(NEW_TITLE);
      await item().getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        editor.getByRole("listitem", { name: NEW_TITLE, exact: true }),
        "the renamed card is on Next",
      ).toBeVisible();
    });

    await test.step("the second tab converges within 2 s, without a reload", async () => {
      await expect(
        watcher.getByRole("listitem", { name: NEW_TITLE, exact: true }),
        "the untouched tab shows the rename over SSE",
      ).toBeVisible({ timeout: 2_000 });
    });

    await test.step("the file under .workledger/backlog/ is what changed", async () => {
      // The UI paints optimistically and the two writes land as two separate POSTs, so poll for
      // the *last* of them rather than reading once: a single read can catch the file between
      // `accept` and `edit` and see an accepted item that still has its old title.
      await expect
        .poll(
          () => {
            const current = readFileSync(target.file, "utf8");
            return `${field(current, "status")} / ${field(current, "title")}`;
          },
          { timeout: 10_000 },
        )
        .toBe(`accepted / ${NEW_TITLE}`);

      const text = readFileSync(target.file, "utf8");
      expect(
        frontmatterOf(text),
        "confirmed_by names the human who accepted it",
      ).toMatch(
        new RegExp(`^confirmed_by:\\n  name: ${GIT_NAME}\\n  email: ${GIT_EMAIL}\\n  at: .+$`, "m"),
      );

      const history = humanHistory(text);
      expect(history.length, "at least two history entries by the git user").toBeGreaterThanOrEqual(
        2,
      );
      expect(
        history.some((e) => e.op === "status" && e.diff.includes("proposed → accepted")),
        "a history entry records proposed → accepted",
      ).toBe(true);
      expect(
        history.some((e) => e.op === "edit" && e.diff.includes(NEW_TITLE)),
        "a history entry records the title change",
      ).toBe(true);
    });

    expect(editorErrors, "no console errors on Next (editing tab)").toEqual([]);
    expect(watcherErrors, "no console errors on Next (watching tab)").toEqual([]);
    await watcher.close();
    await editor.close();
  });

  test("Needs you renders without console errors, per repo and machine-wide", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`${serving.url}/#/r/${serving.id}/needs`);
    await expect(page.getByRole("heading", { name: "Needs you", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);

    await page.goto(`${serving.url}/#/needs`);
    await expect(page.getByText("Across every project on this machine.")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(errors, "no console errors on Needs you").toEqual([]);
  });

  test("Health renders without console errors", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`${serving.url}/#/r/${serving.id}/health`);
    await expect(page.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
    await expect(page.getByText("claude-code").first()).toBeVisible();
    expect(errors, "no console errors on Health").toEqual([]);
  });

  test("Next fits a 375 px viewport with the fixture backlog (#88)", async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: 812 });
    await page.goto(`${serving.url}/#/r/${serving.id}/next`);
    await expect(page.getByRole("heading", { name: "Next", exact: true })).toBeVisible();
    // The list, not just the heading: the overflow was the cards' merge/rank controls.
    await expect(page.getByRole("listitem").first()).toBeVisible();
    expect(await scrollWidth(page), "Next does not scroll horizontally").toBeLessThanOrEqual(
      MOBILE_WIDTH,
    );
  });

  test("Health fits a 375 px viewport with a long repo path (#89)", async ({ page }) => {
    expect(serving.repo.length, "the fixture repo path is long").toBeGreaterThanOrEqual(LONG_PATH);
    await page.setViewportSize({ width: MOBILE_WIDTH, height: 812 });
    await page.goto(`${serving.url}/#/r/${serving.id}/health`);
    const heading = page.getByRole("heading", { name: serving.repo, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading, "the full path is in the title attribute").toHaveAttribute(
      "title",
      serving.repo,
    );
    expect(await scrollWidth(page), "Health does not scroll horizontally").toBeLessThanOrEqual(
      MOBILE_WIDTH,
    );
  });
});
