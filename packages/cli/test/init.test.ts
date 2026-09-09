/**
 * `workledger init` — docs/contracts/p1/cli.md §`init`, steps 1–5 (#13).
 *
 * Every case runs against a temp repo under a temp `HOME` and a temp `WORKLEDGER_HOME`, with a
 * `PATH` that contains only the fake `claude` (or none at all): `init` reads the user's real
 * `~/.claude/` and `~/.gitconfig` in production, and a test that let it do so here would be both
 * flaky and rude.
 *
 * The load-bearing case is the last one. The contract's command string exists to make an absent
 * binary a clean exit 0, and the only honest way to assert that is to run the string that was
 * actually written into `.claude/settings.json` through `sh` with `workledger` off `PATH`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PRIVACY_SUMMARY, runInit } from "../src/commands/init.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit-codes.js";
import { DEFAULT_CONFIG_YAML } from "../src/config.js";
import { HOOKED_EVENTS, hookCommandString } from "../src/settings-merge.js";
import type { InitIo } from "../src/commands/init.js";

/** A temp `HOME`, a temp repo inside it, and a collecting {@link InitIo}. */
interface Fixture {
  dir: string;
  root: string;
  home: string;
  /** A directory holding a fake `claude`; `PATH` points only here. */
  bin: string;
  io: InitIo & { out: string[]; err: string[] };
}

/** `key = value` lines for a git config file. */
function gitConfig(name?: string, email?: string): string {
  const lines = ["[user]"];
  if (name !== undefined) lines.push(`\tname = ${name}`);
  if (email !== undefined) lines.push(`\temail = ${email}`);
  return `${lines.join("\n")}\n`;
}

interface SetupOptions {
  /** `user.name`, written to the repo's `.git/config`. Omit to leave it unset. */
  name?: string;
  /** `user.email`. Omit to leave it unset. */
  email?: string;
  /** Install a fake `claude` on `PATH` reporting this version. */
  claudeVersion?: string;
  /** Answer to the settings-merge confirmation. */
  confirm?: boolean;
}

function setup(options: SetupOptions = {}): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-init-"));
  const home = path.join(dir, "home");
  const root = path.join(dir, "repo");
  const bin = path.join(dir, "bin");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(home, ".claude", "projects", "-Users-x-repo"), { recursive: true });
  writeFileSync(
    path.join(root, ".git", "config"),
    gitConfig(options.name ?? "Ada Lovelace", options.email ?? "ada@example.com"),
    "utf8",
  );
  if (options.claudeVersion !== undefined) {
    const fake = path.join(bin, "claude");
    writeFileSync(fake, `#!/bin/sh\necho "${options.claudeVersion} (Claude Code)"\n`, "utf8");
    chmodSync(fake, 0o755);
  }

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

/** The settings file `init` wrote. */
function settings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, ".claude", "settings.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("workledger init", () => {
  it("creates .workledger with config, README, sessions/ and backlog/", async () => {
    const fixture = setup({ claudeVersion: "2.1.4" });

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    const ledger = path.join(fixture.root, ".workledger");
    expect(readFileSync(path.join(ledger, "config.yaml"), "utf8")).toBe(DEFAULT_CONFIG_YAML);
    expect(readFileSync(path.join(ledger, "README.md"), "utf8")).toContain("source of truth");
    expect(existsSync(path.join(ledger, "sessions"))).toBe(true);
    expect(existsSync(path.join(ledger, "backlog", ".gitkeep"))).toBe(true);

    // Step 1 reported the harness and its version, from metadata only.
    expect(fixture.io.out.join("\n")).toContain("2.1.4");
    expect(fixture.io.out.join("\n")).toContain("1 project(s)");
    expect(fixture.io.out.join("\n")).toContain("Ada Lovelace <ada@example.com>");
  });

  it("writes the contract's hooks block into .claude/settings.json", async () => {
    const fixture = setup();

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    const hooks = settings(fixture.root)["hooks"] as Record<string, unknown[]>;
    for (const event of HOOKED_EVENTS) {
      expect(hooks[event]).toEqual([
        { hooks: [{ type: "command", command: hookCommandString(event), timeout: 10 }] },
      ]);
    }
  });

  it("a second init prints 'already enabled' and exits 0", async () => {
    const fixture = setup();
    await runInit({ yes: true }, fixture.io);
    const before = readFileSync(path.join(fixture.root, ".claude", "settings.json"), "utf8");
    fixture.io.out.length = 0;

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(fixture.io.out).toContain("already enabled");
    expect(fixture.io.out.join("\n")).not.toContain("Next steps");
    expect(readFileSync(path.join(fixture.root, ".claude", "settings.json"), "utf8")).toBe(before);
  });

  it("refuses with exit 1 when git user.name or user.email is empty", async () => {
    for (const missing of [{ name: undefined }, { email: undefined }] as SetupOptions[]) {
      const fixture = setup({ name: "Ada", email: "ada@example.com", ...missing });
      // `setup` always writes both unless the key is explicitly undefined, so rewrite the file.
      writeFileSync(
        path.join(fixture.root, ".git", "config"),
        gitConfig(
          "name" in missing ? undefined : "Ada",
          "email" in missing ? undefined : "ada@example.com",
        ),
        "utf8",
      );

      await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_USAGE);
      expect(fixture.io.err.join("\n")).toMatch(/user\.(name|email)/);
      expect(existsSync(path.join(fixture.root, ".workledger"))).toBe(false);
    }
  });

  it("existing .workledger files are left untouched", async () => {
    const fixture = setup();
    const ledger = path.join(fixture.root, ".workledger");
    mkdirSync(ledger, { recursive: true });
    writeFileSync(path.join(ledger, "config.yaml"), "stale_turns: 99\n", "utf8");
    writeFileSync(path.join(ledger, "README.md"), "mine\n", "utf8");

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(readFileSync(path.join(ledger, "config.yaml"), "utf8")).toBe("stale_turns: 99\n");
    expect(readFileSync(path.join(ledger, "README.md"), "utf8")).toBe("mine\n");
    expect(existsSync(path.join(ledger, "sessions"))).toBe(true);
  });

  it("next steps include the privacy summary", async () => {
    const fixture = setup();

    await runInit({ yes: true }, fixture.io);

    const text = fixture.io.out.join("\n");
    expect(text).toContain("Next steps:");
    expect(PRIVACY_SUMMARY).toHaveLength(5);
    for (const line of PRIVACY_SUMMARY) expect(text).toContain(line);
    expect(text).toContain("Nothing leaves this machine");
    expect(text).toContain("WORKLEDGER_PRIVATE=1");
    expect(text).toContain("secret-scanned");
  });

  it("asks before editing .claude/settings.json unless --yes, and honours a no", async () => {
    const asked: string[] = [];
    const fixture = setup({ confirm: false });
    fixture.io.confirm = async (question) => {
      asked.push(question);
      return false;
    };

    await expect(runInit({}, fixture.io)).resolves.toBe(EXIT_USAGE);

    expect(asked).toHaveLength(1);
    expect(existsSync(path.join(fixture.root, ".claude", "settings.json"))).toBe(false);
  });

  it("--repo enables a repo elsewhere and rejects one that does not exist", async () => {
    const fixture = setup();
    const other = path.join(fixture.dir, "other");
    mkdirSync(path.join(other, ".git"), { recursive: true });
    writeFileSync(path.join(other, ".git", "config"), gitConfig("Ada", "ada@example.com"), "utf8");

    await expect(runInit({ repo: other, yes: true }, fixture.io)).resolves.toBe(EXIT_OK);
    expect(existsSync(path.join(other, ".workledger", "config.yaml"))).toBe(true);

    await expect(runInit({ repo: path.join(fixture.dir, "nope"), yes: true }, fixture.io))
      .resolves.toBe(EXIT_USAGE);
  });

  it("accepts --no-backfill and ignores it", async () => {
    const fixture = setup();

    await expect(runInit({ yes: true, backfill: false }, fixture.io)).resolves.toBe(EXIT_OK);
    expect(existsSync(path.join(fixture.root, ".workledger", "config.yaml"))).toBe(true);
  });

  it("the written hook command exits 0 with empty stdout and stderr when the CLI is absent", async () => {
    const fixture = setup();
    await runInit({ yes: true }, fixture.io);

    // A PATH holding only the standard tools `command -v` needs — and certainly no `workledger`.
    const emptyBin = path.join(fixture.dir, "empty-bin");
    mkdirSync(emptyBin, { recursive: true });
    expect(existsSync(path.join(emptyBin, "workledger"))).toBe(false);

    const hooks = settings(fixture.root)["hooks"] as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    for (const event of HOOKED_EVENTS) {
      const command = hooks[event]![0]!.hooks[0]!.command;
      const result = spawnSync("/bin/sh", ["-c", command], {
        env: { PATH: emptyBin },
        encoding: "utf8",
        input: "{}",
      });

      expect(result.status, `${event}: ${command}`).toBe(0);
      expect(result.stdout, event).toBe("");
      expect(result.stderr, event).toBe("");
    }
  });

  it("refuses a settings.json it cannot merge without losing data", async () => {
    const fixture = setup();
    mkdirSync(path.join(fixture.root, ".claude"), { recursive: true });
    writeFileSync(path.join(fixture.root, ".claude", "settings.json"), "{ nope", "utf8");

    await expect(runInit({ yes: true }, fixture.io)).resolves.toBe(EXIT_USAGE);
    expect(fixture.io.err.join("\n")).toContain("not valid JSON");
  });
});

describe("the fake harness the fixtures install", () => {
  it("is a real executable, so the version probe is exercised for real", () => {
    const fixture = setup({ claudeVersion: "2.1.4" });

    expect(execFileSync(path.join(fixture.bin, "claude"), ["--version"], { encoding: "utf8" }))
      .toContain("2.1.4");
  });
});
