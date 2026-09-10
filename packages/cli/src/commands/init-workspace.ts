/**
 * `workledger init --workspace <dir>` — docs/contracts/p8/daemon-and-api.md amendment 8 (#105).
 *
 * A workspace is a folder that is not a git repo but holds tracked repos — `~/Projects/
 * dome_workspace` with the card repos under it. A Claude Code session started there loads the
 * folder's `.claude/settings.json`, not any repo's, so without hooks of its own it is invisible
 * live. This writes the same three hook files a repo `init` writes (`../settings-merge.ts`,
 * `../codex-hooks.ts`, `../cursor-hooks.ts` — the same commands, the same additive merge) and
 * records the folder in the index's `workspaces` table. No `.workledger/` is created here: the
 * ledger stays in each repo, and the hook resolves the repo(s) from the transcript at `Stop`.
 *
 * Two refusals. A folder with a `.git` is a repo and gets plain `init`; a folder with no tracked
 * repo under it (three levels, the discovery walk's depth) would only ever fire hooks that find
 * nothing to record into.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { CODEX_HOOKS_PATH, mergeCodexHooksFile } from "../codex-hooks.js";
import { CURSOR_HOOKS_PATH, mergeCursorHooksFile } from "../cursor-hooks.js";
import { EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { isEnabled } from "../ledger-fs.js";
import { SETTINGS_PATH, SettingsError, mergeSettingsFile } from "../settings-merge.js";
import { isInstalled, probeCodex, probeCursor } from "./doctor.js";
import { PRIVACY_SUMMARY, codexTrustStep } from "./init.js";
import type { SettingsOutcome } from "../settings-merge.js";
import type { InitIo, InitOptions, InitReport } from "./init.js";

/** How far below a workspace a tracked repo is looked for. Matches the discovery walk. */
export const WORKSPACE_DEPTH = 3;

/** `true` for a directory. */
function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** Enabled repos under `dir`, at most {@link WORKSPACE_DEPTH} levels down; a repo is not entered. */
export function trackedReposUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (depth > 0 && isEnabled(current)) {
      found.push(current);
      return;
    }
    if (depth > 0 && existsSync(path.join(current, ".git"))) return;
    if (depth >= WORKSPACE_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(path.join(current, entry.name), depth + 1);
    }
  };
  walk(dir, 0);
  return found.sort();
}

/** Why `dir` cannot be a workspace, or `undefined` when it can. `selected` are repos about to be enabled. */
export function workspaceProblem(dir: string, selected: readonly string[] = []): string | undefined {
  if (!isDirectory(dir)) return `${dir} is not a directory`;
  if (existsSync(path.join(dir, ".git"))) return `${dir} is a git repository; run \`workledger init\` in it instead`;
  const holds = selected.some((repo) => repo.startsWith(`${dir}${path.sep}`)) || trackedReposUnder(dir).length > 0;
  if (!holds) return `${dir} holds no tracked repo; run \`workledger init\` in the repos under it first`;
  return undefined;
}

/** The hook files in `dir` that carry the workledger hook command, by path. */
export function workspaceHookStatus(dir: string): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const file of [SETTINGS_PATH, CODEX_HOOKS_PATH, CURSOR_HOOKS_PATH]) {
    let text: string | undefined;
    try {
      text = readFileSync(path.join(dir, file), "utf8");
    } catch {
      text = undefined;
    }
    status[file] = text !== undefined && text.includes("workledger hook Stop");
  }
  return status;
}

/** `true` when the Claude Code hook file in `dir` carries the hook — what `discover` reports. */
export function workspaceHooksInstalled(dir: string): boolean {
  return workspaceHookStatus(dir)[SETTINGS_PATH] === true;
}

/**
 * The command. Writes the hook files, records the workspace, prints the summary. The report's
 * `created` is always empty: nothing is scaffolded in a workspace.
 */
export async function runWorkspaceInit(
  workspace: string,
  options: InitOptions & { selected?: readonly string[] | undefined },
  io: InitIo,
): Promise<InitReport> {
  const report: InitReport = { code: EXIT_OK, created: [], hooksWritten: [], trustSteps: [] };
  const withCode = (code: number): InitReport => ({ ...report, code });

  const problem = workspaceProblem(workspace, options.selected ?? []);
  if (problem !== undefined) {
    io.stderr(`workledger init --workspace: ${problem}`);
    return withCode(EXIT_USAGE);
  }

  const forced = new Set((options.harness ?? []).map((name) => name.trim()).filter((name) => name !== ""));
  const enableCodex = isInstalled(probeCodex(io)) || forced.has("codex");
  const enableCursor = isInstalled(probeCursor(io)) || forced.has("cursor");
  io.stdout(`workledger init --workspace: ${workspace}`);
  const repos = trackedReposUnder(workspace);
  io.stdout(`  tracked repos under it: ${repos.length === 0 ? "none yet (selected in this run)" : repos.map((repo) => path.relative(workspace, repo)).join(", ")}`);
  if (enableCodex) report.trustSteps.push(codexTrustStep());

  const ask = options.yes !== true;
  const merges: Array<[string, () => Promise<SettingsOutcome>]> = [
    [SETTINGS_PATH, () => mergeSettingsFile(workspace, io, ask)],
  ];
  if (enableCodex) merges.push([CODEX_HOOKS_PATH, () => mergeCodexHooksFile(workspace, io, ask)]);
  if (enableCursor) merges.push([CURSOR_HOOKS_PATH, () => mergeCursorHooksFile(workspace, io, ask)]);
  for (const [label, run] of merges) {
    let merge: SettingsOutcome;
    try {
      merge = await run();
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      io.stderr(`workledger init --workspace: ${error.message}`);
      return withCode(EXIT_USAGE);
    }
    if (merge.status === "declined") {
      io.stderr(`workledger init --workspace: declined; ${label} was not written`);
      return withCode(EXIT_USAGE);
    }
    if (merge.status === "written") {
      report.hooksWritten.push(label);
      io.stdout(`  wrote ${label}${merge.backup === undefined ? "" : ` (backup: ${path.basename(merge.backup)})`}`);
    }
  }

  await recordWorkspace(workspace, io);
  if (report.hooksWritten.length === 0) {
    io.stdout("already enabled");
    return report;
  }

  io.stdout("");
  io.stdout("Next steps:");
  const steps = [
    "Start a Claude Code session in this folder; at Stop the hook records the session in each repo it touched.",
    ...report.trustSteps,
    "Run `workledger doctor` to confirm the hooks are live.",
  ];
  steps.forEach((step, index) => io.stdout(`  ${index + 1}. ${step}`));
  io.stdout("");
  io.stdout("Privacy:");
  for (const line of PRIVACY_SUMMARY) io.stdout(`  · ${line}`);
  return report;
}

/** Record the workspace in the index (`0006_workspaces`). Best effort, like `recordRepo`. */
async function recordWorkspace(workspace: string, io: InitIo): Promise<void> {
  const home = io.env["WORKLEDGER_HOME"]?.trim();
  try {
    const { openIndex } = await import("../index/db.js");
    const db = openIndex(home ? { home } : {});
    try {
      db.upsertWorkspace(workspace);
    } finally {
      db.close();
    }
  } catch (error) {
    io.stderr(`workledger init --workspace: could not record ${workspace} in the index (${error instanceof Error ? error.message : String(error)}); the hooks will not fire until it is`);
  }
}
