/**
 * `workledger checkpoint [--session <ulid>] [--dry-run]` — docs/contracts/p1/cli.md.
 *
 * Reads a CheckpointPayload on stdin, validates it, secret-scans it, renders it into the ledger
 * and updates the index. Implemented by P1 slot 9 (#12); the signature is registered in
 * `src/main.ts` from slot 7 so this file is the only one that slot has to change.
 */
import { notImplemented } from "./not-implemented.js";

/** Options commander parses for `checkpoint`. */
export interface CheckpointOptions {
  /** The session ulid, when the index lookup would otherwise be ambiguous. */
  session?: string;
  /** Perform steps 1–6 and print the would-be stdout line prefixed `dry-run:`. */
  dryRun?: boolean;
}

/** @returns the process exit code. */
export function checkpointCommand(options: CheckpointOptions): number {
  // Parsed and deliberately unread: the implementing slot fills this body in, and the
  // signature above is already the contract's.
  void options;
  return notImplemented("checkpoint");
}
