import { createRequire } from "node:module";

import { Argument, Command, CommanderError, InvalidArgumentError } from "commander";

import { backlogCommand, BACKLOG_ACTIONS } from "./commands/backlog.js";
import { briefCommand } from "./commands/brief.js";
import { checkpointCommand } from "./commands/checkpoint.js";
import { doctorCommand } from "./commands/doctor.js";
import { HOOK_EVENTS, hookCommand } from "./commands/hook.js";
import { initCommand } from "./commands/init.js";
import type { BriefOptions } from "./commands/brief.js";
import type { CheckpointOptions } from "./commands/checkpoint.js";
import type { DoctorOptions } from "./commands/doctor.js";
import type { HookEvent } from "./commands/hook.js";
import type { InitOptions } from "./commands/init.js";

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
 * The cell a command action writes its exit code into.
 *
 * Commander actions return nothing the caller can read, so the program is built around a single
 * mutable cell rather than around `process.exit` — which would make the program impossible to
 * drive from a test worker.
 */
export interface ExitCell {
  code: number;
}

/** Parse a `--max-tokens` value, rejecting anything that is not a positive integer. */
function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("expected a positive integer");
  }
  return parsed;
}

/**
 * Build the commander program.
 *
 * Every P1 command is registered here with its final argument and option signature from
 * docs/contracts/p1/cli.md, and delegates its body to one file under `src/commands/`. Slots 8–10
 * replace those bodies without editing this file — the watchdog's T-X mitigation for four CLI
 * slots landing in parallel.
 *
 * `exitOverride()` makes commander throw a `CommanderError` instead of calling `process.exit`,
 * so the program is safe to drive from a test worker. `run()` maps the error to an exit code.
 */
export function createProgram(exit: ExitCell = { code: EXIT_OK }): Command {
  const program = new Command()
    .name("workledger")
    .description("Local observer for coding-agent sessions.")
    .version(VERSION, "-v, --version", "print the workledger version")
    .helpOption("-h, --help", "print usage")
    .exitOverride();

  program
    .command("init")
    .description("enable workledger for one repo")
    .option("--repo <path>", "repo to enable (default: the repo root above cwd)")
    .option("--yes", "skip the confirmation prompt before editing .claude/settings.json")
    .option("--no-backfill", "accepted and ignored until P3")
    .action((options: InitOptions) => {
      exit.code = initCommand(options);
    });

  program
    .command("hook")
    .description("handle a Claude Code hook event; reads the hook JSON on stdin")
    .addArgument(
      new Argument("<event>", "the hook event").choices([...HOOK_EVENTS]),
    )
    .action((event: HookEvent) => {
      exit.code = hookCommand(event);
    });

  program
    .command("checkpoint")
    .description("record a checkpoint; reads a CheckpointPayload on stdin")
    .option("--session <ulid>", "session to record against, when the index lookup is ambiguous")
    .option("--dry-run", "validate and render without writing anything")
    .action((options: CheckpointOptions) => {
      exit.code = checkpointCommand(options);
    });

  program
    .command("brief")
    .description("print the session brief for a repo")
    .option("--repo <path>", "repo to read (default: the repo root above cwd)")
    .option("--max-tokens <n>", "budget for the rendered brief", positiveInteger)
    .action((options: BriefOptions) => {
      exit.code = briefCommand(options);
    });

  program
    .command("doctor")
    .description("report harness, hook, index and version health")
    .option("--json", "emit the report as JSON")
    .action((options: DoctorOptions) => {
      exit.code = doctorCommand(options);
    });

  program
    .command("backlog")
    .description("reserved for the P2 backlog UI; not available in P1")
    .addArgument(
      new Argument("<action>", "backlog action").choices([...BACKLOG_ACTIONS]),
    )
    .addArgument(new Argument("[args...]", "action arguments"))
    .action(() => {
      exit.code = backlogCommand();
    });

  return program;
}

/**
 * Parse `argv` (user arguments only — no `node`, no script path) and return the exit code the
 * process should end with. Never exits the process itself; bin/workledger owns that.
 */
export async function run(argv: readonly string[]): Promise<number> {
  const exit: ExitCell = { code: EXIT_OK };
  try {
    await createProgram(exit).parseAsync([...argv], { from: "user" });
    return exit.code;
  } catch (error) {
    if (error instanceof CommanderError) {
      // `--version` and `--help` land here too, with exitCode 0.
      return error.exitCode === 0 ? EXIT_OK : EXIT_USAGE;
    }
    throw error;
  }
}
