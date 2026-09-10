/**
 * The P4a acceptance criterion, end to end, against a real Codex session (#59).
 *
 * plans/feature-p4-harnesses.md §Acceptance: "`workledger init` in a repo with Codex installed
 * writes `.codex/hooks.json` matching the contract; a `codex exec` session in that repo records a
 * checkpoint".
 *
 * Like `e2e.test.ts`, this drives nothing directly. `codex exec` runs in a throwaway repo, loads
 * the `.codex/hooks.json` `init` wrote, the `Stop` hook runs the built `bin/workledger` with
 * `--harness codex`, the block puts `src/instruction.ts` on stderr as a continuation prompt, and
 * the model decides on its own to run `workledger checkpoint --session <ulid>`.
 *
 * ## Hook trust
 *
 * Codex will not run a project's hooks until the operator has trusted them once, and that prompt
 * is interactive by design. `codex exec` documents `--dangerously-bypass-hook-trust` — "run
 * enabled hooks without requiring persisted hook trust for this invocation … intended only for
 * automation that already vets hook sources" — and that is the flag this test uses, on a hook file
 * the test itself just wrote two lines earlier. `workledger repair` never passes it: there the
 * hook source is whatever is already in the operator's repo, and escalating past their trust
 * decision is not workledger's call (docs/contracts/p4/hooks-codex.md §Headless resume).
 *
 * ## Why it is opt-in
 *
 * It costs real tokens, needs a logged-in `codex` on `PATH`, and takes ~1 min. It is skipped
 * unless `WORKLEDGER_E2E` is set *and* `codex` resolves. Run it with
 * `WORKLEDGER_E2E=1 pnpm -F workledger test` after `pnpm build`.
 *
 * ## Observed behaviour on codex-cli 0.150.1 / Node 25.9.0 (2026-09-09)
 *
 * The run's findings are recorded in the PR body; the two constants below are the ones a future
 * Codex would change, and a change to either is itself the finding.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSessionText } from "@workledger/core";

import { CODEX_HOOKS_PATH, codexHooksBlock } from "../src/codex-hooks.js";

/** `packages/cli/`. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The bin shim under test. It dynamic-imports `dist/main.js`, so the bundle must be built. */
const CLI_BIN = path.join(PACKAGE_ROOT, "bin", "workledger");

/** Five minutes: a real model turn plus up to three checkpoint attempts. */
const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The prompt. It asks the agent to *read* two files and answer from them, so the transcript grows
 * past a deliberately tiny bytes threshold without the agent writing anything. Nothing in it
 * mentions workledger: the checkpoint has to come from the block's instruction, or the test has
 * proved nothing.
 */
const PROMPT = [
  "Read both notes/alpha.md and notes/beta.md in this repo.",
  "In your final message, say which of the two mentions a deadline and quote that line.",
  "Do not create, edit or delete any file.",
].join(" ");

/** Why the suite is being skipped, or `null` when it can run. */
function skipReason(): string | null {
  if (!process.env["WORKLEDGER_E2E"]) {
    return "WORKLEDGER_E2E is unset (opt-in: it spends real tokens on a live Codex session)";
  }
  const found = spawnSync("sh", ["-c", "command -v codex"], { encoding: "utf8" });
  if (found.status !== 0 || found.stdout.trim() === "") return "`codex` is not on PATH";
  if (!existsSync(path.join(PACKAGE_ROOT, "dist", "main.js"))) {
    return "packages/cli/dist/main.js is missing — run `pnpm build` first";
  }
  return null;
}

/** Everything one run needs: a temp repo, a temp index home, and a `workledger` on `PATH`. */
interface Fixture {
  repo: string;
  home: string;
  binPath: string;
}

/**
 * A git repo with an identity, two files to read, and a `workledger` shim on `PATH`.
 *
 * The shim matters: the hook command `init` writes is
 * `if command -v workledger …; then exec workledger hook <event> --harness codex; fi`, so an
 * unresolvable `workledger` makes every hook a silent no-op and the test would pass vacuously.
 * `HOME` is deliberately not redirected — `codex` needs its real credentials.
 */
function setup(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-e2e-codex-"));
  const repo = path.join(dir, "repo");
  const home = path.join(dir, "wlhome");
  const bin = path.join(dir, "bin");
  mkdirSync(path.join(repo, "notes"), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "E2E Bot"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: repo });
  writeFileSync(
    path.join(repo, "notes", "alpha.md"),
    "# Alpha\n\nAlpha is the first note. It has no dates in it at all.\n",
    "utf8",
  );
  writeFileSync(
    path.join(repo, "notes", "beta.md"),
    "# Beta\n\nThe migration deadline is 2026-10-01 and it will not move.\n",
    "utf8",
  );

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
function workledger(fixture: Fixture, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: { ...process.env, PATH: fixture.binPath, WORKLEDGER_HOME: fixture.home },
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Every `.md` under `.workledger/<dir>/`, as absolute paths. */
function ledgerFiles(repo: string, dir: string): string[] {
  const at = path.join(repo, ".workledger", dir);
  return readdirSync(at)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(at, name));
}

const reason = skipReason();

describe.skipIf(reason !== null)(
  `e2e: headless Codex session${reason === null ? "" : ` — SKIPPED: ${reason}`}`,
  () => {
    it(
      "records a checkpoint from a `codex exec` session in a repo init enabled",
      async () => {
        const fixture = setup();

        // 1. Enable the repo. Codex is on PATH, so `init` writes `.codex/hooks.json` unprompted.
        const init = workledger(fixture, ["init", "--yes"]);
        expect(init.status, init.stderr).toBe(0);
        expect(JSON.parse(readFileSync(path.join(fixture.repo, CODEX_HOOKS_PATH), "utf8"))).toEqual({
          hooks: codexHooksBlock(),
        });
        expect(init.stdout).toContain("Trust the hooks");

        // 2. A bytes threshold two files' worth of reading is certain to cross, so the block does
        //    not depend on how many turns Codex happens to take.
        writeFileSync(
          path.join(fixture.repo, ".workledger", "config.yaml"),
          [
            "schema_version: 1",
            "harnesses: [claude-code, codex]",
            "thresholds: { bytes: 2000, minutes: 20, turns: 15 }",
            "brief: { inject: true, max_tokens: 2000 }",
            "stale_turns: 5",
            "orphan_minutes: 30",
            "private_paths: []",
            "auto_commit: false",
            "",
          ].join("\n"),
          "utf8",
        );

        // 3. The session. `--dangerously-bypass-hook-trust` stands in for the interactive trust
        //    prompt, on the hook file written three assertions ago; see the module comment.
        const session = spawnSync(
          "codex",
          [
            "exec",
            "--dangerously-bypass-hook-trust",
            "--sandbox",
            "workspace-write",
            "--skip-git-repo-check",
            PROMPT,
          ],
          {
            cwd: fixture.repo,
            encoding: "utf8",
            timeout: TIMEOUT_MS,
            env: { ...process.env, PATH: fixture.binPath, WORKLEDGER_HOME: fixture.home },
          },
        );
        expect(session.status, `${session.stdout}\n${session.stderr}`).toBe(0);

        // 4. What the session left behind: one session file, recorded as codex, with a checkpoint.
        const sessions = ledgerFiles(fixture.repo, "sessions");
        expect(sessions).toHaveLength(1);
        const parsed = parseSessionText(readFileSync(sessions[0] as string, "utf8"));
        expect(parsed.frontmatter.harness).toBe("codex");
        expect(parsed.frontmatter.source).toBe("live");
        expect(parsed.frontmatter.checkpoints.length).toBeGreaterThanOrEqual(1);
        // The digest itself, not just the stamp: every rendered line carries a `[cp n]` inside
        // the range the frontmatter declares.
        expect(parsed.done.length + parsed.remaining.length).toBeGreaterThan(0);
        for (const line of [...parsed.done, ...parsed.remaining]) {
          expect(line.cp).toBeGreaterThanOrEqual(1);
          expect(line.cp).toBeLessThanOrEqual(parsed.frontmatter.checkpoints.length);
        }
      },
      TIMEOUT_MS + 30_000,
    );
  },
);
