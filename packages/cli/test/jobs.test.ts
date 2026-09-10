/**
 * The job queue and its runner — docs/contracts/p3/cli.md §Jobs.
 *
 * Everything here runs against a real SQLite index under a temp `WORKLEDGER_HOME`: the semantics
 * being asserted are the table's (a partial unique index, a conditional UPDATE, a heartbeat
 * cutoff), and a fake queue would assert nothing about them.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEAD_JOB_MS,
  MAX_ATTEMPTS,
  cancelJob,
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  findActiveJob,
  getJob,
  heartbeat,
  listJobs,
  requeueDeadJobs,
  retryJob,
} from "../src/jobs/queue.js";
import { runJobs } from "../src/jobs/runner.js";
import { runJobsCommand } from "../src/commands/jobs.js";
import { openIndex } from "../src/index/db.js";
import type { IndexDb } from "../src/index/db.js";
import type { JobRow } from "../src/jobs/queue.js";

const REPO = "/tmp/repo-a";
const OTHER_REPO = "/tmp/repo-b";

let home: string;
let db: IndexDb;
let ids = 0;

/** Monotonic, sortable, and readable in a failure message — a stand-in for the ULID factory. */
function newId(): string {
  ids += 1;
  return `JOB${String(ids).padStart(23, "0")}`;
}

/** A minimal session row, so the job's `session_ulid` points at something real. */
function session(ulid: string, repo = REPO): string {
  db.insertSession({
    ulid,
    repo_path: repo,
    harness: "claude-code",
    harness_session_id: `hs-${ulid}`,
    status: "crashed",
  });
  return ulid;
}

function queue(sessionUlid: string, repo = REPO, now = new Date("2026-09-09T10:00:00.000Z")): JobRow {
  return enqueueJob(db, { kind: "repair", sessionUlid, repoPath: repo, newId, now }).job;
}

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "wl-jobs-"));
  db = openIndex({ home });
  ids = 0;
});

afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

describe("enqueueJob", () => {
  it("queues one job and returns the same row for a second enqueue of the same pair", () => {
    session("S1");
    const first = enqueueJob(db, {
      kind: "repair",
      sessionUlid: "S1",
      repoPath: REPO,
      newId,
      now: new Date(),
    });
    const second = enqueueJob(db, {
      kind: "repair",
      sessionUlid: "S1",
      repoPath: REPO,
      newId,
      now: new Date(),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(listJobs(db, REPO)).toHaveLength(1);
  });

  it("frees the (kind, session) pair once the job is done", () => {
    session("S1");
    const first = queue("S1");
    completeJob(db, first.id, new Date());
    expect(findActiveJob(db, "repair", "S1")).toBeUndefined();

    const second = enqueueJob(db, {
      kind: "repair",
      sessionUlid: "S1",
      repoPath: REPO,
      newId,
      now: new Date(),
    });
    expect(second.created).toBe(true);
    expect(second.job.id).not.toBe(first.id);
  });

  it("keeps a failed job in the way of a duplicate, so scan re-uses it", () => {
    session("S1");
    const job = queue("S1");
    claimJob(db, { repoPath: REPO, now: new Date() });
    failJob(db, job.id, new Date(), { error: "timed out" });

    const again = enqueueJob(db, {
      kind: "repair",
      sessionUlid: "S1",
      repoPath: REPO,
      newId,
      now: new Date(),
    });
    expect(again.created).toBe(false);
    expect(again.job.status).toBe("failed");
  });
});

describe("claimJob", () => {
  it("moves the oldest queued job to running and increments attempts", () => {
    session("S1");
    session("S2");
    queue("S1", REPO, new Date("2026-09-09T10:00:00.000Z"));
    queue("S2", REPO, new Date("2026-09-09T11:00:00.000Z"));

    const claimed = claimJob(db, { repoPath: REPO, now: new Date("2026-09-09T12:00:00.000Z") });
    expect(claimed?.session_ulid).toBe("S1");
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
    expect(getJob(db, claimed?.id as string)?.heartbeat_at).toBe("2026-09-09T12:00:00.000Z");
  });

  it("hands each queued row to exactly one claim", () => {
    session("S1");
    session("S2");
    queue("S1");
    queue("S2");

    const a = claimJob(db, { repoPath: REPO, now: new Date() });
    const b = claimJob(db, { repoPath: REPO, now: new Date() });
    const c = claimJob(db, { repoPath: REPO, now: new Date() });
    expect([a?.id, b?.id].sort()).toEqual([a?.id, b?.id].sort());
    expect(a?.id).not.toBe(b?.id);
    expect(c).toBeUndefined();
  });

  it("never crosses repos, kinds, or sessions", () => {
    session("S1");
    session("S2", OTHER_REPO);
    queue("S1");
    queue("S2", OTHER_REPO);

    expect(claimJob(db, { repoPath: REPO, now: new Date(), kinds: ["extract"] })).toBeUndefined();
    expect(
      claimJob(db, { repoPath: REPO, now: new Date(), sessionUlid: "S2" }),
    ).toBeUndefined();
    expect(claimJob(db, { repoPath: OTHER_REPO, now: new Date() })?.session_ulid).toBe("S2");
  });
});

describe("requeueDeadJobs", () => {
  it("re-queues a running job whose heartbeat went stale, keeping the attempt count", () => {
    session("S1");
    const start = new Date("2026-09-09T10:00:00.000Z");
    queue("S1");
    const claimed = claimJob(db, { repoPath: REPO, now: start }) as JobRow;

    const later = new Date(start.getTime() + DEAD_JOB_MS + 1000);
    expect(requeueDeadJobs(db, later)).toEqual({ requeued: 1, failed: 0 });

    const row = getJob(db, claimed.id) as JobRow;
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(row.started_at).toBeNull();
    expect(row.heartbeat_at).toBeNull();
  });

  it("leaves a running job alone while its heartbeat is fresh", () => {
    session("S1");
    const start = new Date("2026-09-09T10:00:00.000Z");
    queue("S1");
    const claimed = claimJob(db, { repoPath: REPO, now: start }) as JobRow;

    const later = new Date(start.getTime() + DEAD_JOB_MS + 1000);
    heartbeat(db, claimed.id, later);
    expect(requeueDeadJobs(db, later)).toEqual({ requeued: 0, failed: 0 });
    expect(getJob(db, claimed.id)?.status).toBe("running");
  });

  it("fails a job that has been claimed the maximum number of times", () => {
    session("S1");
    let at = new Date("2026-09-09T10:00:00.000Z");
    const job = queue("S1");
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      expect(claimJob(db, { repoPath: REPO, now: at })).toBeDefined();
      at = new Date(at.getTime() + DEAD_JOB_MS + 1000);
      requeueDeadJobs(db, at);
    }

    const row = getJob(db, job.id) as JobRow;
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.status).toBe("failed");
    expect(row.error).toContain(String(MAX_ATTEMPTS));
    // And it stays failed: the sweep must not hand it back out a fourth time.
    expect(claimJob(db, { repoPath: REPO, now: at })).toBeUndefined();
  });
});

describe("cancelJob and retryJob", () => {
  it("cancels a queued job and a running one, and refuses a finished one", () => {
    session("S1");
    session("S2");
    const queued = queue("S1");
    const running = queue("S2");
    claimJob(db, { repoPath: REPO, now: new Date(), sessionUlid: "S2" });

    expect(cancelJob(db, queued.id, new Date())).toMatchObject({ status: "cancelled" });
    expect(cancelJob(db, running.id, new Date())).toMatchObject({ status: "cancelled" });
    expect(cancelJob(db, queued.id, new Date())).toMatchObject({ message: expect.stringContaining("cancelled") });
    expect(cancelJob(db, "nope", new Date())).toMatchObject({ message: "no job nope" });
  });

  it("re-queues a failed job with a clean attempt count, and refuses a queued one", () => {
    session("S1");
    const job = queue("S1");
    claimJob(db, { repoPath: REPO, now: new Date() });
    failJob(db, job.id, new Date(), { error: "the resumed session exited 1" });

    expect(retryJob(db, job.id)).toMatchObject({ status: "queued", attempts: 0 });
    const row = getJob(db, job.id) as JobRow;
    expect(row.error).toBeNull();
    expect(row.finished_at).toBeNull();

    expect(retryJob(db, job.id)).toMatchObject({ message: expect.stringContaining("queued") });
    expect(retryJob(db, "nope")).toMatchObject({ message: "no job nope" });
  });

  it("re-queues a cancelled job", () => {
    session("S1");
    const job = queue("S1");
    cancelJob(db, job.id, new Date());
    expect(retryJob(db, job.id)).toMatchObject({ status: "queued" });
  });
});

describe("listJobs", () => {
  it("lists one repo's jobs newest first", () => {
    session("S1");
    session("S2");
    queue("S1", REPO, new Date("2026-09-09T10:00:00.000Z"));
    queue("S2", REPO, new Date("2026-09-09T11:00:00.000Z"));
    session("S3", OTHER_REPO);
    queue("S3", OTHER_REPO);

    expect(listJobs(db, REPO).map((job) => job.session_ulid)).toEqual(["S2", "S1"]);
  });
});

describe("runJobs", () => {
  it("runs every queued job, recording done and failed separately", async () => {
    for (const ulid of ["S1", "S2", "S3"]) {
      session(ulid);
      queue(ulid);
    }

    const seen: string[] = [];
    const summary = await runJobs(db, {
      repoPath: REPO,
      kinds: ["repair"],
      concurrency: 2,
      now: () => new Date(),
      handler: async (job) => {
        seen.push(job.session_ulid);
        return { ok: job.session_ulid !== "S2", error: "no" };
      },
    });

    expect(seen.sort()).toEqual(["S1", "S2", "S3"]);
    expect(summary).toEqual({ done: 2, failed: 1, requeued: 0 });
    expect(listJobs(db, REPO).filter((job) => job.status === "done")).toHaveLength(2);
    const failed = listJobs(db, REPO).find((job) => job.status === "failed");
    expect(failed?.error).toBe("no");
  });

  it("writes a handler's output to <logDir>/<job>.log and records log_path, done or failed (#97)", async () => {
    session("S1");
    session("S2");
    session("S3");
    queue("S1");
    queue("S2");
    queue("S3");
    const logDir = path.join(home, "logs");

    await runJobs(db, {
      repoPath: REPO,
      concurrency: 1,
      now: () => new Date(),
      logDir,
      handler: async (job) => {
        if (job.session_ulid === "S1") return { ok: true, output: "ok log" };
        if (job.session_ulid === "S2") return { ok: false, error: "no", output: "failed log" };
        return { ok: true };
      },
    });

    const byUlid = new Map(listJobs(db, REPO).map((job) => [job.session_ulid, job]));
    const s1 = byUlid.get("S1")!;
    const s2 = byUlid.get("S2")!;
    expect(s1.log_path).toBe(path.join(logDir, `${s1.id}.log`));
    expect(readFileSync(s1.log_path!, "utf8")).toBe("ok log");
    expect(s2).toMatchObject({ status: "failed", error: "no" });
    expect(readFileSync(s2.log_path!, "utf8")).toBe("failed log");
    // No output, no log: the row says so rather than pointing at an empty file.
    expect(byUlid.get("S3")!.log_path).toBeNull();
    expect(existsSync(path.join(logDir, `${byUlid.get("S3")!.id}.log`))).toBe(false);
  });

  it("never runs more than `concurrency` jobs at a time", async () => {
    for (const ulid of ["S1", "S2", "S3", "S4"]) {
      session(ulid);
      queue(ulid);
    }

    let inFlight = 0;
    let peak = 0;
    await runJobs(db, {
      repoPath: REPO,
      concurrency: 2,
      now: () => new Date(),
      handler: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { ok: true };
      },
    });

    expect(peak).toBe(2);
    expect(listJobs(db, REPO).every((job) => job.status === "done")).toBe(true);
  });

  it("stops after `limit` jobs and leaves the rest queued", async () => {
    for (const ulid of ["S1", "S2"]) {
      session(ulid);
      queue(ulid);
    }

    const summary = await runJobs(db, {
      repoPath: REPO,
      concurrency: 1,
      limit: 1,
      now: () => new Date(),
      handler: async () => ({ ok: true }),
    });

    expect(summary.done).toBe(1);
    expect(listJobs(db, REPO).filter((job) => job.status === "queued")).toHaveLength(1);
  });

  it("refreshes the heartbeat while a job is running", async () => {
    session("S1");
    const job = queue("S1");
    let beats = 0;

    await runJobs(db, {
      repoPath: REPO,
      concurrency: 1,
      heartbeatMs: 5,
      now: () => new Date(),
      handler: async () => {
        const before = getJob(db, job.id)?.heartbeat_at;
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (getJob(db, job.id)?.heartbeat_at !== before) beats += 1;
        return { ok: true };
      },
    });

    expect(beats).toBe(1);
  });

  it("re-queues a dead runner's job before it claims anything", async () => {
    session("S1");
    const job = queue("S1");
    claimJob(db, { repoPath: REPO, now: new Date(Date.now() - DEAD_JOB_MS - 5000) });

    const summary = await runJobs(db, {
      repoPath: REPO,
      concurrency: 1,
      now: () => new Date(),
      handler: async () => ({ ok: true }),
    });

    expect(summary.requeued).toBe(1);
    expect(summary.done).toBe(1);
    // Once by the dead runner, once by this one.
    expect(getJob(db, job.id)?.attempts).toBe(2);
  });

  it("records a throwing handler as a failure rather than propagating it", async () => {
    session("S1");
    const job = queue("S1");

    const summary = await runJobs(db, {
      repoPath: REPO,
      concurrency: 1,
      now: () => new Date(),
      handler: async () => {
        throw new Error("harness exploded");
      },
    });

    expect(summary.failed).toBe(1);
    expect(getJob(db, job.id)?.error).toBe("harness exploded");
  });

  it("keeps a cancel that landed while the job was running", async () => {
    session("S1");
    const job = queue("S1");

    const summary = await runJobs(db, {
      repoPath: REPO,
      concurrency: 1,
      now: () => new Date(),
      handler: async () => {
        cancelJob(db, job.id, new Date());
        return { ok: true };
      },
    });

    expect(summary).toEqual({ done: 0, failed: 0, requeued: 0 });
    expect(getJob(db, job.id)?.status).toBe("cancelled");
  });
});

describe("workledger jobs", () => {
  /** The command with its streams captured. */
  function run(options: Parameters<typeof runJobsCommand>[0]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = runJobsCommand(options, {
      db,
      root: REPO,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
      now: () => new Date("2026-09-09T12:00:00.000Z"),
    });
    return { code, out, err };
  }

  it("lists the repo's jobs, newest first, and says so when there are none", () => {
    expect(run({}).out).toEqual(["jobs: none"]);

    session("S1");
    session("S2");
    queue("S1", REPO, new Date("2026-09-09T10:00:00.000Z"));
    queue("S2", REPO, new Date("2026-09-09T11:00:00.000Z"));

    const listed = run({});
    expect(listed.code).toBe(0);
    expect(listed.out).toHaveLength(2);
    expect(listed.out[0]).toContain("S2");
    expect(listed.out[0]).toContain("queued");
    expect(listed.out[1]).toContain("S1");
  });

  it("emits one JSON object with --json", () => {
    session("S1");
    queue("S1");

    const listed = run({ json: true });
    const payload = JSON.parse(listed.out[0] as string) as { repo: string; jobs: JobRow[] };
    expect(payload.repo).toBe(REPO);
    expect(payload.jobs[0]).toMatchObject({ session_ulid: "S1", status: "queued" });
  });

  it("cancels and retries by id, and reports a bad id as a usage error", () => {
    session("S1");
    const job = queue("S1");

    expect(run({ cancel: job.id }).code).toBe(0);
    expect(getJob(db, job.id)?.status).toBe("cancelled");

    expect(run({ retry: job.id }).code).toBe(0);
    expect(getJob(db, job.id)?.status).toBe("queued");

    const bad = run({ cancel: "nope" });
    expect(bad.code).toBe(1);
    expect(bad.err[0]).toContain("no job nope");
  });

  it("refuses --cancel and --retry together", () => {
    const both = run({ cancel: "a", retry: "b" });
    expect(both.code).toBe(1);
    expect(both.err[0]).toContain("mutually exclusive");
  });

  it("shows the failure reason in the listing", () => {
    session("S1");
    const job = queue("S1");
    claimJob(db, { repoPath: REPO, now: new Date() });
    failJob(db, job.id, new Date(), { error: "the resumed session was killed after 300s" });

    expect(run({}).out[0]).toContain("killed after 300s");
  });
});
