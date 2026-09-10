/**
 * The recovery half of P3, end to end through the real binary (#57).
 *
 * `e2e-repair.test.ts` (#61) already covers the other half of this issue — a real `claude -p`
 * session `SIGKILL`ed mid-turn, `scan` marking it `crashed` with a repair job queued, and
 * `workledger repair <ulid>` producing a checkpoint stamped `trigger: repair` on a session left
 * `status: repaired`. That case is deliberately *not* duplicated here; this file adds the two
 * things it does not cover.
 *
 * 1. **Backfill, as a process.** `backfill.test.ts` drives `runBackfill` in-process with a fake
 *    adapter, so the one thing it cannot exercise is the part that only exists in a real run:
 *    `os.homedir()` resolving a temp `HOME`, the store enumerated off a real
 *    `~/.claude/projects/<slug>/` tree, and `resumeHeadless` actually *spawning* a `claude` off
 *    `PATH` in its own process group and waiting for the `workledger checkpoint` that child runs.
 *    The stub `claude` here is a shell script, not a stubbed function: everything between
 *    `backfill` deciding to resume a session and a checkpoint landing in the ledger is real.
 *
 * 2. **The non-interactive extraction refusal.** `extract.test.ts` covers an operator who is
 *    asked and says no. The case below is the one an unattended run hits: `--extract` without
 *    `--yes` and with no way to ask at all. It must still exit 6 and still send nothing.
 *
 * ## Why the backfill case is opt-in
 *
 * It spawns processes, waits on them, and writes a temp `HOME`; it spends no tokens (the stub
 * never calls a model) but it is minutes-slow next to the rest of the suite. Skipped unless
 * `WORKLEDGER_E2E` is set, exactly like `e2e.test.ts` and `e2e-repair.test.ts`. Run it with
 * `WORKLEDGER_E2E=1 pnpm -F workledger test` after `pnpm build` — it executes the bundled
 * `dist/main.js` through `bin/workledger`.
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
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseSessionText } from "@workledger/core";

import { EXIT_CONSENT_REFUSED } from "../src/exit-codes.js";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { openIndex } from "../src/index/db.js";
import { listJobs } from "../src/jobs/queue.js";
import { runRepair } from "../src/commands/repair.js";
import { CLAUDE_STORE, projectSlug } from "../src/commands/backfill.js";
import { sessionFile, writeFileAtomic } from "../src/ledger-fs.js";
import type { IndexDb } from "../src/index/db.js";
import type { RepairIo } from "../src/commands/repair.js";

/** `packages/cli/`. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The bin shim under test. It dynamic-imports `dist/main.js`, so the bundle must be built. */
const CLI_BIN = path.join(PACKAGE_ROOT, "bin", "workledger");
/** `packages/cli/test/fixtures/transcripts/` — the three sessions, with `__CWD__` unresolved. */
const FIXTURES = fileURLToPath(new URL("./fixtures/transcripts/", import.meta.url));

/** The fixture session ids. The filename is the harness session id a resume is handed. */
const IDS = ["hs-alpha", "hs-beta", "hs-gamma"] as const;

/** Three spawned resumes, each waiting on a child process. */
const TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Case 1 (opt-in): backfill three fixture sessions through the real binary.
// ---------------------------------------------------------------------------

/** Why the opt-in suite is being skipped, or `null` when it can run. */
function skipReason(): string | null {
  if (!process.env["WORKLEDGER_E2E"]) {
    return "WORKLEDGER_E2E is unset (opt-in: it spawns real processes and is minutes-slow)";
  }
  if (!existsSync(path.join(PACKAGE_ROOT, "dist", "main.js"))) {
    return "packages/cli/dist/main.js is missing — run `pnpm build` first";
  }
  return null;
}

/** Everything one backfill run needs. */
interface Fixture {
  /** The throwaway git repo, already `realpath`ed — see {@link setup}. */
  repo: string;
  /** `WORKLEDGER_HOME` — the SQLite index cache, kept out of the developer's real `~`. */
  wlHome: string;
  /** `HOME` — holds `.claude/projects/<slug>/`, the store the enumeration reads. */
  fakeHome: string;
  /** `PATH` for every child, with the shim directory first. */
  binPath: string;
}

/**
 * A git repo, a fake `HOME`, and both a `workledger` and a stub `claude` on `PATH`.
 *
 * Every path is `realpath`ed before it is used. On macOS `os.tmpdir()` is `/var/folders/…`, a
 * symlink to `/private/var/…`, and a child process's `process.cwd()` reports the resolved form —
 * so `findRepoRoot` returns the resolved path, `projectSlug` slugifies the resolved path, and a
 * store seeded under the unresolved one would simply not be found. Same reason the fixtures'
 * `__CWD__` is replaced with the resolved path: `enumerateStore` rejects a transcript whose first
 * record's `cwd` does not `path.resolve` to the repo it is enumerating.
 *
 * The `workledger` shim matters twice over: the hooks `init` writes invoke it by name, and so
 * does the stub `claude` when it plays the part of a resumed agent.
 */
function setup(): Fixture {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wl-e2e-recovery-")));
  const repo = path.join(dir, "repo");
  const wlHome = path.join(dir, "wlhome");
  const fakeHome = path.join(dir, "home");
  const bin = path.join(dir, "bin");
  for (const at of [repo, wlHome, fakeHome, bin]) mkdirSync(at, { recursive: true });

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
  writeFileSync(path.join(bin, "claude"), STUB_CLAUDE, "utf8");
  chmodSync(path.join(bin, "claude"), 0o755);

  return {
    repo,
    wlHome,
    fakeHome,
    binPath: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
  };
}

/**
 * The stand-in for a resumed Claude Code session.
 *
 * `resumeHeadless` invokes `claude -p <instruction> --resume <id> --allowedTools <tools>`, and the
 * only thing in that call telling the session which ledger row it belongs to is the
 * `workledger checkpoint --session <ulid>` line inside the instruction — so the stub reads the
 * ulid back out of `$2` exactly as a real agent reads it off its prompt, rather than being handed
 * it out of band. Anything else would test a channel the product does not have.
 *
 * It then does the one thing `--allowedTools "Bash(workledger checkpoint*)"` permits: runs that
 * command with a valid `CheckpointPayload` on stdin.
 */
const STUB_CLAUDE = `#!/bin/sh
# Stub Claude Code: plays a resumed session that records one checkpoint and stops.
set -e
instruction="$2"
ulid=$(printf '%s\\n' "$instruction" | sed -n 's/^Run: workledger checkpoint --session \\([0-9A-Za-z]*\\).*$/\\1/p' | head -1)
if [ -z "$ulid" ]; then
  echo "stub claude: no '--session <ulid>' in the instruction" >&2
  exit 1
fi
printf '%s' '{"goal":"Describe what this backfilled session did","done":[{"text":"Edited a file during the original session","files":["src/health.ts"],"verified":"not-verified"}],"remaining":[],"notes":[]}' \\
  | workledger checkpoint --session "$ulid"
`;

/** Run the built CLI in the fixture's repo, under its fake `HOME` and index home. */
function workledger(
  fixture: Fixture,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: fixture.repo,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: fixture.binPath,
      HOME: fixture.fakeHome,
      WORKLEDGER_HOME: fixture.wlHome,
    },
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Copy the three fixtures into `<fakeHome>/.claude/projects/<slug>/`, with `__CWD__` resolved. */
function seedStore(fixture: Fixture): void {
  const store = path.join(fixture.fakeHome, CLAUDE_STORE, projectSlug(fixture.repo));
  mkdirSync(store, { recursive: true });
  for (const id of IDS) {
    writeFileSync(
      path.join(store, `${id}.jsonl`),
      readFileSync(path.join(FIXTURES, `${id}.jsonl`), "utf8").replaceAll("__CWD__", fixture.repo),
      "utf8",
    );
  }
}

/** Every `.workledger/sessions/*.md`, parsed. */
function sessions(repo: string): ReturnType<typeof parseSessionText>[] {
  const at = path.join(repo, ".workledger", "sessions");
  if (!existsSync(at)) return [];
  return readdirSync(at)
    .filter((name) => name.endsWith(".md"))
    .map((name) => parseSessionText(readFileSync(path.join(at, name), "utf8")));
}

const reason = skipReason();

describe.skipIf(reason !== null)(
  `e2e: backfill from a seeded harness store${reason === null ? "" : ` — SKIPPED: ${reason}`}`,
  () => {
    it(
      "prices three sessions in a dry run, digests them as source: backfill, then skips them",
      async () => {
        const fixture = setup();

        const init = workledger(fixture, ["init", "--yes"]);
        expect(init.status, init.stderr).toBe(0);
        seedStore(fixture);

        // 1. The dry run: the table, the estimate, and no trace of itself anywhere.
        const dry = workledger(fixture, ["backfill", "--since", "all", "--dry-run"]);
        expect(dry.status, dry.stderr).toBe(0);
        const table = dry.stdout.trimEnd().split("\n");
        expect(table[0]).toBe("sessions   3");
        expect(table[1]).toMatch(/^bytes {6}[1-9]\d*$/);
        expect(table[2]).toMatch(/^oldest {5}\d{4}-\d{2}-\d{2}T/);
        // The estimate is the number an operator decides on, so its presence is the assertion —
        // not its value, which is `seconds_per_session` times a config knob.
        expect(table[3]).toMatch(/^estimate {3}~\d+[ms]/);
        expect(table[4]).toBe("skipped    0 (already indexed)");
        expect(sessions(fixture.repo), "a dry run must record nothing").toEqual([]);

        // 2. The real run. Each session is resumed by spawning the stub `claude`, which runs
        //    `workledger checkpoint` as its own process against the same repo.
        const run = workledger(fixture, ["backfill", "--since", "all", "--yes"]);
        expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
        expect(run.stdout).toContain("backfill: 3 digested, 0 failed, 0 skipped (already indexed)");

        const digested = sessions(fixture.repo);
        expect(digested).toHaveLength(3);
        for (const session of digested) {
          expect(session.frontmatter.source).toBe("backfill");
          expect(session.frontmatter.status).toBe("repaired");
          expect(session.frontmatter.needs_repair).toBe(false);
          expect(session.frontmatter.checkpoints).toHaveLength(1);
          expect(session.frontmatter.checkpoints[0]?.trigger).toBe("repair");
        }
        // The harness ids come from the filenames — the link that lets a resume find the session.
        expect(digested.map((s) => s.frontmatter.harness_session_id).sort()).toEqual([...IDS]);
        // `started` comes from each transcript's first record, not from the clock.
        expect(digested.map((s) => s.frontmatter.started).sort()).toEqual([
          "2026-08-20T09:00:00.000Z",
          "2026-08-28T14:30:00.000Z",
          "2026-09-04T11:15:00.000Z",
        ]);

        // 3. Resumability: the same command again is a no-op, because the index already has them.
        const again = workledger(fixture, ["backfill", "--since", "all", "--yes"]);
        expect(again.status, again.stderr).toBe(0);
        expect(again.stdout).toContain("sessions   0");
        expect(again.stdout).toContain("skipped    3 (already indexed)");
        expect(again.stdout).toContain("backfill: 0 digested, 0 failed, 3 skipped (already indexed)");
        expect(sessions(fixture.repo)).toHaveLength(3);
        for (const session of sessions(fixture.repo)) {
          expect(session.frontmatter.checkpoints, "a skip must not re-digest").toHaveLength(1);
        }

        rmSync(path.dirname(fixture.repo), { recursive: true, force: true });
      },
      TIMEOUT_MS,
    );
  },
);

// ---------------------------------------------------------------------------
// Case 2 (always runs): the unattended extraction refusal.
// ---------------------------------------------------------------------------

const ULID = "01JBQK0000000000000000000A";
const NOW = new Date("2026-09-09T12:00:00.000Z");

let dir: string;
let repo: string;
let home: string;
let db: IndexDb;
let out: string[];
let err: string[];
let requests: string[];

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "wl-e2e-recovery-unit-"));
  repo = path.join(dir, "repo");
  home = path.join(dir, "home");
  writeFileAtomic(path.join(repo, ".workledger", "config.yaml"), "orphan_minutes: 30\n");

  const transcript = path.join(dir, "store", "hs-beta.jsonl");
  mkdirSync(path.dirname(transcript), { recursive: true });
  writeFileSync(
    transcript,
    readFileSync(path.join(FIXTURES, "hs-beta.jsonl"), "utf8").replaceAll("__CWD__", repo),
    "utf8",
  );

  db = openIndex({ home });
  out = [];
  err = [];
  requests = [];

  writeFileAtomic(
    sessionFile(repo, ULID),
    [
      "---",
      "schema_version: 1",
      `id: ${ULID}`,
      "harness: claude-code",
      "harness_session_id: hs-beta",
      "repo: example/repo",
      "branch: main",
      "author: { name: Tester, email: t@example.com }",
      "started: 2026-08-28T14:30:00.000Z",
      "ended: 2026-08-28T15:30:00.000Z",
      "end_reason: unknown",
      "status: crashed",
      "private: false",
      "source: backfill",
      "needs_repair: true",
      "checkpoint_failures: 0",
      "checkpoints: []",
      "---",
      "",
      "# Session",
      "",
    ].join("\n"),
  );
  db.insertSession({
    ulid: ULID,
    repo_path: repo,
    harness: "claude-code",
    harness_session_id: "hs-beta",
    status: "crashed",
    transcript_path: transcript,
    last_offset: 0,
    turns_total: 4,
    turns_since_checkpoint: 4,
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A `fetch` that records every call and would answer — so a silent request cannot pass. */
function recordingFetch(): typeof globalThis.fetch {
  return (async (url: string | URL | Request) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), {
      status: 200,
    });
  }) as unknown as typeof globalThis.fetch;
}

describe("repair --extract without --yes, unattended", () => {
  it("exits 6 and sends no request when there is nobody to ask", async () => {
    const io: RepairIo = {
      db,
      root: repo,
      adapter: claudeCodeAdapter,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      now: () => NOW,
      newId: () => "01JBQK0000000000000000000J",
      newBacklogId: () => "WL-01JBQK0000000000000000000B",
      apiKey: () => "sk-ant-api03-TESTKEYbutNotARealOne0000000000000000",
      fetchImpl: recordingFetch(),
      home,
      // No `confirm`. A run with no TTY has no way to ask, and the contract's answer to an
      // unaskable spend question is the same as to a refused one: don't spend.
    };

    const code = await runRepair(ULID, { extract: true }, io);

    expect(code).toBe(EXIT_CONSENT_REFUSED);
    expect(requests, "an unconfirmed extraction must send nothing").toEqual([]);
    expect(listJobs(db, repo), "and leave no job row behind").toEqual([]);

    const session = parseSessionText(readFileSync(sessionFile(repo, ULID), "utf8"));
    expect(session.frontmatter.checkpoints).toEqual([]);
    expect(session.frontmatter.status).toBe("crashed");
    expect(session.frontmatter.needs_repair).toBe(true);
    // The estimate is still printed: a refusal the operator never saw priced is not informed.
    expect(err.join("\n")).toContain("transcript bytes since offset 0");
    expect(err.join("\n")).toContain("extract: cancelled; nothing was sent and nothing was written");
  });
});
