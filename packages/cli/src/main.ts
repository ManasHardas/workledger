import { createRequire } from "node:module";

import { Argument, Command, CommanderError, InvalidArgumentError } from "commander";

import { HOOK_EVENTS } from "./commands/hook-events.js";
import { EXIT_OK, EXIT_USAGE } from "./exit-codes.js";
import type { BriefOptions } from "./commands/brief.js";
import type { CheckpointOptions } from "./commands/checkpoint.js";
import type { DoctorOptions } from "./commands/doctor.js";
import type { HookEvent } from "./commands/hook-events.js";
import type { InitOptions } from "./commands/init.js";
import type { JobsOptions } from "./commands/jobs.js";
import type { RepairOptions } from "./commands/repair.js";
import type { ScanOptions } from "./commands/scan.js";
import type { ServeOptions } from "./commands/serve.js";

// Resolved relative to this module, so it points at packages/cli/package.json both from
// src/ (vitest) and from dist/ (the published bin).
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

/** The workledger version, read from packages/cli/package.json. */
export const VERSION: string = version;

// Re-exported so `main.js` stays the one import every caller and test needs.
export * from "./exit-codes.js";

/**
 * The cell a command action writes its exit code into.
 *
 * Commander actions return nothing the caller can read, so the program is built around a single
 * mutable cell rather than around `process.exit` — which would make the program impossible to
 * drive from a test worker. Every action is `async` and awaits its command: `run()` drives the
 * program with `parseAsync`, so a command body that needs to await (init's confirmation prompt,
 * a stdin read) never forces an edit to this file.
 */
export interface ExitCell {
  code: number;
}

/** Parse a numeric option value, rejecting anything that is not a positive integer. */
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
 * slots landing in parallel. P2 adds `backlog` and `note` (docs/contracts/p2/backlog-cli.md) as
 * pass-throughs that parse their own sub-commands.
 *
 * Each body is reached with `await import()` rather than a static import, and the only values
 * this module pulls eagerly are commander, the exit codes and one argument-choice list. That is
 * what makes `hook Stop`'s allow path meet its p95 < 100 ms budget (data-flow §6): a static
 * import of `checkpoint.js` puts `@workledger/core` — ~30 ms of zod schema construction and
 * `yaml` module init — into the bundle's top level, where every invocation pays for it. The
 * choice list lives in `commands/hook-events.js`, which imports nothing.
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
    // `backlog` and `note` own their own sub-parsers, so everything after their first operand
    // has to reach them untouched — `--title`, `--json` and the rest are theirs, not ours.
    .enablePositionalOptions()
    .exitOverride();

  program
    .command("init")
    .description("enable workledger for one repo")
    .option("--repo <path>", "repo to enable (default: the repo root above cwd)")
    .option("--yes", "skip the confirmation prompt before editing .claude/settings.json")
    .option("--no-backfill", "accepted and ignored until P3")
    .action(async (options: InitOptions) => {
      const { initCommand } = await import("./commands/init.js");
      exit.code = await initCommand(options);
    });

  program
    .command("hook")
    .description("handle a Claude Code hook event; reads the hook JSON on stdin")
    .addArgument(
      new Argument("<event>", "the hook event").choices([...HOOK_EVENTS]),
    )
    .action(async (event: HookEvent) => {
      const { hookCommand } = await import("./commands/hook.js");
      exit.code = await hookCommand(event);
    });

  program
    .command("checkpoint")
    .description("record a checkpoint; reads a CheckpointPayload on stdin")
    .option("--session <ulid>", "session to record against, when the index lookup is ambiguous")
    .option("--dry-run", "validate and render without writing anything")
    .action(async (options: CheckpointOptions) => {
      const { checkpointCommand } = await import("./commands/checkpoint.js");
      exit.code = await checkpointCommand(options);
    });

  program
    .command("brief")
    .description("print the session brief for a repo")
    .option("--repo <path>", "repo to read (default: the repo root above cwd)")
    .option("--max-tokens <n>", "budget for the rendered brief", positiveInteger)
    .action(async (options: BriefOptions) => {
      const { briefCommand } = await import("./commands/brief.js");
      exit.code = await briefCommand(options);
    });

  program
    .command("doctor")
    .description("report harness, hook, index and version health")
    .option("--json", "emit the report as JSON")
    .action(async (options: DoctorOptions) => {
      const { doctorCommand } = await import("./commands/doctor.js");
      exit.code = await doctorCommand(options);
    });

  program
    .command("serve")
    .description("serve the local UI and API on 127.0.0.1 until Ctrl-C")
    .option("--repo <path>", "repo to serve (default: the repo root above cwd)")
    .option("--port <n>", "port to bind (default: a random high port)", positiveInteger)
    .option("--no-open", "do not open the browser")
    .action(async (options: ServeOptions) => {
      const { serveCommand } = await import("./commands/serve.js");
      exit.code = await serveCommand(options);
    });

  // P3 (docs/contracts/p3/cli.md). Same shape as every command above: the body is reached with
  // `await import()` so `hook Stop`'s allow path never pays for it.
  program
    .command("scan")
    .description("mark orphaned sessions crashed and queue their repairs")
    .option("--repo <path>", "repo to sweep (default: the repo root above cwd)")
    .option("--json", "emit the result as JSON")
    .action(async (options: ScanOptions) => {
      const { scanCommand } = await import("./commands/scan.js");
      exit.code = await scanCommand(options);
    });

  program
    .command("repair")
    .description("record the missing digest for a crashed session by resuming it")
    .addArgument(new Argument("<ulid>", "the session to repair"))
    .option("--extract", "reconstruct from the transcript instead of resuming (arrives with #54)")
    .option("--yes", "skip the extraction spend prompt")
    .option("--timeout <s>", "seconds before the resumed session is killed", positiveInteger)
    .option("--force", "repair a session that is still open, or ended without needs_repair")
    .action(async (ulid: string, options: RepairOptions) => {
      const { repairCommand } = await import("./commands/repair.js");
      exit.code = await repairCommand(ulid, options);
    });

  program
    .command("jobs")
    .description("list, cancel and retry the repair queue")
    .option("--repo <path>", "repo to read (default: the repo root above cwd)")
    .option("--json", "emit the listing as JSON")
    .option("--cancel <job-id>", "cancel a queued or running job")
    .option("--retry <job-id>", "re-queue a failed or cancelled job")
    .action(async (options: JobsOptions) => {
      const { jobsCommand } = await import("./commands/jobs.js");
      exit.code = await jobsCommand(options);
    });

  // `backlog` and `note` are pass-throughs: the sub-command tables, their flags and their help
  // live in `commands/backlog.ts` and `commands/note.ts` and are parsed there, on demand. Two
  // reasons, both structural. Their option surface is wide and per-sub-command, which commander
  // cannot express from one registration here; and every eager import in this file is paid for
  // by `hook Stop`, whose allow path has a p95 < 100 ms budget (data-flow §6).
  program
    .command("backlog")
    .description("read and edit the backlog; `workledger backlog --help` lists the actions")
    .addArgument(new Argument("[args...]", "action and its arguments"))
    .passThroughOptions()
    .allowUnknownOption()
    .helpOption(false)
    .action(async (args: string[]) => {
      const { backlogCommand } = await import("./commands/backlog.js");
      exit.code = await backlogCommand(args);
    });

  program
    .command("note")
    .description("act on the notes in a session digest; `workledger note --help` lists the actions")
    .addArgument(new Argument("[args...]", "action and its arguments"))
    .passThroughOptions()
    .allowUnknownOption()
    .helpOption(false)
    .action(async (args: string[]) => {
      const { noteCommand } = await import("./commands/note.js");
      exit.code = await noteCommand(args);
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
