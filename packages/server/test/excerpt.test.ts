/**
 * `GET /api/sessions/:ulid/excerpt?cp=<n>` — plans/feature-p3-data-flow.md §Excerpts.
 *
 * The transcript is a real captured one (`test/fixtures/transcripts/`), not a hand-written stub:
 * the whole risk in this endpoint is that a harness's record shapes are not what the renderer
 * assumes, and a fixture written by the same hand as the renderer cannot find that out. The two
 * checkpoints are synthesized here because the *offsets* are the injected op's business, and this
 * package never opens the index that holds them.
 *
 * What is asserted: the span really is `[offset(n-1), offset(n))`, turns render with tool counts
 * and no tool payloads, the cache lands under `~/.workledger/cache/` and is used on the second
 * call, a deleted transcript is a 404, and nothing is ever written under `.workledger/`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeJobOps, appFor, seedRepo } from "./helpers.js";
import { excerptCachePath, renderTurns } from "../src/excerpt.js";
import type { ServerApp } from "../src/app.js";
import type { TempRepo } from "./helpers.js";

/** A transcript captured from a real Claude Code session (`scripts/capture-fixtures.mjs`). */
const TRANSCRIPT = fileURLToPath(
  new URL("../../../test/fixtures/transcripts/746c9f65-6bb2-423a-b497-28855f8519a3.jsonl", import.meta.url),
);

const SESSION = "01JQ8ZK4T0000000000000000A";

/**
 * Two checkpoints over the fixture: one at the end of the first `n` records, one at the end.
 *
 * The byte offsets are computed from the file rather than hard-coded, so re-capturing the fixture
 * does not silently turn this into a test of a stale window.
 */
function checkpointOffsets(): [number, number] {
  const lines = readFileSync(TRANSCRIPT, "utf8").split("\n");
  let first = 0;
  for (const line of lines.slice(0, 12)) first += Buffer.byteLength(line, "utf8") + 1;
  return [first, statSync(TRANSCRIPT).size];
}

let repo: TempRepo;
let jobs: FakeJobOps;
let server: ServerApp;
let home: string;
let transcript: string;

beforeEach(() => {
  repo = seedRepo();
  home = path.join(repo.root, "home");
  // A copy, so a test that deletes the transcript cannot delete the repo's fixture.
  transcript = path.join(repo.root, "transcript.jsonl");
  writeFileSync(transcript, readFileSync(TRANSCRIPT));
  jobs = new FakeJobOps();
  server = appFor(repo, { jobs, home, jobPollMs: 60_000 });
  // `createApp` starts the `job.changed` poller, whose priming read is a real `listJobs` call;
  // these tests assert what the excerpt route asked for.
  jobs.calls.length = 0;
});

afterEach(() => {
  server.close();
  repo.cleanup();
});

async function excerpt(cp: number): Promise<{ status: number; body: unknown }> {
  const response = await server.app.request(`/api/sessions/${SESSION}/excerpt?cp=${String(cp)}`);
  return { status: response.status, body: await response.json() };
}

/** Every file under `.workledger/`, with its size — the "nothing is written here" assertion. */
function ledgerSnapshot(dir: string): Record<string, number> {
  const seen: Record<string, number> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isFile()) seen[path.relative(dir, file)] = statSync(file).size;
  }
  return seen;
}

describe("renderTurns", () => {
  it("renders user and assistant prose and counts tool traffic without returning it", () => {
    const turns = renderTurns(readFileSync(TRANSCRIPT, "utf8"));

    expect(turns.length).toBeGreaterThan(0);
    expect(new Set(turns.map((turn) => turn.role))).toEqual(new Set(["user", "assistant"]));
    for (const turn of turns) {
      expect(turn.text).not.toBe("");
      expect(Number.isInteger(turn.tools)).toBe(true);
      expect(turn.tools).toBeGreaterThanOrEqual(0);
    }
    // The fixture is a session that ran tools, so at least one turn carries a count.
    expect(turns.some((turn) => turn.tools > 0)).toBe(true);
  });

  it("drops thinking blocks and tool payloads, keeping only the text", () => {
    const turns = renderTurns(
      [
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
          { type: "thinking", thinking: "SECRET-REASONING" },
          { type: "text", text: "Reading the file." },
          { type: "tool_use", name: "Read", input: { file_path: "/etc/passwd" } },
        ] } }),
        JSON.stringify({ type: "user", message: { role: "user", content: [
          { type: "tool_result", content: "root:x:0:0:SECRET-CONTENTS" },
        ] } }),
      ].join("\n"),
    );

    expect(turns).toEqual([{ role: "assistant", text: "Reading the file.", tools: 2 }]);
    expect(JSON.stringify(turns)).not.toContain("SECRET");
  });

  it("collapses a tool-only record into the turn before it, and carries a leading one forward", () => {
    const toolOnly = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] },
    });
    const spoke = JSON.stringify({ type: "user", message: { role: "user", content: "go on" } });

    expect(renderTurns([toolOnly, spoke].join("\n"))).toEqual([
      { role: "user", text: "go on", tools: 1 },
    ]);
    expect(renderTurns([spoke, toolOnly].join("\n"))).toEqual([
      { role: "user", text: "go on", tools: 1 },
    ]);
  });

  it("skips the torn first and last lines of a window rather than failing", () => {
    const good = JSON.stringify({ type: "user", message: { role: "user", content: "hello" } });

    expect(renderTurns(`ge":{"role":"user"}}\n${good}\n{"type":"assis`)).toEqual([
      { role: "user", text: "hello", tools: 0 },
    ]);
  });

  it("ignores records that are not turns", () => {
    expect(renderTurns('{"type":"mode","mode":"normal"}\n{"type":"file-history-snapshot"}')).toEqual([]);
  });
});

describe("GET /api/sessions/:ulid/excerpt", () => {
  it("reads [offset(n-1), offset(n)) and returns the contract's shape", async () => {
    const [first, end] = checkpointOffsets();
    jobs.span = { transcriptPath: transcript, from: first, to: end };

    const { status, body } = await excerpt(2);

    expect(status).toBe(200);
    const excerpted = body as { cp: number; offset: [number, number]; turns: { role: string }[] };
    expect(excerpted.cp).toBe(2);
    expect(excerpted.offset).toEqual([first, end]);
    expect(excerpted.turns.length).toBeGreaterThan(0);
    expect(jobs.calls).toEqual([{ op: "excerptSpan", args: [repo.root, SESSION, 2] }]);
  });

  it("gives checkpoint 1 the span from byte 0, and a smaller reading than checkpoint 2", async () => {
    const [first, end] = checkpointOffsets();

    jobs.span = { transcriptPath: transcript, from: 0, to: first };
    const one = (await excerpt(1)).body as { offset: [number, number]; turns: unknown[] };
    jobs.span = { transcriptPath: transcript, from: first, to: end };
    const two = (await excerpt(2)).body as { offset: [number, number]; turns: unknown[] };

    expect(one.offset).toEqual([0, first]);
    expect(two.offset[0]).toBe(one.offset[1]);
    expect(one.turns.length).toBeLessThan(two.turns.length);
  });

  it("caches the rendering under ~/.workledger/cache/<ulid>/cp-<n>.json and reuses it", async () => {
    const [first] = checkpointOffsets();
    jobs.span = { transcriptPath: transcript, from: 0, to: first };

    const fresh = await excerpt(1);
    const cache = excerptCachePath(home, SESSION, 1);
    expect(existsSync(cache)).toBe(true);
    expect(JSON.parse(readFileSync(cache, "utf8"))).toEqual(fresh.body);

    // A second call is served from that file: the marker below is not in the transcript, so
    // seeing it back proves the render did not run again.
    writeFileSync(cache, JSON.stringify({ cp: 1, offset: [0, first], turns: [{ role: "user", text: "CACHED", tools: 0 }] }));
    expect((await excerpt(1)).body).toEqual({ cp: 1, offset: [0, first], turns: [{ role: "user", text: "CACHED", tools: 0 }] });
  });

  it("re-renders when the cached entry is for a different span", async () => {
    const [first] = checkpointOffsets();
    const cache = excerptCachePath(home, SESSION, 1);
    mkdirSync(path.dirname(cache), { recursive: true });
    writeFileSync(cache, JSON.stringify({ cp: 1, offset: [0, 7], turns: [{ role: "user", text: "STALE", tools: 0 }] }));

    jobs.span = { transcriptPath: transcript, from: 0, to: first };
    const { body } = await excerpt(1);

    expect(JSON.stringify(body)).not.toContain("STALE");
    expect((body as { offset: [number, number] }).offset).toEqual([0, first]);
  });

  it("404s with transcript_missing when the file is gone from this machine", async () => {
    const [first] = checkpointOffsets();
    jobs.span = { transcriptPath: transcript, from: 0, to: first };
    await excerpt(1);

    // Moved rather than deleted, so the cache entry that already exists is what is under test:
    // "no longer on this machine" is a fact about now, not about the last render.
    renameSync(transcript, `${transcript}.gone`);
    const { status, body } = await excerpt(1);

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("transcript_missing");
  });

  it("404s when the index has no such session or checkpoint", async () => {
    jobs.span = undefined;

    const { status, body } = await excerpt(9);

    expect(status).toBe(404);
    expect((body as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("400s a cp that is not a checkpoint number, before the op is reached", async () => {
    for (const cp of ["0", "-1", "1.5", "many", ""]) {
      const response = await server.app.request(`/api/sessions/${SESSION}/excerpt?cp=${cp}`);
      expect(response.status).toBe(400);
    }
    const missing = await server.app.request(`/api/sessions/${SESSION}/excerpt`);
    expect(missing.status).toBe(400);
    expect(jobs.calls).toEqual([]);
  });

  it("writes nothing under .workledger/", async () => {
    const [, end] = checkpointOffsets();
    const before = ledgerSnapshot(repo.ledger);

    jobs.span = { transcriptPath: transcript, from: 0, to: end };
    await excerpt(1);
    await excerpt(1);

    expect(ledgerSnapshot(repo.ledger)).toEqual(before);
    // …and the cache it did write is outside the repo's ledger entirely.
    expect(excerptCachePath(home, SESSION, 1).startsWith(repo.ledger)).toBe(false);
  });
});
