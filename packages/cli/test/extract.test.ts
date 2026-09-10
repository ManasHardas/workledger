/**
 * `workledger repair <ulid> --extract [--yes]` — docs/contracts/p3/cli.md step 4 and
 * plans/feature-p3-data-flow.md §Extraction fallback.
 *
 * `fetch` is the only thing mocked. The transcript is a real fixture, the slice is a real
 * positioned read, the payload is validated by the real P1 schema and written by the real
 * `runCheckpoint`, so `trigger: extract` in the assertions below is a stamp that went the whole
 * way through the ledger renderer.
 *
 * The last test in this file is the one the issue names as an acceptance criterion: after a full
 * successful extraction, the API key must not appear in the index, in any ledger file, or in
 * anything the command wrote to either output stream.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseSessionText } from "@workledger/core";

import { EXIT_CONSENT_REFUSED, EXIT_JOB_FAILED, EXIT_OK } from "../src/exit-codes.js";
import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { openIndex } from "../src/index/db.js";
import { listJobs } from "../src/jobs/queue.js";
import { runRepair } from "../src/commands/repair.js";
import {
  MAX_TOOL_RESULT_BYTES,
  chunkRecords,
  estimateTokens,
  keptRecords,
  readSlice,
} from "../src/extract/transcript.js";
import { estimateExtraction, estimateLines, formatUsd } from "../src/extract/run.js";
import { extractJson, redactSecrets } from "../src/extract/api.js";
import { sessionFile, writeFileAtomic } from "../src/ledger-fs.js";
import type { IndexDb } from "../src/index/db.js";
import type { RepairIo } from "../src/commands/repair.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/transcripts/", import.meta.url));
const ULID = "01JBQK0000000000000000000A";
const NOW = new Date("2026-09-09T12:00:00.000Z");

/** A plausible-looking key. Nothing that leaves the command may contain it. */
const API_KEY = "sk-ant-api03-TESTKEYbutNotARealOne0000000000000000";

let dir: string;
let repo: string;
let home: string;
let transcript: string;
let db: IndexDb;
let out: string[];
let err: string[];
let requests: Array<{ url: string; headers: Record<string, string>; body: string }>;

/** The payload a well-behaved model returns. */
const GOOD_PAYLOAD = {
  goal: "Add a health endpoint to the server",
  done: [{ text: "Wrote the health endpoint", files: ["src/health.ts"], verified: "not-verified" }],
  remaining: [{ text: "Add a test for the endpoint", why: "it is untested", new: true }],
  notes: [{ type: "discovery", text: "The server has no route table yet" }],
};

/** A `fetch` that answers every Messages call with `text`, and records what it was sent. */
function mockFetch(text: string, status = 200): typeof globalThis.fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    requests.push({ url: String(url), headers, body: String(init?.body ?? "") });
    const payload =
      status === 200
        ? JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 1 } })
        : text;
    return new Response(payload, { status });
  }) as unknown as typeof globalThis.fetch;
}

/** A crashed session pointing at the `hs-beta` fixture, which is the one with a long tool result. */
function crashedSession(lastOffset = 0): void {
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
      "end_reason: crashed",
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
    last_offset: lastOffset,
    turns_total: 4,
    turns_since_checkpoint: 4,
  });
}

function repairIo(overrides: Partial<RepairIo> = {}): RepairIo {
  return {
    db,
    root: repo,
    adapter: claudeCodeAdapter,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    now: () => NOW,
    // A *job* id, the way `repairCommand` passes one. Deliberately not `WL-`-shaped: an earlier
    // draft forwarded this field to `runCheckpoint` as the backlog-id minter, and a WL-shaped
    // value here is precisely what hid that from this suite.
    newId: () => "01JBQK0000000000000000000J",
    newBacklogId: () => "WL-01JBQK0000000000000000000B",
    apiKey: () => API_KEY,
    confirm: async () => true,
    home,
    ...overrides,
  };
}

function frontmatter() {
  return parseSessionText(readFileSync(sessionFile(repo, ULID), "utf8"));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "wl-extract-"));
  repo = path.join(dir, "repo");
  home = path.join(dir, "home");
  writeFileAtomic(path.join(repo, ".workledger", "config.yaml"), "orphan_minutes: 30\n");
  writeFileSync(path.join(repo, ".workledger", ".keep"), "", "utf8");

  mkdirSync(path.join(dir, "store"), { recursive: true });
  transcript = path.join(dir, "store", "hs-beta.jsonl");
  writeFileSync(
    transcript,
    readFileSync(path.join(FIXTURES, "hs-beta.jsonl"), "utf8").replaceAll("__CWD__", repo),
    "utf8",
  );

  db = openIndex({ home });
  out = [];
  err = [];
  requests = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("transcript slicing and filtering", () => {
  it("keeps user, assistant and tool-result records and drops everything else", () => {
    const records = keptRecords(readSlice(transcript, 0, statSync(transcript).size));

    expect(records.map((record) => record.kind)).toEqual([
      "user",
      "assistant",
      "tool-result",
      "assistant",
    ]);
    // The `thinking` block and the `tool_use` input are gone; the assistant's text is not.
    const assistant = records[1] as { text: string };
    expect(assistant.text).toContain("I will edit");
    expect(assistant.text).not.toContain("I should start by reading");
    expect(records.map((record) => record.text).join("\n")).not.toContain("file_path");
    // And the `system` record never became one.
    expect(records.map((record) => record.text).join("\n")).not.toContain("PostToolUse");
  });

  it("truncates a tool result to 2 KB", () => {
    const result = keptRecords(readSlice(transcript, 0, statSync(transcript).size)).find(
      (record) => record.kind === "tool-result",
    );

    expect(result).toBeDefined();
    expect(Buffer.byteLength(result?.text ?? "", "utf8")).toBeLessThanOrEqual(
      MAX_TOOL_RESULT_BYTES + Buffer.byteLength("… (truncated)", "utf8"),
    );
    expect(result?.text).toContain("… (truncated)");
  });

  it("reads only the span it is asked for", () => {
    const size = statSync(transcript).size;
    const whole = readSlice(transcript, 0, size);
    const tail = readSlice(transcript, size - 40, size);

    expect(tail).toHaveLength(40);
    expect(whole.endsWith(tail)).toBe(true);
    expect(readSlice(transcript, size, size)).toBe("");
  });

  it("skips the partial first line a byte offset leaves behind, and unparseable lines", () => {
    const size = statSync(transcript).size;
    // Start 20 bytes into the first record: the leading line cannot parse and is dropped.
    const records = keptRecords(readSlice(transcript, 20, size));
    expect(records.map((record) => record.kind)).toEqual(["assistant", "tool-result", "assistant"]);
  });

  it("chunks at the token ceiling, never splitting a record", () => {
    const records = keptRecords(readSlice(transcript, 0, statSync(transcript).size));

    expect(chunkRecords(records, 100_000)).toHaveLength(1);
    // A ceiling below one record's size still emits that record whole, in its own chunk.
    const tiny = chunkRecords(records, 1);
    expect(tiny).toHaveLength(records.length);
    expect(tiny.join("")).toContain("I will edit");
    expect(estimateTokens("abcd")).toBe(1);
  });
});

describe("the estimate", () => {
  it("prices input at the configured rate plus a fixed 4k output", () => {
    const estimate = estimateExtraction(400_000, {
      model: "claude-haiku-4-5",
      usd_per_million_input: 1,
      usd_per_million_output: 5,
    });

    expect(estimate.inputTokens).toBe(100_000);
    expect(estimate.outputTokens).toBe(4096);
    expect(estimate.usd).toBeCloseTo(100_000 / 1e6 + (4096 * 5) / 1e6, 6);
    expect(formatUsd(estimate.usd)).toBe("$0.12");
    expect(estimateLines(estimate).join("\n")).toContain("claude-haiku-4-5");
  });

  it("never rounds a real cost down to nothing", () => {
    expect(formatUsd(0.0004)).toBe("<$0.01");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("runRepair --extract", () => {
  it("exits 6 when the spend is refused, having sent and written nothing", async () => {
    crashedSession();

    const code = await runRepair(
      ULID,
      { extract: true },
      repairIo({ confirm: async () => false, fetchImpl: mockFetch("{}") }),
    );

    expect(code).toBe(EXIT_CONSENT_REFUSED);
    expect(requests).toEqual([]);
    expect(listJobs(db, repo)).toEqual([]);
    expect(frontmatter().frontmatter.checkpoints).toEqual([]);
    expect(frontmatter().frontmatter.status).toBe("crashed");
    // The estimate is still printed: a refusal should be an informed one.
    expect(err.join("\n")).toContain("transcript bytes since offset 0");
    expect(err.join("\n")).toContain("extract: cancelled");
  });

  it("writes the extracted digest with trigger: extract and marks the session repaired", async () => {
    crashedSession();

    const code = await runRepair(
      ULID,
      { extract: true, yes: true },
      repairIo({ fetchImpl: mockFetch(JSON.stringify(GOOD_PAYLOAD)) }),
    );

    expect(code, err.join("\n")).toBe(EXIT_OK);
    const parsed = frontmatter();
    expect(parsed.frontmatter.checkpoints).toHaveLength(1);
    expect(parsed.frontmatter.checkpoints[0]?.trigger).toBe("extract");
    expect(parsed.frontmatter.status).toBe("repaired");
    expect(parsed.frontmatter.needs_repair).toBe(false);
    expect(readFileSync(sessionFile(repo, ULID), "utf8")).toContain("Wrote the health endpoint");
    // Consumed exactly once.
    expect(db.getSessionByUlid(ULID)?.pending_trigger).toBeNull();
    expect(out).toContain(`repair: session ${ULID} repaired by extraction`);

    // The request went to the Messages endpoint with the contracted headers, and carried the
    // transcript rather than a path to it.
    expect(requests).toHaveLength(1);
    const request = requests[0] as { url: string; headers: Record<string, string>; body: string };
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request.headers["x-api-key"]).toBe(API_KEY);
    expect(JSON.parse(request.body)).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 4096 });
    expect(request.body).toContain("I will edit");

    const job = listJobs(db, repo)[0];
    expect(job).toMatchObject({ kind: "extract", status: "done" });
    expect(job?.cost_estimate_usd).toBeGreaterThan(0);
  });

  it("mints a real WL- backlog id for a new: true item with no minter injected", async () => {
    crashedSession();

    // `newBacklogId` is left off deliberately, so the extraction falls through to core's real
    // minter — the production wiring. The system prompt mandates `new: true` on every remaining
    // item, so a run that forwarded the *job* id minter here (a bare ULID) would fail validation
    // with `expected a backlog id of the form WL-<ulid>` after the API call had been paid for,
    // and leave the session unrepaired.
    const code = await runRepair(
      ULID,
      { extract: true, yes: true },
      repairIo({
        newBacklogId: undefined,
        fetchImpl: mockFetch(JSON.stringify(GOOD_PAYLOAD)),
      }),
    );

    expect(code, err.join("\n")).toBe(EXIT_OK);
    const backlog = readdirSync(path.join(repo, ".workledger", "backlog"));
    expect(backlog).toHaveLength(1);
    expect(backlog[0]).toMatch(/^WL-[0-9A-HJKMNP-TV-Z]{26}\.md$/);
    expect(frontmatter().frontmatter.status).toBe("repaired");
    expect(frontmatter().frontmatter.checkpoints[0]?.trigger).toBe("extract");
    // The remaining item points at the file that was just created.
    expect(readFileSync(sessionFile(repo, ULID), "utf8")).toContain(
      (backlog[0] as string).replace(/\.md$/, ""),
    );
  });

  it("exits 5 with the field paths when the model's payload does not validate", async () => {
    crashedSession();
    // `done[0]` has neither `files` nor `commit`: the evidence rule the P1 schema enforces.
    const bad = JSON.stringify({
      goal: "Add a health endpoint",
      done: [{ text: "Did something", verified: "not-verified" }],
      remaining: [],
      notes: [],
    });

    const code = await runRepair(
      ULID,
      { extract: true, yes: true },
      repairIo({ fetchImpl: mockFetch(bad) }),
    );

    expect(code).toBe(EXIT_JOB_FAILED);
    expect(err.join("\n")).toContain("extract: done[0]: needs evidence");
    expect(frontmatter().frontmatter.checkpoints).toEqual([]);
    expect(frontmatter().frontmatter.status).toBe("crashed");
    expect(listJobs(db, repo)[0]).toMatchObject({ status: "failed" });
    expect(db.getSessionByUlid(ULID)?.pending_trigger).toBeNull();
  });

  it("exits 5 when the API refuses, without echoing the key into the job row", async () => {
    crashedSession();

    const code = await runRepair(
      ULID,
      { extract: true, yes: true },
      repairIo({
        fetchImpl: mockFetch(
          JSON.stringify({ error: { message: `invalid key ${API_KEY}` } }),
          401,
        ),
      }),
    );

    expect(code).toBe(EXIT_JOB_FAILED);
    const job = listJobs(db, repo)[0];
    expect(job?.error).toContain("returned 401");
    expect(job?.error).not.toContain(API_KEY);
    expect(job?.error).toContain("<redacted:anthropic-api-key>");
  });

  it("exits 5 without a key rather than calling the API", async () => {
    crashedSession();

    const code = await runRepair(
      ULID,
      { extract: true, yes: true },
      repairIo({ apiKey: () => undefined, fetchImpl: mockFetch("{}") }),
    );

    expect(code).toBe(EXIT_JOB_FAILED);
    expect(requests).toEqual([]);
    expect(err.join("\n")).toContain("ANTHROPIC_API_KEY is not set");
  });

  it("reports a transcript that is no longer on this machine", async () => {
    crashedSession();
    rmSync(transcript);

    expect(await runRepair(ULID, { extract: true, yes: true }, repairIo())).toBe(EXIT_JOB_FAILED);
    expect(err.join("\n")).toContain("no longer on this machine");
    expect(requests).toEqual([]);
  });

  it("has nothing to extract when the last checkpoint already covers the transcript", async () => {
    crashedSession(statSync(transcript).size);

    expect(await runRepair(ULID, { extract: true, yes: true }, repairIo())).toBe(EXIT_JOB_FAILED);
    expect(err.join("\n")).toContain("no transcript bytes since its last checkpoint");
  });

  it("tolerates a fenced reply and a preamble around the JSON", () => {
    expect(extractJson('Here you go:\n```json\n{"goal":"x"}\n```')).toBe('{"goal":"x"}');
    expect(extractJson('{"goal":"x"}')).toBe('{"goal":"x"}');
    expect(redactSecrets(`key ${API_KEY} here`)).toBe("key <redacted:anthropic-api-key> here");
  });
});

describe("the API key never lands anywhere durable", () => {
  it("is absent from the index, every ledger file, and both output streams", async () => {
    crashedSession();

    const code = await runRepair(
      ULID,
      { extract: true, yes: true },
      repairIo({ fetchImpl: mockFetch(JSON.stringify(GOOD_PAYLOAD)) }),
    );
    expect(code, err.join("\n")).toBe(EXIT_OK);
    db.close();

    /** Every file under a directory, recursively. */
    const walk = (root: string): string[] =>
      readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const at = path.join(root, entry.name);
        return entry.isDirectory() ? walk(at) : [at];
      });

    // The whole index home (index.sqlite, its WAL, anything else) and the whole ledger — the
    // two places workledger persists anything — plus the two streams a caller can capture.
    const searched = [...walk(home), ...walk(path.join(repo, ".workledger"))];
    expect(searched.length).toBeGreaterThan(1);
    for (const file of searched) {
      expect(readFileSync(file, "latin1"), `${file} contains the API key`).not.toContain(API_KEY);
    }
    expect(out.join("\n")).not.toContain(API_KEY);
    expect(err.join("\n")).not.toContain(API_KEY);
    // Sanity: the run really did happen and really did use the key.
    expect(requests[0]?.headers["x-api-key"]).toBe(API_KEY);

    db = openIndex({ home });
  });
});
