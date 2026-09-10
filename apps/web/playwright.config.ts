import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright for the one end-to-end test (#41): a real `workledger serve` over a temp copy of a
 * ledger, driven in a real Chromium.
 *
 * There is no `webServer` block. The server under test is `packages/cli/bin/workledger serve`
 * bound to a *random* port over a per-run temp repo, so the test starts it itself and reads the
 * URL the command prints — a fixed `webServer.url` would be a second, divergent way of deciding
 * what "the server" is.
 *
 * The suite is opt-in: every test skips unless `WORKLEDGER_E2E=1`, so `pnpm test:e2e` on a machine
 * without browsers (and CI, which installs none) reports skips rather than failures.
 */
export default defineConfig({
  testDir: "./test/e2e",
  // `.e2e.ts`, not `.test.ts`: apps/web/vitest.config.ts globs `test/**/*.test.ts`, and these
  // files must never be picked up by `pnpm test`.
  testMatch: "**/*.e2e.ts",
  // One worker. The test spawns a server, watches files and asserts a 2 s live-update budget;
  // parallel workers would measure the machine rather than the SSE stream.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
