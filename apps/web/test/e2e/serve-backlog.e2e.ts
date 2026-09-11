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
/** The three widths the shell is judged at (docs/design/direction.md §Shell). */
const TABLET_WIDTH = 768;
const DESKTOP_WIDTH = 1280;
/** Where the PR's screenshots are written, when the operator asks for them. */
const SHOTS = process.env["WORKLEDGER_SHOTS_DIR"];
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

/** A YAML scalar as a plain string: `backlog propose` quotes a title only when it has to. */
function unquote(value: string): string {
  return /^"(.*)"$/.exec(value)?.[1]?.replace(/\\"/g, '"') ?? value;
}

/**
 * The titles of one status group in the order the files put them in — `rank` ascending, then most
 * recently `updated` first, which is `compareItems` in `features/next/backlog-model.ts` and the
 * order `/api/backlog` returns. This is the claim a reorder has to move: the paint is not the
 * ledger (CLAUDE.md).
 */
function backlogOrder(repo: string, status: string): string[] {
  return backlogFiles(repo)
    .filter((file) => field(file.text, "status") === status)
    .map((file) => ({
      title: unquote(field(file.text, "title") ?? ""),
      rank: Number(field(file.text, "rank") ?? "0"),
      updated: field(file.text, "updated") ?? "",
    }))
    .sort((a, b) => (a.rank === b.rank ? b.updated.localeCompare(a.updated) : a.rank - b.rank))
    .map((row) => row.title);
}

/** Every session file in the ledger. */
function sessionFiles(repo: string): string[] {
  return readdirSync(path.join(repo, ".workledger", "sessions")).filter((name) => name.endsWith(".md"));
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
    // Home is a status overview now, not a second copy of the nav (#134): its title is Overview
    // and Projects is one of its groups.
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    const row = page.getByRole("list", { name: "Projects" }).getByRole("listitem", { name: "repo" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: "repo", exact: true })).toHaveAttribute(
      "href",
      `#/r/${serving.id}/ledger`,
    );
    // Rule 4: every count on the row is a link to the view that counts it.
    await expect(row.getByRole("link", { name: /open backlog$/ })).toHaveAttribute(
      "href",
      `#/r/${serving.id}/next`,
    );
    await expect(row.getByRole("link", { name: /open notes$/ })).toHaveAttribute(
      "href",
      `#/r/${serving.id}/needs`,
    );
    await expect(row.getByText(serving.repo)).toBeVisible();
    // Scoped to the middle pane: the left nav carries its own "Add projects" at the bottom
    // (docs/design/direction.md §Shell).
    await expect(page.getByRole("main").getByRole("link", { name: "Add projects" })).toHaveAttribute(
      "href",
      "#/onboarding",
    );

    // The P2 route is redirected to the first (here: only) repo without a history entry.
    await page.goto(`${serving.url}/#/ledger`);
    await expect(page).toHaveURL(`${serving.url}/#/r/${serving.id}/ledger`);
    // The switcher is the nav's filterable button now, not a `<select>`; its accessible name is
    // the project it currently holds.
    await expect(page.getByRole("button", { name: "Project: repo" })).toBeVisible();
    expect(errors, "no console errors on Home").toEqual([]);
  });

  test("Ledger lists every session with its goal, in one list with no tabs", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`${serving.url}/#/r/${serving.id}/ledger`);

    // Amendment 11: no Open/All tabs, so every copied session is listed straight away.
    await expect(page.getByRole("tab")).toHaveCount(0);

    // The dogfood ledger grows a session every time this repo records one, so both counts come
    // from the files on disk rather than numbers frozen when the test was written. A card per
    // session file; a heading per session that got as far as a goal (a backfilled row that never
    // checkpointed has an empty `## Goal`).
    const files = sessionFiles(serving.repo);
    const goals = sessionGoals(serving.repo);
    expect(files.length, "at least one session file").toBeGreaterThan(0);
    expect(goals.length, "at least one goal").toBeGreaterThan(0);

    const cards = page.getByRole("list", { name: "Sessions, open first then newest first" }).getByRole("listitem");
    await expect(cards).toHaveCount(files.length);

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

  /**
   * #138: drag-and-drop was the only way to rank, so a keyboard operator could not reorder at all.
   * Nothing here touches the mouse — `j` selects, `Alt+ArrowDown` moves — and the assertion is the
   * order the *files* define, not the order the list happens to be painting.
   */
  test("the backlog reorders from the keyboard alone, and the files say so", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`${serving.url}/#/r/${serving.id}/next`);

    const rows = page.getByRole("list", { name: "Proposed" }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    const before = (await rows.evaluateAll((items) =>
      items.map((row) => row.getAttribute("aria-label") ?? ""),
    )) as string[];
    expect(before.length, "the copied ledger has a proposed group to reorder").toBeGreaterThanOrEqual(2);

    // Proposed is the first group, so one `j` from a cold page selects its first row.
    await page.keyboard.press("j");
    await expect(rows.first()).toHaveAttribute("data-selected", "");
    await page.keyboard.press("Alt+ArrowDown");

    const moved = [before[1], before[0], ...before.slice(2)];
    await expect(
      page.getByRole("main").getByRole("status"),
      "the move is announced, not only painted",
    ).toHaveText(`${before[0] ?? ""} moved to 2 of ${String(before.length)} in Proposed.`);
    await expect
      .poll(() => backlogOrder(serving.repo, "proposed"), { timeout: 15_000 })
      .toEqual(moved);

    // It survives a reload, which is the whole point of writing `rank` to the files.
    await page.reload();
    await expect(
      page.getByRole("list", { name: "Proposed" }).getByRole("listitem").first(),
    ).toHaveAttribute("aria-label", moved[0] ?? "");
    expect(errors, "no console errors while reordering").toEqual([]);
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
    // The repo is the page's subject line now, not a card title: the rows are the readings (#134).
    const subject = page.getByTitle(serving.repo);
    await expect(subject).toBeVisible();
    await expect(subject).toHaveText(serving.repo);
    expect(await scrollWidth(page), "Health does not scroll horizontally").toBeLessThanOrEqual(
      MOBILE_WIDTH,
    );
  });

  /**
   * The acceptance criterion of #134, measured rather than inferred: each of the five views, in a
   * real browser, at 375 px and at 1280 px, with `scrollWidth` no wider than the viewport — and a
   * screenshot of each, dark and light, for the PR.
   */
  test("the five views hold 375 px and 1280 px with no sideways scroll", async ({ page }) => {
    const views = [
      { name: "home", href: "#/", settled: "Projects" },
      { name: "next", href: `#/r/${serving.id}/next`, settled: "Next" },
      { name: "needs", href: `#/r/${serving.id}/needs`, settled: "Needs you" },
      { name: "jobs", href: `#/r/${serving.id}/jobs`, settled: "Jobs" },
      { name: "health", href: `#/r/${serving.id}/health`, settled: "Harnesses" },
    ] as const;

    for (const [width, height] of [[MOBILE_WIDTH, 812], [DESKTOP_WIDTH, 900]] as const) {
      await page.setViewportSize({ width, height });
      for (const view of views) {
        await page.goto(`${serving.url}/${view.href}`);
        // Settled before measuring: a list still loading is narrower than the one that follows it,
        // and a screenshot taken over "Loading…" shows nothing worth looking at.
        await expect(
          page.getByRole("heading", { name: view.settled, exact: true }).first(),
        ).toBeVisible();
        await expect(page.getByRole("main").getByText("Loading…")).toHaveCount(0);
        await expect
          .poll(() => scrollWidth(page), {
            message: `${view.name} does not scroll horizontally at ${String(width)} px`,
          })
          .toBeLessThanOrEqual(width);
        await shot(page, `${view.name}-${String(width)}`);
      }
    }
  });

  // -------------------------------------------------------------------------
  // The shell (#128): left nav, middle pane, floating right panel
  // -------------------------------------------------------------------------

  /** A screenshot for the PR, in both themes, when `WORKLEDGER_SHOTS_DIR` is set. */
  async function shot(page: Page, name: string): Promise<void> {
    if (SHOTS === undefined) return;
    mkdirSync(SHOTS, { recursive: true });
    for (const scheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // The theme swap repaints through `transition-colors`, so a shot taken on the same tick
      // catches half the page in the theme it just left.
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: null });
  }

  /** The route of the first session that got as far as a goal — the one with Done items to open. */
  async function openFirstSession(page: Page): Promise<void> {
    await page.goto(`${serving.url}/#/r/${serving.id}/ledger`);
    await page
      .getByRole("list", { name: "Sessions, open first then newest first" })
      .getByRole("link")
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Session", exact: true })).toBeVisible();
  }

  test("the left nav is a fixed column at 1280 px and a sheet below 900 px", async ({ page }) => {
    await page.setViewportSize({ width: DESKTOP_WIDTH, height: 900 });
    await page.goto(`${serving.url}/#/r/${serving.id}/ledger`);

    const nav = page.getByRole("navigation", { name: "Views" });
    await expect(nav).toBeVisible();
    // 240 px, per direction.md §Shell.
    expect((await nav.boundingBox())?.width).toBeLessThanOrEqual(240);
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    // The switcher, the counts and the folders all live in it.
    await expect(page.getByRole("button", { name: "Project: repo" })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Ledger/ })).toBeVisible();
    await shot(page, "session-1280");

    // Below 900 px the nav is swapped for a sheet, not merely hidden: there is one nav, and it is
    // behind the hamburger.
    await page.setViewportSize({ width: TABLET_WIDTH, height: 900 });
    await expect(page.getByRole("navigation", { name: "Views" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Views" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Project: repo" })).toBeVisible();
    // A modal sheet needs a control a thumb can find; the overlay strip is 57 px at 375 px.
    await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Views" })).toHaveCount(0);

    // Picking a view navigates *and* closes the sheet, at both narrow widths: a sheet left up over
    // the new route leaves the document `aria-hidden` and focus inside it (#132 review).
    for (const width of [TABLET_WIDTH, MOBILE_WIDTH]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`${serving.url}/#/r/${serving.id}/ledger`);
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page
        .getByRole("navigation", { name: "Views" })
        .getByRole("link", { name: /^Jobs/ })
        .click();
      await expect(page).toHaveURL(`${serving.url}/#/r/${serving.id}/jobs`);
      await expect(page.getByRole("navigation", { name: "Views" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
      // Nothing behind it is still hidden from assistive technology.
      expect(await page.locator("[data-aria-hidden]").count()).toBe(0);
    }
  });

  test("the right pane is a floating inset panel on desktop and a bottom sheet at 375 px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: DESKTOP_WIDTH, height: 900 });
    await openFirstSession(page);

    // A Done gist, not the switcher or Repair: those open dialogs too, and neither is a list row.
    const done = page.getByRole("main").locator("li button[aria-haspopup='dialog']");
    await done.first().click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-variant", "panel");

    // Floating and inset: 380 px wide, 12 px off the top, the right and the bottom — never a
    // full-height drawer.
    const box = (await panel.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.round(box.width)).toBe(380);
    expect(Math.round(box.y)).toBe(12);
    expect(Math.round(viewport.width - (box.x + box.width))).toBe(12);
    expect(Math.round(viewport.height - (box.y + box.height))).toBe(12);
    // Its own header, with a close control.
    await expect(panel.getByRole("button", { name: "Close panel" })).toBeVisible();
    // Non-modal: the middle pane behind it is still reachable, so the ledger link still navigates.
    await expect(page.getByRole("link", { name: "← All sessions" })).toBeVisible();
    await shot(page, "session-panel-1280");
    // The middle pane made room for it rather than being covered: its right edge stops short of
    // the panel's left edge.
    const paneRight = await page.evaluate(() => {
      const main = document.querySelector("main");
      return main === null ? 0 : main.getBoundingClientRect().right;
    });
    expect(paneRight).toBeLessThanOrEqual(box.x);

    // Escape closes it and focus goes back to the item that opened it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Polled: Radix restores focus as the content unmounts, which is a frame after the dialog is
    // gone from the tree.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup")))
      .toBe("dialog");

    // At 375 px the same control is a modal bottom sheet, and nothing scrolls sideways.
    await page.setViewportSize({ width: MOBILE_WIDTH, height: 812 });
    // The session itself fits first — the meta line carries absolute paths (rule 5). Polled: the
    // resize relayouts a frame after `setViewportSize` returns.
    await expect
      .poll(() => scrollWidth(page), { message: "the session fits 375 px before the panel" })
      .toBeLessThanOrEqual(MOBILE_WIDTH);
    await page.getByRole("main").locator("li button[aria-haspopup='dialog']").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toHaveAttribute("data-variant", "sheet");
    const sheetBox = (await sheet.boundingBox())!;
    expect(Math.round(sheetBox.width)).toBe(MOBILE_WIDTH);
    expect(sheetBox.height).toBeLessThanOrEqual(812 * 0.86);
    expect(await scrollWidth(page), "the session does not scroll horizontally").toBeLessThanOrEqual(
      MOBILE_WIDTH,
    );
    await shot(page, "session-panel-375");
  });

  test("Home holds the tablet width between the two the design is judged at", async ({ page }) => {
    await page.setViewportSize({ width: TABLET_WIDTH, height: 900 });
    await page.goto(`${serving.url}/#/`);
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    // Shot after the rows are in, not while the first read is still in flight.
    await expect(
      page.getByRole("list", { name: "Projects" }).getByRole("listitem"),
    ).toHaveCount(1);
    expect(await scrollWidth(page), "Home does not scroll horizontally at 768 px").toBeLessThanOrEqual(
      TABLET_WIDTH,
    );
    await shot(page, "home-768");
  });
});
