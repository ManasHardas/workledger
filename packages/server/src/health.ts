/**
 * `GET /api/health` — the `Health` read model of api.md §Read models.
 *
 * The shape is `workledger doctor --json` narrowed to what a local UI can act on: the harness
 * probe verbatim (`DoctorEntry` *is* doctor's `HarnessProbe`), the index file's path and size,
 * config validity, and the last time a hook touched the ledger.
 *
 * Two deliberate differences from `doctor`. First, `openSessions` is counted from the ledger's
 * own session frontmatter rather than by opening `index.sqlite`: CLAUDE.md makes the ledger the
 * source of truth and the index a cache, and reading it here would put `better-sqlite3` — a
 * native binding — into a package that otherwise has none. The index file is still reported, by
 * path and size, because that is what the operator needs to find it. Second, `lastHookAt` is the
 * newest session-file mtime: every hook that records anything writes a session file, so the
 * ledger already answers "when did a hook last run" without a second store.
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Config } from "@workledger/core/schema";
import { parse } from "yaml";

import { fileMtimeMs, fileSize, listMarkdown, readTextFile } from "./paths.js";
import type { LedgerPaths } from "./paths.js";
import type { ReadModel } from "./read-model.js";

/** The Claude Code version `docs/contracts/p1/hooks-claude-code.md` was frozen against. */
export const CONTRACT_TESTED_CLAUDE_VERSION = "2.1.x";

/** The index database file inside `~/.workledger/`. */
export const INDEX_FILENAME = "index.sqlite";

/** What is known about one harness — `workledger doctor`'s `HarnessProbe`, unchanged. */
export interface DoctorEntry {
  harness: string;
  binary: string | null;
  version: string | null;
  contract_tested_version: string;
  store: string;
  store_readable: boolean;
  projects: number | null;
  last_activity: string | null;
}

/** api.md §Read models. */
export interface Health {
  cli: string;
  repo: string;
  harnesses: DoctorEntry[];
  index: { path: string; bytes: number; openSessions: number };
  config: { valid: boolean; problems: string[] };
  lastHookAt: string | null;
}

/** Everything the health probe reads from outside this process. */
export interface HealthEnv {
  env: Record<string, string | undefined>;
  homeDir: string;
  /** `~/.workledger`, or wherever `--home` / `WORKLEDGER_HOME` points. */
  home: string;
  /** The `workledger` version string this server was built alongside. */
  cli: string;
}

/** The first executable named `name` on `PATH`, or `undefined`. */
function onPath(name: string, env: Record<string, string | undefined>): string | undefined {
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
 * "version unknown", never to a `/api/health` that never responds.
 */
function binaryVersion(binary: string): string | null {
  let out: string;
  try {
    out = execFileSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const match = /\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?/.exec(out);
  return match ? match[0] : (out.trim() || null);
}

/**
 * Detect Claude Code: the binary, its version, and the *metadata* of `~/.claude/projects/`.
 * Directory counts and mtimes only — transcript content is never opened (CLAUDE.md).
 */
export function probeHarness(env: HealthEnv): DoctorEntry {
  const binary = onPath("claude", env.env) ?? null;
  const store = path.join(env.homeDir, ".claude", "projects");
  let projects: number | null = null;
  let storeReadable = false;
  let lastActivity: number | null = null;
  try {
    const entries = readdirSync(store, { withFileTypes: true });
    storeReadable = true;
    projects = entries.filter((entry) => entry.isDirectory()).length;
    for (const entry of entries) {
      const mtime = fileMtimeMs(path.join(store, entry.name));
      if (mtime !== undefined && (lastActivity === null || mtime > lastActivity)) lastActivity = mtime;
    }
  } catch {
    // Not readable is a fact about the store, not a failure of the probe.
  }
  return {
    harness: "claude-code",
    binary,
    version: binary === null ? null : binaryVersion(binary),
    contract_tested_version: CONTRACT_TESTED_CLAUDE_VERSION,
    store,
    store_readable: storeReadable,
    projects,
    last_activity: lastActivity === null ? null : new Date(lastActivity).toISOString(),
  };
}

/** `.workledger/config.yaml` validated against the frozen P1 `Config` schema. */
export function checkConfig(paths: LedgerPaths): { valid: boolean; problems: string[] } {
  const text = readTextFile(paths.config);
  // No config file is not an error: cli.md says the defaults are in force.
  if (text === undefined) return { valid: true, problems: [] };
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (error) {
    return { valid: false, problems: [error instanceof Error ? error.message : String(error)] };
  }
  const result = Config.safeParse(doc ?? {});
  if (result.success) return { valid: true, problems: [] };
  return {
    valid: false,
    problems: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}

/** Newest mtime among the session files, ISO 8601, or `null` when there are none. */
export function lastHookAt(paths: LedgerPaths): string | null {
  let newest: number | null = null;
  for (const name of listMarkdown(paths.sessions)) {
    const mtime = fileMtimeMs(path.join(paths.sessions, name));
    if (mtime !== undefined && (newest === null || mtime > newest)) newest = mtime;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/** The whole report. Files that would not parse land in `config.problems` alongside the config. */
export function buildHealth(model: ReadModel, env: HealthEnv): Health {
  const indexPath = path.join(env.home, INDEX_FILENAME);
  const config = checkConfig(model.paths);
  const problems = [...config.problems];
  for (const [file, reason] of model.problems) problems.push(`${file}: ${reason}`);
  return {
    cli: env.cli,
    repo: model.paths.root,
    harnesses: [probeHarness(env)],
    index: {
      path: indexPath,
      bytes: fileSize(indexPath) ?? 0,
      openSessions: model.openSessionCount(),
    },
    config: { valid: config.valid && model.problems.size === 0, problems },
    lastHookAt: lastHookAt(model.paths),
  };
}

/** `~/.workledger`, the default index home (`packages/cli/src/index/db.ts` §`resolveHome`). */
export function defaultHome(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".workledger");
}
