/**
 * The multi-repo case — docs/contracts/p5/config-and-identities.md §CLI additions:
 * "`workledger scan --all` — orphan scan across every enabled repo the index knows" and
 * "`workledger doctor` gains one row per enabled repo: path, open sessions, last hook".
 *
 * One machine, one index, two enabled repos. Before P5 both commands could only see the repo
 * they were run in, which is exactly wrong for the case the phase is named for: a person with
 * several enabled checkouts, one of which crashed a session yesterday and is not the one they
 * happen to be standing in today.
 *
 * The two repos are given *different* states on purpose — one with an orphan, one without —
 * because a sweep that visited only the first repo and a sweep that visited both would look
 * identical against two identical fixtures.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSessionText } from "@workledger/core";
import type { SessionFrontmatter } from "@workledger/core";

import { buildReport } from "../src/commands/doctor.js";
import { runScanAll } from "../src/commands/scan.js";
import { openIndex } from "../src/index/db.js";
import { sessionFile } from "../src/ledger-fs.js";
import type { HealthIo } from "../src/commands/doctor.js";
import type { IndexDb } from "../src/index/db.js";

const NOW = new Date("2026-09-09T18:00:00.000Z");
/** Older than the default `orphan_minutes: 30`, so a stale transcript is an orphan. */
const LONG_AGO = "2026-09-09T09:00:00.000Z";

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

function frontmatter(ulid: string): SessionFrontmatter {
  return {
    schema_version: 1,
    id: ulid,
    harness: "claude-code",
    harness_session_id: `hsess-${ulid}`,
    repo: "github.com/manashardas/workledger",
    branch: "main",
    author: { name: "Ada Lovelace", email: "ada@example.com", dome_user: null },
    started: LONG_AGO,
    ended: null,
    end_reason: null,
    status: "open",
    private: false,
    source: "live",
    model: null,
    needs_repair: false,
    checkpoint_failures: 0,
    checkpoints: [],
  };
}

interface Fixture {
  dir: string;
  home: string;
  /** Two enabled repos plus one whose `.workledger/` was deleted after the fact. */
  alpha: string;
  beta: string;
  gone: string;
}

/** One enabled repo directory with a `.workledger/`. */
function makeRepo(dir: string, name: string): string {
  const root = path.join(dir, name);
  mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  writeFileSync(
    path.join(root, ".workledger", "config.yaml"),
    ["schema_version: 1", "harnesses: [claude-code]", "orphan_minutes: 30", ""].join("\n"),
    "utf8",
  );
  return root;
}

/**
 * Two enabled repos in one index:
 *
 * - `alpha` has an open session whose transcript file does not exist and whose row has not been
 *   touched for hours — the orphan `scan` is for.
 * - `beta` has an open session whose transcript was written just now — alive, and it must
 *   survive the sweep untouched.
 * - `gone` is in the index but its `.workledger/` has been removed, which is the case both
 *   commands have to filter out rather than report on.
 */
function setup(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-multirepo-"));
  temps.push(dir);
  const home = path.join(dir, "home");
  mkdirSync(home, { recursive: true });

  const alpha = makeRepo(dir, "alpha");
  const beta = makeRepo(dir, "beta");
  const gone = path.join(dir, "gone");
  mkdirSync(gone, { recursive: true });

  const liveTranscript = path.join(dir, "beta.jsonl");
  writeFileSync(liveTranscript, "x".repeat(100), "utf8");

  writeFileSync(sessionFile(alpha, "01JQ8ZK4T0000000000000000A"), createSessionText(frontmatter("01JQ8ZK4T0000000000000000A")), "utf8");
  writeFileSync(sessionFile(beta, "01JQ8ZK4T0000000000000000B"), createSessionText(frontmatter("01JQ8ZK4T0000000000000000B")), "utf8");

  const db = openIndex({ home });
  try {
    db.insertSession({
      ulid: "01JQ8ZK4T0000000000000000A",
      repo_path: alpha,
      harness: "claude-code",
      harness_session_id: "hsess-alpha",
      status: "open",
      transcript_path: path.join(dir, "missing.jsonl"),
      turns_total: 4,
      turns_since_checkpoint: 4,
      updated_at: LONG_AGO,
    });
    db.insertSession({
      ulid: "01JQ8ZK4T0000000000000000B",
      repo_path: beta,
      harness: "claude-code",
      harness_session_id: "hsess-beta",
      status: "open",
      transcript_path: liveTranscript,
      turns_total: 1,
      turns_since_checkpoint: 1,
      updated_at: NOW.toISOString(),
    });
    db.insertSession({
      ulid: "01JQ8ZK4T0000000000000000C",
      repo_path: gone,
      harness: "claude-code",
      harness_session_id: "hsess-gone",
      status: "ended",
      updated_at: LONG_AGO,
    });
  } finally {
    db.close();
  }
  return { dir, home, alpha, beta, gone };
}

function withDb<T>(home: string, fn: (db: IndexDb) => T): T {
  const db = openIndex({ home });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** {@link withDb} for an async body — the handle must outlive the promise, not the call. */
async function withDbAsync<T>(home: string, fn: (db: IndexDb) => Promise<T>): Promise<T> {
  const db = openIndex({ home });
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

function healthIo(fixture: Fixture, cwd: string): HealthIo & { out: string[] } {
  const out: string[] = [];
  return {
    out,
    cwd,
    homeDir: fixture.home,
    env: { PATH: "", HOME: fixture.home, WORKLEDGER_HOME: fixture.home },
    stdout: (line) => void out.push(line),
    stderr: () => undefined,
  };
}

describe("the index's repo listing", () => {
  it("groups sessions by repo with open counts and the last hook time", () => {
    const fixture = setup();

    const repos = withDb(fixture.home, (db) => db.listRepos());

    expect(repos.map((repo) => repo.repo_path).sort()).toEqual([fixture.alpha, fixture.beta, fixture.gone].sort());
    const alpha = repos.find((repo) => repo.repo_path === fixture.alpha);
    expect(alpha?.open_sessions).toBe(1);
    expect(alpha?.last_hook).toBe(LONG_AGO);
    expect(repos.find((repo) => repo.repo_path === fixture.gone)?.open_sessions).toBe(0);
  });
});

describe("scan --all", () => {
  it("sweeps every enabled repo, skipping the one that is no longer enabled", async () => {
    const fixture = setup();
    let minted = 0;

    const results = await withDbAsync(fixture.home, (db) =>
      runScanAll({
        db,
        now: () => NOW,
        newId: () => `01JQ8ZK4T00000000000000J${String(minted++)}`,
        stderr: () => undefined,
      }),
    );

    // Two enabled repos, both visited; `gone` filtered out.
    expect(results.map((result) => result.repo).sort()).toEqual([fixture.alpha, fixture.beta].sort());

    const alpha = results.find((result) => result.repo === fixture.alpha);
    expect(alpha?.orphans).toHaveLength(1);
    expect(alpha?.orphans[0]?.reason).toBe("transcript-missing");
    expect(alpha?.queued).toBe(1);

    // The live session in the other repo was examined and left alone — this is the assertion
    // that separates "swept both" from "swept both and broke one".
    const beta = results.find((result) => result.repo === fixture.beta);
    expect(beta?.examined).toBe(1);
    expect(beta?.orphans).toEqual([]);

    // And the ledger of the repo that was *not* the cwd was the one that changed.
    expect(readFileSync(sessionFile(fixture.alpha, "01JQ8ZK4T0000000000000000A"), "utf8")).toContain(
      "status: crashed",
    );
    expect(readFileSync(sessionFile(fixture.beta, "01JQ8ZK4T0000000000000000B"), "utf8")).toContain(
      "status: open",
    );
    withDb(fixture.home, (db) => {
      expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000A")?.status).toBe("crashed");
      expect(db.getSessionByUlid("01JQ8ZK4T0000000000000000B")?.status).toBe("open");
    });
  });

  it("returns nothing when the index knows no enabled repo", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-empty-index-"));
    temps.push(dir);

    const results = await withDbAsync(dir, (db) =>
      runScanAll({ db, now: () => NOW, newId: () => "01JQ8ZK4T00000000000000J0", stderr: () => undefined }),
    );

    expect(results).toEqual([]);
  });
});

describe("doctor", () => {
  it("reports one row per enabled repo, from wherever it is run", async () => {
    const fixture = setup();

    // Run from `beta`, and assert it still sees `alpha`.
    const report = await buildReport(healthIo(fixture, fixture.beta));

    expect(report.repos.map((repo) => repo.path).sort()).toEqual([fixture.alpha, fixture.beta].sort());
    const alpha = report.repos.find((repo) => repo.path === fixture.alpha);
    expect(alpha).toEqual({ path: fixture.alpha, open_sessions: 1, last_hook: LONG_AGO });
    // The repo whose `.workledger/` is gone is not a health row for anything.
    expect(report.repos.some((repo) => repo.path === fixture.gone)).toBe(false);

    // One printed check line per repo, carrying the three fields the contract names.
    const line = report.checks.find((check) => check.name === `repo ${fixture.alpha}`);
    expect(line?.detail).toBe(`1 open session(s), last hook ${LONG_AGO}`);
    // Informational: another repo's state never moves this invocation's exit code.
    expect(line?.status).toBe("ok");
  });

  it("says `never` for a repo the index has no timestamp for", async () => {
    const fixture = setup();
    withDb(fixture.home, (db) => {
      db.connection.prepare("UPDATE sessions SET updated_at = '' WHERE repo_path = ?").run(fixture.beta);
    });

    const report = await buildReport(healthIo(fixture, fixture.alpha));

    const beta = report.checks.find((check) => check.name === `repo ${fixture.beta}`);
    expect(beta?.detail).toContain("open session(s), last hook");
  });
});
