/**
 * `workledger init [--repo <path>] [--yes] [--no-backfill]` — docs/contracts/p1/cli.md §`init`,
 * steps 1–5, and plans/feature-p1-data-flow.md §1.
 *
 * The five steps in order: detect the harness, detect the git identity, scaffold `.workledger/`,
 * merge the hooks block into `.claude/settings.json`, print next steps. Nothing here is
 * destructive — an existing `.workledger/` file is left exactly as it is, and the settings merge
 * (`src/settings-merge.ts`) is additive, diffed, confirmed and backed up before it writes.
 *
 * Running it twice is the interesting case: when every file already exists and the hooks block
 * is already registered, `init` prints "already enabled" and exits 0 (cli.md §init: `"nothing to
 * do" is reported as exit 0`).
 *
 * The only refusal is an empty git identity. The ledger records *who* did the work in every
 * session's frontmatter, and a repo with no `user.name` / `user.email` would record "unknown"
 * forever — so step 2 stops rather than enabling a repo whose ledger cannot be attributed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import { configYaml } from "../config.js";
import { CODEX_HOOKS_PATH, mergeCodexHooksFile } from "../codex-hooks.js";
import { CURSOR_HOOKS_PATH, mergeCursorHooksFile } from "../cursor-hooks.js";
import { EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { LEDGER_DIR, findRepoRoot } from "../ledger-fs.js";
import { gitDir, parseIni } from "../git-info.js";
import { SETTINGS_PATH, SettingsError, mergeSettingsFile } from "../settings-merge.js";
import { isInstalled, probeCodex, probeCursor, probeHarness, processHealthIo } from "./doctor.js";
import type { HealthIo } from "./doctor.js";
import type { SettingsOutcome } from "../settings-merge.js";

/** Options commander parses for `init`. */
export interface InitOptions {
  /** Repo to enable; defaults to the repo root found by walking up from `cwd`. */
  repo?: string;
  /** Skip the confirmation prompt before the `.claude/settings.json` merge. */
  yes?: boolean;
  /** Accepted and ignored until P3. Commander sets this to `false` for `--no-backfill`. */
  backfill?: boolean;
  /**
   * Harnesses to enable regardless of what is detected on this machine — `--harness cursor` is
   * how a repo gets `.cursor/hooks.json` on a machine where Cursor is not installed but a
   * teammate's is. Detected harnesses are always enabled on top of these.
   */
  harness?: string[];
}

/** {@link HealthIo} plus the one thing only `init` needs: a way to ask. */
export interface InitIo extends HealthIo {
  /** Ask a yes/no question. `--yes` replaces this with a function that never prompts. */
  confirm: (question: string) => Promise<boolean>;
}

/** The real environment: `HealthIo` plus a readline prompt on the terminal. */
function processInitIo(): InitIo {
  return {
    ...processHealthIo(),
    confirm: async (question: string): Promise<boolean> => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = await rl.question(`${question} [y/N] `);
        return /^y(es)?$/i.test(answer.trim());
      } finally {
        rl.close();
      }
    },
  };
}

/**
 * The five lines cli.md step 5 requires `init` to print. They are the whole of workledger's
 * privacy posture, in the place an operator is deciding whether to enable it.
 */
export const PRIVACY_SUMMARY: readonly string[] = [
  "Nothing leaves this machine: workledger makes no network calls and sends no telemetry.",
  "Checkpoint digests and the backlog are written into `.workledger/` and committed with the repo.",
  "Transcript excerpts never enter the repo — only file sizes, offsets and turn counts are read.",
  "`WORKLEDGER_PRIVATE=1` marks a session private: a boundary record only, no brief, never a block.",
  "Every ledger write is secret-scanned first; a finding exits 3 and writes nothing.",
];

/** The `.workledger/README.md` `init` drops next to the ledger it creates. */
const LEDGER_README = `# .workledger

The ledger for this repo. It is the source of truth; \`~/.workledger/index.sqlite\` is only a
cache and can be rebuilt from these files.

- \`config.yaml\` — thresholds, brief budget and privacy knobs. See \`workledger doctor\`.
- \`sessions/<ulid>.md\` — one file per coding-agent session: frontmatter, Done, Notes.
- \`backlog/WL-<ulid>.md\` — one file per backlog item, with its history.

Agents never write these files directly; every write goes through \`workledger checkpoint\` or
the backlog commands, which validate and secret-scan first. Commit this directory.
`;

/** git's global config files, in the order git reads them (later wins). */
function globalGitConfigs(io: InitIo): string[] {
  const xdg = io.env["XDG_CONFIG_HOME"]?.trim();
  return [
    path.join(xdg !== undefined && xdg !== "" ? xdg : path.join(io.homeDir, ".config"), "git", "config"),
    path.join(io.homeDir, ".gitconfig"),
  ];
}

/**
 * `user.name` and `user.email` for `root`, repo config overriding the global one.
 *
 * Read out of git's own INI files rather than by spawning `git config`, the same choice
 * `src/git-info.ts` documents — and, unlike {@link import("../git-info.js").gitInfo}, this
 * reports an *absent* value as absent rather than as the string `unknown`, because step 2 has to
 * be able to refuse.
 */
export function gitIdentity(root: string, io: InitIo): { name?: string; email?: string } {
  const read = (file: string): string | undefined => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
  };
  const merged = new Map<string, string>();
  const dir = gitDir(root);
  for (const file of [...globalGitConfigs(io), ...(dir === undefined ? [] : [path.join(dir, "config")])]) {
    const text = read(file);
    if (text === undefined) continue;
    for (const [key, value] of parseIni(text)) merged.set(key, value);
  }
  const nonEmpty = (key: string): string | undefined => {
    const value = merged.get(key)?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  return { name: nonEmpty("user.name"), email: nonEmpty("user.email") };
}

/** Create `file` with `content` when it is absent. @returns `true` when it was created. */
function createIfAbsent(file: string, content: string): boolean {
  if (existsSync(file)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return true;
}

/** Everything step 3 creates, in the order it is reported. */
function scaffold(root: string, config: string): string[] {
  const ledger = path.join(root, LEDGER_DIR);
  const created: string[] = [];
  for (const dir of [ledger, path.join(ledger, "sessions"), path.join(ledger, "backlog")]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(`${path.relative(root, dir)}/`);
    }
  }
  const files: Array<[string, string]> = [
    [path.join(ledger, "config.yaml"), config],
    [path.join(ledger, "README.md"), LEDGER_README],
    // `backlog/` ships empty, and an empty directory does not survive `git add`; the ledger has
    // to reach a teammate's clone with the directory the checkpoint writer expects.
    [path.join(ledger, "backlog", ".gitkeep"), ""],
  ];
  for (const [file, content] of files) {
    if (createIfAbsent(file, content)) created.push(path.relative(root, file));
  }
  return created;
}

/** The command, with its environment injected. @returns the process exit code. */
export async function runInit(options: InitOptions, io: InitIo): Promise<number> {
  // Step 0: which repo. `--repo` is taken as given (resolved against cwd); without it the walk
  // from cli.md's preamble finds the nearest `.workledger/` or `.git/`.
  let root: string | undefined;
  if (options.repo !== undefined) {
    root = path.resolve(io.cwd, options.repo);
    if (!existsSync(root)) {
      io.stderr(`workledger init: ${root} does not exist`);
      return EXIT_USAGE;
    }
  } else {
    root = findRepoRoot(io.env["CLAUDE_PROJECT_DIR"]?.trim() || io.cwd);
    if (root === undefined) {
      io.stderr("workledger init: no .workledger/ or .git/ above the working directory; pass --repo");
      return EXIT_USAGE;
    }
  }

  // Step 1 — detect harnesses (metadata only; no transcript is ever opened).
  const forced = new Set((options.harness ?? []).map((name) => name.trim()).filter((name) => name !== ""));
  const probe = probeHarness(io);
  const codex = probeCodex(io);
  const cursor = probeCursor(io);
  // Claude Code's hooks are always written: it is the harness workledger was built against, and
  // an absent `claude` binary is a hook file that activates the day one is installed. The other
  // two are written when this machine has them, or when `--harness` names them.
  const enableCodex = isInstalled(codex) || forced.has("codex");
  const enableCursor = isInstalled(cursor) || forced.has("cursor");

  io.stdout(`workledger init: ${root}`);
  io.stdout(
    probe.binary === null
      ? "  claude-code: `claude` not found on PATH — the hooks are still written and activate once it is"
      : `  claude-code: ${probe.binary}${probe.version === null ? "" : ` (${probe.version})`}`,
  );
  io.stdout(
    probe.store_readable
      ? `  claude-code store: ${probe.store} — ${probe.projects ?? 0} project(s), last activity ${probe.last_activity ?? "unknown"}`
      : `  claude-code store: ${probe.store} not found`,
  );
  if (enableCodex) {
    io.stdout(
      codex.binary === null
        ? "  codex: `codex` not found on PATH — the hooks are still written and activate once it is"
        : `  codex: ${codex.binary}${codex.version === null ? "" : ` (${codex.version})`}`,
    );
    io.stdout(
      codex.store_readable
        ? `  codex store: ${codex.store} — ${codex.projects ?? 0} rollout(s), last activity ${codex.last_activity ?? "unknown"}`
        : `  codex store: ${codex.store} not found`,
    );
  }
  if (enableCursor) {
    io.stdout(`  cursor: ${cursor.binary ?? (cursor.store_readable ? cursor.store : "not found")}`);
  }

  // Step 2 — identity. The one refusal.
  const identity = gitIdentity(root, io);
  if (identity.name === undefined || identity.email === undefined) {
    const missing = [
      identity.name === undefined ? "user.name" : undefined,
      identity.email === undefined ? "user.email" : undefined,
    ].filter((key): key is string => key !== undefined);
    io.stderr(
      `workledger init: git ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} empty in ${root}; ` +
        "set them so the ledger can record who did the work",
    );
    return EXIT_USAGE;
  }
  io.stdout(`  identity: ${identity.name} <${identity.email}>`);

  // Step 3 — scaffold. `harnesses` records what this run enabled, so `doctor` reports a row for
  // each of them even on a machine where the harness is not installed.
  const harnesses = [
    "claude-code",
    ...(enableCodex ? ["codex"] : []),
    ...(enableCursor ? ["cursor"] : []),
  ];
  const created = scaffold(root, configYaml(harnesses));
  for (const entry of created) io.stdout(`  created ${entry}`);

  // Step 4 — the hook-file merges, the only writes outside `.workledger/`. One per enabled
  // harness, each additive, each diffed and confirmed before it writes.
  const ask = options.yes !== true;
  const merges: Array<[string, () => Promise<SettingsOutcome>]> = [
    [SETTINGS_PATH, () => mergeSettingsFile(root, io, ask)],
  ];
  if (enableCodex) merges.push([CODEX_HOOKS_PATH, () => mergeCodexHooksFile(root, io, ask)]);
  if (enableCursor) merges.push([CURSOR_HOOKS_PATH, () => mergeCursorHooksFile(root, io, ask)]);

  let allUnchanged = true;
  for (const [label, run] of merges) {
    let merge: SettingsOutcome;
    try {
      merge = await run();
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      io.stderr(`workledger init: ${error.message}`);
      return EXIT_USAGE;
    }
    if (merge.status === "declined") {
      io.stderr(`workledger init: declined; ${label} was not written`);
      return EXIT_USAGE;
    }
    if (merge.status === "written") {
      allUnchanged = false;
      io.stdout(`  wrote ${label}${merge.backup === undefined ? "" : ` (backup: ${path.basename(merge.backup)})`}`);
    }
  }

  if (created.length === 0 && allUnchanged) {
    io.stdout("already enabled");
    return EXIT_OK;
  }

  // Step 5 — next steps and the privacy summary.
  io.stdout("");
  io.stdout("Next steps:");
  const steps = [
    "Start a Claude Code session in this repo; SessionStart injects the brief.",
    // Codex will not run a project's hooks until the operator has trusted them once. `init`
    // cannot do it for them — the whole point of the prompt is that a person read the file —
    // so it names the step rather than leaving a silently inert hook file behind.
    ...(enableCodex
      ? [
          `Trust the hooks in ${CODEX_HOOKS_PATH}: Codex prompts once, on the next \`codex\` run in this repo. Until then it runs none of them.`,
        ]
      : []),
    "Run `workledger doctor` to confirm the hooks are live.",
    `Commit \`.workledger/\` and ${[SETTINGS_PATH, ...(enableCodex ? [CODEX_HOOKS_PATH] : []), ...(enableCursor ? [CURSOR_HOOKS_PATH] : [])].join(", ")}.`,
  ];
  steps.forEach((step, index) => io.stdout(`  ${index + 1}. ${step}`));
  io.stdout("");
  io.stdout("Privacy:");
  for (const line of PRIVACY_SUMMARY) io.stdout(`  · ${line}`);
  return EXIT_OK;
}

/** @returns the process exit code. */
export async function initCommand(options: InitOptions): Promise<number> {
  return runInit(options, processInitIo());
}
