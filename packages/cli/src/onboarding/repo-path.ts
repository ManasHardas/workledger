/**
 * What a path has to be before an onboarding op will touch it.
 *
 * A repo: absolute, existing once symlinks are resolved, a directory, and holding a `.git` entry
 * (a directory, or the file a git worktree keeps in its place). A root: absolute and an existing
 * directory. Nothing else is walked or scaffolded — `init` writes hook files, and a plain
 * directory that happens to be named on the command line must not grow a `.claude/settings.json`.
 *
 * The server's routes run the same check (`@workledger/server`'s `repoPathProblem`) before the
 * request reaches these ops; this is the check the CLI gets, and the one every op runs so a
 * caller that is neither is refused too. The refusal carries the code the route maps to 400.
 */
import { realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { OnboardingRefusalCode } from "@workledger/server";

/** A refusal the route answers with the contract's status and the code, verbatim. */
export class OnboardingRefusalError extends Error {
  readonly code: OnboardingRefusalCode;

  constructor(code: OnboardingRefusalCode, message: string) {
    super(message);
    this.name = "OnboardingRefusalError";
    this.code = code;
  }
}

/** `true` for a directory, following symlinks. */
function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** Why `given` is not a repo, or `undefined` when it is one. */
export function repoPathProblem(given: string): string | undefined {
  if (!path.isAbsolute(given)) return `${given} is not an absolute path`;
  let real: string;
  try {
    real = realpathSync(given);
  } catch {
    return `${given} does not exist`;
  }
  if (!isDirectory(real)) return `${given} is not a directory`;
  try {
    statSync(path.join(real, ".git"));
  } catch {
    return `${given} is not a git repository (no .git)`;
  }
  return undefined;
}

/** Every entry of `repos`, or the first refusal. Returns the paths as given, not their realpaths. */
export function assertRepoPaths(repos: readonly string[]): string[] {
  for (const repo of repos) {
    const problem = repoPathProblem(repo);
    if (problem !== undefined) throw new OnboardingRefusalError("invalid-repo", problem);
  }
  return [...repos];
}

/** Why `given` cannot be walked for repos, or `undefined`. */
export function rootPathProblem(given: string): string | undefined {
  if (!path.isAbsolute(given)) return `${given} is not an absolute path`;
  let real: string;
  try {
    real = realpathSync(given);
  } catch {
    return `${given} does not exist`;
  }
  return isDirectory(real) ? undefined : `${given} is not a directory`;
}

/**
 * Where scratch lives: `os.tmpdir()` plus both spellings of `/tmp` (macOS resolves it to
 * `/private/tmp`). A test-fixture repo under one of these is nobody's project.
 */
export const OS_TEMP_DIRS: readonly string[] = [os.tmpdir(), "/tmp", "/private/tmp"];

/** `true` when `given` is one of `tempDirs` or below one, both sides resolved through symlinks. */
export function underTempDir(given: string, tempDirs: readonly string[] = OS_TEMP_DIRS): boolean {
  let real: string;
  try {
    real = realpathSync(given);
  } catch {
    return false;
  }
  for (const temp of tempDirs) {
    let base: string;
    try {
      base = realpathSync(temp);
    } catch {
      continue;
    }
    if (real === base || real.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`)) return true;
  }
  return false;
}

/** Every entry of `roots`, or the first refusal. */
export function assertRootPaths(roots: readonly string[]): string[] {
  for (const root of roots) {
    const problem = rootPathProblem(root);
    if (problem !== undefined) throw new OnboardingRefusalError("invalid-root", problem);
  }
  return [...roots];
}
