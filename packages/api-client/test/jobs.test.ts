/**
 * The P3 half of `LedgerSource` (`docs/contracts/p3/api.md`) round-tripped through a real
 * `packages/server`.
 *
 * A mock of the wire would agree with the client by construction — including where both are
 * wrong — so the server here is the real one, with only the index-backed ops faked (they are
 * injected precisely so that this package never needs SQLite). The transcript is a captured
 * fixture, so the excerpt assertions are about record shapes a harness really wrote.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "@workledger/server";
import type { ExcerptSpan, Job, JobOps, RunningServer, ServerApp } from "@workledger/server";

import { ApiClientError, createSource } from "../src/index.js";
import type { LedgerSource } from "../src/index.js";

const DOGFOOD_LEDGER = fileURLToPath(new URL("../../../.workledger", import.meta.url));
const TRANSCRIPT = fileURLToPath(
  new URL("../../../test/fixtures/transcripts/746c9f65-6bb2-423a-b497-28855f8519a3.jsonl", import.meta.url),
);
const SESSION = "01JQ8ZK4T0000000000000000A";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "01JQ8ZK4T00000000000000JOB",
    kind: "repair",
    session_ulid: SESSION,
    repo_path: "/tmp/repo",
    status: "queued",
    attempts: 0,
    created_at: "2026-09-09T09:00:00.000Z",
    started_at: null,
    finished_at: null,
    heartbeat_at: null,
    error: null,
    cost_estimate_usd: null,
    log_path: null,
    ...over,
  };
}

let root: string;
let transcript: string;
let app: ServerApp;
let running: RunningServer;
let source: LedgerSource;
/** What the server's ops were asked for, so a round trip can be checked in both directions. */
const seen: { op: string; args: unknown[] }[] = [];

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "workledger-api-client-jobs-"));
  cpSync(DOGFOOD_LEDGER, path.join(root, ".workledger"), { recursive: true });
  transcript = path.join(root, "transcript.jsonl");
  writeFileSync(transcript, readFileSync(TRANSCRIPT));

  const record = <T>(op: string, args: unknown[], value: T): T => {
    seen.push({ op, args });
    return value;
  };
  const jobs: JobOps = {
    listJobs: async (repoRoot, status) =>
      record("listJobs", [repoRoot, status], [job(), job({ id: "B", status: "done" })]),
    scan: async (repoRoot) => record("scan", [repoRoot], { orphaned: 4, queued: 2 }),
    repair: async (repoRoot, input) => record("repair", [repoRoot, input], job({ kind: "repair" })),
    cancelJob: async (repoRoot, id) => record("cancelJob", [repoRoot, id], job({ id, status: "cancelled" })),
    retryJob: async (repoRoot, id) => record("retryJob", [repoRoot, id], job({ id, status: "queued" })),
    excerptSpan: async (repoRoot, ulid, cp): Promise<ExcerptSpan | undefined> =>
      record(
        "excerptSpan",
        [repoRoot, ulid, cp],
        cp > 1 ? undefined : { transcriptPath: transcript, from: 0, to: statSync(transcript).size },
      ),
    estimateExtract: async (repoRoot, session) =>
      record("estimateExtract", [repoRoot, session], { bytes: 2048, model: "claude-haiku-4-5", usd: 0.01 }),
    backfill: async (repoRoot, input) =>
      record("backfill", [repoRoot, input], {
        jobs: input.consent ? [job({ kind: "backfill" })] : [],
        estimate: { count: 2, bytes: 4096, oldest: "2026-09-01T00:00:00.000Z", seconds: 45 },
      }),
  };

  app = createApp({
    repoRoot: root,
    home: path.join(root, "home"),
    env: { PATH: "" },
    homeDir: root,
    jobs,
    // The `job.changed` poller is not what these tests drive; keep it out of `seen`.
    jobPollMs: 3_600_000,
  });
  running = await app.start();
  source = createSource("local", { baseUrl: `http://127.0.0.1:${running.port}` });
  seen.length = 0;
});

afterAll(async () => {
  app.close();
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it("declares provenance now that the excerpt endpoint exists", () => {
  expect(source.capabilities).toEqual({ write: true, live: true, provenance: true });
});

describe("the job methods", () => {
  it("lists jobs, with and without a status filter", async () => {
    seen.length = 0;

    expect(await source.listJobs()).toEqual([job(), job({ id: "B", status: "done" })]);
    expect(await source.listJobs("done")).toHaveLength(2);

    expect(seen).toEqual([
      { op: "listJobs", args: [root, undefined] },
      { op: "listJobs", args: [root, "done"] },
    ]);
  });

  it("runs a scan and decodes { orphaned, queued }", async () => {
    expect(await source.scan()).toEqual({ orphaned: 4, queued: 2 });
  });

  it("queues a repair and gets the Job back", async () => {
    seen.length = 0;

    expect(await source.repair({ session: SESSION })).toEqual(job({ kind: "repair" }));

    expect(seen).toEqual([
      { op: "repair", args: [root, { session: SESSION, extract: false, consent: false }] },
    ]);
  });

  it("rejects an unconsented extraction with the code and the estimate", async () => {
    const error = await source
      .repair({ session: SESSION, extract: true })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown as ApiClientError);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error?.code).toBe("consent-required");
    expect(error?.status).toBe(409);
    expect(error?.detail).toEqual({ estimate: { bytes: 2048, model: "claude-haiku-4-5", usd: 0.01 } });
  });

  it("backfills dry and wet", async () => {
    const dry = await source.backfill({ since: "30d", consent: false });
    expect(dry.jobs).toEqual([]);
    expect(dry.estimate).toEqual({ count: 2, bytes: 4096, oldest: "2026-09-01T00:00:00.000Z", seconds: 45 });

    const wet = await source.backfill({ since: "30d", consent: true });
    expect(wet.jobs).toEqual([job({ kind: "backfill" })]);
  });

  it("cancels and retries by id, escaping the id into the path", async () => {
    seen.length = 0;

    expect((await source.cancelJob("a/b")).status).toBe("cancelled");
    expect((await source.retryJob("a/b")).status).toBe("queued");

    expect(seen).toEqual([
      { op: "cancelJob", args: [root, "a/b"] },
      { op: "retryJob", args: [root, "a/b"] },
    ]);
  });
});

describe("excerpt", () => {
  it("returns the checkpoint's turns with tool counts and no tool payloads", async () => {
    const excerpt = await source.excerpt(SESSION, 1);

    expect(excerpt.cp).toBe(1);
    expect(excerpt.offset).toEqual([0, statSync(transcript).size]);
    expect(excerpt.turns.length).toBeGreaterThan(0);
    for (const turn of excerpt.turns) {
      expect(["user", "assistant"]).toContain(turn.role);
      expect(typeof turn.text).toBe("string");
      expect(Number.isInteger(turn.tools)).toBe(true);
    }
    expect(excerpt.turns.some((turn) => turn.tools > 0)).toBe(true);
  });

  it("rejects with not_found when the index has no such checkpoint", async () => {
    const error = await source
      .excerpt(SESSION, 4)
      .then(() => undefined)
      .catch((thrown: unknown) => thrown as ApiClientError);

    expect(error?.code).toBe("not_found");
    expect(error?.status).toBe(404);
  });
});
