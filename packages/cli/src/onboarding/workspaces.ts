/**
 * `listWorkspaces` — `GET /api/workspaces` (docs/contracts/p8/daemon-and-api.md amendment 12):
 * the folders Home lists under "Folders with sessions".
 *
 * A folder qualifies two ways. It is a **registered** workspace — `init --workspace` wrote hook
 * files into it and recorded it in the index's `workspaces` table — or it is a **start folder**
 * a harness store holds transcripts for that is not a git repo: no `.git` of its own, and either
 * outside any repo or holding repos itself (amendment 8's workspace rule: `~/Projects/
 * dome_workspace` under a `~/Projects` that happens to be under git is still the folder its
 * sessions start in). A session started in `<repo>/packages/cli` counts for the repo, never for
 * the subdirectory, and one under the OS temp dir counts for nothing, the same as `discover`.
 *
 * Only metadata is read — directory listings, `stat`, a Codex rollout's first line — never a
 * transcript body: this runs on every Home render and must stay cheap.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { WORKSPACE_DEPTH, workspaceHooksInstalled } from "../commands/init-workspace.js";
import { findRepoRoot, isEnabled } from "../ledger-fs.js";
import { withIndex } from "./io.js";
import { OS_TEMP_DIRS, underTempDir } from "./repo-path.js";
import { isDirectory } from "./session-cwd.js";
import { claudeProjects, codexSessions } from "./stores.js";
import type { OnboardingIo } from "./io.js";
import type { Workspace } from "@workledger/server";

/** `file` with symlinks resolved, or as given when it cannot be. */
function realOr(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/**
 * Git repos under `dir`, at most {@link WORKSPACE_DEPTH} levels down, split into the enabled
 * ones (what hooks here record into) and all of them (what makes the folder a workspace). A repo
 * is not entered; `node_modules` and dot directories are skipped, as the discovery walk skips them.
 */
function reposUnder(dir: string): { tracked: string[]; git: string[] } {
  const tracked: string[] = [];
  const git: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (depth > 0 && existsSync(path.join(current, ".git"))) {
      git.push(current);
      if (isEnabled(current)) tracked.push(current);
      return;
    }
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
  return { tracked: tracked.sort(), git };
}

/** The op. Newest session first, then by path; a registered folder with no session sorts last. */
export async function listWorkspaces(io: OnboardingIo): Promise<Workspace[]> {
  const tempDirs = io.tempDirs ?? OS_TEMP_DIRS;
  const found = new Map<string, Workspace>();

  const entryFor = (folder: string): Workspace => {
    const key = realOr(folder);
    let entry = found.get(key);
    if (entry === undefined) {
      entry = {
        path: key,
        name: path.basename(key),
        repos: reposUnder(key).tracked,
        hooksInstalled: workspaceHooksInstalled(key),
        registered: false,
        sessions: 0,
        lastSessionAt: null,
      };
      found.set(key, entry);
    }
    return entry;
  };

  /** The folder a session's cwd stands for, or `undefined` when the cwd is a repo's or nobody's. */
  const startFolderOf = (cwd: string): string | undefined => {
    if (!isDirectory(cwd) || underTempDir(cwd, tempDirs)) return undefined;
    const start = path.resolve(cwd);
    if (existsSync(path.join(start, ".git"))) return undefined;
    // Inside a repo: the session is the repo's — unless the folder holds repos of its own.
    const enclosing = findRepoRoot(start);
    if (enclosing !== undefined && enclosing !== start && reposUnder(start).git.length === 0) return undefined;
    return start;
  };
  const count = (cwd: string, sessions: number, newestMs: number): void => {
    const folder = startFolderOf(cwd);
    if (folder === undefined) return;
    const entry = entryFor(folder);
    entry.sessions += sessions;
    if (newestMs > 0) {
      const at = new Date(newestMs).toISOString();
      if (entry.lastSessionAt === null || at > entry.lastSessionAt) entry.lastSessionAt = at;
    }
  };

  for (const row of await withIndex(io, (db) => db.listWorkspaces())) {
    entryFor(row.path).registered = true;
  }
  for (const project of claudeProjects(io.homeDir)) {
    if (project.cwd === undefined || project.sessions === 0) continue;
    count(project.cwd, project.sessions, project.newestMs);
  }
  for (const session of codexSessions(io.homeDir)) {
    if (session.cwd === null) continue;
    count(session.cwd, 1, session.mtimeMs);
  }

  return [...found.values()].sort(
    (a, b) => (b.lastSessionAt ?? "").localeCompare(a.lastSessionAt ?? "") || a.path.localeCompare(b.path),
  );
}
