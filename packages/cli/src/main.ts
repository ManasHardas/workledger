import { createRequire } from "node:module";

import { Command, CommanderError } from "commander";

// Resolved relative to this module, so it points at packages/cli/package.json both from
// src/ (vitest) and from dist/ (the published bin).
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

/** The workledger version, read from packages/cli/package.json. */
export const VERSION: string = version;

/**
 * Exit codes, per docs/contracts/p1/cli.md:
 * 0 ok · 1 validation or usage error · 2 hook block · 3 secret detected · 4 not an enabled repo.
 */
export const EXIT_OK = 0;
export const EXIT_USAGE = 1;

/**
 * Build the commander program. Commands (`init`, `hook`, `checkpoint`, `brief`, `doctor`,
 * `backlog`) are registered here by slots 8–10; P1 slot 1 ships `--version` and `--help` only.
 *
 * `exitOverride()` makes commander throw a `CommanderError` instead of calling `process.exit`,
 * so the program is safe to drive from a test worker. `run()` maps the error to an exit code.
 */
export function createProgram(): Command {
  return new Command()
    .name("workledger")
    .description("Local observer for coding-agent sessions.")
    .version(VERSION, "-v, --version", "print the workledger version")
    .helpOption("-h, --help", "print usage")
    .exitOverride();
}

/**
 * Parse `argv` (user arguments only — no `node`, no script path) and return the exit code the
 * process should end with. Never exits the process itself; bin/workledger owns that.
 */
export async function run(argv: readonly string[]): Promise<number> {
  try {
    await createProgram().parseAsync([...argv], { from: "user" });
    return EXIT_OK;
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--version` and `--help` land here too, with exitCode 0.
      return error.exitCode === 0 ? EXIT_OK : EXIT_USAGE;
    }
    throw error;
  }
}
