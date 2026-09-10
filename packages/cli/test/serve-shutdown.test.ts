/**
 * The daemon under SIGTERM (#99) — docs/contracts/p8/daemon-and-api.md §CLI, amendment 6.
 *
 * `workledger stop` reported "pid … is still running after SIGTERM" against a live daemon. Two
 * things held the process past the signal, and each is enough on its own: `http.Server.close()`
 * waits for every open connection, and an SSE client is a connection that never closes; and a
 * queued repair's harness — spawned detached, in its own process group — keeps the pipes and the
 * child handle alive for as long as it runs.
 *
 * The daemon is a real child process here, on purpose: an in-process `serveCommand` under an
 * `AbortController` (open.test.ts) can prove that the command *returns*, not that the process
 * *exits*, and the bug was precisely the gap between the two. `dist/main.js` must be built.
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLAUDE_BIN_ENV } from "../src/adapters/claude-code.js";
import { openIndex } from "../src/index/db.js";
import { getJob } from "../src/jobs/queue.js";
import { sessionFile, writeFileAtomic } from "../src/ledger-fs.js";
import { readServeState } from "../src/serve-state.js";
import type { ChildProcess } from "node:child_process";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(PACKAGE_ROOT, "bin", "workledger");
const SESSION = "01JQ8ZK4T0000000000000000A";

let dir: string;
let home: string;
let repo: string;
let daemon: ChildProcess | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "wl-shutdown-"));
  home = path.join(dir, "home");
  repo = path.join(dir, "repo");
  mkdirSync(path.join(repo, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(repo, ".workledger", "backlog"), { recursive: true });
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  writeFileSync(path.join(repo, ".git", "config"), "[user]\n\tname = T\n\temail = t@example.com\n", "utf8");
});

afterEach(() => {
  if (daemon !== undefined && daemon.exitCode === null) daemon.kill("SIGKILL");
  daemon = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** One crashed session in the index and on disk, the way the orphan sweep leaves it. */
function crashedSession(): void {
  const transcript = path.join(dir, `${SESSION}.jsonl`);
  writeFileSync(transcript, '{"type":"user","message":{"role":"user","content":"hi"}}\n', "utf8");
  const at = (Date.now() - 120 * 60_000) / 1000;
  utimesSync(transcript, at, at);
  writeFileAtomic(
    sessionFile(repo, SESSION),
    [
      "---",
      "schema_version: 1",
      `id: ${SESSION}`,
      "harness: claude-code",
      `harness_session_id: hs-${SESSION}`,
      "repo: example/repo",
      "branch: main",
      "author: { name: Tester, email: t@example.com }",
      "started: 2026-09-09T09:00:00.000Z",
      "status: crashed",
      "private: false",
      "source: live",
      "needs_repair: true",
      "checkpoint_failures: 0",
      "checkpoints: []",
      "---",
      "",
      "# Session",
      "",
    ].join("\n"),
  );
  const db = openIndex({ home });
  try {
    db.upsertRepo(repo);
    db.insertSession({
      ulid: SESSION,
      repo_path: repo,
      harness: "claude-code",
      harness_session_id: `hs-${SESSION}`,
      status: "crashed",
      transcript_path: transcript,
      turns_since_checkpoint: 3,
      updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
  } finally {
    db.close();
  }
}

/**
 * A `claude` that never returns: it backgrounds a tool and both outlive any grace period, the
 * shape of a real harness mid-command. Both pids are written so the test can prove they died.
 */
function hangingClaude(): string {
  const bin = path.join(dir, "claude");
  writeFileSync(
    bin,
    ["#!/bin/sh", `echo $$ > "${dir}/harness.pid"`, "sh -c 'sleep 60' &", `echo $! > "${dir}/grandchild.pid"`, "sleep 60"].join("\n"),
    "utf8",
  );
  chmodSync(bin, 0o755);
  return bin;
}

/** Is there a process with this pid? `EPERM` would be someone else's, which a temp-dir stub never is. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Start the daemon on a free port and resolve its URL. */
async function startDaemon(): Promise<string> {
  const child = spawn(process.execPath, [BIN, "serve", "--no-open"], {
    env: { ...process.env, WORKLEDGER_HOME: home, HOME: dir, [CLAUDE_BIN_ENV]: hangingClaude() },
    stdio: ["ignore", "pipe", "pipe"],
  });
  daemon = child;
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
  await vi.waitFor(() => expect(out, err).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/m), { timeout: 10_000 });
  return /^(http:\/\/127\.0\.0\.1:\d+)$/m.exec(out)![1]!;
}

/** Resolve with the exit code, or reject when the process outlives `timeoutMs`. */
function exited(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`daemon pid ${child.pid} still alive after ${timeoutMs} ms`)), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe.skipIf(!existsSync(path.join(PACKAGE_ROOT, "dist", "main.js")))("workledger serve under SIGTERM (#99)", () => {
  it("exits within 5 s with an SSE client open and a resume running, killing the harness's process group", async () => {
    crashedSession();
    const url = await startDaemon();
    expect(readServeState(home)?.pid).toBe(daemon!.pid);

    // An open `/api/events` stream — the browser tab the operator left open.
    const controller = new AbortController();
    const events = await fetch(`${url}/api/events`, { signal: controller.signal });
    expect(events.headers.get("content-type")).toContain("text/event-stream");

    // A repair whose harness hangs. `repo` is the id `/api/repos` reports for the served root.
    const repos = (await (await fetch(`${url}/api/repos`)).json()) as { id: string }[];
    const queued = await fetch(`${url}/api/jobs/repair?repo=${repos[0]!.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: SESSION }),
    });
    expect(queued.status).toBe(202);
    const { id } = (await queued.json()) as { id: string };
    await vi.waitFor(() => expect(existsSync(path.join(dir, "grandchild.pid"))).toBe(true), { timeout: 5000 });
    const harness = Number(readFileSync(path.join(dir, "harness.pid"), "utf8").trim());
    const grandchild = Number(readFileSync(path.join(dir, "grandchild.pid"), "utf8").trim());
    expect(alive(harness) && alive(grandchild)).toBe(true);

    const started = Date.now();
    daemon!.kill("SIGTERM");
    expect(await exited(daemon!, 5000)).toBe(0);
    const elapsed = Date.now() - started;
    expect(elapsed, `exited after ${elapsed} ms`).toBeLessThan(5000);

    // Nothing left behind: no calling card, no orphaned harness tree, no `running` row for the
    // next process to re-queue as dead 60 s from now.
    expect(readServeState(home)).toBeUndefined();
    await vi.waitFor(() => expect([alive(harness), alive(grandchild)]).toEqual([false, false]), { timeout: 2000 });
    const db = openIndex({ home });
    try {
      expect(getJob(db, id)?.status).toBe("failed");
    } finally {
      db.close();
    }
    controller.abort();
  }, 30_000);
});
