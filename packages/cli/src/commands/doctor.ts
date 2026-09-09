/**
 * `workledger doctor [--json]` — docs/contracts/p1/cli.md §`workledger doctor`.
 *
 * One report, three exit codes: `0` clean, `2` warnings, `1` broken. The split is the useful
 * part of this command, so it is stated once, here: a **warning** is something the operator can
 * still work without — Claude Code not installed, the hooks not merged yet, a version this
 * contract was not tested against. **Broken** is something that makes the ledger wrong or
 * unreachable — no repo, not enabled, a `config.yaml` that does not validate, an index that
 * will not open.
 *
 * The harness probe is exported because `workledger init` reports exactly the same facts in its
 * step 1 (cli.md §init) and there is no second definition of "is Claude Code installed".
 * Everything it reads about `~/.claude/projects/` is metadata — directory counts and mtimes.
 * Transcript content is never opened (CLAUDE.md, data-flow §1).
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { checkConfigFile } from "../config.js";
import { EXIT_OK, EXIT_USAGE, EXIT_WARNINGS } from "../exit-codes.js";
import { fileSize, findRepoRoot, isEnabled } from "../ledger-fs.js";
import { HOOKED_EVENTS, SETTINGS_PATH, hookCommandString } from "../settings-merge.js";
import { VERSION } from "../main.js";
import type { HookedEvent } from "../settings-merge.js";

/** Options commander parses for `doctor`. */
export interface DoctorOptions {
  /** Emit the report as JSON instead of the human-readable table. */
  json?: boolean;
}

/**
 * The Claude Code version `docs/contracts/p1/hooks-claude-code.md` was frozen against. `doctor`
 * prints it next to the installed one and warns on a mismatch (that contract §Version drift).
 */
export const CONTRACT_TESTED_CLAUDE_VERSION = "2.1.x";

/** The harness this P1 build knows. */
export const HARNESS = "claude-code";

/** Everything `doctor` and `init` read from outside their own process. */
export interface HealthIo {
  cwd: string;
  env: Record<string, string | undefined>;
  homeDir: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** The real environment. */
export function processHealthIo(): HealthIo {
  return {
    cwd: process.cwd(),
    env: process.env,
    homeDir: os.homedir(),
    stdout: (line) => void process.stdout.write(`${line}\n`),
    stderr: (line) => void process.stderr.write(`${line}\n`),
  };
}

/** What is known about the one harness P1 supports. */
export interface HarnessProbe {
  harness: string;
  /** Absolute path of the executable found on `PATH`, or `null`. */
  binary: string | null;
  /** Whatever `claude --version` reported, trimmed to its version token, or `null`. */
  version: string | null;
  /** The version this contract was tested against. */
  contract_tested_version: string;
  /** `~/.claude/projects`. */
  store: string;
  /** `true` when that directory exists and can be listed. */
  store_readable: boolean;
  /** Number of project directories in the store — metadata only, never their contents. */
  projects: number | null;
  /** Newest mtime under the store, ISO 8601, or `null`. Metadata only. */
  last_activity: string | null;
}

/** The first executable named `name` on `PATH`, or `undefined`. */
export function onPath(name: string, env: Record<string, string | undefined>): string | undefined {
  for (const dir of (env["PATH"] ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * `<binary> --version`, reduced to its version token.
 *
 * Two seconds and a discarded stderr: a harness binary that hangs or complains must degrade to
 * "version unknown", never to a `doctor` that never returns.
 */
function binaryVersion(binary: string): string | null {
  let out: string;
  try {
    out = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  const match = /\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?/.exec(out);
  return match ? match[0] : (out.trim() || null);
}

/** Detect Claude Code: the binary, its version, and the metadata of `~/.claude/projects/`. */
export function probeHarness(io: HealthIo): HarnessProbe {
  const binary = onPath("claude", io.env) ?? null;
  const store = path.join(io.homeDir, ".claude", "projects");
  let projects: number | null = null;
  let lastActivity: string | null = null;
  let readable: boolean;
  try {
    const entries = readdirSync(store, { withFileTypes: true });
    readable = true;
    const dirs = entries.filter((entry) => entry.isDirectory());
    projects = dirs.length;
    let newest = 0;
    for (const dir of dirs) {
      try {
        newest = Math.max(newest, statSync(path.join(store, dir.name)).mtimeMs);
      } catch {
        continue;
      }
    }
    if (newest > 0) lastActivity = new Date(newest).toISOString();
  } catch {
    readable = false;
  }
  return {
    harness: HARNESS,
    binary,
    version: binary === null ? null : binaryVersion(binary),
    contract_tested_version: CONTRACT_TESTED_CLAUDE_VERSION,
    store,
    store_readable: readable,
    projects,
    last_activity: lastActivity,
  };
}

/** `true` when `installed` is in the family `tested` names (`2.1.x` matches `2.1.4`). */
export function versionMatches(installed: string, tested: string): boolean {
  const wanted = tested.split(".");
  const found = installed.split(".");
  return wanted.every((part, i) => part === "x" || part === found[i]);
}

/** Per-event state of the project's `.claude/settings.json`. */
export interface HookFileCheck {
  file: string;
  present: boolean;
  /** Events whose command is exactly the contract's. */
  matching: HookedEvent[];
  /** Events with no workledger hook at all. */
  missing: HookedEvent[];
  /** Events whose workledger hook is registered but with a different command string. */
  mismatched: HookedEvent[];
}

/** Compare `<root>/.claude/settings.json` against the frozen block. Never throws. */
export function checkHookFile(root: string): HookFileCheck {
  const file = path.join(root, SETTINGS_PATH);
  const check: HookFileCheck = { file, present: false, matching: [], missing: [], mismatched: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    check.present = true;
  } catch {
    check.missing.push(...HOOKED_EVENTS);
    return check;
  }
  const hooks = (parsed as Record<string, unknown> | null)?.["hooks"];
  const byEvent = typeof hooks === "object" && hooks !== null ? (hooks as Record<string, unknown>) : {};
  for (const event of HOOKED_EVENTS) {
    const groups = Array.isArray(byEvent[event]) ? (byEvent[event] as unknown[]) : [];
    const commands: string[] = [];
    for (const group of groups) {
      const entries = (group as { hooks?: unknown })?.hooks;
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const command = (entry as { command?: unknown })?.command;
        if (typeof command === "string" && command.includes(`workledger hook ${event}`)) {
          commands.push(command);
        }
      }
    }
    if (commands.length === 0) check.missing.push(event);
    else if (commands.includes(hookCommandString(event))) check.matching.push(event);
    else check.mismatched.push(event);
  }
  return check;
}

/** One line of the report. */
export interface Check {
  name: string;
  status: "ok" | "warn" | "broken";
  detail: string;
}

/** The whole report, which is also the `--json` document. */
export interface DoctorReport {
  workledger_version: string;
  repo: string | null;
  enabled: boolean;
  harnesses: HarnessProbe[];
  hooks: HookFileCheck | null;
  config: { file: string | null; present: boolean; valid: boolean; errors: string[] };
  index: { path: string; exists: boolean; size_bytes: number | null; open_sessions: number | null };
  checks: Check[];
  status: "ok" | "warnings" | "broken";
}

/** The exit code a report's worst check earns (cli.md §Exit codes). */
export function reportExitCode(report: DoctorReport): number {
  if (report.status === "broken") return EXIT_USAGE;
  if (report.status === "warnings") return EXIT_WARNINGS;
  return EXIT_OK;
}

/** Build the report. Pure of output: `runDoctor` decides how to print it. */
export async function buildReport(io: HealthIo): Promise<DoctorReport> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string): void => {
    checks.push({ name, status, detail });
  };

  const root = findRepoRoot(io.env["CLAUDE_PROJECT_DIR"]?.trim() || io.cwd) ?? null;
  const enabled = root !== null && isEnabled(root);
  if (root === null) add("repo", "broken", "no .workledger/ or .git/ above the working directory");
  else if (!enabled) add("repo", "broken", `${root} is not an enabled repo; run \`workledger init\``);
  else add("repo", "ok", root);

  const probe = probeHarness(io);
  if (probe.binary === null) add("claude-code binary", "warn", "`claude` is not on PATH");
  else add("claude-code binary", "ok", `${probe.binary}${probe.version === null ? "" : ` (${probe.version})`}`);

  if (!probe.store_readable) add("claude-code store", "warn", `${probe.store} is not readable`);
  else add("claude-code store", "ok", `${probe.store} (${probe.projects ?? 0} project(s))`);

  if (probe.version === null) {
    add("claude-code version", "warn", `installed version unknown; contract tested against ${CONTRACT_TESTED_CLAUDE_VERSION}`);
  } else if (versionMatches(probe.version, CONTRACT_TESTED_CLAUDE_VERSION)) {
    add("claude-code version", "ok", `${probe.version} matches the contract-tested ${CONTRACT_TESTED_CLAUDE_VERSION}`);
  } else {
    add("claude-code version", "warn", `installed ${probe.version}, contract tested against ${CONTRACT_TESTED_CLAUDE_VERSION}`);
  }

  const hooks = root === null ? null : checkHookFile(root);
  if (hooks === null) add("hooks", "warn", "no repo to check");
  else if (hooks.mismatched.length > 0) {
    add("hooks", "warn", `${hooks.mismatched.join(", ")} do not match the contract in ${SETTINGS_PATH}`);
  } else if (hooks.missing.length > 0) {
    add("hooks", "warn", `${hooks.missing.join(", ")} missing from ${SETTINGS_PATH}; run \`workledger init\``);
  } else add("hooks", "ok", `${HOOKED_EVENTS.join(", ")} match the contract`);

  const config = root === null
    ? { file: null, present: false, valid: false, errors: [] as string[] }
    : await (async () => {
        const result = await checkConfigFile(root);
        return { file: result.file, present: result.present, valid: result.present && result.errors.length === 0, errors: result.errors };
      })();
  if (root === null) add("config", "warn", "no repo to check");
  else if (!config.present) add("config", "warn", "no .workledger/config.yaml; defaults are in force");
  else if (!config.valid) add("config", "broken", `.workledger/config.yaml is invalid: ${config.errors.join("; ")}`);
  else add("config", "ok", ".workledger/config.yaml validates");

  const index = await readIndex(io, root);
  if (index.open_sessions === null) add("index", "broken", `${index.path} could not be opened`);
  else {
    add("index", "ok", `${index.path} (${index.size_bytes ?? 0} bytes, ${index.open_sessions} open session(s))`);
  }

  const status = checks.some((check) => check.status === "broken")
    ? "broken"
    : checks.some((check) => check.status === "warn")
      ? "warnings"
      : "ok";

  return {
    workledger_version: VERSION,
    repo: root,
    enabled,
    harnesses: [probe],
    hooks,
    config,
    index,
    checks,
    status,
  };
}

/** Index path, size and open-session count. A failure to open leaves `open_sessions` null. */
async function readIndex(io: HealthIo, root: string | null): Promise<DoctorReport["index"]> {
  const { openIndex, resolveHome, INDEX_FILENAME } = await import("../index/db.js");
  const home = io.env["WORKLEDGER_HOME"]?.trim();
  const file = path.join(resolveHome(home === "" ? undefined : home), INDEX_FILENAME);
  try {
    const db = openIndex(home ? { home } : {});
    try {
      const open = root === null ? 0 : db.listOpenSessions(root).length;
      return { path: db.path, exists: true, size_bytes: fileSize(db.path) ?? 0, open_sessions: open };
    } finally {
      db.close();
    }
  } catch {
    return { path: file, exists: fileSize(file) !== undefined, size_bytes: fileSize(file) ?? null, open_sessions: null };
  }
}

/** `[ok]` / `[warn]` / `[BROKEN]`, padded so the details line up. */
function label(status: Check["status"]): string {
  return status === "ok" ? "ok    " : status === "warn" ? "warn  " : "BROKEN";
}

/** The command, with its environment injected. @returns the process exit code. */
export async function runDoctor(options: DoctorOptions, io: HealthIo): Promise<number> {
  const report = await buildReport(io);
  if (options.json === true) {
    io.stdout(JSON.stringify(report, null, 2));
    return reportExitCode(report);
  }
  io.stdout(`workledger ${report.workledger_version}`);
  for (const check of report.checks) io.stdout(`  ${label(check.status)}  ${check.name}: ${check.detail}`);
  return reportExitCode(report);
}

/** @returns the process exit code. */
export async function doctorCommand(options: DoctorOptions): Promise<number> {
  return runDoctor(options, processHealthIo());
}
