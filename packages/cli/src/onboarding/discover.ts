/**
 * `discoverRepos` — the wizard's "Projects" step (docs/contracts/p8/daemon-and-api.md
 * §Onboarding endpoints, `GET /api/onboarding/discover`).
 *
 * Two lists. `known` is every repo a harness store has sessions for — the ones an operator has
 * actually worked in with an agent, pre-checked by the wizard. `found` is every `.git` under the
 * roots the stores do not mention, so a repo with no agent history yet can still be picked. A
 * path is in one list or the other, never both.
 *
 * A session recorded in a subdirectory counts for the repo above it: Claude Code slugs the
 * working directory, not the repo, and `packages/cli` is not a project of its own. A session
 * whose directory is gone or under the OS temp dir counts for nothing (amendment 2): a test
 * fixture that ran an agent is not a project either.
 *
 * `suggested` is what the wizard pre-checks: a git repo outside the temp dirs that holds no other
 * candidate. A `~/Projects` with its own `.git` is walked *and* listed, unsuggested.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { configFile } from "../config.js";
import { findRepoRoot } from "../ledger-fs.js";
import { OS_TEMP_DIRS, assertRootPaths, underTempDir } from "./repo-path.js";
import { claudeProjects, codexSessions, isDirectory } from "./stores.js";
import type { OnboardingIo } from "./io.js";
import type { DiscoverResult, RepoCandidate } from "@workledger/server";

/** How far below a root the `.git` walk looks: `<root>/a/b/c` is the deepest repo it can find. */
export const FOUND_DEPTH = 3;

/** The one root walked when none is given, relative to the home directory. */
export const DEFAULT_ROOT = "Projects";

/** Directories the walk never enters. */
function skipped(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

/** A `~`-rooted root, expanded. Anything else is taken as given and must already be absolute. */
function expandRoot(root: string, io: OnboardingIo): string {
  const trimmed = root.trim();
  if (trimmed === "~") return io.homeDir;
  if (trimmed.startsWith("~/")) return path.join(io.homeDir, trimmed.slice(2));
  return trimmed;
}

/** A candidate with no session counts yet. */
function candidate(repo: string): RepoCandidate {
  return {
    path: repo,
    name: path.basename(repo),
    // A file as well as a directory: a git worktree's `.git` is a file pointing at the main one.
    hasGit: existsSync(path.join(repo, ".git")),
    enabled: existsSync(configFile(repo)),
    // Settled once every candidate is in, by `discoverRepos`.
    suggested: false,
    harnessSessions: {},
    lastSessionAt: null,
  };
}

/**
 * The repo a session's working directory belongs to, or the directory itself; `undefined` for a
 * directory that is gone or under one of `tempDirs`.
 */
function repoOf(cwd: string, tempDirs: readonly string[]): string | undefined {
  if (!isDirectory(cwd) || underTempDir(cwd, tempDirs)) return undefined;
  return findRepoRoot(cwd) ?? path.resolve(cwd);
}

/**
 * Every `.git` directory under `root`, at most {@link FOUND_DEPTH} levels down. The root itself
 * is a candidate when it has one, and is walked regardless; a repo below it is not entered.
 */
function walkRoot(root: string, into: (repo: string) => void): void {
  const walk = (dir: string, depth: number): void => {
    if (existsSync(path.join(dir, ".git"))) {
      into(dir);
      if (depth > 0) return;
    }
    if (depth >= FOUND_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || skipped(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  if (isDirectory(root)) walk(root, 0);
}

/** The step, over the stores under `io.homeDir` and the given (or default) roots. */
export function discoverRepos(options: { roots?: string[] | undefined }, io: OnboardingIo): DiscoverResult {
  // The default root may be absent (a machine with no `~/Projects`) and is simply empty; a root
  // the caller named has to be an absolute existing directory (`./repo-path.ts`).
  const roots = assertRootPaths((options.roots ?? []).map((root) => expandRoot(root, io)));
  if (roots.length === 0) roots.push(path.join(io.homeDir, DEFAULT_ROOT));
  const tempDirs = io.tempDirs ?? OS_TEMP_DIRS;

  const known = new Map<string, RepoCandidate>();
  const bump = (repo: string, harness: "claude-code" | "codex", sessions: number, newestMs: number): void => {
    const entry = known.get(repo) ?? candidate(repo);
    entry.harnessSessions[harness] = (entry.harnessSessions[harness] ?? 0) + sessions;
    if (newestMs > 0) {
      const at = new Date(newestMs).toISOString();
      if (entry.lastSessionAt === null || at > entry.lastSessionAt) entry.lastSessionAt = at;
    }
    known.set(repo, entry);
  };

  for (const project of claudeProjects(io.homeDir)) {
    if (project.cwd === undefined || project.sessions === 0) continue;
    const repo = repoOf(project.cwd, tempDirs);
    if (repo !== undefined) bump(repo, "claude-code", project.sessions, project.newestMs);
  }
  for (const session of codexSessions(io.homeDir)) {
    if (session.cwd === null) continue;
    const repo = repoOf(session.cwd, tempDirs);
    if (repo !== undefined) bump(repo, "codex", 1, session.mtimeMs);
  }

  const found = new Map<string, RepoCandidate>();
  for (const root of roots) {
    walkRoot(root, (repo) => {
      if (!known.has(repo) && !found.has(repo)) found.set(repo, candidate(repo));
    });
  }

  const all = [...known.values(), ...found.values()];
  const holdsAnother = (repo: string): boolean => all.some((other) => other.path.startsWith(`${repo}${path.sep}`));
  for (const entry of all) {
    entry.suggested = entry.hasGit && !underTempDir(entry.path, tempDirs) && !holdsAnother(entry.path);
  }

  return {
    // Most recent agent activity first: the repo the operator was in yesterday is the one they
    // are most likely here for.
    known: [...known.values()].sort(
      (a, b) => (b.lastSessionAt ?? "").localeCompare(a.lastSessionAt ?? "") || a.path.localeCompare(b.path),
    ),
    found: [...found.values()].sort((a, b) => a.path.localeCompare(b.path)),
    roots,
  };
}
