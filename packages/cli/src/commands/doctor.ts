/**
 * `workledger doctor [--json]` — docs/contracts/p1/cli.md.
 *
 * Reports harness binaries and versions, session-store readability, hook files versus the
 * contract, the CLI version, and the index path, size and open-session count. Implemented by
 * P1 slot 10 (#13); the signature is registered in `src/main.ts` from slot 7 so this file is
 * the only one that slot has to change.
 */
import { notImplemented } from "./not-implemented.js";

/** Options commander parses for `doctor`. */
export interface DoctorOptions {
  /** Emit the report as JSON instead of the human-readable table. */
  json?: boolean;
}

/** @returns the process exit code. Async so an implementing slot never has to widen it. */
export async function doctorCommand(options: DoctorOptions): Promise<number> {
  // Parsed and deliberately unread: the implementing slot fills this body in, and the
  // signature above is already the contract's.
  void options;
  return notImplemented("doctor");
}
