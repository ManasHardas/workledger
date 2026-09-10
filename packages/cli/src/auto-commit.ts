/**
 * `auto_commit` — docs/contracts/p5/config-and-identities.md §`.workledger/config.yaml`.
 *
 * "after a successful `checkpoint` (`on_checkpoint`) or at `SessionEnd` (`on_session_end`), run
 * `git add .workledger && git commit -q -m …` in the repo. Never push. Skip silently, with one
 * stderr line prefixed `workledger:`, when the tree has a merge, rebase, or cherry-pick in
 * progress, when `.workledger/` has no changes, or when git is missing. Failures never change
 * the hook's exit code."
 *
 * So: this function returns a reason and never throws, and every caller ignores what it returns
 * except to print it. The convenience of not having to commit the ledger by hand is worth
 * exactly nothing if it can wedge a session or lose a checkpoint, and both of those are what a
 * `git` invocation on someone else's repo is capable of.
 *
 * `git` is spawned here rather than read out of `.git/` the way `src/git-info.ts` does, because
 * this *writes*: index locking, hooks, `core.excludesFile`, `commit.gpgsign` and the identity
 * resolution are all git's job and reimplementing any of them would be a way to corrupt a repo.
 * Neither caller is on a tight budget — `checkpoint` has already written the ledger, and
 * `SessionEnd` is the last hook of a session.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { LEDGER_DIR } from "./ledger-fs.js";
import { gitDir } from "./git-info.js";

/** Why an auto-commit did not happen, or `"committed"` when it did. */
export type AutoCommitOutcome =
  | "committed"
  | "disabled"
  | "not-a-git-repo"
  | "git-missing"
  | "operation-in-progress"
  | "nothing-to-commit"
  | "failed";

/** What one attempt did, and the line to print when it did not commit. */
export interface AutoCommitResult {
  outcome: AutoCommitOutcome;
  /** One stderr line, prefixed `workledger:`, or `undefined` when there is nothing to say. */
  message?: string;
}

/** The commit message for `on_checkpoint`, verbatim from the contract. */
export function checkpointMessage(n: number, ulid: string): string {
  return `workledger: checkpoint ${n} for ${ulid}`;
}

/** The commit message for `on_session_end`, verbatim from the contract. */
export function sessionEndMessage(ulid: string): string {
  return `workledger: session ${ulid} ended`;
}

/**
 * The marker files git leaves while a merge, rebase or cherry-pick is unfinished.
 *
 * Committing into one of those is how a half-finished rebase becomes a lost commit, so the
 * contract makes it a skip rather than something the operator has to notice afterwards.
 * `REVERT_HEAD` is here for the same reason even though the contract's list stops at
 * cherry-pick: it is the same sequencer, mid-operation.
 */
const IN_PROGRESS_MARKERS = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
] as const;

/** The name of the operation in progress in `root`, or `undefined` when the tree is idle. */
export function operationInProgress(root: string): string | undefined {
  const dir = gitDir(root);
  if (dir === undefined) return undefined;
  for (const marker of IN_PROGRESS_MARKERS) {
    if (existsSync(path.join(dir, marker))) return marker;
  }
  return undefined;
}

/** Everything {@link autoCommitLedger} needs from outside itself; only tests pass one. */
export interface AutoCommitIo {
  /** Run `git` with `args` in `root` and return its stdout. Throws exactly as `git` fails. */
  git?: ((args: readonly string[], root: string) => string) | undefined;
}

/** The real `git`: two seconds, stdout captured, stderr kept for the failure message. */
function runGit(args: readonly string[], root: string): string {
  return execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The first line of a thrown value, without a stack and without a multi-line git diagnostic. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error).split("\n")[0] ?? "";
  // `execFileSync` hangs the child's stderr off the thrown error; it is where git puts the
  // reason, and the `Error.message` beside it is only "Command failed".
  const captured = (error as unknown as { stderr?: unknown }).stderr;
  const raw = typeof captured === "string" && captured.trim() !== "" ? captured.trim() : error.message;
  return raw.split("\n")[0] ?? "";
}

/**
 * Commit `.workledger/` in `root` with `message`, or say why it did not.
 *
 * The order of the guards is the order of the contract's sentence, and each one is cheaper than
 * the next: git present, tree idle, something to commit, then the two writes. `git add` is
 * scoped to `.workledger` and `git commit` is given `-- .workledger` so a repo with unrelated
 * staged changes has them neither committed nor disturbed — a checkpoint must never sweep up
 * work the operator had staged.
 *
 * @returns what happened. Never throws.
 */
export function autoCommitLedger(
  root: string,
  message: string,
  io: AutoCommitIo = {},
): AutoCommitResult {
  const git = io.git ?? runGit;

  if (gitDir(root) === undefined) {
    return { outcome: "not-a-git-repo", message: `workledger: auto_commit skipped: ${root} is not a git repo` };
  }

  const operation = operationInProgress(root);
  if (operation !== undefined) {
    return {
      outcome: "operation-in-progress",
      message: `workledger: auto_commit skipped: a git operation is in progress (${operation})`,
    };
  }

  let status: string;
  try {
    status = git(["status", "--porcelain", "--", LEDGER_DIR], root);
  } catch (error) {
    const detail = describe(error);
    // ENOENT from the spawn itself is git not being installed, which the contract names
    // separately from a git that ran and failed.
    const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    return {
      outcome: missing ? "git-missing" : "failed",
      message: missing
        ? "workledger: auto_commit skipped: git is not on PATH"
        : `workledger: auto_commit skipped: git status failed (${detail})`,
    };
  }
  if (status.trim() === "") return { outcome: "nothing-to-commit" };

  try {
    git(["add", "--", LEDGER_DIR], root);
    git(["commit", "-q", "-m", message, "--", LEDGER_DIR], root);
  } catch (error) {
    return {
      outcome: "failed",
      message: `workledger: auto_commit failed: ${describe(error)}`,
    };
  }
  return { outcome: "committed" };
}

/**
 * Run the auto-commit for `mode` when it is the one this call site implements, and print the
 * skip line if there is one.
 *
 * Exists so neither caller has to repeat the "compare the mode, swallow everything, print at
 * most one line" dance, and so there is one place asserting that this never influences an exit
 * code: it returns `void`.
 */
export function maybeAutoCommit(options: {
  configured: false | string;
  when: string;
  root: string;
  message: string;
  stderr: (line: string) => void;
  io?: AutoCommitIo | undefined;
}): void {
  if (options.configured !== options.when) return;
  let result: AutoCommitResult;
  try {
    result = autoCommitLedger(options.root, options.message, options.io ?? {});
  } catch (error) {
    // `autoCommitLedger` is written not to throw; this is the belt to that suspenders, because
    // the one thing this feature may never do is turn a successful checkpoint into a failure.
    result = { outcome: "failed", message: `workledger: auto_commit failed: ${describe(error)}` };
  }
  if (result.message !== undefined) options.stderr(result.message);
}
