/**
 * A throwaway repo seeded with **this repo's own** `.workledger/` — the dogfood ledger the issue's
 * acceptance criterion names ("all GET endpoints return the documented shapes for this repo's
 * dogfood ledger"). Copying it rather than inventing fixtures means the tests read the same
 * frontmatter the CLI actually writes, and a schema drift breaks them.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import type { ServerApp } from "../src/app.js";
import type { BacklogOps, ItemResult, MergeResult, OpContext, ResolveNoteResult } from "../src/ops.js";
import type { ExcerptSpan, Job, JobOps, RepairInput, ScanSummary } from "../src/jobs.js";

/** `<repo>/.workledger`, four directories up from this file. */
export const DOGFOOD_LEDGER = fileURLToPath(new URL("../../../.workledger", import.meta.url));

/** A temp repo plus its cleanup. */
export interface TempRepo {
  root: string;
  ledger: string;
  sessions: string;
  backlog: string;
  cleanup(): void;
}

/** Copy the dogfood ledger into a fresh temp directory. */
export function seedRepo(): TempRepo {
  const root = mkdtempSync(path.join(os.tmpdir(), "workledger-server-"));
  const ledger = path.join(root, ".workledger");
  cpSync(DOGFOOD_LEDGER, ledger, { recursive: true });
  return {
    root,
    ledger,
    sessions: path.join(ledger, "sessions"),
    backlog: path.join(ledger, "backlog"),
    cleanup: () => void rmSync(root, { recursive: true, force: true }),
  };
}

/** A temp static asset directory with an `index.html` and one real file. */
export function seedStatic(files: Record<string, string>): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-web-"));
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body, "utf8");
  }
  return { dir, cleanup: () => void rmSync(dir, { recursive: true, force: true }) };
}

/** One call the fake ops recorded: the method name and the arguments it was given. */
export interface OpCall {
  op: string;
  args: unknown[];
}

/**
 * A stand-in for `packages/cli/src/backlog-ops.ts`.
 *
 * This package cannot import the real thing — that is the whole point of injecting it
 * (`src/ops.ts`) — so the tests that live here assert the half the server owns: route wiring,
 * body validation, the identity refusal and the status each refusal class maps to. The half the
 * server does *not* own — that a POST leaves the same bytes on disk as the CLI command — is
 * asserted in `packages/cli/test/serve.test.ts`, where both implementations are in reach.
 */
export class FakeOps implements BacklogOps {
  readonly calls: OpCall[] = [];
  /** Thrown by the next op call, if set. */
  next: Error | undefined;
  /** What `gitActor` returns; `undefined` is the "git has no identity" case. */
  actor: { name: string; email: string } | undefined = { name: "Ada", email: "ada@example.com" };
  /** The id whose item the ops pretend to have written. */
  constructor(readonly id: string) {}

  gitActor(): { name: string; email: string } | undefined {
    return this.actor;
  }

  #record(op: string, args: unknown[]): ItemResult {
    this.calls.push({ op, args });
    if (this.next !== undefined) {
      const error = this.next;
      this.next = undefined;
      throw error;
    }
    return {
      id: this.id,
      file: `${this.id}.md`,
      item: { id: this.id } as ItemResult["item"],
      body: "",
      history: [],
    };
  }

  acceptItem = async (ctx: OpContext, id: string): Promise<ItemResult> => this.#record("accept", [ctx, id]);
  discardItem = async (ctx: OpContext, id: string): Promise<ItemResult> => this.#record("discard", [ctx, id]);
  doneItem = async (ctx: OpContext, id: string): Promise<ItemResult> => this.#record("done", [ctx, id]);
  startItem = async (ctx: OpContext, id: string): Promise<ItemResult> => this.#record("start", [ctx, id]);
  restoreItem = async (ctx: OpContext, id: string): Promise<ItemResult> => this.#record("restore", [ctx, id]);
  editItem = async (ctx: OpContext, id: string, patch: unknown): Promise<ItemResult> =>
    this.#record("edit", [ctx, id, patch]);
  assignItem = async (ctx: OpContext, id: string, owner: unknown): Promise<ItemResult> =>
    this.#record("assign", [ctx, id, owner]);
  rankItem = async (ctx: OpContext, id: string, rank: number): Promise<ItemResult> =>
    this.#record("rank", [ctx, id, rank]);
  mergeItems = async (ctx: OpContext, source: string, target: string): Promise<MergeResult> => {
    const result = this.#record("merge", [ctx, source, target]);
    return { source: result, target: result };
  };
  resolveNote = async (
    ctx: OpContext,
    session: string,
    cp: number,
    index: number,
    decision: string,
  ): Promise<ResolveNoteResult> => {
    this.#record("resolveNote", [ctx, session, cp, index, decision]);
    return { file: "", session, cp, index, type: "blocker", line: "", resolved: [{ cp, index }] };
  };
}

/** `createApp` over a temp repo, with the watcher knobs tests need. */
export function appFor(repo: TempRepo, overrides: Partial<Parameters<typeof createApp>[0]> = {}): ServerApp {
  return createApp({
    repoRoot: repo.root,
    ops: new FakeOps("WL-unset"),
    home: path.join(repo.root, "home"),
    env: { PATH: "" },
    homeDir: repo.root,
    ...overrides,
  });
}

/**
 * A stand-in for the index-backed ops `workledger serve` injects (`src/jobs.ts`).
 *
 * Same reasoning as {@link FakeOps}: this package cannot open `index.sqlite` — that is the whole
 * point of the injection — so the tests here assert the half the server owns (route wiring, body
 * validation, consent, the status each refusal maps to, the `job.changed` diff) against a job
 * table held in memory. `estimateExtract` and `backfill` are settable so the 501 path of a build
 * without them is reachable too.
 */
export class FakeJobOps implements JobOps {
  readonly calls: OpCall[] = [];
  /** The job table, in the order `listJobs` returns it. */
  rows: Job[] = [];
  /** Thrown by the next op call, if set. */
  next: Error | undefined;
  /** `undefined` — the shape of a build before #54 / #56 — unless a test sets one. */
  estimateExtract: JobOps["estimateExtract"];
  backfill: JobOps["backfill"];
  /** What `excerptSpan` answers; `undefined` is "no such session or checkpoint". */
  span: ExcerptSpan | undefined;
  /** What `jobLog` answers; `undefined` is "no log for that job". */
  log: string | undefined;

  #record<T>(op: string, args: unknown[], value: T): T {
    this.calls.push({ op, args });
    if (this.next !== undefined) {
      const error = this.next;
      this.next = undefined;
      throw error;
    }
    return value;
  }

  listJobs = async (repoRoot: string, status?: string): Promise<Job[]> =>
    this.#record("listJobs", [repoRoot, status], this.rows);
  scan = async (repoRoot: string): Promise<ScanSummary> =>
    this.#record("scan", [repoRoot], { orphaned: 2, queued: 1 });
  repair = async (repoRoot: string, input: RepairInput): Promise<Job> =>
    this.#record("repair", [repoRoot, input], fakeJob({ kind: input.extract ? "extract" : "repair" }));
  cancelJob = async (repoRoot: string, id: string): Promise<Job> =>
    this.#record("cancelJob", [repoRoot, id], fakeJob({ id, status: "cancelled" }));
  retryJob = async (repoRoot: string, id: string): Promise<Job> =>
    this.#record("retryJob", [repoRoot, id], fakeJob({ id, status: "queued" }));
  excerptSpan = async (repoRoot: string, ulid: string, cp: number): Promise<ExcerptSpan | undefined> =>
    this.#record("excerptSpan", [repoRoot, ulid, cp], this.span);
  jobLog = async (repoRoot: string, id: string): Promise<string | undefined> =>
    this.#record("jobLog", [repoRoot, id], this.log);
}

/** One `jobs` row with every column filled, so a test only names what it cares about. */
export function fakeJob(over: Partial<Job> = {}): Job {
  return {
    id: "01JQ8ZK4T00000000000000JOB",
    kind: "repair",
    session_ulid: "01JQ8ZK4T0000000000000000A",
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
    error_code: null,
    retry_after: null,
    ...over,
  };
}
