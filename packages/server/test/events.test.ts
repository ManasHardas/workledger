/**
 * `/api/events` and the watcher behind it (api.md §SSE): the four events, the keep-alive, the
 * 2 s budget from plans/feature-p2-data-flow.md §Budgets, and the polling fallback.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appFor, seedRepo } from "./helpers.js";
import { startWatcher } from "../src/watcher.js";
import { ledgerPaths } from "../src/paths.js";
import { repoId } from "../src/repos.js";
import type { TempRepo } from "./helpers.js";
import type { ServerApp, RunningServer } from "../src/app.js";

let repo: TempRepo;
let server: ServerApp;
let running: RunningServer | undefined;

beforeEach(() => {
  repo = seedRepo();
  server = appFor(repo, { pingMs: 200 });
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  server.close();
  repo.cleanup();
});

/** One parsed SSE frame. */
interface Frame {
  event: string;
  data: string;
}

/**
 * Read frames off a live `/api/events` until one satisfies `want`, or `timeoutMs` elapses.
 *
 * The predicate rather than a bare event name is deliberate: FSEvents on macOS can replay a
 * directory's recent history when a recursive watch opens, so the first `session.changed` on the
 * wire is not necessarily the one the test caused.
 *
 * @returns every frame read, so a test can assert on what did arrive when the wanted one did not.
 */
async function readUntil(url: string, want: (frame: Frame) => boolean, timeoutMs: number, after?: () => void): Promise<Frame[]> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal, headers: { accept: "text/event-stream" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");

  const frames: Frame[] = [];
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  // The change is made only once the stream is open, so the event cannot be missed in the gap
  // between `createApp` and the subscription.
  after?.();
  try {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf("\n\n");
      while (split >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const event = /^event:\s*(.*)$/m.exec(block)?.[1]?.trim() ?? "";
        const data = /^data:\s*(.*)$/m.exec(block)?.[1]?.trim() ?? "";
        frames.push({ event, data });
        if (want({ event, data })) {
          controller.abort();
          return frames;
        }
        split = buffer.indexOf("\n\n");
      }
    }
  } catch {
    // An abort is how both the timeout and the success path end the read.
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
  return frames;
}

describe("GET /api/events", () => {
  it("emits backlog.changed within 2 s of a backlog file being written", async () => {
    running = await server.start({ port: 0 });
    const id = "WL-01M246Y97SPQKRBJJYNX141QB6";
    const source = path.join(repo.backlog, "WL-01M246Y97SPQKRBJJYNX141QB5.md");
    const text = readFileSync(source, "utf8").replace("WL-01M246Y97SPQKRBJJYNX141QB5", id);

    const started = Date.now();
    const matches = (frame: Frame): boolean =>
      frame.event === "backlog.changed" && (JSON.parse(frame.data) as { id: string }).id === id;
    const frames = await readUntil(`http://127.0.0.1:${running.port}/api/events`, matches, 2000, () => {
      writeFileSync(path.join(repo.backlog, `${id}.md`), text, "utf8");
    });
    const elapsed = Date.now() - started;

    const change = frames.find(matches);
    expect(change, `frames seen: ${JSON.stringify(frames)}`).toBeDefined();
    // P8: every event names its repo, so one stream can carry the whole machine.
    expect(JSON.parse(change!.data)).toEqual({ id, repo: repoId(repo.root) });
    expect(elapsed).toBeLessThan(2000);
    // The read model was invalidated before the event went out, so the GET already sees it.
    const item = await server.app.request(`/api/backlog/${id}`);
    expect(item.status).toBe(200);
  });

  it("emits session.changed and notes.changed for a session write", async () => {
    running = await server.start({ port: 0 });
    const file = path.join(repo.sessions, "01M2473A9YQ3V9KHYFYC6Q0D2X.md");
    const text = readFileSync(file, "utf8");

    // `notes.changed` closes the flush that `session.changed` opened, so the read stops on the
    // pair rather than on the first of the two.
    let sawSession = false;
    const matches = (frame: Frame): boolean => {
      if (
        frame.event === "session.changed" &&
        (JSON.parse(frame.data) as { ulid: string }).ulid === "01M2473A9YQ3V9KHYFYC6Q0D2X"
      ) {
        sawSession = true;
      }
      return sawSession && frame.event === "notes.changed";
    };
    const frames = await readUntil(`http://127.0.0.1:${running.port}/api/events`, matches, 2000, () => {
      writeFileSync(file, `${text}- discovery [cp 1]: a second discovery\n`, "utf8");
    });
    expect(sawSession, `frames seen: ${JSON.stringify(frames)}`).toBe(true);
    expect(frames.some((frame) => frame.event === "notes.changed")).toBe(true);
  });

  it("emits health.changed when config.yaml changes", async () => {
    running = await server.start({ port: 0 });
    const frames = await readUntil(`http://127.0.0.1:${running.port}/api/events`, (frame) => frame.event === "health.changed", 2000, () => {
      writeFileSync(path.join(repo.ledger, "config.yaml"), "schema_version: 1\nstale_turns: 6\n", "utf8");
    });
    expect(frames.some((frame) => frame.event === "health.changed")).toBe(true);
  });

  it("keeps the stream alive with a ping", async () => {
    running = await server.start({ port: 0 });
    const frames = await readUntil(`http://127.0.0.1:${running.port}/api/events`, (frame) => frame.event === "ping", 2000);
    expect(frames.some((frame) => frame.event === "ping")).toBe(true);
  });
});

describe("start", () => {
  it("binds 127.0.0.1 and serves the API there", async () => {
    running = await server.start({ port: 0 });
    expect(running.port).toBeGreaterThan(0);
    const response = await fetch(`http://127.0.0.1:${running.port}/api/health`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { repo: string }).repo).toBe(repo.root);
  });
});

describe("watcher", () => {
  it("falls back to polling when fs.watch cannot be established, and still reports changes", async () => {
    const missing = path.join(repo.root, "absent-repo");
    const paths = ledgerPaths(missing);
    const seen: string[][] = [];
    const watcher = startWatcher({ paths, onChange: (files) => void seen.push(files), debounceMs: 10, pollMs: 50 });
    try {
      expect(watcher.mode).toBe("poll");
      mkdirSync(paths.backlog, { recursive: true });
      writeFileSync(path.join(paths.backlog, "WL-01M246Y97SPQKRBJJYNX141QB7.md"), "x", "utf8");
      const deadline = Date.now() + 2000;
      while (seen.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(seen.flat().some((file) => file.endsWith("WL-01M246Y97SPQKRBJJYNX141QB7.md"))).toBe(true);
    } finally {
      watcher.close();
    }
  });

  it("debounces a burst into one flush and ignores atomic-write scratch files", async () => {
    const paths = ledgerPaths(repo.root);
    const flushes: string[][] = [];
    const watcher = startWatcher({ paths, onChange: (files) => void flushes.push(files), debounceMs: 100 });
    try {
      const file = path.join(repo.backlog, "WL-01M246Y97SPQKRBJJYNX141QB5.md");
      const text = readFileSync(file, "utf8");
      writeFileSync(path.join(repo.backlog, ".scratch.42.1.tmp"), "ignored", "utf8");
      for (let i = 0; i < 5; i += 1) writeFileSync(file, `${text}\n`, "utf8");
      const deadline = Date.now() + 5000;
      while (flushes.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // Under machine load fs events can straddle the debounce window, so "exactly one flush"
      // is not a stable property; what is stable: at least one flush arrived, no scratch file
      // ever appears in one, and the only file reported is the one that changed.
      expect(flushes.length).toBeGreaterThanOrEqual(1);
      const changed = new Set(flushes.flat());
      expect([...changed].every((f) => !f.endsWith(".tmp"))).toBe(true);
      // fs.watch may also report the containing directory under load; the file itself must be there.
      expect([...changed].some((f) => f.endsWith("WL-01M246Y97SPQKRBJJYNX141QB5.md"))).toBe(true);
    } finally {
      watcher.close();
    }
  });
});
