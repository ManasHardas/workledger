import { createRequire } from "node:module";

import { Command } from "commander";

// Resolved relative to this module, so it points at packages/cli/package.json both from
// src/ (vitest) and from dist/ (the published bin).
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

/** The workledger version, read from packages/cli/package.json. */
export const VERSION: string = version;

/**
 * Build the commander program. Commands (`init`, `hook`, `checkpoint`, `brief`, `doctor`,
 * `backlog`) are registered here by slots 8–10; P1 slot 1 ships `--version` and `--help` only.
 *
 * Exit codes are the shared vocabulary from docs/contracts/p1/cli.md:
 * 0 ok · 1 validation or usage error · 2 hook block · 3 secret detected · 4 not an enabled repo.
 */
export function createProgram(): Command {
  return new Command()
    .name("workledger")
    .description("Local observer for coding-agent sessions.")
    .version(VERSION, "-v, --version", "print the workledger version")
    .helpOption("-h, --help", "print usage")
    .exitOverride((error) => {
      // commander's own usage failures map onto exit code 1 in the CLI contract.
      process.exit(error.exitCode === 0 ? 0 : 1);
    });
}

/** Entry point invoked by bin/workledger. */
export function run(argv: readonly string[] = process.argv): void {
  createProgram().parse([...argv]);
}
