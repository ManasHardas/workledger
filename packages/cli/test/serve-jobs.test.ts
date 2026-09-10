/**
 * The index-backed ops `workledger serve` injects into `@workledger/server` (#55), and the
 * 5-minute orphan sweep it runs while it is up (docs/contracts/p3/cli.md §scan).
 *
 * These live in `packages/cli` rather than in `packages/server` for the same reason
 * `serve.test.ts` does: they are the only tests with both halves in reach. The server package
 * asserts the routes against fake ops; this file asserts that the *real* ops read and write the
 * real `index.sqlite`, so a drift between the two shows up as a failure here rather than as a
 * 500 in front of a user.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openIndex } from "../src/index/db.js";
import { enqueueJob, getJob, listJobs } from "../src/jobs/queue.js";
import { jobOps, serveCommand } from "../src/commands/serve.js";
import { EXIT_OK } from "../src/exit-codes.js";
import { sessionFile, writeFileAtomic } from "../src/ledger-fs.js";
import type { IndexDb } from "../src/index/db.js";
import type { ServeIo } from "../src/commands/serve.js";

const SESSION = "01JQ8ZK4T0000000000000000A";

let dir: string;
let repo: string;
let home: string;
let db: IndexDb;
let ids = 0;

function newId(): string {
  ids += 1;
  return `JOB${String(ids).padStart(23, "0")}`;
}

/** The io the ops read: only `env`, for `WORKLEDGER_HOME`, plus the two sinks. */
function io(): ServeIo & { err: string[]; out: string[]; stop: AbortController } {
  const err: string[] = [];
  const out: string[] = [];
  const stop = new AbortController();
  return {
    cwd: repo,
    env: { WORKLEDGER_HOME: home },
    err,
    out,
    stop,
    signal: stop.signal,
    stdout: (text) => void out.push(text),
    stderr: (line) => void err.push(line),
    openUrl: () => {},
  };
}

/** Frontmatter in the shape `hook SessionStart` writes. */
function sessionText(ulid: string): string {
  return [
    "---",
    "schema_version: 1",
    `id: ${ulid}`,
    "harness: claude-code",
    `harness_session_id: hs-${ulid}`,
    "repo: example/repo",
    "branch: main",
    "author: { name: Tester, email: t@example.com }",
    "started: 2026-09-09T09:00:00.000Z",
    "status: open",
    "private: false",
    "source: live",
    "needs_repair: false",
    "checkpoint_failures: 0",
    "checkpoints: []",
    "---",
    "",
    "# Session",
    "",
  ].join("\n");
}

/** An open session whose transcript was last written `idleMinutes` ago. */
function openSession(ulid: string, idleMinutes: number): string {
  const transcript = path.join(dir, `${ulid}.jsonl`);
  writeFileSync(transcript, '{"type":"user","message":{"role":"user","content":"hi"}}\n', "utf8");
  const at = (Date.now() - idleMinutes * 60_000) / 1000;
  utimesSync(transcript, at, at);

  writeFileAtomic(sessionFile(repo, ulid), sessionText(ulid));
  db.insertSession({
    ulid,
    repo_path: repo,
    harness: "claude-code",
    harness_session_id: `hs-${ulid}`,
    status: "open",
    transcript_path: transcript,
    turns_since_checkpoint: 3,
    updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  });
  return transcript;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "wl-serve-jobs-"));
  repo = path.join(dir, "repo");
  home = path.join(dir, "home");
  mkdirSync(path.join(repo, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(repo, ".workledger", "backlog"), { recursive: true });
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  writeFileSync(path.join(repo, ".git", "config"), "[user]\n\tname = T\n\temail = t@example.com\n", "utf8");
  db = openIndex({ home });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("jobOps", () => {
  it("lists this repo's jobs and filters by status", async () => {
    enqueueJob(db, { kind: "repair", sessionUlid: SESSION, repoPath: repo, newId, now: new Date() });
    enqueueJob(db, { kind: "repair", sessionUlid: "OTHER", repoPath: "/elsewhere", newId, now: new Date() });
    const ops = jobOps(io(), () => {});

    const all = await ops.listJobs(repo);
    expect(all.map((job) => job.session_ulid)).toEqual([SESSION]);
    expect(await ops.listJobs(repo, "queued")).toHaveLength(1);
    expect(await ops.listJobs(repo, "running")).toHaveLength(0);
  });

  it("sweeps orphans and reports { orphaned, queued }", async () => {
    openSession(SESSION, 120);
    const ops = jobOps(io(), () => {});

    expect(await ops.scan(repo)).toEqual({ orphaned: 1, queued: 1 });
    expect(db.getSessionByUlid(SESSION)?.status).toBe("crashed");
    expect(listJobs(db, repo)).toHaveLength(1);
    // The sweep only looks at `open` rows, so the session it just marked `crashed` is not swept
    // a second time — one repair job per crash, not one per tick.
    expect(await ops.scan(repo)).toEqual({ orphaned: 0, queued: 0 });
    expect(listJobs(db, repo)).toHaveLength(1);
  });

  it("queues a repair job and hands the resume off to the runner", async () => {
    openSession(SESSION, 120);
    const started: string[] = [];
    const ops = jobOps(io(), (ulid) => void started.push(ulid));

    const job = await ops.repair(repo, { session: SESSION, extract: false, consent: false });

    expect(job.kind).toBe("repair");
    expect(job.status).toBe("queued");
    expect(getJob(db, job.id)?.session_ulid).toBe(SESSION);
    expect(started).toEqual([SESSION]);
  });

  it("queues an extract job — not a resume — once consent is given", async () => {
    openSession(SESSION, 120);
    const started: string[] = [];
    const ops = jobOps(io(), (ulid) => void started.push(ulid));

    const job = await ops.repair(repo, { session: SESSION, extract: true, consent: true });

    expect(job.kind).toBe("extract");
    // The resume path is what `startRepair` runs, and an extraction is not a resume.
    expect(started).toEqual([]);
  });

  it("refuses a repair for a session that is not in this repo's index", async () => {
    const ops = jobOps(io(), () => {});

    await expect(ops.repair(repo, { session: SESSION, extract: false, consent: false })).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("cancels and retries, and reports the refusals with the codes the routes map", async () => {
    const { job } = enqueueJob(db, {
      kind: "repair",
      sessionUlid: SESSION,
      repoPath: repo,
      newId,
      now: new Date(),
    });
    const ops = jobOps(io(), () => {});

    expect((await ops.cancelJob(repo, job.id)).status).toBe("cancelled");
    expect((await ops.retryJob(repo, job.id)).status).toBe("queued");

    await expect(ops.cancelJob(repo, "nope")).rejects.toMatchObject({ code: "not-found" });
    // A queued job cannot be retried — only a failed or cancelled one.
    await expect(ops.retryJob(repo, job.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("resolves the excerpt span as [offset(n-1), offset(n))", async () => {
    const transcript = openSession(SESSION, 5);
    for (const [n, offset] of [[1, 400], [2, 900]] as const) {
      db.insertCheckpoint({
        session_ulid: SESSION,
        n,
        at: "2026-09-09T10:00:00.000Z",
        transcript_offset: offset,
        turns: n,
        trigger: "turns",
      });
    }
    const ops = jobOps(io(), () => {});

    expect(await ops.excerptSpan(repo, SESSION, 1)).toEqual({ transcriptPath: transcript, from: 0, to: 400 });
    expect(await ops.excerptSpan(repo, SESSION, 2)).toEqual({ transcriptPath: transcript, from: 400, to: 900 });
    // No such checkpoint, no such session, and a session belonging to another repo.
    expect(await ops.excerptSpan(repo, SESSION, 3)).toBeUndefined();
    expect(await ops.excerptSpan(repo, "MISSING", 1)).toBeUndefined();
    expect(await ops.excerptSpan("/elsewhere", SESSION, 1)).toBeUndefined();
  });
});

describe("workledger serve", () => {
  it("serves /api/jobs from the index and sweeps orphans on its own tick", async () => {
    openSession(SESSION, 120);
    const it_ = io();

    const running = serveCommand({ open: false, repo, scanIntervalMs: 30 }, it_);
    await vi.waitFor(() => expect(it_.out[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/), { timeout: 5000 });
    const url = it_.out[0]!;

    // The sweep runs on the interval, not at startup, so the queue fills without anyone asking.
    await vi.waitFor(async () => {
      const response = await fetch(`${url}/api/jobs`);
      expect(((await response.json()) as unknown[]).length).toBe(1);
    }, { timeout: 5000 });

    const jobs = (await (await fetch(`${url}/api/jobs`)).json()) as { kind: string; session_ulid: string }[];
    expect(jobs[0]).toMatchObject({ kind: "repair", session_ulid: SESSION });
    expect(db.getSessionByUlid(SESSION)?.status).toBe("crashed");

    it_.stop.abort();
    expect(await running).toBe(EXIT_OK);
  });

  it("serves an excerpt over HTTP from the transcript the index points at", async () => {
    const transcript = openSession(SESSION, 5);
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", message: { role: "user", content: "ship it" } }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "done" }, { type: "tool_use", name: "Bash", input: {} }] },
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    db.insertCheckpoint({
      session_ulid: SESSION,
      n: 1,
      at: "2026-09-09T10:00:00.000Z",
      transcript_offset: 10_000,
      turns: 2,
      trigger: "turns",
    });

    const it_ = io();
    const running = serveCommand({ open: false, repo, scanIntervalMs: 3_600_000 }, it_);
    await vi.waitFor(() => expect(it_.out[0]).toMatch(/^http:/), { timeout: 5000 });

    const response = await fetch(`${it_.out[0]!}/api/sessions/${SESSION}/excerpt?cp=1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cp: 1,
      turns: [
        { role: "user", text: "ship it", tools: 0 },
        { role: "assistant", text: "done", tools: 1 },
      ],
    });

    it_.stop.abort();
    expect(await running).toBe(EXIT_OK);
  });
});
