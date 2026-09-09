/**
 * `workledger note resolve <session-ulid> <cp> <index> --decision "text"` —
 * docs/contracts/p2/backlog-cli.md, plans/feature-p2-data-flow.md §Notes resolution.
 *
 * The one note operation P2 defines. It appends a `decision` note to the session digest and
 * records the pair `{cp, index}` in the session frontmatter's `resolved` list, which is what
 * turns "open notes" from a guess into a set difference. The work is `resolveNote` in
 * `src/backlog-ops.ts`; this file is the argument surface and the exit-code mapping, and it
 * shares both with `commands/backlog.ts` so the two commands cannot drift.
 *
 * Like `backlog`, it is parsed on demand: `main.ts` passes the raw arguments through, so nothing
 * here is loaded by an invocation that is not a `note` invocation.
 */
import { Command, CommanderError, InvalidArgumentError } from "commander";

import { EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { processIo, withLedger } from "./backlog.js";

import type { CommandIo } from "./backlog.js";

/** Parse the `<cp>` and `<index>` arguments. */
function parseCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("expected a non-negative integer");
  }
  return parsed;
}

/** The exit code the action wrote. */
interface Cell {
  code: number;
}

/** Build the `note` sub-program. */
function buildProgram(io: CommandIo, cell: Cell): Command {
  const output = {
    writeOut: (text: string) => io.stdout(text.replace(/\n$/, "")),
    writeErr: (text: string) => io.stderr(text.replace(/\n$/, "")),
  };
  const program = new Command("note")
    .description("act on the notes in a session digest")
    .exitOverride()
    .configureOutput(output);

  program
    .command("resolve")
    .description("close an open blocker or question with a decision note")
    .argument("<session>", "session ULID")
    .argument("<cp>", "checkpoint the note belongs to", parseCount)
    .argument("<index>", "0-based position of the note among that checkpoint's notes", parseCount)
    .requiredOption("--decision <text>", "the decision that resolves the note")
    .exitOverride()
    .configureOutput(output)
    .action(async (session: string, cp: number, index: number, options: { decision: string }) => {
      cell.code = await withLedger("note resolve", io, true, async (ctx, ops) => {
        const resolved = await ops.resolveNote(ctx, session, cp, index, options.decision);
        io.stdout(resolved.line);
      });
    });

  return program;
}

/**
 * Parse and run `argv` — the arguments `main.ts` passed through, with `note` already removed.
 *
 * @returns the process exit code.
 */
export async function noteCommand(
  argv: readonly string[],
  io: CommandIo = processIo(),
): Promise<number> {
  const cell: Cell = { code: EXIT_OK };
  try {
    await buildProgram(io, cell).parseAsync([...argv], { from: "user" });
    return cell.code;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT_OK : EXIT_USAGE;
    throw error;
  }
}
