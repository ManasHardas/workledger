/**
 * `private_paths` — docs/contracts/p5/config-and-identities.md: "matched with picomatch
 * semantics against the session's `cwd` relative to the repo root; a match sets `private: true`
 * at `SessionStart` (boundary record only, no brief, never a block)."
 *
 * Three layers, tested in order: the glob translation on its own, the pattern-shape rules on top
 * of it, and then the property the contract actually promises, asserted through `runHook` on a
 * real ledger — a session in a matched directory produces a record and no brief, and a Stop in
 * that session never blocks no matter how far past its thresholds it is.
 *
 * The last group is the one that would catch a regression that matters. A private session that
 * *blocked* would hand a checkpoint instruction to an agent working in a directory the operator
 * declared off-limits, which is the exact failure the key exists to prevent.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { claudeCodeAdapter } from "../src/adapters/claude-code.js";
import { isPrivatePath, isPrivateSession, parseConfig, relativeToRoot } from "../src/config.js";
import { matchGlob } from "../src/glob.js";
import { EXIT_OK } from "../src/exit-codes.js";
import { openIndex } from "../src/index/db.js";
import { runHook } from "../src/commands/hook.js";
import type { HookEvent } from "../src/commands/hook-events.js";
import type { HookIo } from "../src/commands/hook.js";

const HARNESS_ID = "hsess-private-paths";
const HOME = "/home/u";

describe("matchGlob", () => {
  it("matches a literal segment and nothing near it", () => {
    expect(matchGlob("secrets", "secrets")).toBe(true);
    expect(matchGlob("secrets2", "secrets")).toBe(false);
    expect(matchGlob("a/secrets", "secrets")).toBe(false);
    // A bare literal is one segment: picomatch does not make `secrets` match `secrets/keys`.
    expect(matchGlob("secrets/keys", "secrets")).toBe(false);
  });

  it("`*` stays inside one segment and `**` crosses them", () => {
    expect(matchGlob("clients/acme", "clients/*")).toBe(true);
    expect(matchGlob("clients/acme/billing", "clients/*")).toBe(false);
    expect(matchGlob("clients/acme/billing", "clients/**")).toBe(true);
    // `a/**` matches `a` itself, which is what an operator writing `secrets/**` means.
    expect(matchGlob("clients", "clients/**")).toBe(true);
    expect(matchGlob("clientsx", "clients/**")).toBe(false);
    expect(matchGlob("a/deep/nested/leaf", "a/**/leaf")).toBe(true);
    expect(matchGlob("", "**")).toBe(true);
  });

  it("supports `?`, character classes and braces", () => {
    expect(matchGlob("v1", "v?")).toBe(true);
    expect(matchGlob("v10", "v?")).toBe(false);
    expect(matchGlob("logs-a", "logs-[a-c]")).toBe(true);
    expect(matchGlob("logs-z", "logs-[a-c]")).toBe(false);
    expect(matchGlob("logs-z", "logs-[!a-c]")).toBe(true);
    expect(matchGlob("src/private", "src/{private,secret}")).toBe(true);
    expect(matchGlob("src/secret", "src/{private,secret}")).toBe(true);
    expect(matchGlob("src/public", "src/{private,secret}")).toBe(false);
  });

  it("treats regex punctuation as literal and never throws on a malformed pattern", () => {
    expect(matchGlob("a.b", "a.b")).toBe(true);
    expect(matchGlob("axb", "a.b")).toBe(false);
    expect(matchGlob("a+b", "a+b")).toBe(true);
    expect(matchGlob("a(b)", "a(b)")).toBe(true);
    // Unterminated constructs are literals, not errors: config.yaml is not a program.
    expect(matchGlob("[oops", "[oops")).toBe(true);
    expect(matchGlob("", "")).toBe(false);
    expect(matchGlob("x", "{unclosed")).toBe(false);
  });
});

describe("relativeToRoot", () => {
  it("is the empty string at the root, a slash path inside it, and undefined outside", () => {
    expect(relativeToRoot("/w/repo", "/w/repo")).toBe("");
    expect(relativeToRoot("/w/repo", "/w/repo/a/b")).toBe("a/b");
    expect(relativeToRoot("/w/repo", "/w/other")).toBeUndefined();
    expect(relativeToRoot("/w/repo", "/w")).toBeUndefined();
  });
});

describe("isPrivateSession", () => {
  it("matches a relative glob against the cwd relative to the repo root", () => {
    const patterns = ["experiments/**", "clients/*/private"];
    expect(isPrivateSession("/w/repo", "/w/repo/experiments/a", patterns, HOME)).toBe(true);
    expect(isPrivateSession("/w/repo", "/w/repo/experiments", patterns, HOME)).toBe(true);
    expect(isPrivateSession("/w/repo", "/w/repo/clients/acme/private", patterns, HOME)).toBe(true);
    expect(isPrivateSession("/w/repo", "/w/repo/clients/acme", patterns, HOME)).toBe(false);
    expect(isPrivateSession("/w/repo", "/w/repo", patterns, HOME)).toBe(false);
    expect(isPrivateSession("/w/repo", "/w/repo/src", patterns, HOME)).toBe(false);
  });

  it("tolerates the shapes an operator actually types", () => {
    expect(isPrivateSession("/w/repo", "/w/repo/secret/x", ["./secret/**"], HOME)).toBe(true);
    expect(isPrivateSession("/w/repo", "/w/repo/secret", ["secret/"], HOME)).toBe(true);
    expect(isPrivateSession("/w/repo", "/w/repo/secret", ["  secret  "], HOME)).toBe(true);
    expect(isPrivateSession("/w/repo", "/w/repo/secret", ["", "   "], HOME)).toBe(false);
  });

  it("keeps P1's absolute-path semantics, against the root and against the cwd", () => {
    // The repo listed by its own path: private wherever the session started inside it.
    expect(isPrivateSession("/w/repo", "/w/repo/deep/dir", ["/w/repo"], HOME)).toBe(true);
    // A directory listed by absolute path, with the session started in it.
    expect(isPrivateSession("/w/repo", "/w/repo/vault", ["/w/repo/vault"], HOME)).toBe(true);
    expect(isPrivateSession("/w/repo", "/w/repo/src", ["/w/repo/vault"], HOME)).toBe(false);
    // A sibling is never a match, the property `isPrivatePath` was written for.
    expect(isPrivateSession("/w/repox", "/w/repox", ["/w/repo"], HOME)).toBe(false);
    expect(isPrivatePath("/w/ab", ["/w/a"], HOME)).toBe(false);
    // `~` expands against the home directory that was passed in, never the real one.
    expect(isPrivateSession(`${HOME}/secret`, `${HOME}/secret`, ["~/secret"], HOME)).toBe(true);
  });

  it("never matches a cwd outside the repo with a relative pattern", () => {
    expect(isPrivateSession("/w/repo", "/elsewhere/experiments", ["experiments/**"], HOME)).toBe(false);
  });
});

describe("private_paths in config.yaml", () => {
  it("reads both the flow sequence and the block sequence", () => {
    expect(parseConfig('private_paths: ["experiments/**", clients/*]\n').private_paths).toEqual([
      "experiments/**",
      "clients/*",
    ]);
    expect(
      parseConfig(["private_paths:", "  - experiments/**", "  - vault", ""].join("\n")).private_paths,
    ).toEqual(["experiments/**", "vault"]);
  });
});

// ---------------------------------------------------------------------------
// End to end, through the hook
// ---------------------------------------------------------------------------

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  home: string;
  transcript: string;
  stdout: string[];
  stderr: string[];
}

function setup(patterns: readonly string[]): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-private-"));
  temps.push(dir);
  const root = path.join(dir, "repo");
  const home = path.join(dir, "home");
  mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  mkdirSync(path.join(root, "experiments", "spike"), { recursive: true });
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    path.join(root, ".workledger", "config.yaml"),
    [
      "schema_version: 1",
      "harnesses: [claude-code]",
      // Deliberately trivial, so a Stop is guaranteed to cross them and a block is guaranteed
      // unless the session is private.
      "thresholds: { bytes: 1, minutes: 1, turns: 1 }",
      "brief: { inject: true, max_tokens: 2000 }",
      "stale_turns: 5",
      `private_paths: [${patterns.join(", ")}]`,
      "",
    ].join("\n"),
    "utf8",
  );
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(transcript, "x".repeat(100), "utf8");
  return { root, home, transcript, stdout: [], stderr: [] };
}

/** Run one hook event with the session's `cwd` set to `cwd`. */
async function run(fixture: Fixture, event: HookEvent, cwd: string, extra: Record<string, unknown> = {}): Promise<number> {
  const io: HookIo = {
    readStdin: () =>
      Promise.resolve(
        JSON.stringify({
          session_id: HARNESS_ID,
          transcript_path: fixture.transcript,
          cwd,
          hook_event_name: event,
          source: "startup",
          ...extra,
        }),
      ),
    stdout: (line) => void fixture.stdout.push(line),
    stderr: (line) => void fixture.stderr.push(line),
    cwd,
    env: { WORKLEDGER_HOME: fixture.home },
    homeDir: fixture.home,
    now: () => new Date("2026-09-09T12:00:00.000Z"),
    adapter: claudeCodeAdapter,
  };
  return runHook(event, io);
}

/** The one session file the ledger holds. */
function sessionText(fixture: Fixture): string {
  const dir = path.join(fixture.root, ".workledger", "sessions");
  const files = readdirSync(dir);
  expect(files).toHaveLength(1);
  return readFileSync(path.join(dir, files[0] as string), "utf8");
}

describe("a session under a private_paths match", () => {
  it("writes a boundary record only, injects no brief, and never blocks", async () => {
    const fixture = setup(["experiments/**"]);
    const cwd = path.join(fixture.root, "experiments", "spike");

    expect(await run(fixture, "SessionStart", cwd)).toBe(EXIT_OK);

    // Boundary record only: the file exists and says so, and nothing went to stdout — the brief
    // is what `SessionStart` would otherwise have injected there.
    expect(sessionText(fixture)).toContain("private: true");
    expect(fixture.stdout).toEqual([]);

    const db = openIndex({ home: fixture.home });
    try {
      expect(db.getSessionByHarnessId("claude-code", HARNESS_ID, fixture.root)?.private).toBe(1);
    } finally {
      db.close();
    }

    // Thresholds of 1 mean this Stop crosses all three; a private session allows anyway.
    writeFileSync(fixture.transcript, "x".repeat(100_000), "utf8");
    expect(await run(fixture, "Stop", cwd, { stop_hook_active: false })).toBe(EXIT_OK);
    expect(fixture.stderr).toEqual([]);
  });

  it("leaves a session started elsewhere in the repo public", async () => {
    const fixture = setup(["experiments/**"]);

    expect(await run(fixture, "SessionStart", path.join(fixture.root, "src"))).toBe(EXIT_OK);

    expect(sessionText(fixture)).toContain("private: false");
    // The brief was injected, which is the observable difference.
    expect(fixture.stdout.length).toBeGreaterThan(0);
  });

  it("still honours WORKLEDGER_PRIVATE=1 with no patterns at all", async () => {
    const fixture = setup([]);
    const io: HookIo = {
      readStdin: () =>
        Promise.resolve(
          JSON.stringify({
            session_id: HARNESS_ID,
            transcript_path: fixture.transcript,
            cwd: fixture.root,
            hook_event_name: "SessionStart",
            source: "startup",
          }),
        ),
      stdout: (line) => void fixture.stdout.push(line),
      stderr: (line) => void fixture.stderr.push(line),
      cwd: fixture.root,
      env: { WORKLEDGER_HOME: fixture.home, WORKLEDGER_PRIVATE: "1" },
      homeDir: fixture.home,
      now: () => new Date("2026-09-09T12:00:00.000Z"),
      adapter: claudeCodeAdapter,
    };

    expect(await runHook("SessionStart", io)).toBe(EXIT_OK);
    expect(sessionText(fixture)).toContain("private: true");
    expect(fixture.stdout).toEqual([]);
  });
});
