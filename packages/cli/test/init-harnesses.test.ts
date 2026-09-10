/**
 * `workledger init` and `workledger doctor` for the two harnesses P4 adds — the §Configuration
 * blocks of docs/contracts/p4/hooks-codex.md and docs/contracts/p4/hooks-cursor.md.
 *
 * The load-bearing assertions are the two `toEqual` against a literal JSON object: the contracts
 * fix the *files*, key for key, and a hook file that is one key name off registers nothing while
 * looking entirely plausible. Spelling them out here is the only way a drift shows up as a
 * failure rather than as a repo that silently records no sessions.
 *
 * Every case runs against a temp repo under a temp `HOME` with a `PATH` holding only the fake
 * binaries the case installs, so nothing here reads the developer's real `~/.codex/` or
 * `~/.cursor/`.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CODEX_HOOKS_PATH, codexHookCommand, codexHooksBlock } from "../src/codex-hooks.js";
import {
  CURSOR_EVENT_KEYS,
  CURSOR_HOOKS_PATH,
  CURSOR_LOOP_LIMIT,
  cursorHookCommand,
  cursorHooksBlock,
} from "../src/cursor-hooks.js";
import { CONTRACT_TESTED_CODEX_VERSION, runDoctor } from "../src/commands/doctor.js";
import { EXIT_OK, EXIT_USAGE, EXIT_WARNINGS } from "../src/exit-codes.js";
import { configYaml } from "../src/config.js";
import { runInit } from "../src/commands/init.js";
import type { DoctorReport } from "../src/commands/doctor.js";
import type { InitIo } from "../src/commands/init.js";

interface Fixture {
  dir: string;
  root: string;
  home: string;
  bin: string;
  io: InitIo & { out: string[]; err: string[] };
}

interface SetupOptions {
  /** Install a fake `codex` on `PATH` reporting this version. */
  codexVersion?: string;
  /** Create `~/.codex/sessions/`, the rollout store. */
  codexStore?: boolean;
  /** Create `~/.cursor/`. */
  cursorStore?: boolean;
  /** Answer to the hook-file confirmations. */
  confirm?: boolean;
}

function setup(options: SetupOptions = {}): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-p4-init-"));
  const home = path.join(dir, "home");
  const root = path.join(dir, "repo");
  const bin = path.join(dir, "bin");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    path.join(root, ".git", "config"),
    "[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n",
    "utf8",
  );
  if (options.codexVersion !== undefined) {
    const fake = path.join(bin, "codex");
    writeFileSync(fake, `#!/bin/sh\necho "codex-cli ${options.codexVersion}"\n`, "utf8");
    chmodSync(fake, 0o755);
  }
  if (options.codexStore === true) {
    mkdirSync(path.join(home, ".codex", "sessions", "2026", "09", "09"), { recursive: true });
    writeFileSync(
      path.join(home, ".codex", "sessions", "2026", "09", "09", "rollout-a.jsonl"),
      "",
      "utf8",
    );
  }
  if (options.cursorStore === true) mkdirSync(path.join(home, ".cursor"), { recursive: true });

  const out: string[] = [];
  const err: string[] = [];
  return {
    dir,
    root,
    home,
    bin,
    io: {
      out,
      err,
      cwd: root,
      homeDir: home,
      env: { PATH: bin, HOME: home, WORKLEDGER_HOME: path.join(dir, "wlhome") },
      stdout: (line) => void out.push(line),
      stderr: (line) => void err.push(line),
      confirm: async () => options.confirm ?? true,
    },
  };
}

/** One JSON file from the fixture repo. */
function json(root: string, relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8")) as Record<string, unknown>;
}

/** The command string every hook file wraps, spelled out here rather than imported. */
function command(event: string, harness: string): string {
  return `if command -v workledger >/dev/null 2>&1; then exec workledger hook ${event} --harness ${harness}; fi`;
}

// ---------------------------------------------------------------------------
// The frozen blocks
// ---------------------------------------------------------------------------

describe("the hook files the contracts freeze", () => {
  it("`.codex/hooks.json` is the block from hooks-codex.md §Configuration", () => {
    expect(CODEX_HOOKS_PATH).toBe(path.join(".codex", "hooks.json"));
    expect(codexHooksBlock()).toEqual({
      SessionStart: [
        { hooks: [{ type: "command", command: command("SessionStart", "codex"), timeout: 10 }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: command("Stop", "codex"), timeout: 10 }] }],
      // 3 s, not 10: Codex defaults SessionEnd to 1 s and the contract raises it to 3.
      SessionEnd: [
        { hooks: [{ type: "command", command: command("SessionEnd", "codex"), timeout: 3 }] },
      ],
    });
  });

  it("`.cursor/hooks.json` uses Cursor's own key names and loop_limit", () => {
    expect(CURSOR_HOOKS_PATH).toBe(path.join(".cursor", "hooks.json"));
    expect(CURSOR_EVENT_KEYS).toEqual(["sessionStart", "stop", "sessionEnd"]);
    expect(cursorHooksBlock()).toEqual({
      sessionStart: [{ command: command("SessionStart", "cursor") }],
      // `loop_limit` on `stop` alone, and nowhere a `type` or a `timeout`.
      stop: [{ command: command("Stop", "cursor"), loop_limit: CURSOR_LOOP_LIMIT }],
      sessionEnd: [{ command: command("SessionEnd", "cursor") }],
    });
    expect(CURSOR_LOOP_LIMIT).toBe(2);
  });

  it("every command exits 0 in silence when the CLI is absent", async () => {
    const { spawnSync } = await import("node:child_process");
    const empty = mkdtempSync(path.join(os.tmpdir(), "wl-empty-bin-"));
    const commands = [
      ...(["SessionStart", "Stop", "SessionEnd"] as const).map((e) => codexHookCommand(e)),
      ...CURSOR_EVENT_KEYS.map((key) => cursorHookCommand(key)),
    ];
    for (const script of commands) {
      const result = spawnSync("/bin/sh", ["-c", script], {
        env: { PATH: empty },
        encoding: "utf8",
        input: "{}",
      });
      expect(result.status, script).toBe(0);
      expect(result.stdout, script).toBe("");
      expect(result.stderr, script).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

describe("workledger init with other harnesses", () => {
  it("writes nothing but .claude/settings.json when neither is installed", async () => {
    const fixture = setup();

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(existsSync(path.join(fixture.root, CODEX_HOOKS_PATH))).toBe(false);
    expect(existsSync(path.join(fixture.root, CURSOR_HOOKS_PATH))).toBe(false);
    expect(readFileSync(path.join(fixture.root, ".workledger", "config.yaml"), "utf8")).toContain(
      "harnesses: [claude-code]",
    );
  });

  it("writes `.codex/hooks.json` verbatim when Codex is on PATH", async () => {
    const fixture = setup({ codexVersion: "0.150.1" });

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(json(fixture.root, CODEX_HOOKS_PATH)).toEqual({ hooks: codexHooksBlock() });
    expect(readFileSync(path.join(fixture.root, ".workledger", "config.yaml"), "utf8")).toBe(
      configYaml(["claude-code", "codex"]),
    );
    // The trust step, which `init` cannot perform for the operator.
    const text = fixture.io.out.join("\n");
    expect(text).toContain("Trust the hooks");
    expect(text).toContain(CODEX_HOOKS_PATH);
    expect(text).toContain("0.150.1");
  });

  it("detects Codex from `~/.codex/` alone, with no binary on PATH", async () => {
    const fixture = setup({ codexStore: true });

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(json(fixture.root, CODEX_HOOKS_PATH)).toEqual({ hooks: codexHooksBlock() });
    expect(fixture.io.out.join("\n")).toContain("`codex` not found on PATH");
  });

  it("writes `.cursor/hooks.json` verbatim when `~/.cursor` exists", async () => {
    const fixture = setup({ cursorStore: true });

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(json(fixture.root, CURSOR_HOOKS_PATH)).toEqual({ hooks: cursorHooksBlock() });
    expect(readFileSync(path.join(fixture.root, ".workledger", "config.yaml"), "utf8")).toBe(
      configYaml(["claude-code", "cursor"]),
    );
  });

  it("--harness cursor writes the file on a machine with no Cursor at all", async () => {
    const fixture = setup();

    await expect(runInit({ yes: true, harness: ["cursor"] }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(json(fixture.root, CURSOR_HOOKS_PATH)).toEqual({ hooks: cursorHooksBlock() });
    expect(existsSync(path.join(fixture.root, CODEX_HOOKS_PATH))).toBe(false);
  });

  it("a second init is a no-op and says `already enabled`", async () => {
    const fixture = setup({ codexVersion: "0.150.1", cursorStore: true });
    await runInit({ yes: true }, fixture.io);
    const before = [CODEX_HOOKS_PATH, CURSOR_HOOKS_PATH].map((file) =>
      readFileSync(path.join(fixture.root, file), "utf8"),
    );
    fixture.io.out.length = 0;

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(fixture.io.out).toContain("already enabled");
    expect(
      [CODEX_HOOKS_PATH, CURSOR_HOOKS_PATH].map((file) =>
        readFileSync(path.join(fixture.root, file), "utf8"),
      ),
    ).toEqual(before);
  });

  it("preserves a foreign hook already in `.codex/hooks.json` and backs the file up", async () => {
    const fixture = setup({ codexVersion: "0.150.1" });
    mkdirSync(path.join(fixture.root, ".codex"), { recursive: true });
    const foreign = { hooks: { Stop: [{ hooks: [{ type: "command", command: "make lint" }] }] }, mine: 1 };
    writeFileSync(
      path.join(fixture.root, CODEX_HOOKS_PATH),
      `${JSON.stringify(foreign, null, 2)}\n`,
      "utf8",
    );

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    const written = json(fixture.root, CODEX_HOOKS_PATH);
    expect(written["mine"]).toBe(1);
    const stop = (written["hooks"] as Record<string, unknown[]>)["Stop"] as unknown[];
    // Foreign first, ours appended after it.
    expect(stop[0]).toEqual({ hooks: [{ type: "command", command: "make lint" }] });
    expect(stop[1]).toEqual({
      hooks: [{ type: "command", command: codexHookCommand("Stop"), timeout: 10 }],
    });
    expect(existsSync(path.join(fixture.root, `${CODEX_HOOKS_PATH}.bak`))).toBe(true);
  });

  it("corrects a stale workledger command in `.cursor/hooks.json` in place", async () => {
    const fixture = setup({ cursorStore: true });
    mkdirSync(path.join(fixture.root, ".cursor"), { recursive: true });
    writeFileSync(
      path.join(fixture.root, CURSOR_HOOKS_PATH),
      `${JSON.stringify({ hooks: { stop: [{ command: "workledger hook Stop" }] } }, null, 2)}\n`,
      "utf8",
    );

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    const stop = ((json(fixture.root, CURSOR_HOOKS_PATH)["hooks"] as Record<string, unknown[]>)[
      "stop"
    ] as unknown[]);
    expect(stop).toHaveLength(1);
    expect(stop[0]).toEqual({ command: cursorHookCommand("stop"), loop_limit: CURSOR_LOOP_LIMIT });
  });

  it("refuses when a hook file it must merge is not valid JSON", async () => {
    const fixture = setup({ codexVersion: "0.150.1" });
    mkdirSync(path.join(fixture.root, ".codex"), { recursive: true });
    writeFileSync(path.join(fixture.root, CODEX_HOOKS_PATH), "{ nope", "utf8");

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_USAGE);
    expect(fixture.io.err.join("\n")).toContain("not valid JSON");
  });

  it("a declined confirmation leaves the hook file unwritten and exits 1", async () => {
    const fixture = setup({ cursorStore: true, confirm: false });

    await expect(runInit({}, fixture.io)).resolves.toBe(EXIT_USAGE);

    expect(existsSync(path.join(fixture.root, CURSOR_HOOKS_PATH))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

/** `init` a repo, then report on it. */
async function initThenDoctor(fixture: Fixture, options: Parameters<typeof runInit>[0] = { yes: true }): Promise<DoctorReport> {
  await runInit(options, fixture.io);
  fixture.io.out.length = 0;
  await runDoctor({ json: true }, fixture.io);
  return JSON.parse(fixture.io.out[0] as string) as DoctorReport;
}

describe("workledger doctor with other harnesses", () => {
  it("always reports all three harnesses in the JSON, in a fixed order", async () => {
    const fixture = setup();
    const report = await initThenDoctor(fixture);

    expect(report.harnesses.map((probe) => probe.harness)).toEqual([
      "claude-code",
      "codex",
      "cursor",
    ]);
  });

  it("adds no codex or cursor rows on a machine with neither", async () => {
    const fixture = setup();
    const report = await initThenDoctor(fixture);

    expect(report.checks.map((check) => check.name).filter((name) => /codex|cursor/.test(name)))
      .toEqual([]);
    expect(report.codex_hooks).toBeNull();
    expect(report.cursor_hooks).toBeNull();
  });

  it("reports codex binary, store, version and hooks once Codex is installed", async () => {
    const fixture = setup({ codexVersion: "0.150.1", codexStore: true });
    const report = await initThenDoctor(fixture);

    const byName = new Map(report.checks.map((check) => [check.name, check]));
    expect(byName.get("codex binary")?.status).toBe("ok");
    expect(byName.get("codex store")?.detail).toContain("rollout(s)");
    expect(byName.get("codex version")?.status).toBe("ok");
    expect(byName.get("codex version")?.detail).toContain(CONTRACT_TESTED_CODEX_VERSION);
    expect(byName.get("codex hooks")?.status).toBe("ok");
    expect(report.codex_hooks?.matching).toEqual(["SessionStart", "Stop", "SessionEnd"]);
  });

  it("warns on a Codex version the contract was not tested against", async () => {
    const fixture = setup({ codexVersion: "1.0.0", codexStore: true });
    const report = await initThenDoctor(fixture);

    const drift = report.checks.find((check) => check.name === "codex version");
    expect(drift?.status).toBe("warn");
    expect(drift?.detail).toContain(CONTRACT_TESTED_CODEX_VERSION);
    expect(report.status).toBe("warnings");
  });

  it("reports cursor rows and the contract's key names once Cursor is present", async () => {
    const fixture = setup({ cursorStore: true });
    const report = await initThenDoctor(fixture);

    const byName = new Map(report.checks.map((check) => [check.name, check]));
    expect(byName.get("cursor install")?.status).toBe("ok");
    expect(byName.get("cursor hooks")?.status).toBe("ok");
    expect(byName.get("cursor hooks")?.detail).toContain("sessionStart, stop, sessionEnd");
    expect(report.cursor_hooks?.matching).toEqual(["sessionStart", "stop", "sessionEnd"]);
  });

  it("warns when a hook file uses the wrong key names for its harness", async () => {
    const fixture = setup({ cursorStore: true });
    await runInit({ yes: true }, fixture.io);
    // Claude Code's key names in Cursor's file: plausible, and completely inert.
    writeFileSync(
      path.join(fixture.root, CURSOR_HOOKS_PATH),
      `${JSON.stringify({ hooks: { SessionStart: [{ command: cursorHookCommand("sessionStart") }] } }, null, 2)}\n`,
      "utf8",
    );
    fixture.io.out.length = 0;

    await expect(runDoctor({ json: true }, fixture.io)).resolves.toBe(EXIT_WARNINGS);
    const report = JSON.parse(fixture.io.out[0] as string) as DoctorReport;
    expect(report.cursor_hooks?.missing).toEqual(["sessionStart", "stop", "sessionEnd"]);
    expect(report.checks.find((check) => check.name === "cursor hooks")?.detail).toContain(
      CURSOR_HOOKS_PATH,
    );
  });

  it("reports a harness that config enables but this machine does not have", async () => {
    const fixture = setup();
    const report = await initThenDoctor(fixture, { yes: true, harness: ["cursor"] });

    expect(report.checks.map((check) => check.name)).toContain("cursor hooks");
    expect(report.checks.find((check) => check.name === "cursor hooks")?.status).toBe("ok");
  });
});
