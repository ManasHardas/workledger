/**
 * The shared body of every P1 command that is registered but not yet built.
 *
 * `packages/cli/src/main.ts` carries the full command registry from slot 7 (#10) so that slots
 * 8–10 each replace one file under `src/commands/` without touching `main.ts` — the watchdog's
 * T-X mitigation for four CLI slots landing in parallel. Until then the signature is real and
 * the body is this.
 */

import { EXIT_USAGE } from "../exit-codes.js";

/**
 * Report that `name` is registered but has no implementation yet, and return the usage exit
 * code. Written to stderr: stdout belongs to the command's contracted output, and a caller
 * piping it must not receive this line as data.
 */
export function notImplemented(name: string): number {
  process.stderr.write(`workledger ${name}: not implemented in this slot\n`);
  return EXIT_USAGE;
}
