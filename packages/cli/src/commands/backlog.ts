/**
 * `workledger backlog <accept|discard|done|edit|assign|rank|merge|show|list> …` —
 * docs/contracts/p2/backlog-cli.md.
 *
 * Argument parsing and printing only: every mutation is a function in `src/backlog-ops.ts`, which
 * `packages/server` calls with the same arguments. What this file owns is the surface the
 * contract fixes — flag names, the `--json` shapes, and the mapping from a
 * {@link BacklogOpError}'s `code` to an exit code (`0` ok · `1` usage/validation · `4` not an
 * enabled repo).
 *
 * The subcommands are built here rather than in `src/main.ts` and parsed on demand. `main.ts`
 * registers `backlog` as a single pass-through command, so nothing in this file — and nothing in
 * `backlog-ops.ts` or `@workledger/core` behind it — is loaded by an invocation that is not a
 * backlog invocation. That is what keeps the `hook Stop` allow path inside its p95 < 100 ms
 * budget (plans/feature-p1-data-flow.md §6): the only eager imports here are commander, the exit
 * codes, and `node:process`.
 */
import process from "node:process";

import { Command, CommanderError, InvalidArgumentError } from "commander";

import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";

import type { EditPatch, ItemResult, OpContext } from "../backlog-ops.js";
import type { BacklogStatus } from "@workledger/core/schema";

/** Everything a backlog or note command touches outside itself. */
export interface CommandIo {
  cwd: string;
  env: Record<string, string | undefined>;
  /** A line of output; the newline is added here. */
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

/** The real environment. */
export function processIo(): CommandIo {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => void process.stdout.write(`${text}\n`),
    stderr: (line) => void process.stderr.write(`${line}\n`),
  };
}

/** The `src/backlog-ops.js` module, imported on demand. */
type Ops = typeof import("../backlog-ops.js");

/**
 * Resolve the repo root and the writing identity, then run `body`.
 *
 * `needsActor` is false for `show` and `list`: reading the backlog is not a write, and refusing
 * it because git has no `user.email` would be gratuitous. Every mutation passes true, and the
 * contract's "refuse with exit 1 if empty" happens here rather than inside each op.
 */
export async function withLedger(
  label: string,
  io: CommandIo,
  needsActor: boolean,
  body: (ctx: OpContext, ops: Ops) => Promise<void>,
): Promise<number> {
  const ops = await import("../backlog-ops.js");
  const { findRepoRoot, isEnabled } = await import("../ledger-fs.js");

  const root = findRepoRoot(io.env["CLAUDE_PROJECT_DIR"]?.trim() || io.cwd);
  if (root === undefined || !isEnabled(root)) {
    io.stderr(`workledger ${label}: ${root ?? io.cwd} is not an enabled repo; run \`workledger init\``);
    return EXIT_NOT_ENABLED;
  }

  // A read still needs *an* actor to satisfy `OpContext`; only a write insists it is a real one.
  const by = ops.gitActor(root);
  if (needsActor && by === undefined) {
    io.stderr(
      `workledger ${label}: git user.name and user.email must be set to record who made this change`,
    );
    return EXIT_USAGE;
  }

  try {
    await body({ repoRoot: root, by: by ?? { name: "", email: "" } }, ops);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof ops.BacklogOpError) {
      io.stderr(`workledger ${label}: ${error.message}`);
      for (const detail of error.details) io.stderr(`  ${detail}`);
      return error.code === "not-enabled" ? EXIT_NOT_ENABLED : EXIT_USAGE;
    }
    io.stderr(`workledger ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }
}

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

/** `Name <email>` — the one `--owner` form the contract gives. */
const OWNER = /^\s*(.*?)\s*<([^<>@\s]+@[^<>\s]+)>\s*$/;

/** Parse `--owner "Ada Lovelace <ada@example.com>"`. */
export function parseOwner(value: string): { name: string; email: string } {
  const match = OWNER.exec(value);
  if (match === null || match[1] === "") {
    throw new InvalidArgumentError(`expected a \`Name <email>\` owner, got ${JSON.stringify(value)}`);
  }
  return { name: match[1]!, email: match[2]! };
}

/** Parse a comma-separated list, dropping empty entries so `a,,b` and `a, b` agree. */
export function parseList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** Parse `rank <n>`; any integer is legal, including a negative one. */
function parseRank(value: string): number {
  const rank = Number(value);
  if (!Number.isInteger(rank)) throw new InvalidArgumentError("expected an integer");
  return rank;
}

/**
 * Validate `--priority`. `none` clears the field, which is why this cannot be a commander
 * `.choices()` list: the enum lives in `@workledger/core/schema` and importing it eagerly would
 * put zod in the startup path, so the check happens against `PRIORITIES` after the dynamic
 * import.
 */
async function readPriority(value: string): Promise<EditPatch["priority"]> {
  const { PRIORITIES } = await import("@workledger/core/schema");
  if (value === "none") return null;
  if ((PRIORITIES as readonly string[]).includes(value)) return value as EditPatch["priority"];
  throw new Error(`expected one of ${PRIORITIES.join(", ")}, none`);
}

/** Validate `--status p,q` against the backlog status enum. */
async function readStatuses(value: string): Promise<BacklogStatus[]> {
  const { BACKLOG_STATUS } = await import("@workledger/core/schema");
  const wanted = parseList(value);
  for (const status of wanted) {
    if (!(BACKLOG_STATUS as readonly string[]).includes(status)) {
      throw new Error(`unknown status ${JSON.stringify(status)}: expected one of ${BACKLOG_STATUS.join(", ")}`);
    }
  }
  return wanted as BacklogStatus[];
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** What a mutation prints on stdout: the id and the diffs it recorded. */
export function summarize(result: ItemResult): string {
  if (result.history.length === 0) return `${result.id}: no change`;
  const diffs = result.history.map((entry) => entry.diff ?? entry.op);
  return `${result.id}: ${diffs.join("; ")}`;
}

/** One `list` row. */
function row(item: { id: string; status: string; priority?: string | null; title: string }): string {
  return `${item.id}  ${item.status.padEnd(11)}  ${(item.priority ?? "-").padEnd(4)}  ${item.title}`;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** Sub-commands, in the order the contract lists them; also what `--help` prints. */
export const BACKLOG_ACTIONS = [
  "accept",
  "discard",
  "done",
  "edit",
  "assign",
  "rank",
  "merge",
  "show",
  "list",
] as const;

/** The exit code a subcommand action wrote. */
interface Cell {
  code: number;
}

/** Build the `backlog` sub-program. Every action writes its exit code into `cell`. */
function buildProgram(io: CommandIo, cell: Cell): Command {
  const program = new Command("backlog")
    .description("read and edit the backlog")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout(text.replace(/\n$/, "")),
      writeErr: (text) => io.stderr(text.replace(/\n$/, "")),
    });

  const sub = (name: string, description: string): Command =>
    program.command(name).description(description).exitOverride().configureOutput({
      writeOut: (text) => io.stdout(text.replace(/\n$/, "")),
      writeErr: (text) => io.stderr(text.replace(/\n$/, "")),
    });

  sub("accept", "proposed | in_progress | done → accepted; stamps confirmed_by")
    .argument("<id>", "backlog item id")
    .action(async (id: string) => {
      cell.code = await withLedger("backlog accept", io, true, async (ctx, ops) => {
        io.stdout(summarize(await ops.acceptItem(ctx, id)));
      });
    });

  sub("discard", "proposed | accepted | in_progress → discarded")
    .argument("<id>", "backlog item id")
    .action(async (id: string) => {
      cell.code = await withLedger("backlog discard", io, true, async (ctx, ops) => {
        io.stdout(summarize(await ops.discardItem(ctx, id)));
      });
    });

  sub("done", "proposed | accepted | in_progress → done; done_by stays null")
    .argument("<id>", "backlog item id")
    .action(async (id: string) => {
      cell.code = await withLedger("backlog done", io, true, async (ctx, ops) => {
        io.stdout(summarize(await ops.doneItem(ctx, id)));
      });
    });

  sub("edit", "change the title, body, priority or area")
    .argument("<id>", "backlog item id")
    .option("--title <text>", "replace the title")
    .option("--body <text>", "replace the markdown body")
    .option("--priority <p>", "p1, p2, p3, or none to clear")
    .option("--area <list>", "comma-separated areas, replacing the current list")
    .action(async (id: string, options: { title?: string; body?: string; priority?: string; area?: string }) => {
      cell.code = await withLedger("backlog edit", io, true, async (ctx, ops) => {
        const patch: EditPatch = {};
        if (options.title !== undefined) patch.title = options.title;
        if (options.body !== undefined) patch.body = options.body;
        if (options.priority !== undefined) {
          patch.priority = await readPriority(options.priority);
        }
        if (options.area !== undefined) patch.area = parseList(options.area);
        io.stdout(summarize(await ops.editItem(ctx, id, patch)));
      });
    });

  sub("assign", "set or clear the owner")
    .argument("<id>", "backlog item id")
    .option("--owner <actor>", 'owner as "Name <email>"', parseOwner)
    .option("--none", "clear the owner")
    .action(async (id: string, options: { owner?: { name: string; email: string }; none?: boolean }) => {
      cell.code = await withLedger("backlog assign", io, true, async (ctx, ops) => {
        const clearing = options.none === true;
        if (clearing === (options.owner !== undefined)) {
          throw new ops.BacklogOpError("pass exactly one of --owner and --none");
        }
        io.stdout(summarize(await ops.assignItem(ctx, id, options.owner ?? null)));
      });
    });

  sub("rank", "set the manual order within a status group")
    .argument("<id>", "backlog item id")
    .argument("<n>", "the new rank", parseRank)
    .action(async (id: string, rank: number) => {
      cell.code = await withLedger("backlog rank", io, true, async (ctx, ops) => {
        io.stdout(summarize(await ops.rankItem(ctx, id, rank)));
      });
    });

  sub("merge", "fold one item into another; the source is discarded")
    .argument("<id>", "the source item, which is discarded")
    .requiredOption("--into <id>", "the target item, which gains the source's body")
    .action(async (id: string, options: { into: string }) => {
      cell.code = await withLedger("backlog merge", io, true, async (ctx, ops) => {
        const merged = await ops.mergeItems(ctx, id, options.into);
        io.stdout(summarize(merged.source));
        io.stdout(summarize(merged.target));
      });
    });

  sub("show", "print one item")
    .argument("<id>", "backlog item id")
    .option("--json", "emit the item as JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      cell.code = await withLedger("backlog show", io, false, async (ctx, ops) => {
        const found = ops.readItem(ctx.repoRoot, id);
        const item = found.frontmatter;
        if (options.json === true) {
          io.stdout(JSON.stringify({ id: item.id, item, body: found.body }, null, 2));
          return;
        }
        io.stdout(row(item));
        if (item.owner !== null && item.owner !== undefined) {
          io.stdout(`owner: ${item.owner.name} <${item.owner.email}>`);
        }
        if (item.area.length > 0) io.stdout(`area: ${item.area.join(", ")}`);
        const body = found.body.replace(/\n+$/, "");
        if (body !== "") io.stdout(`\n${body}`);
      });
    });

  sub("list", "print the backlog")
    .option("--status <list>", "comma-separated statuses to include")
    .option("--json", "emit the items as JSON")
    .action(async (options: { status?: string; json?: boolean }) => {
      cell.code = await withLedger("backlog list", io, false, async (ctx, ops) => {
        const statuses =
          options.status === undefined
            ? undefined
            : await readStatuses(options.status);
        const rows = ops.listItems(ctx.repoRoot, statuses);
        if (options.json === true) {
          io.stdout(JSON.stringify(rows, null, 2));
          return;
        }
        for (const entry of rows) io.stdout(row(entry.item));
      });
    });

  return program;
}

/**
 * Parse and run `argv` — the arguments `main.ts` passed through, with `backlog` already removed.
 *
 * @returns the process exit code.
 */
export async function backlogCommand(
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
