/**
 * The P1 acceptance criterion, end to end, against a real Claude Code session (#2).
 *
 * plans/feature-p1-cli-core.md §Acceptance: "A scripted headless Claude Code session produces a
 * session file with ≥1 checkpoint, a proposed backlog item, and a `[cp n]` stamp whose transcript
 * offset lies inside the transcript file."
 *
 * Every other test in this package drives the CLI directly, or drives the hook with a synthetic
 * event payload. This one drives *nothing*: it starts `claude -p` in a throwaway repo and asserts
 * on what the session left behind. The whole chain is real — Claude Code loads the project
 * `.claude/settings.json` `init` wrote, the `Stop` hook runs the built `bin/workledger`, the block
 * puts `src/instruction.ts` on stderr, and the model decides on its own to run
 * `workledger checkpoint --session <ulid>`. That last step is the only part of P1 that no unit
 * test can establish, because it is a prompt being obeyed rather than a function being called.
 *
 * ## Why it is opt-in
 *
 * It costs real tokens, needs a logged-in `claude` on `PATH`, and takes ~30 s. It is skipped
 * unless `WORKLEDGER_E2E` is set *and* `claude` resolves, so CI stays green without the binary.
 * Run it with `WORKLEDGER_E2E=1 pnpm -F workledger test` after `pnpm -r build` — it executes the
 * bundled `dist/main.js` through `bin/workledger`, not the TypeScript sources.
 *
 * ## Observed behaviour on claude 2.1.263 / Node 25.9.0 (2026-09-09)
 *
 * - `SessionEnd` *does* fire under `-p`, so the session file ends `status: ended` with
 *   `end_reason: unknown`. The test asserts `ended` via EXPECTED_STATUS below.
 * - The block fires on the very first `Stop`, and its trigger is `bytes`, not `turns`: a Claude
 *   Code transcript is ~230 KB after one turn (system prompt, tool definitions, CLAUDE.md), which
 *   is already past the default 40 000-byte threshold. Lowering `thresholds.turns` is kept anyway
 *   so the block does not depend on how large a future system prompt happens to be.
 * - The model runs the checkpoint unprompted, from the instruction alone. It took three attempts
 *   in one observed run — the first two failed `CheckpointPayload` validation (a `done` item needs
 *   `files` or a commit; a `notes` item needs a `type`) and it corrected itself from the stderr
 *   the contract feeds back. That retry loop is the instruction working as designed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseItem, parseSessionText } from "@workledger/core";

/** `packages/cli/`. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The bin shim under test. It dynamic-imports `dist/main.js`, so the bundle must be built. */
const CLI_BIN = path.join(PACKAGE_ROOT, "bin", "workledger");

/** Five minutes: a real model turn plus up to three checkpoint attempts. */
const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The single prompt. It asks for one file and two trivial answers, and it names one follow-up it
 * explicitly does *not* do — that is what gives the checkpoint a `remaining` item to propose, and
 * therefore what produces the `WL-` file the acceptance criterion asks for. Nothing in it mentions
 * workledger: the checkpoint has to come from the block's instruction, or the test has proved
 * nothing.
 */
const PROMPT = [
  "Create a file hello.txt containing exactly one line: hello from workledger e2e.",
  "Then answer these two questions in your final message: what is 2+2, and what colour is",
  "the sky on a clear day?",
  "Do not create any other file — writing a goodbye.txt is deliberately left as a follow-up",
  "task for a later session.",
].join(" ");

/**
 * What `SessionEnd` did under `-p`, recorded rather than inferred.
 *
 * The contract allows a session file to be left `open` when the harness never emits `SessionEnd`
 * (data-flow §2 has the orphan sweep for exactly that). On claude 2.1.263 it *is* emitted, so the
 * expected value here is `ended`. If a future harness stops emitting it under `-p`, this constant
 * is the one line to change, and the change is the finding.
 */
const EXPECTED_STATUS = "ended";

/** Why the suite is being skipped, or `null` when it can run. */
function skipReason(): string | null {
  if (!process.env["WORKLEDGER_E2E"]) {
    return "WORKLEDGER_E2E is unset (opt-in: it spends real tokens on a live Claude Code session)";
  }
  const found = spawnSync("sh", ["-c", "command -v claude"], { encoding: "utf8" });
  if (found.status !== 0 || found.stdout.trim() === "") {
    return "`claude` is not on PATH";
  }
  if (!existsSync(path.join(PACKAGE_ROOT, "dist", "main.js"))) {
    return "packages/cli/dist/main.js is missing — run `pnpm -r build` first";
  }
  return null;
}

/** Everything one run needs: a temp repo, a temp index home, and a `workledger` on `PATH`. */
interface Fixture {
  /** The throwaway git repo `claude` runs in. */
  repo: string;
  /** `WORKLEDGER_HOME` — the SQLite index cache, kept out of the developer's real `~`. */
  home: string;
  /** `PATH` for the child, with the shim directory first. */
  binPath: string;
}

/**
 * A git repo with an identity, and a `workledger` shim on `PATH`.
 *
 * The shim matters: the hook command `init` writes is
 * `if command -v workledger …; then exec workledger hook <event>; fi`, so an unresolvable
 * `workledger` makes every hook a silent no-op and the test would pass vacuously. `HOME` is
 * deliberately *not* redirected — `claude` needs its real credentials, and its transcript has to
 * land in the real `~/.claude/projects/` for the offset assertion to have a file to measure.
 */
function setup(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-e2e-"));
  const repo = path.join(dir, "repo");
  const home = path.join(dir, "wlhome");
  const bin = path.join(dir, "bin");
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "E2E Bot"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: repo });

  const shim = path.join(bin, "workledger");
  writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_BIN)} "$@"\n`, "utf8");
  chmodSync(shim, 0o755);

  return { repo, home, binPath: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` };
}

/** Run the shim in the fixture's repo and return its exit code plus both streams. */
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

/**
 * The transcript Claude Code wrote for a harness session id.
 *
 * Claude Code names the project directory after the *resolved* cwd with every non-alphanumeric
 * character replaced by `-` (on macOS `/var/…` resolves to `/private/var/…`, which is why the
 * slug is built from `realpathSync`). The directory listing is the fallback so a future naming
 * change fails on the assertion below rather than on a missing path.
 */
function transcriptFile(repo: string, harnessSessionId: string): string {
  const projects = path.join(os.homedir(), ".claude", "projects");
  const slug = realpathSync(repo).replace(/[^a-zA-Z0-9]/g, "-");
  const expected = path.join(projects, slug, `${harnessSessionId}.jsonl`);
  if (existsSync(expected)) return expected;
  for (const entry of readdirSync(projects)) {
    const candidate = path.join(projects, entry, `${harnessSessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no transcript for ${harnessSessionId}; expected ${expected}`);
}

const reason = skipReason();

describe.skipIf(reason !== null)(`e2e: headless Claude Code session${reason === null ? "" : ` — SKIPPED: ${reason}`}`, () => {
  it(
    "records a checkpoint, proposes a backlog item, and stamps an offset inside the transcript",
    async () => {
      const fixture = setup();

      // 1. Onboard the repo through the real command, then make the Stop block cheap to reach.
      const init = workledger(fixture, ["init", "--yes"]);
      expect(init.status, init.stderr).toBe(0);

      const configFile = path.join(fixture.repo, ".workledger", "config.yaml");
      const config = readFileSync(configFile, "utf8").replace(/turns: \d+/, "turns: 2");
      expect(config).toContain("turns: 2");
      writeFileSync(configFile, config, "utf8");

      // 2. One real headless turn. `--output-format stream-json --verbose` is what puts tool
      //    *results* in stdout; plain `-p` prints only the model's final message, and the ack
      //    line is the stdout of a Bash tool call, not part of that message.
      const session = spawnSync(
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
          encoding: "utf8",
          timeout: TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, PATH: fixture.binPath, WORKLEDGER_HOME: fixture.home },
        },
      );
      const output = `${session.stdout ?? ""}\n${session.stderr ?? ""}`;
      expect(session.error, `claude failed to run: ${String(session.error)}`).toBeUndefined();
      expect(session.status, `claude exited ${session.status}\n${output.slice(-4000)}`).toBe(0);

      // 3a. Exactly one session file — one `claude` invocation is one `SessionStart` — ended,
      //     with at least one checkpoint.
      const sessionFiles = ledgerFiles(fixture.repo, "sessions");
      expect(sessionFiles, "expected exactly one .workledger/sessions/*.md").toHaveLength(1);
      const parsed = parseSessionText(readFileSync(sessionFiles[0] as string, "utf8"));
      expect(parsed.frontmatter.status).toBe(EXPECTED_STATUS);
      expect(parsed.frontmatter.checkpoints.length).toBeGreaterThanOrEqual(1);

      // 3b. A `[cp n]` stamp in the body for every checkpoint the frontmatter claims.
      expect(parsed.done.length + parsed.remaining.length).toBeGreaterThan(0);
      for (const item of [...parsed.done, ...parsed.remaining]) {
        expect(item.cp).toBeGreaterThanOrEqual(1);
        expect(item.cp).toBeLessThanOrEqual(parsed.frontmatter.checkpoints.length);
      }

      // 3c. At least one proposed backlog item, named by a `remaining` line of the session. The
      //     count is deliberately not pinned: how many follow-ups a model volunteers is its call,
      //     and a test that demanded exactly one would be flaky by construction.
      const items = ledgerFiles(fixture.repo, "backlog").map((file) =>
        parseItem(readFileSync(file, "utf8")),
      );
      const proposed = items.filter((entry) => entry.frontmatter.status === "proposed");
      expect(proposed.length, `no proposed backlog item; got ${items.length} item(s)`).toBeGreaterThanOrEqual(1);
      const item = proposed[0] as (typeof proposed)[number];
      expect(item.frontmatter.id).toMatch(/^WL-[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(item.frontmatter.proposed_by.session).toBe(parsed.frontmatter.id);
      expect(parsed.remaining.map((line) => line.ref)).toContain(item.frontmatter.id);

      // 3d. The offset is a real position inside the transcript on disk. `> 0` rules out an
      //     unreadable transcript (the contract records 0 for that) and `<= size` rules out a
      //     stamp pointing past the end, which would make the excerpt range meaningless.
      const checkpoint = parsed.frontmatter.checkpoints[0];
      expect(checkpoint).toBeDefined();
      const transcript = transcriptFile(fixture.repo, parsed.frontmatter.harness_session_id);
      const size = statSync(transcript).size;
      expect(checkpoint?.transcript_offset).toBeGreaterThan(0);
      expect(checkpoint?.transcript_offset).toBeLessThanOrEqual(size);

      // 3e. The ack line the model saw. This is the evidence that the *model* ran the command:
      //     it only reaches stdout as the result of a Bash tool call it chose to make.
      expect(output).toMatch(/checkpoint \d+ recorded: \d+ done, \d+ remaining/);

      // 4. The new item is visible to the next session's brief.
      const brief = workledger(fixture, ["brief"]);
      expect(brief.status).toBe(0);
      expect(brief.stdout).toContain(item.frontmatter.id);
    },
    TIMEOUT_MS,
  );
});
