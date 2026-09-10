/**
 * `workledger scan` — docs/contracts/p3/cli.md §`workledger scan`.
 *
 * Every case is a synthesized session in a real temp repo with a real transcript file whose mtime
 * is set with `utimesSync`: the contract's rule is about mtimes, and a test that stubbed `stat`
 * would be testing the stub.
 */
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseFrontmatter } from "@workledger/core/frontmatter";

import { openIndex } from "../src/index/db.js";
import { listJobs } from "../src/jobs/queue.js";
import { runScan, scanLine } from "../src/commands/scan.js";
import { sessionFile, writeFileAtomic } from "../src/ledger-fs.js";
import type { IndexDb } from "../src/index/db.js";

/** Fixed so `orphan_minutes` arithmetic in the assertions is exact. */
const NOW = new Date("2026-09-09T12:00:00.000Z");

let dir: string;
let repo: string;
let home: string;
let db: IndexDb;
let ids = 0;

function newId(): string {
  ids += 1;
  return `JOB${String(ids).padStart(23, "0")}`;
}

/** The session frontmatter `hook SessionStart` would have written. */
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

/**
 * An open session with a transcript last written `idleMinutes` ago.
 *
 * @param idleMinutes `null` writes no transcript at all — the "transcript file is missing" case.
 */
function openSession(
  ulid: string,
  options: { idleMinutes: number | null; turnsSince?: number; checkpoints?: number },
): void {
  let transcript: string | null = null;
  if (options.idleMinutes !== null) {
    transcript = path.join(dir, `${ulid}.jsonl`);
    writeFileSync(transcript, '{"type":"user"}\n', "utf8");
    const at = new Date(NOW.getTime() - options.idleMinutes * 60_000).getTime() / 1000;
    utimesSync(transcript, at, at);
  }

  writeFileAtomic(sessionFile(repo, ulid), sessionText(ulid));
  db.insertSession({
    ulid,
    repo_path: repo,
    harness: "claude-code",
    harness_session_id: `hs-${ulid}`,
    status: "open",
    transcript_path: transcript,
    turns_since_checkpoint: options.turnsSince ?? 3,
    // A row last touched an hour ago: old enough that a missing transcript counts, so the
    // "transcript-missing" cases below are testing the file check and not the age floor.
    updated_at: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
  });
  for (let n = 1; n <= (options.checkpoints ?? 0); n += 1) {
    db.insertCheckpoint({
      session_ulid: ulid,
      n,
      at: "2026-09-09T10:00:00.000Z",
      transcript_offset: 10,
      turns: n,
      trigger: "turns",
    });
  }
}

function scan(overrides: Partial<Parameters<typeof runScan>[0]> = {}) {
  return runScan({ db, root: repo, now: () => NOW, newId, ...overrides });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "wl-scan-"));
  repo = path.join(dir, "repo");
  home = path.join(dir, "home");
  writeFileSync(path.join(dir, "keep"), "", "utf8");
  writeFileAtomic(path.join(repo, ".workledger", "config.yaml"), "orphan_minutes: 30\n");
  db = openIndex({ home });
  ids = 0;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("runScan", () => {
  it("marks a session whose transcript went stale crashed and queues one repair", async () => {
    openSession("S1", { idleMinutes: 90 });

    const result = await scan();

    expect(result.examined).toBe(1);
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0]).toMatchObject({ ulid: "S1", reason: "stale", idleMinutes: 90 });
    expect(result.queued).toBe(1);
    expect(scanLine(result)).toBe("scan: 1 orphaned, 1 repair job queued");

    const frontmatter = parseFrontmatter(readFileSync(sessionFile(repo, "S1"), "utf8")).data;
    expect(frontmatter["status"]).toBe("crashed");
    expect(frontmatter["end_reason"]).toBe("crashed");
    expect(frontmatter["needs_repair"]).toBe(true);
    expect(db.getSessionByUlid("S1")?.status).toBe("crashed");

    const jobs = listJobs(db, repo);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "repair", session_ulid: "S1", status: "queued" });
  });

  it("marks a session whose transcript is gone crashed", async () => {
    openSession("S1", { idleMinutes: null });

    const result = await scan();

    expect(result.orphans[0]).toMatchObject({ reason: "transcript-missing", idleMinutes: null });
    expect(result.queued).toBe(1);
  });

  it("leaves a session whose transcript has not been written yet alone", async () => {
    // What `SessionStart` leaves behind: the path the harness reported, and no file at it. The
    // e2e caught the sweep calling this crashed on the very hook that opened the session.
    openSession("S1", { idleMinutes: null });
    db.updateSession("S1", { updated_at: NOW.toISOString() });

    expect((await scan()).orphans).toEqual([]);
    expect(db.getSessionByUlid("S1")?.status).toBe("open");
  });

  it("never sweeps the session a SessionStart sweep was triggered by", async () => {
    openSession("S1", { idleMinutes: 90 });
    openSession("S2", { idleMinutes: 90 });

    const result = await scan({ skipUlid: "S1" });

    expect(result.orphans.map((orphan) => orphan.ulid)).toEqual(["S2"]);
    expect(db.getSessionByUlid("S1")?.status).toBe("open");
  });

  it("leaves a session whose transcript is still fresh alone", async () => {
    openSession("S1", { idleMinutes: 5 });

    const result = await scan();

    expect(result.examined).toBe(1);
    expect(result.orphans).toEqual([]);
    expect(scanLine(result)).toBe("scan: 0 orphaned, 0 repair jobs queued");
    expect(db.getSessionByUlid("S1")?.status).toBe("open");
    expect(listJobs(db, repo)).toEqual([]);
  });

  it("leaves a stale session that is already fully checkpointed alone", async () => {
    // Idle for hours, but every turn is already in the ledger: there is nothing to repair.
    openSession("S1", { idleMinutes: 90, turnsSince: 0, checkpoints: 1 });

    expect((await scan()).orphans).toEqual([]);
    expect(db.getSessionByUlid("S1")?.status).toBe("open");
  });

  it("sweeps a stale session that never checkpointed at all", async () => {
    openSession("S1", { idleMinutes: 90, turnsSince: 0, checkpoints: 0 });

    expect((await scan()).orphans).toHaveLength(1);
  });

  it("queues one job however many times it is run", async () => {
    openSession("S1", { idleMinutes: 90 });

    const first = await scan();
    // The row is `crashed` now, so the second sweep does not even look at it.
    const second = await scan();

    expect(first.queued).toBe(1);
    expect(second.examined).toBe(0);
    expect(listJobs(db, repo)).toHaveLength(1);
  });

  it("honours the opportunistic caps", async () => {
    for (let i = 1; i <= 5; i += 1) openSession(`S${i}`, { idleMinutes: 90 });

    const result = await scan({ limit: 2 });

    expect(result.examined).toBe(2);
    expect(result.orphans).toHaveLength(2);
    expect(listJobs(db, repo)).toHaveLength(2);
  });

  it("stops at the wall-clock budget", async () => {
    for (let i = 1; i <= 3; i += 1) openSession(`S${i}`, { idleMinutes: 90 });

    // A budget already spent: the loop checks it before the first session.
    const result = await scan({ budgetMs: -1 });

    expect(result.examined).toBe(0);
    expect(listJobs(db, repo)).toEqual([]);
  });

  it("still moves the index row when the ledger file cannot be parsed", async () => {
    openSession("S1", { idleMinutes: 90 });
    writeFileAtomic(sessionFile(repo, "S1"), "not frontmatter at all\n");

    const result = await scan();

    expect(result.orphans).toHaveLength(1);
    expect(db.getSessionByUlid("S1")?.status).toBe("crashed");
  });
});
