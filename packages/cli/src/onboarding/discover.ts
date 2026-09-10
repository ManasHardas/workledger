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
 *
 * Paths are compared resolved: roots are realpath'd and deduplicated once they are known to
 * exist, and a candidate is one candidate however it was spelled (`~/Projects/`, a symlink to
 * it). A `known` path is reported as the harness recorded it, the way `findRepoRoot` keeps it.
 *
 * A second attribution runs over the candidates once both lists exist (amendment 8, #105): a
 * transcript started somewhere else — a workspace folder above the repos, another repo — counts
 * for every candidate its tool inputs touched (`./attribution.ts`), and a `found` repo that gains
 * a session that way moves to `known`. `startedIn` says where those sessions began and
 * `touchedSessions` how many there were; `harnessSessions` counts them with the rest.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { workspaceHooksInstalled } from "../commands/init-workspace.js";
import { configFile } from "../config.js";
import { findRepoRoot } from "../ledger-fs.js";
import { attributeTranscripts } from "./attribution.js";
import { withIndex } from "./io.js";
import { OS_TEMP_DIRS, assertRootPaths, underTempDir } from "./repo-path.js";
import { isDirectory, sessionRepoOf } from "./session-cwd.js";
import { claudeProjects, codexSessions } from "./stores.js";
import type { OnboardingIo } from "./io.js";
import type { DiscoverResult, RepoCandidate, WorkspaceCandidate } from "@workledger/server";

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
    startedIn: [],
    touchedSessions: 0,
  };
}

/**
 * The repo a session's working directory belongs to, or the directory itself; `undefined` for a
 * directory that is gone or under one of `tempDirs`.
 */
function repoOf(cwd: string, tempDirs: readonly string[]): string | undefined {
  if (!isDirectory(cwd) || underTempDir(cwd, tempDirs)) return undefined;
  return sessionRepoOf(cwd);
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

/** `file` with symlinks resolved, or as given when it cannot be. */
function realOr(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** The step, over the stores under `io.homeDir` and the given (or default) roots. */
export async function discoverRepos(options: { roots?: string[] | undefined }, io: OnboardingIo): Promise<DiscoverResult> {
  // The default root may be absent (a machine with no `~/Projects`) and is simply empty; a root
  // the caller named has to be an absolute existing directory (`./repo-path.ts`).
  const given = assertRootPaths((options.roots ?? []).map((root) => expandRoot(root, io)));
  if (given.length === 0) given.push(path.join(io.homeDir, DEFAULT_ROOT));
  // `assertRootPaths` has just realpath'd every named root; the default one may not exist.
  const roots = [...new Set(given.map(realOr))];
  const tempDirs = io.tempDirs ?? OS_TEMP_DIRS;

  // Both maps are keyed by resolved path; `known` keeps the first spelling a store recorded.
  const known = new Map<string, RepoCandidate>();
  const count = (entry: RepoCandidate, harness: "claude-code" | "codex", sessions: number, newestMs: number): void => {
    entry.harnessSessions[harness] = (entry.harnessSessions[harness] ?? 0) + sessions;
    if (newestMs > 0) {
      const at = new Date(newestMs).toISOString();
      if (entry.lastSessionAt === null || at > entry.lastSessionAt) entry.lastSessionAt = at;
    }
  };
  const bump = (repo: string, harness: "claude-code" | "codex", sessions: number, newestMs: number): void => {
    const key = realOr(repo);
    const entry = known.get(key) ?? candidate(repo);
    count(entry, harness, sessions, newestMs);
    known.set(key, entry);
  };

  // Start directories that are not repos (amendment 8): candidates for `init --workspace`.
  const starts = new Set<string>();
  const startedIn = (cwd: string): void => {
    if (findRepoRoot(cwd) === undefined) starts.add(realOr(path.resolve(cwd)));
  };

  for (const project of claudeProjects(io.homeDir)) {
    if (project.cwd === undefined || project.sessions === 0) continue;
    const repo = repoOf(project.cwd, tempDirs);
    if (repo === undefined) continue;
    bump(repo, "claude-code", project.sessions, project.newestMs);
    startedIn(project.cwd);
  }
  for (const session of codexSessions(io.homeDir)) {
    if (session.cwd === null) continue;
    const repo = repoOf(session.cwd, tempDirs);
    if (repo === undefined) continue;
    bump(repo, "codex", 1, session.mtimeMs);
    startedIn(session.cwd);
  }

  // The walk follows no symlink and starts from a resolved root, so what it yields is resolved.
  const found = new Map<string, RepoCandidate>();
  for (const root of roots) {
    walkRoot(root, (repo) => {
      if (!known.has(repo) && !found.has(repo)) found.set(repo, candidate(repo));
    });
  }

  // The touched-path rule, over every candidate from both lists. A transcript is scanned once
  // through the index cache whatever its cwd; a `found` repo it touched is a `known` one after all.
  const touched = await withIndex(io, (db) =>
    attributeTranscripts(io.homeDir, [...known.keys(), ...found.keys()], db, { tempDirs }),
  );
  for (const [key, attribution] of touched) {
    const sessions = [...attribution.claude.map((s) => ["claude-code", s] as const), ...attribution.codex.map((s) => ["codex", s] as const)];
    if (sessions.length === 0) continue;
    let entry = known.get(key);
    if (entry === undefined) {
      entry = found.get(key) as RepoCandidate;
      found.delete(key);
      known.set(key, entry);
    }
    for (const [harness, session] of sessions) count(entry, harness, 1, session.mtimeMs);
    entry.touchedSessions += sessions.length;
    entry.startedIn = attribution.startedIn;
  }

  const all = [...known.entries(), ...found.entries()];
  const holdsAnother = (key: string): boolean => all.some(([other]) => other.startsWith(`${key}${path.sep}`));
  for (const [key, entry] of all) {
    entry.suggested = entry.hasGit && !underTempDir(key, tempDirs) && !holdsAnother(key);
  }

  // A workspace is a start directory holding git candidates. The repos are reported as the
  // candidates spell them, so the wizard can match them against its selection.
  const workspaces: WorkspaceCandidate[] = [];
  for (const start of [...starts].sort()) {
    const repos = all
      .filter(([key, entry]) => entry.hasGit && key.startsWith(`${start}${path.sep}`))
      .map(([, entry]) => entry.path);
    if (repos.length === 0) continue;
    workspaces.push({ path: start, repos, hooksInstalled: workspaceHooksInstalled(start) });
  }

  return {
    // Most recent agent activity first: the repo the operator was in yesterday is the one they
    // are most likely here for.
    known: [...known.values()].sort(
      (a, b) => (b.lastSessionAt ?? "").localeCompare(a.lastSessionAt ?? "") || a.path.localeCompare(b.path),
    ),
    found: [...found.values()].sort((a, b) => a.path.localeCompare(b.path)),
    roots,
    workspaces,
  };
}
