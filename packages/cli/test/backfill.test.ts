/**
 * `workledger backfill` — docs/contracts/p3/cli.md §`workledger backfill`.
 *
 * The three fixture transcripts under `test/fixtures/transcripts/` are copied into a temp `HOME`
 * laid out the way Claude Code lays out its store (`~/.claude/projects/<slug>/<id>.jsonl`), with
 * the temp repo's path substituted for the fixtures' `__CWD__` — so the enumeration is exercised
 * against a real directory tree, real `stat`s and real first records rather than against a mock
 * of the filesystem.
 *
 * The harness is faked exactly as `repair.test.ts` fakes it: the stand-in `claude` spends its
 * resumed turn running `runCheckpoint`, which is what a real resumed session is instructed to do.
 * That makes the two assertions this issue turns on — `source: backfill` in the frontmatter and
 * `trigger: repair` on the stamp — assertions about a checkpoint written through the real command.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseSessionText } from "@workledger/core";

import { EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { openIndex } from "../src/index/db.js";
import { cancelJob, listJobs, retryJob } from "../src/jobs/queue.js";
import { runCheckpoint, stdinFrom } from "../src/commands/checkpoint.js";
import {
  CLAUDE_STORE,
  enumerateStore,
  filterSince,
  formatDuration,
  planBackfill,
  projectSlug,
  runBackfill,
  summaryLine,
} from "../src/commands/backfill.js";
import { sessionFile, writeFileAtomic } from "../src/ledger-fs.js";
import type { BackfillIo } from "../src/commands/backfill.js";
import type { HarnessAdapter, ResumeOptions, ResumeResult } from "../src/adapters/types.js";
import type { IndexDb } from "../src/index/db.js";

/** `packages/cli/test/fixtures/transcripts/`. */
const FIXTURES = fileURLToPath(new URL("./fixtures/transcripts/", import.meta.url));

/** The fixture session ids, oldest first. */
const IDS = ["hs-alpha", "hs-beta", "hs-gamma"] as const;

/** Fixed mtimes, so `--since` is tested against a clock the test controls. */
const NOW = new Date("2026-09-09T12:00:00.000Z");
/** hs-alpha is 20 days old, hs-beta 12, hs-gamma 5 — one per side of every window. */
const AGE_DAYS: Record<string, number> = { "hs-alpha": 20, "hs-beta": 12, "hs-gamma": 5 };

let dir: string;
let repo: string;
let home: string;
let fakeHome: string;
let db: IndexDb;
let out: string[];
let err: string[];
let ids = 0;

function newId(): string {
  ids += 1;
  return `JOB${String(ids).padStart(23, "0")}`;
}

/** Copy the fixtures into `<fakeHome>/.claude/projects/<slug>/`, with `__CWD__` resolved. */
function seedStore(): void {
  const store = path.join(fakeHome, CLAUDE_STORE, projectSlug(repo));
  mkdirSync(store, { recursive: true });
  for (const id of IDS) {
    const text = readFileSync(path.join(FIXTURES, `${id}.jsonl`), "utf8").replaceAll("__CWD__", repo);
    const file = path.join(store, `${id}.jsonl`);
    writeFileSync(file, text, "utf8");
    const at = new Date(NOW.getTime() - (AGE_DAYS[id] as number) * 24 * 60 * 60 * 1000);
    utimesSync(file, at, at);
  }
}

/** The payload a resumed agent pipes into `workledger checkpoint`. */
function payloadFor(ulid: string): string {
  return JSON.stringify({
    goal: `Describe what session ${ulid.slice(-4)} did`,
    done: [{ text: "Edited a file", files: ["src/health.ts"], verified: "not-verified" }],
    remaining: [],
    notes: [],
  });
}

/**
 * A harness whose resume records one checkpoint against whichever session it was handed.
 *
 * The ulid is read off the instruction rather than passed in, because that is the only channel
 * the real resumed agent has — `repair`'s instruction carries `--session <ulid>` and nothing else
 * tells the session which row it belongs to.
 */
function checkpointingAdapter(options: { failFor?: Set<string>; onResume?: () => void } = {}): HarnessAdapter & {
  seen: ResumeOptions[];
} {
  const seen: ResumeOptions[] = [];
  return {
    ...claudeCodeAdapter,
    seen,
    async resumeHeadless(sessionId: string, resumeOptions: ResumeOptions): Promise<ResumeResult> {
      seen.push(resumeOptions);
      options.onResume?.();
      if (options.failFor?.has(sessionId) === true) {
        return { exitCode: 1, timedOut: false, output: "the session could not be resumed" };
      }
      const ulid = /--session (\S+)/.exec(resumeOptions.instruction)?.[1] as string;
      const code = await runCheckpoint(
        { session: ulid },
        {
          readStdin: stdinFrom(payloadFor(ulid)),
          stdout: () => {},
          stderr: (line) => err.push(line),
          cwd: repo,
          home,
          now: () => NOW,
          newId: () => `WL-01JBQK000000000000000${String(seen.length).padStart(4, "0")}`,
        },
      );
      return { exitCode: code, timedOut: false, output: "" };
    },
  };
}

function backfillIo(adapter: HarnessAdapter, overrides: Partial<BackfillIo> = {}): BackfillIo {
  return {
    db,
    root: repo,
    adapter,
    homeDir: fakeHome,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    now: () => NOW,
    newId,
    confirm: async () => true,
    timeoutS: 5,
    home,
    ...overrides,
  };
}

/** Every backfilled session file in the repo, parsed. */
function sessions() {
  return db
    .connection.prepare<[], { ulid: string }>("SELECT ulid FROM sessions ORDER BY ulid")
    .all()
    .map((row) => parseSessionText(readFileSync(sessionFile(repo, row.ulid), "utf8")));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "wl-backfill-"));
  repo = path.join(dir, "repo");
  home = path.join(dir, "home");
  fakeHome = path.join(dir, "fakehome");
  writeFileAtomic(path.join(repo, ".workledger", "config.yaml"), "orphan_minutes: 30\n");
  writeFileSync(path.join(repo, ".workledger", ".keep"), "", "utf8");
  db = openIndex({ home });
  out = [];
  err = [];
  ids = 0;
  seedStore();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("store enumeration", () => {
  it("reads the slug directory's transcripts, newest first, from metadata only", () => {
    const found = enumerateStore(fakeHome, repo);

    expect(found.map((session) => session.harnessSessionId)).toEqual([
      "hs-gamma",
      "hs-beta",
      "hs-alpha",
    ]);
    const alpha = found.find((session) => session.harnessSessionId === "hs-alpha");
    expect(alpha?.startedIso).toBe("2026-08-20T09:00:00.000Z");
    expect(alpha?.cwd).toBe(repo);
    expect(alpha?.bytes).toBeGreaterThan(0);
    expect(alpha?.file.endsWith(path.join(projectSlug(repo), "hs-alpha.jsonl"))).toBe(true);
  });

  it("ignores a transcript whose first record names another repo, and non-transcripts", () => {
    const store = path.join(fakeHome, CLAUDE_STORE, projectSlug(repo));
    writeFileSync(
      path.join(store, "hs-elsewhere.jsonl"),
      `${JSON.stringify({ type: "user", cwd: "/somewhere/else", message: { role: "user", content: "hi" } })}\n`,
      "utf8",
    );
    writeFileSync(path.join(store, "notes.md"), "not a transcript", "utf8");
    writeFileSync(path.join(store, "hs-empty.jsonl"), "", "utf8");

    const found = enumerateStore(fakeHome, repo).map((session) => session.harnessSessionId);
    expect(found).toEqual(["hs-gamma", "hs-beta", "hs-alpha"]);
  });

  it("is empty for a repo the store has never seen", () => {
    expect(enumerateStore(fakeHome, path.join(dir, "other-repo"))).toEqual([]);
  });

  it("slugifies a path the way the harness does", () => {
    expect(projectSlug("/Users/x/Projects/work.ledger")).toBe("-Users-x-Projects-work-ledger");
  });
});

describe("--since filtering and the plan", () => {
  it("keeps only the sessions inside the window, by file mtime", () => {
    const found = enumerateStore(fakeHome, repo);

    const names = (since: string): string[] =>
      filterSince(found, since, NOW).map((session) => session.harnessSessionId);

    expect(names("7d")).toEqual(["hs-gamma"]);
    expect(names("14d")).toEqual(["hs-gamma", "hs-beta"]);
    expect(names("30d")).toEqual(["hs-gamma", "hs-beta", "hs-alpha"]);
    expect(names("all")).toEqual(["hs-gamma", "hs-beta", "hs-alpha"]);
  });

  it("splits the window into fresh and already-indexed, and prices the fresh half", () => {
    db.insertSession({
      ulid: "01JBQK0000000000000000000A",
      repo_path: repo,
      harness: "claude-code",
      harness_session_id: "hs-beta",
      status: "ended",
    });

    const plan = planBackfill(enumerateStore(fakeHome, repo), {
      db,
      harness: "claude-code",
      since: "all",
      now: NOW,
      concurrency: 2,
      secondsPerSession: 45,
    });

    expect(plan.fresh.map((session) => session.harnessSessionId)).toEqual(["hs-gamma", "hs-alpha"]);
    expect(plan.skipped.map((session) => session.harnessSessionId)).toEqual(["hs-beta"]);
    // 2 sessions × 45s ÷ concurrency 2.
    expect(plan.estimateSeconds).toBe(45);
    expect(plan.oldest).toBe(new Date(NOW.getTime() - 20 * 86_400_000).toISOString());
    expect(plan.totalBytes).toBe(
      plan.fresh.reduce((sum, session) => sum + session.bytes, 0),
    );
  });

  it("formats the estimate in the units an operator waits in", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(135)).toBe("2m 15s");
  });
});

describe("runBackfill", () => {
  it("rejects a --since window the contract does not define", async () => {
    expect(await runBackfill({ since: "3h" }, backfillIo(checkpointingAdapter()))).toBe(EXIT_USAGE);
    expect(err.join("\n")).toContain("--since must be one of");
  });

  it("--dry-run prints the table and the estimate, and records nothing", async () => {
    const adapter = checkpointingAdapter();

    const code = await runBackfill({ since: "all", dryRun: true }, backfillIo(adapter));

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      "sessions   3",
      expect.stringMatching(/^bytes {6}\d+$/) as unknown as string,
      `oldest     ${new Date(NOW.getTime() - 20 * 86_400_000).toISOString()}`,
      "estimate   ~1m 8s at concurrency 2",
      "skipped    0 (already indexed)",
    ]);
    expect(db.connection.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(listJobs(db, repo)).toEqual([]);
    expect(adapter.seen).toEqual([]);
  });

  it("digests three fixture sessions as source: backfill with trigger: repair stamps", async () => {
    const adapter = checkpointingAdapter();

    const code = await runBackfill({ since: "all", yes: true }, backfillIo(adapter));

    expect(code, err.join("\n")).toBe(EXIT_OK);
    expect(out).toContain(summaryLine(3, 0, 0));

    const parsed = sessions();
    expect(parsed).toHaveLength(3);
    for (const session of parsed) {
      expect(session.frontmatter.source).toBe("backfill");
      expect(session.frontmatter.status).toBe("repaired");
      expect(session.frontmatter.needs_repair).toBe(false);
      expect(session.frontmatter.checkpoints).toHaveLength(1);
      expect(session.frontmatter.checkpoints[0]?.trigger).toBe("repair");
    }
    // `started` comes from the first record's timestamp, not from the clock (data-flow §Backfill).
    expect(parsed.map((session) => session.frontmatter.started).sort()).toEqual([
      "2026-08-20T09:00:00.000Z",
      "2026-08-28T14:30:00.000Z",
      "2026-09-04T11:15:00.000Z",
    ]);
    // And the harness ids come from the filenames, which is what lets a resume find the session.
    expect(
      db.connection
        .prepare<[], { harness_session_id: string }>(
          "SELECT harness_session_id FROM sessions ORDER BY harness_session_id",
        )
        .all()
        .map((row) => row.harness_session_id),
    ).toEqual(["hs-alpha", "hs-beta", "hs-gamma"]);

    const jobs = listJobs(db, repo);
    expect(jobs).toHaveLength(3);
    expect(jobs.every((job) => job.kind === "repair" && job.status === "done")).toBe(true);
  });

  it("honours --since when it records, not just when it prints", async () => {
    await runBackfill({ since: "7d", yes: true }, backfillIo(checkpointingAdapter()));

    expect(sessions()).toHaveLength(1);
    expect(out).toContain(summaryLine(1, 0, 0));
  });

  it("refuses without consent and records nothing", async () => {
    const adapter = checkpointingAdapter();

    const code = await runBackfill(
      { since: "all" },
      backfillIo(adapter, { confirm: async () => false }),
    );

    expect(code).toBe(EXIT_OK);
    expect(err.join("\n")).toContain("backfill: cancelled");
    expect(sessions()).toEqual([]);
    expect(listJobs(db, repo)).toEqual([]);
  });

  it("skips sessions already in the index on a second run", async () => {
    await runBackfill({ since: "all", yes: true }, backfillIo(checkpointingAdapter()));
    out = [];
    const second = checkpointingAdapter();

    const code = await runBackfill({ since: "all", yes: true }, backfillIo(second));

    expect(code).toBe(EXIT_OK);
    expect(out).toContain(summaryLine(0, 0, 3));
    // Nothing was resumed and nothing was created: every session was already indexed.
    expect(second.seen).toEqual([]);
    expect(sessions()).toHaveLength(3);
  });

  it("resumes a cancelled run without re-running the jobs that finished", async () => {
    // The first run digests one session, then the operator cancels the rest of the queue —
    // the shape of a `jobs --cancel` or a Ctrl-C landing mid-batch.
    let resumes = 0;
    const first = checkpointingAdapter({
      onResume: () => {
        resumes += 1;
        if (resumes !== 1) return;
        for (const job of listJobs(db, repo)) {
          if (job.status === "queued") cancelJob(db, job.id, NOW);
        }
      },
    });
    await runBackfill({ since: "all", yes: true, concurrency: 1 }, backfillIo(first));

    const afterFirst = listJobs(db, repo);
    expect(afterFirst.filter((job) => job.status === "done")).toHaveLength(1);
    expect(afterFirst.filter((job) => job.status === "cancelled")).toHaveLength(2);
    const finished = afterFirst.find((job) => job.status === "done") as { session_ulid: string };

    // The operator retries the cancelled jobs and runs backfill again.
    for (const job of afterFirst) if (job.status === "cancelled") retryJob(db, job.id);
    out = [];
    const second = checkpointingAdapter();
    const code = await runBackfill({ since: "all", yes: true, concurrency: 1 }, backfillIo(second));

    expect(code).toBe(EXIT_OK);
    // Only the two outstanding sessions were resumed; the finished one was not touched again.
    expect(second.seen).toHaveLength(2);
    expect(
      second.seen.some((options) => options.instruction.includes(finished.session_ulid)),
    ).toBe(false);
    expect(db.countCheckpoints(finished.session_ulid)).toBe(1);
    expect(listJobs(db, repo).every((job) => job.status === "done")).toBe(true);
    expect(out).toContain(summaryLine(2, 0, 3));
  });

  it("--extract-fallback reconstructs the session a resume could not", async () => {
    const adapter = checkpointingAdapter({ failFor: new Set(["hs-alpha"]) });
    const payload = JSON.stringify({
      goal: "Add a health endpoint to the server",
      done: [{ text: "Wrote the endpoint", files: ["src/health.ts"], verified: "not-verified" }],
      remaining: [],
      notes: [],
    });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: payload }] }), {
        status: 200,
      })) as unknown as typeof globalThis.fetch;

    const code = await runBackfill(
      { since: "all", yes: true, extractFallback: true, concurrency: 1 },
      backfillIo(adapter, { apiKey: () => "sk-ant-test-key-000000000000", fetchImpl }),
    );

    expect(code, err.join("\n")).toBe(EXIT_OK);
    // All three sessions ended up digested; one of them the long way round.
    expect(out).toContain(summaryLine(3, 0, 0));
    const stamps = sessions().map((session) => session.frontmatter.checkpoints[0]?.trigger);
    expect(stamps.filter((trigger) => trigger === "repair")).toHaveLength(2);
    expect(stamps.filter((trigger) => trigger === "extract")).toHaveLength(1);

    const jobs = listJobs(db, repo);
    expect(jobs.filter((job) => job.kind === "repair" && job.status === "failed")).toHaveLength(1);
    expect(jobs.filter((job) => job.kind === "extract" && job.status === "done")).toHaveLength(1);
    expect(err.join("\n")).toContain("queued an extract job");
  });

  it("counts a session whose resume failed as failed", async () => {
    const adapter = checkpointingAdapter({ failFor: new Set(["hs-alpha"]) });

    await runBackfill({ since: "all", yes: true }, backfillIo(adapter));

    expect(out).toContain(summaryLine(2, 1, 0));
    const failed = listJobs(db, repo).filter((job) => job.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error).toContain("exited 1");
  });
});
