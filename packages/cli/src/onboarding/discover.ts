/**
 * `discoverRepos` — the wizard's "Projects" step (docs/contracts/p8/daemon-and-api.md
 * §Onboarding endpoints, `GET /api/onboarding/discover`).
 *
 * Two lists. `known` is every repo a harness store has sessions *about* — the ones an operator
 * has actually worked in with an agent, pre-checked by the wizard. `found` is every `.git` under
 * the roots with no such session, so a repo with no agent history yet can still be picked. A
 * path is in one list or the other, never both.
 *
 * Which sessions a repo has is the inference of amendment 10 (`./attribution.ts`): a session
 * counts for every repo its transcript's tool inputs qualify, wherever it was started, and for
 * the repo containing its start directory only when nothing qualifies. The candidates the
 * inference scores are the repos sessions were started in — the nearest git repo or enabled
 * ledger at or above each start directory, a start directory inside no repo being nobody's
 * candidate — and every `.git` under the roots. A session whose start directory is gone or
 * under the OS temp dir counts for nothing (amendment 2): a test fixture that ran an agent is not
 * a project either. `startedIn` says where a repo's sessions began when that was not inside it,
 * `touchedSessions` how many began elsewhere, and `about` how many the content qualified against
 * how many are the fallback.
 *
 * `suggested` is what the wizard pre-checks: a git repo outside the temp dirs that holds no other
 * candidate. A `~/Projects` with its own `.git` is walked *and* listed, unsuggested.
 *
 * Paths are compared resolved: roots are realpath'd and deduplicated once they are known to
 * exist, and a candidate is one candidate however it was spelled (`~/Projects/`, a symlink to
 * it). A `known` path is reported as the harness recorded it, the way `findRepoRoot` keeps it.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { workspaceHooksInstalled } from "../commands/init-workspace.js";
import { configFile } from "../config.js";
import { attributeTranscripts } from "./attribution.js";
import { withIndex } from "./io.js";
import { OS_TEMP_DIRS, assertRootPaths, underTempDir } from "./repo-path.js";
import { isDirectory } from "./session-cwd.js";
import { claudeProjects, codexSessions } from "./stores.js";
import { repoAbove } from "./touched.js";
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
    about: { content: 0, fallback: 0 },
  };
}

/** A start directory that still exists and is not scratch (amendment 2). */
function usableStart(cwd: string, tempDirs: readonly string[]): boolean {
  return isDirectory(cwd) && !underTempDir(cwd, tempDirs);
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

  // The candidates, keyed by resolved path; a start directory's repo keeps the first spelling a
  // store recorded, a walked repo is resolved already (the walk follows no symlink).
  const candidates = new Map<string, RepoCandidate>();
  const consider = (repo: string): void => {
    const key = realOr(repo);
    if (!candidates.has(key)) candidates.set(key, candidate(repo));
  };

  // Start directories that are not repo roots themselves (amendment 8): candidates for
  // `init --workspace`. "Not a repo root" is the directory's own `.git`, not an ancestor's: a
  // `~/Projects/dome_workspace` under a `~/Projects` that is itself a git repo is still the
  // folder its sessions start in, and `findRepoRoot` would resolve it to the ancestor.
  // The repo a start directory is inside — the nearest git repo or enabled ledger at or above
  // it — is a candidate; a `~` or a workspace folder is where sessions start, never something
  // they are about (amendment 10): a session that wrote its harness's memory file under `~` is
  // not a session about `~`.
  const starts = new Set<string>();
  const startedIn = (cwd: string): void => {
    const start = path.resolve(cwd);
    if (!existsSync(path.join(start, ".git"))) starts.add(realOr(start));
    const repo = repoAbove(start);
    if (repo !== undefined) consider(repo);
  };

  for (const project of claudeProjects(io.homeDir)) {
    if (project.cwd === undefined || project.sessions === 0 || !usableStart(project.cwd, tempDirs)) continue;
    startedIn(project.cwd);
  }
  for (const session of codexSessions(io.homeDir)) {
    if (session.cwd === null || !usableStart(session.cwd, tempDirs)) continue;
    startedIn(session.cwd);
  }
  for (const root of roots) walkRoot(root, consider);

  // The inference, over every candidate at once (amendment 10): a transcript is scanned once
  // through the index cache whatever its start directory, and counts for each repo it is about.
  const about = await withIndex(io, (db) => attributeTranscripts(io.homeDir, [...candidates.keys()], db, { tempDirs }));
  const known = new Map<string, RepoCandidate>();
  const found = new Map<string, RepoCandidate>();
  for (const [key, entry] of candidates) {
    const attribution = about.get(key);
    const sessions = [...(attribution?.claude.map((s) => ["claude-code", s] as const) ?? []), ...(attribution?.codex.map((s) => ["codex", s] as const) ?? [])];
    if (sessions.length === 0) {
      // No session is about it: a walked repo stays offered; a start directory whose sessions
      // were all about other repos — a workspace folder, `~` — is not a project at all.
      if (entry.hasGit && roots.some((root) => key === root || key.startsWith(`${root}${path.sep}`))) found.set(key, entry);
      continue;
    }
    for (const [harness, session] of sessions) {
      entry.harnessSessions[harness] = (entry.harnessSessions[harness] ?? 0) + 1;
      const at = new Date(session.mtimeMs).toISOString();
      if (entry.lastSessionAt === null || at > entry.lastSessionAt) entry.lastSessionAt = at;
    }
    entry.startedIn = attribution?.startedIn ?? [];
    entry.about = attribution?.about ?? { content: 0, fallback: 0 };
    entry.touchedSessions = sessions.filter(([, session]) => session.cwd !== null && entry.startedIn.includes(session.cwd)).length;
    known.set(key, entry);
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
