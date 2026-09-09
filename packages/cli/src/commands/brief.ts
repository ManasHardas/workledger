/**
 * `workledger brief [--repo <path>] [--max-tokens <n>]` — docs/contracts/p1/cli.md.
 *
 * Prints the deterministic session brief. Implemented by P1 slot 10 (#13); the signature is
 * registered in `src/main.ts` from slot 7 so this file is the only one that slot has to change.
 */
import { notImplemented } from "./not-implemented.js";

/** Options commander parses for `brief`. */
export interface BriefOptions {
  /** Repo to read; defaults to the repo root found by walking up from `cwd`. */
  repo?: string;
  /** Budget for the rendered brief; defaults to `brief.max_tokens` in `.workledger/config.yaml`. */
  maxTokens?: number;
}

/** @returns the process exit code. Async so an implementing slot never has to widen it. */
export async function briefCommand(options: BriefOptions): Promise<number> {
  // Parsed and deliberately unread: the implementing slot fills this body in, and the
  // signature above is already the contract's.
  void options;
  return notImplemented("brief");
}
