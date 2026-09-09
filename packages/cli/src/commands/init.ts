/**
 * `workledger init [--repo <path>] [--yes] [--no-backfill]` — docs/contracts/p1/cli.md.
 *
 * Onboards one repo: harness detection, identity detection, `.workledger/` scaffolding and the
 * `.claude/settings.json` hooks merge. Implemented by P1 slot 10 (#13); the signature is
 * registered in `src/main.ts` from slot 7 so this file is the only one that slot has to change.
 */
import { notImplemented } from "./not-implemented.js";

/** Options commander parses for `init`. */
export interface InitOptions {
  /** Repo to enable; defaults to the repo root found by walking up from `cwd`. */
  repo?: string;
  /** Skip the confirmation prompt before the `.claude/settings.json` merge. */
  yes?: boolean;
  /** Accepted and ignored until P3. Commander sets this to `false` for `--no-backfill`. */
  backfill?: boolean;
}

/** @returns the process exit code. */
export function initCommand(options: InitOptions): number {
  // Parsed and deliberately unread: the implementing slot fills this body in, and the
  // signature above is already the contract's.
  void options;
  return notImplemented("init");
}
