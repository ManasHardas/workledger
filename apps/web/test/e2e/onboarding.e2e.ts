/**
 * End-to-end (#79): the onboarding wizard, in Chromium, against a fixture daemon.
 *
 * Unlike its two siblings this one does not run the real `workledger serve`: the real wizard
 * scaffolds hook files into the operator's repos and resumes their sessions in a child harness,
 * neither of which a test may do to the machine it runs on. What is real is the *bundle* — the
 * `dist/web` that `workledger serve` ships, served by a small Node server that answers the
 * `/api/*` routes of docs/contracts/p8/daemon-and-api.md with canned bodies and drives the
 * backfill's `job.changed` stream on a timer. The test walks all five steps, leaves for Home,
 * and reads the banner; a second pass at 375 px asserts the page never scrolls sideways.
 *
 * `WORKLEDGER_SHOTS_DIR` (optional) is where the PR's screenshots are written.
 *
 * Opt-in, like its siblings: without `WORKLEDGER_E2E=1` every test reports as skipped.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Page } from "@playwright/test";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const WEB_DIST = path.join(REPO_ROOT, "packages", "cli", "dist", "web");
const WEB_INDEX = path.join(WEB_DIST, "index.html");

const ENABLED = process.env["WORKLEDGER_E2E"] === "1";
const SKIP_REASON = "set WORKLEDGER_E2E=1 to run (needs `pnpm build` and `pnpm exec playwright install chromium`)";
const SHOTS = process.env["WORKLEDGER_SHOTS_DIR"];

// ---------------------------------------------------------------------------
// The fixture daemon
// ---------------------------------------------------------------------------

const PROJECTS = "/Users/op/Projects";
const ALPHA = `${PROJECTS}/alpha`;
const BETA = `${PROJECTS}/beta`;
const GAMMA = `${PROJECTS}/gamma`;

interface FixtureJob {
  id: string;
  repo_path: string;
  status: "queued" | "running" | "done" | "failed";
}

interface Daemon {
  url: string;
  server: Server;
  /** Every `/api` request, method and path, for assertions on what the wizard sent. */
  requests: string[];
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".map": "application/json",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length === 0 ? {} : (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
}

function repoId(root: string): string {
  return root.split("/").pop()!.padEnd(12, "0");
}

async function startDaemon(): Promise<Daemon> {
  const requests: string[] = [];
  const enabled = new Set<string>();
  const jobs: FixtureJob[] = [];
  const streams = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | undefined;

  const emit = (event: string, data: unknown) => {
    for (const stream of streams) stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const status = () => {
    const done = jobs.filter((j) => j.status === "done").length;
    const failed = jobs.filter((j) => j.status === "failed").length;
    const running = jobs.length - done - failed;
    return { total: jobs.length, done, failed, running, waiting: 0, retryAfter: null, complete: running === 0 };
  };
  const repo = (root: string) => ({
    id: repoId(root),
    path: root,
    name: root.split("/").pop(),
    enabled: true,
    harnesses: root === BETA ? ["codex"] : ["claude-code"],
    sessions7d: 0,
    openBacklog: 0,
    openNotes: 0,
    lastHookAt: null,
    health: "ok",
  });
  const candidate = (root: string, sessions: Record<string, number>, suggested = true) => ({
    path: root,
    name: root.split("/").pop(),
    hasGit: suggested,
    enabled: enabled.has(root),
    suggested,
    harnessSessions: sessions,
    lastSessionAt: Object.keys(sessions).length === 0 ? null : "2026-09-09T08:02:00Z",
  });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        requests.push(`${req.method ?? "GET"} ${url.pathname}${url.search}`);
        switch (`${req.method ?? "GET"} ${url.pathname}`) {
          case "GET /api/repos":
            return json(res, 200, [...enabled].sort().map(repo));
          case "GET /api/health":
            return json(res, 200, { cli: "e2e", repo: null, harnesses: [], index: { path: "", bytes: 0, openSessions: 0 }, config: { valid: true, problems: [] }, lastHookAt: null, repos: [...enabled].map(repo) });
          case "GET /api/notes/all":
            return json(res, 200, []);
          case "GET /api/jobs/all":
            return json(res, 200, jobs.map((j) => ({ ...j, kind: "backfill", session_ulid: "01JBQ4Z8W2K7N3RQ9XMDT5V0AE", attempts: 1, created_at: "2026-09-09T09:00:00.000Z", started_at: null, finished_at: null, heartbeat_at: null, error: null, cost_estimate_usd: null, log_path: null, error_code: null, retry_after: null, repo: repo(j.repo_path) })));
          case "GET /api/events":
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
            res.write(": open\n\n");
            streams.add(res);
            req.on("close", () => streams.delete(res));
            return;
          case "GET /api/onboarding/discover": {
            const roots = url.searchParams.get("roots")?.split(",") ?? [PROJECTS];
            return json(res, 200, {
              known: [candidate(ALPHA, { "claude-code": 5 }), candidate(BETA, { codex: 2 }), candidate(PROJECTS, { "claude-code": 1 }, false)],
              found: [candidate(GAMMA, {}), ...roots.filter((r) => r !== PROJECTS).map((r) => candidate(`${r}/delta`, {}))],
              roots,
              workspaces: [],
            });
          }
          case "GET /api/onboarding/history":
            return json(res, 200, { windows: { "7d": { sessions: 1, bytes: 400_000 }, "30d": { sessions: 3, bytes: 1_200_000 }, "90d": { sessions: 7, bytes: 2_900_000 }, all: { sessions: 9, bytes: 3_400_000 } } });
          case "POST /api/onboarding/init": {
            const body = await readJson(req);
            const repos = body["repos"] as string[];
            const workspaces = body["workspaces"] as string[] | undefined;
            for (const root of repos) enabled.add(root);
            return json(res, 200, {
              results: repos.map((root) => ({ path: root, ok: true, hooksWritten: [".claude/settings.json"], trustSteps: root === BETA ? ["Open Codex in this repo once and accept its hooks prompt"] : [] })),
              ...(workspaces === undefined ? {} : { workspaces: workspaces.map((root) => ({ path: root, ok: true, hooksWritten: [".claude/settings.json"], trustSteps: [] })) }),
            });
          }
          case "POST /api/onboarding/plan": {
            const body = await readJson(req);
            return json(res, 200, body["method"] === "extract" ? { sessions: 3, estimate: { tokens: 240_000, usd: 0.96, needsApiKey: true } } : { sessions: 3, estimate: { seconds: 135 } });
          }
          case "POST /api/onboarding/run": {
            const body = await readJson(req);
            if (body["consent"] !== true) return json(res, 409, { error: { code: "consent-required", message: "consent" } });
            jobs.length = 0;
            jobs.push({ id: "j1", repo_path: ALPHA, status: "queued" }, { id: "j2", repo_path: ALPHA, status: "queued" }, { id: "j3", repo_path: BETA, status: "queued" });
            // One job finishes every 400 ms, announced on the stream the way the daemon does.
            timer = setInterval(() => {
              const next = jobs.find((j) => j.status !== "done");
              if (next === undefined) {
                clearInterval(timer);
                return;
              }
              next.status = "done";
              emit("job.changed", { id: next.id, status: "done", repo: repoId(next.repo_path) });
            }, 400);
            return json(res, 202, { jobs: jobs.map((j) => ({ ...j, kind: "backfill" })) });
          }
          case "GET /api/onboarding/status":
            return json(res, 200, status());
          default:
            return json(res, 404, { error: { code: "not-found", message: url.pathname } });
        }
      }
      const file = url.pathname === "/" ? WEB_INDEX : path.join(WEB_DIST, url.pathname);
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    })().catch((error: unknown) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    server,
    requests,
    close: async () => {
      if (timer !== undefined) clearInterval(timer);
      for (const stream of streams) stream.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("onboarding wizard", () => {
  test.skip(!ENABLED, SKIP_REASON);
  test.skip(ENABLED && !existsSync(WEB_INDEX), `${WEB_INDEX} is missing — run pnpm build`);

  let daemon: Daemon;

  test.beforeEach(async () => {
    daemon = await startDaemon();
    if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });
  });

  test.afterEach(async () => {
    await daemon.close();
  });

  async function shot(page: Page, name: string): Promise<void> {
    if (SHOTS === undefined) return;
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  }

  async function noSidewaysScroll(page: Page): Promise<void> {
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
  }

  test("an empty daemon opens the wizard, and the five steps enable, plan, backfill and report", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${daemon.url}/`);

    // Home on a daemon with no repo is redirected to the wizard.
    await expect(page).toHaveURL(/#\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Choose the repos to track" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "alpha" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "beta" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "gamma" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Projects" })).not.toBeChecked();
    await expect(page.getByText("contains other repos")).toBeVisible();
    // The projects folder itself has no `.git`: shown, never tickable.
    await expect(page.getByRole("checkbox", { name: "Projects" })).toBeDisabled();
    await shot(page, "onboarding-projects-1280");

    // Add folder re-discovers with the extra root and lists what it found.
    await page.getByLabel("Add folder").fill("/Users/op/code");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "delta" })).toBeVisible();
    // The default root is still walked beside the added one: gamma stays listed.
    await expect(page.getByRole("checkbox", { name: "gamma" })).toBeVisible();
    expect(daemon.requests).toContain(`GET /api/onboarding/discover?roots=${encodeURIComponent(`${PROJECTS},/Users/op/code`)}`);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Repos enabled" })).toBeVisible();
    await expect(page.getByText(".claude/settings.json").first()).toBeVisible();
    await expect(page.getByText("Open Codex in this repo once and accept its hooks prompt")).toBeVisible();
    expect(daemon.requests).toContain("POST /api/onboarding/init");

    await page.getByRole("button", { name: "Next: choose history" }).click();
    await expect(page.getByRole("heading", { name: "How much history to backfill" })).toBeVisible();
    await expect(page).toHaveURL(/step=history/);
    await expect(page.getByRole("button", { name: /Last 30 days/ })).toContainText("3 sessions");
    await page.getByRole("button", { name: /Last 30 days/ }).click();

    await expect(page.getByRole("heading", { name: "How should past sessions be digested?" })).toBeVisible();
    await shot(page, "onboarding-method-1280");
    // A reload lands on the same step with the same selections.
    await page.reload();
    await expect(page.getByRole("heading", { name: "How should past sessions be digested?" })).toBeVisible();

    await page.getByRole("button", { name: "Yes, replay my sessions" }).click();
    await expect(page.getByRole("heading", { name: "Resume in your harness" })).toBeVisible();
    await expect(page.getByText("about 2m 15s")).toBeVisible();
    await page.getByRole("button", { name: "Start backfill (3 sessions)" }).click();

    await expect(page.getByRole("heading", { name: "Backfilling" })).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByRole("link", { name: /Go to home/ })).toBeVisible();
    // The stream and the poll both feed the count; three jobs land at 400 ms each.
    await expect(page.getByRole("heading", { name: "Backfilled 3 sessions across 2 repos" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: "Go to home" }).click();
    await expect(page.getByRole("heading", { name: "Projects", level: 2 })).toBeVisible();
    await expect(page.getByRole("link", { name: "alpha" })).toBeVisible();
    await expect(page.getByRole("link", { name: "beta" })).toBeVisible();
    const banner = page.getByRole("status").filter({ hasText: "Backfilled" });
    await expect(banner).toContainText("Backfilled 3 sessions across 2 repos.");
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Backfilled" })).toHaveCount(0);
  });

  test("declining the extraction backfills nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${daemon.url}/#/onboarding?step=method&repos=${encodeURIComponent(ALPHA)}&since=7d`);
    await page.getByRole("button", { name: "No, use the Anthropic API instead" }).click();
    await expect(page.getByRole("heading", { name: "Extract with an API key" })).toBeVisible();
    await expect(page.getByText("$0.96")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run extraction" })).toBeDisabled();
    await page.getByRole("button", { name: "Skip backfill" }).click();
    await expect(page.getByRole("heading", { name: "Nothing was backfilled" })).toBeVisible();
    expect(daemon.requests.some((r) => r.startsWith("POST /api/onboarding/run"))).toBe(false);
  });

  test("fits 375 px without sideways scroll on the projects and method steps", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto(`${daemon.url}/#/onboarding`);
    await expect(page.getByRole("heading", { name: "Choose the repos to track" })).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "onboarding-projects-375");

    await page.goto(`${daemon.url}/#/onboarding?step=method&repos=${encodeURIComponent(ALPHA)},${encodeURIComponent(BETA)}&since=30d`);
    await expect(page.getByRole("heading", { name: "How should past sessions be digested?" })).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "onboarding-method-375");

    await page.getByRole("button", { name: "No, use the Anthropic API instead" }).click();
    await expect(page.getByRole("heading", { name: "Extract with an API key" })).toBeVisible();
    await noSidewaysScroll(page);
  });
});
