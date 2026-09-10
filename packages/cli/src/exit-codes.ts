/**
 * Process exit codes, per docs/contracts/p1/cli.md.
 *
 * `2` has two meanings by command — from `hook Stop` it is the deliberate block, from `doctor`
 * it is "warnings" — so it is spelled twice rather than given one misleading name. No other
 * command exits 2.
 */

/** Success. */
export const EXIT_OK = 0;
/** Validation or usage error. */
export const EXIT_USAGE = 1;
/** `hook Stop` only: the checkpoint block. */
export const EXIT_BLOCK = 2;
/** `doctor` only: warnings. */
export const EXIT_WARNINGS = 2;
/** A secret was detected; nothing was written. */
export const EXIT_SECRET = 3;
/** Not an enabled repo. */
export const EXIT_NOT_ENABLED = 4;
/** `repair` and `backfill` only: the job did not succeed (docs/contracts/p3/cli.md). */
export const EXIT_JOB_FAILED = 5;
/** `repair --extract` only: consent for the extraction spend was refused. */
export const EXIT_CONSENT_REFUSED = 6;
