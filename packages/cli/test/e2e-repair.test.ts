/**
 * The P3 acceptance criterion, end to end, against a real Claude Code session (#53).
 *
 * Issue #53 §Acceptance: "a headless session killed mid-turn is marked crashed by scan and
 * repaired end to end". Every other test in this package fakes the harness; this one kills a real
 * one. The chain is the whole feature: `claude -p` starts, its `SessionStart` hook opens a session
 * row, the child is `SIGKILL`ed as soon as it makes its first tool call so no `SessionEnd` ever
 * fires, `workledger scan` finds the row still `open` with a transcript nobody is writing to,
 * marks it `crashed` and queues a repair, and `workledger repair` resumes the dead session and
 * gets a digest out of it.
 *
 * The kill is what no unit test can stand in for: it is the difference between a session that
 * ended and a session that stopped existing, and the whole orphan sweep is built on that
 * distinction.
 *
 * ## Why it is opt-in
 *
 * It costs real tokens, needs a logged-in `claude` on `PATH`, and takes a few minutes (a real
 * turn, then a real resumed turn). Skipped unless `WORKLEDGER_E2E` is set *and* `claude` resolves,
 * exactly like `e2e.test.ts`. Run it with `WORKLEDGER_E2E=1 pnpm -F workledger test` after
 * `pnpm -r build` — it executes the bundled `dist/main.js` through `bin/workledger`.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSessionText } from "@workledger/core";

/** `packages/cli/`. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The bin shim under test. It dynamic-imports `dist/main.js`, so the bundle must be built. */
const CLI_BIN = path.join(PACKAGE_ROOT, "bin", "workledger");

/** A first turn, a kill, a scan, and a resumed turn. */
const TIMEOUT_MS = 8 * 60 * 1000;
/** How long the first session is given to reach its first tool call before the test gives up. */
const FIRST_TOOL_MS = 3 * 60 * 1000;

/**
 * The prompt for the session that gets killed.
 *
 * It asks for two files so there is work in flight when the kill lands, and it names them so the
 * resumed session has something concrete to describe. Nothing in it mentions workledger: the
 * digest has to come from the repair instruction or the test has proved nothing.
 */
const PROMPT = [
  "Create a file alpha.txt containing exactly one line: alpha.",
  "Then create a file beta.txt containing exactly one line: beta.",
  "Then tell me how many files you created.",
].join(" ");

/** Why the suite is being skipped, or `null` when it can run. */
function skipReason(): string | null {
  if (!process.env["WORKLEDGER_E2E"]) {
    return "WORKLEDGER_E2E is unset (opt-in: it spends real tokens on a live Claude Code session)";
  }
  const found = spawnSync("sh", ["-c", "command -v claude"], { encoding: "utf8" });
  if (found.status !== 0 || found.stdout.trim() === "") return "`claude` is not on PATH";
  if (!existsSync(path.join(PACKAGE_ROOT, "dist", "main.js"))) {
    return "packages/cli/dist/main.js is missing — run `pnpm -r build` first";
  }
  return null;
}

/** Everything one run needs: a temp repo, a temp index home, and a `workledger` on `PATH`. */
interface Fixture {
  repo: string;
  home: string;
  binPath: string;
}

/** A git repo with an identity, and a `workledger` shim on `PATH`. See `e2e.test.ts` §setup. */
function setup(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-e2e-repair-"));
  const repo = path.join(dir, "repo");
  const home = path.join(dir, "wlhome");
  const bin = path.join(dir, "bin");
  for (const at of [repo, home, bin]) mkdirSync(at, { recursive: true });

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "E2E Bot"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: repo });

  const shim = path.join(bin, "workledger");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_BIN)} "$@"\n`,
    "utf8",
  );
  chmodSync(shim, 0o755);

  return { repo, home, binPath: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` };
}

/** Run the shim in the fixture's repo. */
function workledger(
  fixture: Fixture,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: fixture.repo,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: fixture.binPath, WORKLEDGER_HOME: fixture.home },
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** The one `.workledger/sessions/*.md`. */
function sessionText(repo: string): string {
  const at = path.join(repo, ".workledger", "sessions");
  const files = readdirSync(at).filter((name) => name.endsWith(".md"));
  expect(files, "expected exactly one .workledger/sessions/*.md").toHaveLength(1);
  return readFileSync(path.join(at, files[0] as string), "utf8");
}

/**
 * Start a headless session and `SIGKILL` it the moment it makes its first tool call.
 *
 * `--output-format stream-json --verbose` is what puts tool-use records on stdout as they happen;
 * `SIGKILL` rather than `SIGTERM` because a harness that gets to run its shutdown path would emit
 * `SessionEnd`, and a session that ended cleanly is precisely not the case under test.
 */
async function killMidTurn(fixture: Fixture): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        PROMPT,
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Bash Write Read Edit",
        "--output-format",
        "stream-json",
        "--verbose",
      ],
      {
        cwd: fixture.repo,
        env: { ...process.env, PATH: fixture.binPath, WORKLEDGER_HOME: fixture.home },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const giveUp = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("no tool call within the budget; nothing to kill mid-turn"));
    }, FIRST_TOOL_MS);

    let killed = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (killed || !chunk.toString("utf8").includes('"tool_use"')) return;
      killed = true;
      clearTimeout(giveUp);
      child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.on("close", () => {
      clearTimeout(giveUp);
      if (killed) resolve();
    });
    child.on("error", reject);
  });
}

const reason = skipReason();

describe.skipIf(reason !== null)(
  `e2e: crashed Claude Code session${reason === null ? "" : ` — SKIPPED: ${reason}`}`,
  () => {
    it(
      "is marked crashed by scan and repaired by a headless resume",
      async () => {
        const fixture = setup();

        const init = workledger(fixture, ["init", "--yes"]);
        expect(init.status, init.stderr).toBe(0);

        // The sweep's rule is an mtime older than `orphan_minutes`; a transcript written seconds
        // ago is never stale, so the repo is configured to call anything idle at all an orphan.
        const configFile = path.join(fixture.repo, ".workledger", "config.yaml");
        writeFileSync(
          configFile,
          readFileSync(configFile, "utf8").replace(/orphan_minutes: \d+/, "orphan_minutes: 1"),
          "utf8",
        );

        // 1. A real session, killed before it could end.
        await killMidTurn(fixture);
        const afterKill = parseSessionText(sessionText(fixture.repo));
        expect(afterKill.frontmatter.status, "SessionEnd should not have fired").toBe("open");

        // 2. `scan` sees a transcript nobody is writing to. The mtime has to age past the
        //    one-minute floor first; this is the only wait in the test.
        await new Promise((resolve) => setTimeout(resolve, 65_000));
        const scan = workledger(fixture, ["scan"]);
        expect(scan.status, scan.stderr).toBe(0);
        expect(scan.stdout).toBe("scan: 1 orphaned, 1 repair job queued\n");

        const crashed = parseSessionText(sessionText(fixture.repo));
        expect(crashed.frontmatter.status).toBe("crashed");
        expect(crashed.frontmatter.end_reason).toBe("crashed");
        expect(crashed.frontmatter.needs_repair).toBe(true);

        const queued = workledger(fixture, ["jobs", "--json"]);
        const listing = JSON.parse(queued.stdout) as { jobs: Array<{ status: string }> };
        expect(listing.jobs[0]).toMatchObject({ kind: "repair", status: "queued" });

        // 3. The repair resumes the dead session and gets the digest the crash cost us.
        const ulid = crashed.frontmatter.id;
        const repair = workledger(fixture, ["repair", ulid, "--timeout", "300"]);
        expect(repair.status, `${repair.stdout}\n${repair.stderr}`).toBe(0);

        const repaired = parseSessionText(sessionText(fixture.repo));
        expect(repaired.frontmatter.status).toBe("repaired");
        expect(repaired.frontmatter.needs_repair).toBe(false);
        expect(repaired.frontmatter.checkpoints.length).toBeGreaterThanOrEqual(1);
        // The stamp the whole `pending_trigger` mechanism exists to produce.
        expect(repaired.frontmatter.checkpoints.at(-1)?.trigger).toBe("repair");
        expect(repaired.done.length + repaired.remaining.length).toBeGreaterThan(0);

        const done = workledger(fixture, ["jobs", "--json"]);
        const after = JSON.parse(done.stdout) as { jobs: Array<{ status: string }> };
        expect(after.jobs[0]?.status).toBe("done");
      },
      TIMEOUT_MS,
    );
  },
);
