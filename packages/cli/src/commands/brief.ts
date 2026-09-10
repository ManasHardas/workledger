/**
 * `workledger brief [--repo <path>] [--max-tokens <n>]` — docs/contracts/p1/cli.md §`brief`,
 * plans/feature-p1-data-flow.md §5.
 *
 * Two callers, one ledger reader. {@link readBriefInput} turns `.workledger/` into the
 * `BriefInput` `@workledger/core/brief` consumes, and both this command and the `SessionStart`
 * hook go through it — the hook adds the session ulid and its own `now`, this command adds
 * neither. That is what makes cli.md's "deterministic for a given ledger" a property rather than
 * a hope: `buildBrief` is a total function of its arguments and never reads a clock, so two runs
 * over an unchanged ledger emit the same bytes.
 *
 * `@workledger/core` is imported dynamically for the same reason it is everywhere else in this
 * package: this module is reached by an `await import()` from `commands/hook.ts`, whose Stop
 * allow path must not pay for zod and `yaml` (data-flow §6).
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { loadConfig } from "../config.js";
import { loadIdentities, resolveActor, resolveMaybe } from "../identities.js";
import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { findRepoRoot, isEnabled, ledgerPaths, readTextFile } from "../ledger-fs.js";
import type { BriefInput } from "@workledger/core/brief";

/** Options commander parses for `brief`. */
export interface BriefOptions {
  /** Repo to read; defaults to the repo root found by walking up from `cwd`. */
  repo?: string;
  /** Budget for the rendered brief; defaults to `brief.max_tokens` in `.workledger/config.yaml`. */
  maxTokens?: number;
}

/** Everything the command touches outside itself. */
export interface BriefIo {
  cwd: string;
  env: Record<string, string | undefined>;
  /** The brief itself; the newline is added here. */
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

/** The real environment. */
function processBriefIo(): BriefIo {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => void process.stdout.write(`${text}\n`),
    stderr: (line) => void process.stderr.write(`${line}\n`),
  };
}

/** The `.md` files in one ledger directory, or none when the directory is absent. */
function ledgerFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Read one repo's ledger into the shape `buildBrief` consumes.
 *
 * `buildBrief` does its own filtering, ordering and capping (data-flow §5), so every readable
 * file is handed over; a file that does not parse is skipped rather than thrown on — the same
 * rule `listOpenBacklogIds` follows, because one corrupt file must not cost a session its brief.
 */
export async function readBriefInput(root: string): Promise<BriefInput> {
  const [{ parseItem }, { parseSessionText }] = await Promise.all([
    import("@workledger/core/render/backlog"),
    import("@workledger/core/render/session"),
  ]);
  const paths = ledgerPaths(root);
  // P5: `.workledger/identities.yaml` maps a git email to a display name, and the brief's owner
  // column is the most visible place that shows. Applied to the *input* rather than inside
  // `buildBrief` so `@workledger/core` stays a pure function of what it is handed, and so the
  // injected brief and `workledger brief` cannot disagree about a name.
  const identities = loadIdentities(root, loadConfig(root));

  const backlog: BriefInput["backlog"] = [];
  for (const file of ledgerFiles(paths.backlog)) {
    const text = readTextFile(file);
    if (text === undefined) continue;
    try {
      const frontmatter = parseItem(text).frontmatter;
      backlog.push({
        frontmatter: {
          ...frontmatter,
          owner: resolveMaybe(frontmatter.owner, identities),
          confirmed_by: resolveMaybe(frontmatter.confirmed_by, identities),
        },
      });
    } catch {
      continue;
    }
  }

  const sessions: BriefInput["sessions"] = [];
  for (const file of ledgerFiles(paths.sessions)) {
    const text = readTextFile(file);
    if (text === undefined) continue;
    try {
      const parsed = parseSessionText(text);
      sessions.push({
        frontmatter: {
          ...parsed.frontmatter,
          author: resolveActor(parsed.frontmatter.author, identities),
        },
        done: parsed.done.map((line) => line.text),
        notes: parsed.notes.map((line) => ({ type: line.type, text: line.text, cp: line.cp })),
      });
    } catch {
      continue;
    }
  }

  return { backlog, sessions };
}

/** The command, with its environment injected. @returns the process exit code. */
export async function runBrief(options: BriefOptions, io: BriefIo): Promise<number> {
  const root = options.repo === undefined
    ? findRepoRoot(io.env["CLAUDE_PROJECT_DIR"]?.trim() || io.cwd)
    : path.resolve(io.cwd, options.repo);
  if (root === undefined || !isEnabled(root)) {
    io.stderr(
      `workledger brief: ${root ?? io.cwd} is not an enabled repo; run \`workledger init\``,
    );
    return EXIT_NOT_ENABLED;
  }

  const maxTokens = options.maxTokens ?? loadConfig(root).brief.max_tokens;
  const { buildBrief } = await import("@workledger/core/brief");
  let text: string;
  try {
    // No `now`: the `generated` line is opt-in, and `workledger brief` is contracted to be
    // byte-identical across runs on an unchanged ledger.
    text = buildBrief(await readBriefInput(root), { maxTokens });
  } catch (error) {
    io.stderr(`workledger brief: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }
  io.stdout(text);
  return EXIT_OK;
}

/** @returns the process exit code. */
export async function briefCommand(options: BriefOptions): Promise<number> {
  return runBrief(options, processBriefIo());
}
