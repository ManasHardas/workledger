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

import { checkConfigFile, loadConfig } from "../config.js";
import { CODEX_HOOKS_PATH, codexHookCommand } from "../codex-hooks.js";
import { CURSOR_EVENTS, CURSOR_EVENT_KEYS, CURSOR_HOOKS_PATH, cursorHookCommand } from "../cursor-hooks.js";
import { EXIT_OK, EXIT_USAGE, EXIT_WARNINGS } from "../exit-codes.js";
import { fileSize, findRepoRoot, isEnabled } from "../ledger-fs.js";
import { HOOKED_EVENTS, SETTINGS_PATH, hookCommandString } from "../settings-merge.js";
import { VERSION } from "../main.js";
import type { CursorEventKey } from "../cursor-hooks.js";
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

/** The harness this P1 build knows. `doctor` reports all three from P4 on. */
export const HARNESS = "claude-code";

/**
 * The Codex version `docs/contracts/p4/hooks-codex.md` was frozen against. That contract's
 * §Version drift asks `doctor` to record it and warn on a newer major.
 */
export const CONTRACT_TESTED_CODEX_VERSION = "0.150.x";

/**
 * Cursor is not installed on the reference machine, so no version was ever tested against the
 * contract. `doctor` says so rather than implying a version it never saw.
 */
export const CONTRACT_TESTED_CURSOR_VERSION = "untested (not installed on the reference machine)";

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

/**
 * Directory count and newest mtime under `store`. Metadata only — nothing under it is opened.
 *
 * The count is of *directories* for Claude Code (`~/.claude/projects/<slug>/`) and of everything
 * below for a store that nests by date, so `deep` walks instead of listing one level.
 */
function storeMetadata(store: string, deep: boolean): {
  readable: boolean;
  projects: number | null;
  last_activity: string | null;
} {
  let newest = 0;
  let count = 0;

  const walk = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      try {
        newest = Math.max(newest, statSync(child).mtimeMs);
      } catch {
        continue;
      }
      if (entry.isDirectory()) {
        if (depth === 0) count += 1;
        // Three levels is `YYYY/MM/DD` — Codex's rollout layout. Bounded so a store someone
        // symlinked at their home directory cannot turn `doctor` into a filesystem crawl.
        if (deep && depth < 3) walk(child, depth + 1);
      } else if (deep && depth > 0) {
        count += 1;
      }
    }
  };

  try {
    readdirSync(store);
  } catch {
    return { readable: false, projects: null, last_activity: null };
  }
  walk(store, 0);
  return {
    readable: true,
    projects: count,
    last_activity: newest > 0 ? new Date(newest).toISOString() : null,
  };
}

/** Detect Claude Code: the binary, its version, and the metadata of `~/.claude/projects/`. */
export function probeHarness(io: HealthIo): HarnessProbe {
  const binary = onPath("claude", io.env) ?? null;
  const store = path.join(io.homeDir, ".claude", "projects");
  const metadata = storeMetadata(store, false);
  return {
    harness: HARNESS,
    binary,
    version: binary === null ? null : binaryVersion(binary),
    contract_tested_version: CONTRACT_TESTED_CLAUDE_VERSION,
    store,
    store_readable: metadata.readable,
    projects: metadata.projects,
    last_activity: metadata.last_activity,
  };
}

/**
 * Detect Codex: `codex` on `PATH` and the rollout store at `~/.codex/sessions/`
 * (hooks-codex.md §Headless resume). Metadata only; no rollout file is ever opened.
 */
export function probeCodex(io: HealthIo): HarnessProbe {
  const binary = onPath("codex", io.env) ?? null;
  const store = path.join(io.homeDir, ".codex", "sessions");
  const metadata = storeMetadata(store, true);
  return {
    harness: "codex",
    binary,
    version: binary === null ? null : binaryVersion(binary),
    contract_tested_version: CONTRACT_TESTED_CODEX_VERSION,
    store,
    store_readable: metadata.readable,
    projects: metadata.projects,
    last_activity: metadata.last_activity,
  };
}

/**
 * Detect Cursor: a `cursor` CLI shim on `PATH`, `~/.cursor/`, or the installed app.
 *
 * There is no version probe. Cursor's CLI shim reports the app's version, the app is not on the
 * reference machine, and the contract was never tested against a version — so
 * {@link CONTRACT_TESTED_CURSOR_VERSION} says exactly that instead of naming one.
 */
export function probeCursor(io: HealthIo): HarnessProbe {
  const binary = onPath("cursor", io.env) ?? (cursorAppPath(io) ?? null);
  const store = path.join(io.homeDir, ".cursor");
  const metadata = storeMetadata(store, false);
  return {
    harness: "cursor",
    binary,
    version: null,
    contract_tested_version: CONTRACT_TESTED_CURSOR_VERSION,
    store,
    store_readable: metadata.readable,
    projects: metadata.projects,
    last_activity: metadata.last_activity,
  };
}

/** The installed Cursor application bundle, when there is one. macOS and Linux only. */
export function cursorAppPath(io: HealthIo): string | undefined {
  const candidates = [
    "/Applications/Cursor.app",
    path.join(io.homeDir, "Applications", "Cursor.app"),
    "/usr/share/cursor",
    "/opt/Cursor",
  ];
  for (const candidate of candidates) {
    try {
      statSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** `true` when anything on this machine says the harness is installed. */
export function isInstalled(probe: HarnessProbe): boolean {
  return probe.binary !== null || probe.store_readable;
}

/** Every harness this build speaks, in the order `doctor` reports them. */
export function probeHarnesses(io: HealthIo): HarnessProbe[] {
  return [probeHarness(io), probeCodex(io), probeCursor(io)];
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

/** {@link HookFileCheck} keyed by Cursor's own lower-camel event names. */
export interface CursorHookFileCheck {
  file: string;
  present: boolean;
  matching: CursorEventKey[];
  missing: CursorEventKey[];
  mismatched: CursorEventKey[];
}

/** The `hooks` mapping of a JSON hook file, or `undefined` when the file cannot be read. */
function hooksMapping(file: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  const hooks = (parsed as Record<string, unknown> | null)?.["hooks"];
  return typeof hooks === "object" && hooks !== null && !Array.isArray(hooks)
    ? (hooks as Record<string, unknown>)
    : {};
}

/**
 * Sort each event of a `hooks` mapping into matching / missing / mismatched.
 *
 * `commandsOf` is the one thing that differs between the harnesses' schemas: Claude Code and
 * Codex nest `{ hooks: [{ command }] }` under each event, Cursor puts `{ command }` entries
 * directly in the array.
 */
function classifyHooks<K extends string>(
  file: string,
  keys: readonly K[],
  wanted: (key: K) => string,
  event: (key: K) => string,
  commandsOf: (entry: unknown) => string[],
): { file: string; present: boolean; matching: K[]; missing: K[]; mismatched: K[] } {
  const check = { file, present: false, matching: [] as K[], missing: [] as K[], mismatched: [] as K[] };
  const byEvent = hooksMapping(file);
  if (byEvent === undefined) {
    check.missing.push(...keys);
    return check;
  }
  check.present = true;
  for (const key of keys) {
    const entries = Array.isArray(byEvent[key]) ? (byEvent[key] as unknown[]) : [];
    const commands = entries
      .flatMap(commandsOf)
      .filter((command) => command.includes(`workledger hook ${event(key)}`));
    if (commands.length === 0) check.missing.push(key);
    else if (commands.includes(wanted(key))) check.matching.push(key);
    else check.mismatched.push(key);
  }
  return check;
}

/** Every `command` string in one `{ hooks: [{ command }] }` group. */
function nestedCommands(group: unknown): string[] {
  const entries = (group as { hooks?: unknown })?.hooks;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => (entry as { command?: unknown })?.command)
    .filter((command): command is string => typeof command === "string");
}

/** The `command` of one flat `{ command }` entry. */
function flatCommand(entry: unknown): string[] {
  const command = (entry as { command?: unknown })?.command;
  return typeof command === "string" ? [command] : [];
}

/** Compare `<root>/.claude/settings.json` against the frozen block. Never throws. */
export function checkHookFile(root: string): HookFileCheck {
  return classifyHooks(
    path.join(root, SETTINGS_PATH),
    HOOKED_EVENTS,
    hookCommandString,
    (event) => event,
    nestedCommands,
  );
}

/** Compare `<root>/.codex/hooks.json` against docs/contracts/p4/hooks-codex.md. Never throws. */
export function checkCodexHookFile(root: string): HookFileCheck {
  return classifyHooks(
    path.join(root, CODEX_HOOKS_PATH),
    HOOKED_EVENTS,
    codexHookCommand,
    (event) => event,
    nestedCommands,
  );
}

/**
 * Compare `<root>/.cursor/hooks.json` against docs/contracts/p4/hooks-cursor.md. Never throws.
 *
 * The contract asks for the *key names* to be checked, not just the commands: `sessionStart`,
 * `stop`, `sessionEnd` and `loop_limit` are Cursor's own spelling, and a file that used
 * Claude Code's `SessionStart` would register no hook at all while looking plausible. A key that
 * is absent lands in `missing`, which is exactly the mismatch report the contract asks for.
 */
export function checkCursorHookFile(root: string): CursorHookFileCheck {
  return classifyHooks(
    path.join(root, CURSOR_HOOKS_PATH),
    CURSOR_EVENT_KEYS,
    cursorHookCommand,
    (key) => CURSOR_EVENTS[key],
    flatCommand,
  );
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
  /** `<repo>/.codex/hooks.json`, present only when Codex is installed or enabled. */
  codex_hooks: HookFileCheck | null;
  /** `<repo>/.cursor/hooks.json`, present only when Cursor is installed or enabled. */
  cursor_hooks: CursorHookFileCheck | null;
  config: { file: string | null; present: boolean; valid: boolean; errors: string[] };
  index: { path: string; exists: boolean; size_bytes: number | null; open_sessions: number | null };
  /**
   * One entry per enabled repo the index knows — docs/contracts/p5/config-and-identities.md:
   * "`workledger doctor` gains one row per enabled repo: path, open sessions, last hook".
   *
   * This is the multi-repo case the phase is named for: several enabled repos on one machine
   * share one index, and before P5 `doctor` could only see the one it was run in.
   */
  repos: RepoRow[];
  checks: Check[];
  status: "ok" | "warnings" | "broken";
}

/** One `repos` row. */
export interface RepoRow {
  path: string;
  open_sessions: number;
  /** ISO 8601 of the last hook that touched this repo, or `null` when none ever has. */
  last_hook: string | null;
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

  const harnesses = probeHarnesses(io);
  const probe = harnesses[0] as HarnessProbe;
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

  // Codex and Cursor get rows only once they are installed here or listed in this repo's
  // `harnesses`. A machine with neither is not in a degraded state, and a `doctor` that warned
  // about every harness the operator has chosen not to use would train them to ignore warnings.
  const enabledHarnesses = root === null || !enabled ? [] : loadConfig(root).harnesses;
  const codexProbe = harnesses[1] as HarnessProbe;
  const cursorProbe = harnesses[2] as HarnessProbe;
  const codexOn = isInstalled(codexProbe) || enabledHarnesses.includes("codex");
  const cursorOn = isInstalled(cursorProbe) || enabledHarnesses.includes("cursor");

  const codexHooks = codexOn && root !== null ? checkCodexHookFile(root) : null;
  if (codexOn) {
    add(
      "codex binary",
      codexProbe.binary === null ? "warn" : "ok",
      codexProbe.binary === null
        ? "`codex` is not on PATH; the hook file is still written and activates once it is"
        : `${codexProbe.binary}${codexProbe.version === null ? "" : ` (${codexProbe.version})`}`,
    );
    add(
      "codex store",
      codexProbe.store_readable ? "ok" : "warn",
      codexProbe.store_readable
        ? `${codexProbe.store} (${codexProbe.projects ?? 0} rollout(s))`
        : `${codexProbe.store} is not readable`,
    );
    if (codexProbe.version === null) {
      add("codex version", "warn", `installed version unknown; contract tested against ${CONTRACT_TESTED_CODEX_VERSION}`);
    } else if (versionMatches(codexProbe.version, CONTRACT_TESTED_CODEX_VERSION)) {
      add("codex version", "ok", `${codexProbe.version} matches the contract-tested ${CONTRACT_TESTED_CODEX_VERSION}`);
    } else {
      add("codex version", "warn", `installed ${codexProbe.version}, contract tested against ${CONTRACT_TESTED_CODEX_VERSION}`);
    }
    if (codexHooks === null) add("codex hooks", "warn", "no repo to check");
    else if (codexHooks.mismatched.length > 0) {
      add("codex hooks", "warn", `${codexHooks.mismatched.join(", ")} do not match the contract in ${CODEX_HOOKS_PATH}`);
    } else if (codexHooks.missing.length > 0) {
      add("codex hooks", "warn", `${codexHooks.missing.join(", ")} missing from ${CODEX_HOOKS_PATH}; run \`workledger init\``);
    } else {
      add("codex hooks", "ok", `${HOOKED_EVENTS.join(", ")} match the contract (trust them once in Codex)`);
    }
  }

  const cursorHooks = cursorOn && root !== null ? checkCursorHookFile(root) : null;
  if (cursorOn) {
    add(
      "cursor install",
      cursorProbe.binary === null && !cursorProbe.store_readable ? "warn" : "ok",
      cursorProbe.binary ?? (cursorProbe.store_readable ? cursorProbe.store : "not found"),
    );
    if (cursorHooks === null) add("cursor hooks", "warn", "no repo to check");
    else if (cursorHooks.mismatched.length > 0) {
      add("cursor hooks", "warn", `${cursorHooks.mismatched.join(", ")} do not match the contract in ${CURSOR_HOOKS_PATH}`);
    } else if (cursorHooks.missing.length > 0) {
      add("cursor hooks", "warn", `${cursorHooks.missing.join(", ")} missing from ${CURSOR_HOOKS_PATH}; run \`workledger init\``);
    } else {
      add("cursor hooks", "ok", `${CURSOR_EVENT_KEYS.join(", ")} match the contract`);
    }
  }

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

  // The multi-repo rows. Informational by design: another repo's state is not this invocation's
  // health, so a row never moves the exit code — it is there so an operator with `dashero`,
  // `kubera` and this repo enabled can see all three from wherever they happen to be.
  const repos = await readRepos(io);
  for (const repo of repos) {
    add(
      `repo ${repo.path}`,
      "ok",
      `${repo.open_sessions} open session(s), last hook ${repo.last_hook ?? "never"}`,
    );
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
    harnesses,
    hooks,
    codex_hooks: codexHooks,
    cursor_hooks: cursorHooks,
    config,
    index,
    repos,
    checks,
    status,
  };
}

/**
 * Every enabled repo the index knows, newest activity first.
 *
 * `isEnabled` is the filter the contract asks for: a repo whose `.workledger/` was deleted or
 * whose checkout has moved is still in the index — it is a cache — and reporting it as a health
 * row would be reporting on something that no longer exists. An index that will not open is
 * already a `broken` check above, so it is simply no rows here.
 */
async function readRepos(io: HealthIo): Promise<RepoRow[]> {
  const { openIndex } = await import("../index/db.js");
  const home = io.env["WORKLEDGER_HOME"]?.trim();
  try {
    const db = openIndex(home ? { home } : {});
    try {
      return db
        .listRepos()
        .filter((repo) => isEnabled(repo.repo_path))
        .map((repo) => ({
          path: repo.repo_path,
          open_sessions: repo.open_sessions,
          last_hook: repo.last_hook,
        }))
        .sort((a, b) => (b.last_hook ?? "").localeCompare(a.last_hook ?? "") || a.path.localeCompare(b.path));
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
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
