/**
 * `workledger repair <ulid>` — docs/contracts/p3/cli.md §`workledger repair`.
 *
 * The adapter is faked, and nothing else is. The success case's fake spends its turn doing what a
 * resumed Claude Code session is asked to do — it runs `runCheckpoint` against the same temp repo
 * — so the assertions are made against a real checkpoint written through the real command: the
 * `trigger: repair` stamp is the one thing this issue exists to produce, and only the whole path
 * from `pending_trigger` through `stampTrigger` to the rendered frontmatter can establish it.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseSessionText } from "@workledger/core";

import process from "node:process";

import { EXIT_JOB_FAILED, EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import { CLAUDE_BIN_ENV, claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { openIndex } from "../src/index/db.js";
import { getJob, listJobs } from "../src/jobs/queue.js";
import { runCheckpoint, stdinFrom } from "../src/commands/checkpoint.js";
import { runRepair } from "../src/commands/repair.js";
import { sessionFile, writeFileAtomic } from "../src/ledger-fs.js";
import type { HarnessAdapter, ResumeOptions, ResumeResult } from "../src/adapters/types.js";
import type { IndexDb } from "../src/index/db.js";

const ULID = "01JBQK0000000000000000000A";

let dir: string;
let repo: string;
let home: string;
let db: IndexDb;
let out: string[];
let err: string[];
let ids = 0;

function newId(): string {
  ids += 1;
  return `JOB${String(ids).padStart(23, "0")}`;
}

/** A crashed session, as `scan` would have left it. */
function crashedSession(status = "crashed", needsRepair = true): void {
  writeFileAtomic(
    sessionFile(repo, ULID),
    [
      "---",
      "schema_version: 1",
      `id: ${ULID}`,
      "harness: claude-code",
      `harness_session_id: hs-1`,
      "repo: example/repo",
      "branch: main",
      "author: { name: Tester, email: t@example.com }",
      "started: 2026-09-09T09:00:00.000Z",
      "ended: 2026-09-09T10:00:00.000Z",
      "end_reason: crashed",
      `status: ${status}`,
      "private: false",
      "source: live",
      `needs_repair: ${String(needsRepair)}`,
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
    harness_session_id: "hs-1",
    status,
    turns_since_checkpoint: 4,
    turns_total: 4,
  });
}

/** The payload a resumed agent would pipe into `workledger checkpoint`. */
const PAYLOAD = JSON.stringify({
  goal: "Recover the digest for a crashed session",
  done: [{ text: "Wrote hello.txt", files: ["hello.txt"], verified: "not-verified" }],
  remaining: [],
  notes: [],
});

/** An adapter whose resume does what the real one asks the model to do: one checkpoint. */
function checkpointingAdapter(): HarnessAdapter & { seen: ResumeOptions[] } {
  const seen: ResumeOptions[] = [];
  return {
    ...claudeCodeAdapter,
    seen,
    async resumeHeadless(_sessionId: string, options: ResumeOptions): Promise<ResumeResult> {
      seen.push(options);
      const code = await runCheckpoint(
        { session: ULID },
        {
          readStdin: stdinFrom(PAYLOAD),
          stdout: () => {},
          stderr: (line) => err.push(line),
          cwd: repo,
          home,
          now: () => new Date("2026-09-09T13:00:00.000Z"),
          newId: () => "WL-01JBQK0000000000000000000B",
        },
      );
      return { exitCode: code, timedOut: false, output: "" };
    },
  };
}

/** An adapter whose resume is killed by the timeout without recording anything. */
function timingOutAdapter(): HarnessAdapter {
  return {
    ...claudeCodeAdapter,
    async resumeHeadless(): Promise<ResumeResult> {
      return { exitCode: null, timedOut: true, output: "" };
    },
  };
}

function repairIo(adapter: HarnessAdapter) {
  return {
    db,
    root: repo,
    adapter,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    now: () => new Date("2026-09-09T13:00:00.000Z"),
    newId,
  };
}

function frontmatter() {
  return parseSessionText(readFileSync(sessionFile(repo, ULID), "utf8"));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "wl-repair-"));
  repo = path.join(dir, "repo");
  home = path.join(dir, "home");
  writeFileAtomic(path.join(repo, ".workledger", "config.yaml"), "orphan_minutes: 30\n");
  writeFileSync(path.join(repo, ".workledger", ".keep"), "", "utf8");
  db = openIndex({ home });
  out = [];
  err = [];
  ids = 0;
});

afterEach(() => {
  db.close();
  delete process.env[CLAUDE_BIN_ENV];
  rmSync(dir, { recursive: true, force: true });
});

describe("runRepair — resume path", () => {
  it("stamps trigger: repair, marks the session repaired, and completes the job", async () => {
    crashedSession();
    const adapter = checkpointingAdapter();

    const code = await runRepair(ULID, {}, repairIo(adapter));

    expect(code, err.join("\n")).toBe(EXIT_OK);
    const parsed = frontmatter();
    expect(parsed.frontmatter.checkpoints).toHaveLength(1);
    expect(parsed.frontmatter.checkpoints[0]?.trigger).toBe("repair");
    expect(parsed.frontmatter.status).toBe("repaired");
    expect(parsed.frontmatter.needs_repair).toBe(false);
    expect(db.getSessionByUlid(ULID)?.status).toBe("repaired");
    // Consumed exactly once: a later checkpoint in the same session is an ordinary one.
    expect(db.getSessionByUlid(ULID)?.pending_trigger).toBeNull();

    const jobs = listJobs(db, repo);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "repair", status: "done", attempts: 1 });
    expect(out).toContain(`repair: session ${ULID} repaired`);
  });

  it("pins the resumed session to the repo, the checkpoint command, and the timeout", async () => {
    crashedSession();
    const adapter = checkpointingAdapter();

    await runRepair(ULID, { timeout: 42 }, repairIo(adapter));

    const options = adapter.seen[0] as ResumeOptions;
    expect(options.cwd).toBe(repo);
    expect(options.allowedTools).toEqual(["Bash(workledger checkpoint*)"]);
    expect(options.timeoutMs).toBe(42_000);
    expect(options.instruction).toContain(`workledger checkpoint --session ${ULID}`);
    expect(options.instruction).toContain("crashed");
  });

  it("names the span when the session already has checkpoints", async () => {
    crashedSession();
    db.insertCheckpoint({
      session_ulid: ULID,
      n: 1,
      at: "2026-09-09T09:30:00.000Z",
      transcript_offset: 10,
      turns: 2,
      trigger: "turns",
    });
    const adapter = checkpointingAdapter();

    await runRepair(ULID, {}, repairIo(adapter));

    expect((adapter.seen[0] as ResumeOptions).instruction).toContain("since checkpoint 1");
  });

  it("leaves the session crashed and fails the job when the resume times out", async () => {
    crashedSession();

    const code = await runRepair(ULID, { timeout: 7 }, repairIo(timingOutAdapter()));

    expect(code).toBe(EXIT_JOB_FAILED);
    expect(frontmatter().frontmatter.status).toBe("crashed");
    expect(frontmatter().frontmatter.needs_repair).toBe(true);
    expect(db.getSessionByUlid(ULID)?.status).toBe("crashed");
    expect(db.getSessionByUlid(ULID)?.pending_trigger).toBeNull();

    const job = listJobs(db, repo)[0];
    expect(job).toMatchObject({ status: "failed", attempts: 1 });
    expect(job?.error).toContain("killed after 7s");
    expect(err.join("\n")).toContain(`workledger repair ${ULID} --extract`);
  });

  it("fails the job when the harness cannot be started", async () => {
    crashedSession();
    const adapter: HarnessAdapter = {
      ...claudeCodeAdapter,
      async resumeHeadless(): Promise<ResumeResult> {
        return { exitCode: null, timedOut: false, output: "", spawnError: "spawn claude ENOENT" };
      },
    };

    expect(await runRepair(ULID, {}, repairIo(adapter))).toBe(EXIT_JOB_FAILED);
    expect(getJob(db, listJobs(db, repo)[0]?.id as string)?.error).toContain("ENOENT");
  });

  it("fails when the harness exits 0 without recording anything", async () => {
    crashedSession();
    const adapter: HarnessAdapter = {
      ...claudeCodeAdapter,
      async resumeHeadless(): Promise<ResumeResult> {
        return { exitCode: 0, timedOut: false, output: "done" };
      },
    };

    expect(await runRepair(ULID, {}, repairIo(adapter))).toBe(EXIT_JOB_FAILED);
    expect(listJobs(db, repo)[0]?.error).toContain("no checkpoint");
  });

  it("reports an adapter with no headless resume without queueing anything", async () => {
    crashedSession();
    const adapter: HarnessAdapter = { ...claudeCodeAdapter };
    delete (adapter as { resumeHeadless?: unknown }).resumeHeadless;

    expect(await runRepair(ULID, {}, repairIo(adapter))).toBe(EXIT_JOB_FAILED);
    expect(listJobs(db, repo)).toEqual([]);
    expect(err.join("\n")).toContain("cannot resume a session headlessly");
  });
});

describe("runRepair — eligibility and --extract", () => {
  it("rejects an unknown session and one from another repo", async () => {
    expect(await runRepair(ULID, {}, repairIo(claudeCodeAdapter))).toBe(EXIT_USAGE);
    expect(err.join("\n")).toContain(`no session ${ULID}`);

    db.insertSession({
      ulid: ULID,
      repo_path: path.join(dir, "elsewhere"),
      harness: "claude-code",
      harness_session_id: "hs-1",
      status: "crashed",
    });
    expect(await runRepair(ULID, {}, repairIo(claudeCodeAdapter))).toBe(EXIT_USAGE);
    expect(err.join("\n")).toContain("belongs to");
  });

  it("refuses an open session without --force and accepts it with one", async () => {
    crashedSession("open", false);

    expect(await runRepair(ULID, {}, repairIo(checkpointingAdapter()))).toBe(EXIT_USAGE);
    expect(err.join("\n")).toContain("--force");

    expect(await runRepair(ULID, { force: true }, repairIo(checkpointingAdapter()))).toBe(EXIT_OK);
  });

  it("repairs an ended session only when it is marked needs_repair", async () => {
    crashedSession("ended", false);
    expect(await runRepair(ULID, {}, repairIo(checkpointingAdapter()))).toBe(EXIT_USAGE);
    expect(err.join("\n")).toContain("needs_repair");

    db.close();
    rmSync(path.join(repo, ".workledger", "sessions"), { recursive: true, force: true });
    db = openIndex({ home });
    db.connection.prepare("DELETE FROM sessions").run();
    crashedSession("ended", true);
    expect(await runRepair(ULID, {}, repairIo(checkpointingAdapter()))).toBe(EXIT_OK);
  });

  it("hands --extract to the extraction path instead of resuming", async () => {
    crashedSession();
    const adapter = checkpointingAdapter();

    // No transcript path on the row, so extraction stops at its first check — which is enough to
    // establish that `--extract` took the other branch. The extraction path itself is covered end
    // to end, against a mocked `fetch`, in `extract.test.ts`.
    expect(await runRepair(ULID, { extract: true, yes: true }, repairIo(adapter))).toBe(
      EXIT_JOB_FAILED,
    );
    expect(err.join("\n")).toContain("has no transcript path");
    expect(adapter.seen, "--extract must never resume the session").toEqual([]);
    expect(listJobs(db, repo)).toEqual([]);
  });
});

describe("runRepair — the real adapter against a stub harness", () => {
  /** Install a fake `claude`; the real adapter finds it through the env var. */
  function fakeClaude(body: string): void {
    const bin = path.join(dir, "claude");
    writeFileSync(bin, `#!/bin/sh\n${body}\n`, "utf8");
    chmodSync(bin, 0o755);
    process.env[CLAUDE_BIN_ENV] = bin;
  }

  it("returns on the timeout even when the harness left a grandchild running", async () => {
    crashedSession();
    // The shape of the real failure: `claude` backgrounds a tool and both outlive the timeout,
    // holding the stdio pipes they inherited. Killing one pid returned at T+30 s, not T+2 s.
    fakeClaude(["sh -c 'sleep 30' &", "echo $! > grandchild.pid", "sleep 30"].join("\n"));

    const started = Date.now();
    const code = await runRepair(ULID, { timeout: 2 }, repairIo(claudeCodeAdapter));
    const elapsed = Date.now() - started;

    expect(code).toBe(EXIT_JOB_FAILED);
    expect(elapsed, `repair returned after ${elapsed} ms`).toBeLessThan(5000);
    expect(listJobs(db, repo)[0]).toMatchObject({ status: "failed" });
    expect(listJobs(db, repo)[0]?.error).toContain("killed after 2s");

    // Written into the child's cwd, which `repair` pins to the repo — asserting that too.
    const pid = Number(readFileSync(path.join(repo, "grandchild.pid"), "utf8").trim());
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Signal 0 only tests for existence. The grandchild must have gone with the group.
    expect(() => process.kill(pid, 0), `pid ${pid} survived the kill`).toThrow(/ESRCH/);

    // And the session is untouched: a repair that killed its harness repaired nothing.
    expect(frontmatter().frontmatter.status).toBe("crashed");
    expect(db.getSessionByUlid(ULID)?.pending_trigger).toBeNull();
  });
});
