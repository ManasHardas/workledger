/**
 * `workledger doctor` — docs/contracts/p1/cli.md §`doctor` and §Exit codes (#13).
 *
 * Three fixture states, three exit codes. What each one means is the contract's split, not this
 * file's: a warning is something the operator can work without, broken is something that makes
 * the ledger wrong or unreachable.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG_YAML } from "../src/config.js";
import { EXIT_OK, EXIT_USAGE, EXIT_WARNINGS } from "../src/exit-codes.js";
import {
  CONTRACT_TESTED_CLAUDE_VERSION,
  checkHookFile,
  runDoctor,
  versionMatches,
} from "../src/commands/doctor.js";
import { hooksBlock } from "../src/settings-merge.js";
import type { DoctorReport, HealthIo } from "../src/commands/doctor.js";

interface Fixture {
  root: string;
  io: HealthIo & { out: string[]; err: string[] };
}

interface SetupOptions {
  /** Write `.workledger/config.yaml` with this text; omit for the frozen defaults. */
  config?: string;
  /** Leave `.workledger/` out entirely. */
  enabled?: boolean;
  /** Write the contract's hooks block into `.claude/settings.json`. */
  hooks?: boolean;
  /** Install a fake `claude` on `PATH` reporting this version. */
  claudeVersion?: string;
  /** Create `~/.claude/projects/`. */
  store?: boolean;
}

function setup(options: SetupOptions = {}): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-doctor-"));
  const root = path.join(dir, "repo");
  const home = path.join(dir, "home");
  const bin = path.join(dir, "bin");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });

  if (options.enabled !== false) {
    mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
    mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
    writeFileSync(
      path.join(root, ".workledger", "config.yaml"),
      options.config ?? DEFAULT_CONFIG_YAML,
      "utf8",
    );
  }
  if (options.hooks === true) {
    mkdirSync(path.join(root, ".claude"), { recursive: true });
    writeFileSync(
      path.join(root, ".claude", "settings.json"),
      `${JSON.stringify({ hooks: hooksBlock() }, null, 2)}\n`,
      "utf8",
    );
  }
  if (options.claudeVersion !== undefined) {
    const fake = path.join(bin, "claude");
    writeFileSync(fake, `#!/bin/sh\necho "${options.claudeVersion} (Claude Code)"\n`, "utf8");
    chmodSync(fake, 0o755);
  }
  if (options.store !== false) mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });

  const out: string[] = [];
  const err: string[] = [];
  return {
    root,
    io: {
      out,
      err,
      cwd: root,
      homeDir: home,
      env: { PATH: bin, HOME: home, WORKLEDGER_HOME: path.join(dir, "wlhome") },
      stdout: (line) => void out.push(line),
      stderr: (line) => void err.push(line),
    },
  };
}

/** A clean fixture: enabled, valid config, contract hooks, a `claude` of the tested version. */
function clean(): Fixture {
  return setup({ hooks: true, claudeVersion: "2.1.4", store: true });
}

describe("workledger doctor", () => {
  it("exits 0 on a clean repo", async () => {
    const fixture = clean();

    await expect(runDoctor({}, fixture.io)).resolves.toBe(EXIT_OK);
    expect(fixture.io.out.join("\n")).not.toContain("warn");
    expect(fixture.io.out.join("\n")).not.toContain("BROKEN");
  });

  it("exits 2 on warnings", async () => {
    // No `claude` on PATH, no store, no hooks merged: all three are things you can work without.
    const fixture = setup({ store: false });

    await expect(runDoctor({}, fixture.io)).resolves.toBe(EXIT_WARNINGS);

    const text = fixture.io.out.join("\n");
    expect(text).toContain("not on PATH");
    expect(text).toContain("run `workledger init`");
    expect(text).not.toContain("BROKEN");
  });

  it("exits 1 when the repo is broken", async () => {
    const fixture = setup({ config: "schema_version: 9\nthresholds: { bytes: 0 }\n", hooks: true });

    await expect(runDoctor({}, fixture.io)).resolves.toBe(EXIT_USAGE);
    expect(fixture.io.out.join("\n")).toContain("config.yaml is invalid");
  });

  it("exits 1 when the repo is not enabled", async () => {
    const fixture = setup({ enabled: false, hooks: true, claudeVersion: "2.1.4" });

    await expect(runDoctor({}, fixture.io)).resolves.toBe(EXIT_USAGE);
    expect(fixture.io.out.join("\n")).toContain("not an enabled repo");
  });

  it("--json parses and names the contract-tested Claude Code version", async () => {
    const fixture = clean();

    await expect(runDoctor({ json: true }, fixture.io)).resolves.toBe(EXIT_OK);

    expect(fixture.io.out).toHaveLength(1);
    const report = JSON.parse(fixture.io.out[0]!) as DoctorReport;
    expect(report.status).toBe("ok");
    expect(report.workledger_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.repo).toBe(fixture.root);
    expect(report.enabled).toBe(true);
    expect(report.harnesses[0]!.harness).toBe("claude-code");
    expect(report.harnesses[0]!.version).toBe("2.1.4");
    expect(report.harnesses[0]!.contract_tested_version).toBe(CONTRACT_TESTED_CLAUDE_VERSION);
    expect(report.harnesses[0]!.store_readable).toBe(true);
    expect(report.hooks?.matching).toEqual(["SessionStart", "Stop", "SessionEnd"]);
    expect(report.config.valid).toBe(true);
    expect(report.index.open_sessions).toBe(0);
    expect(report.index.path).toContain("index.sqlite");
  });

  it("warns on a version this contract was not tested against", async () => {
    const fixture = setup({ hooks: true, claudeVersion: "3.0.0" });

    await expect(runDoctor({ json: true }, fixture.io)).resolves.toBe(EXIT_WARNINGS);
    const report = JSON.parse(fixture.io.out[0]!) as DoctorReport;
    const drift = report.checks.find((check) => check.name === "claude-code version");
    expect(drift?.status).toBe("warn");
    expect(drift?.detail).toContain(CONTRACT_TESTED_CLAUDE_VERSION);
  });

  it("warns when a hook command no longer matches the contract", async () => {
    const fixture = setup({ hooks: true, claudeVersion: "2.1.4" });
    writeFileSync(
      path.join(fixture.root, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "workledger hook SessionStart" }] }],
        },
      }),
      "utf8",
    );

    await expect(runDoctor({}, fixture.io)).resolves.toBe(EXIT_WARNINGS);
    expect(fixture.io.out.join("\n")).toContain("do not match the contract");
  });
});

describe("checkHookFile", () => {
  it("reports every event missing when there is no settings.json", () => {
    const fixture = setup();
    const check = checkHookFile(fixture.root);

    expect(check.present).toBe(false);
    expect(check.missing).toEqual(["SessionStart", "Stop", "SessionEnd"]);
  });
});

describe("versionMatches", () => {
  it("treats `x` as a wildcard component and nothing else", () => {
    expect(versionMatches("2.1.4", "2.1.x")).toBe(true);
    expect(versionMatches("2.1", "2.1.x")).toBe(true);
    expect(versionMatches("2.2.0", "2.1.x")).toBe(false);
    expect(versionMatches("3.0.0", "2.1.x")).toBe(false);
  });
});
