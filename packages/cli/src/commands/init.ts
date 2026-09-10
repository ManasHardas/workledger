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
import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import { LEDGER_DIR, findRepoRoot, isEnabled } from "../ledger-fs.js";
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
  /**
   * Teammate onboarding for a repo that is *already* enabled and whose hook files arrived with
   * the clone — docs/contracts/p5/config-and-identities.md §CLI additions. Confirms the
   * identity, writes nothing, offers a backfill, and says so.
   */
  teammate?: boolean;
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

## If you cloned this repo

The hook files are committed, so the behaviour arrives with the clone and there is nothing to
wire up: install workledger, then run \`workledger init --teammate\` in your checkout. It confirms
the git identity your sessions will be recorded under, offers to backfill the sessions you have
already had in this repo, and leaves \`.claude/settings.json\` (and any other hook file) exactly
as the repo committed it. Until workledger is on your \`PATH\` the committed hook commands are a
silent no-op, so a teammate who never installs it is never inconvenienced by it.

Names instead of email addresses come from \`identities.yaml\` next to this file, which is
committed and shared; a person missing from it simply shows up as their git email.

## Conflicts

Every ledger write goes into one small file, so a conflict is an ordinary git conflict in one
file and not a merge of a database. Two people editing the *same* backlog item is the only case
that conflicts at all — sessions are named by ULID and never collide. Resolve it the way you
resolve any other conflict: keep both sets of \`history:\` entries, in timestamp order, and pick
one \`status:\`.

If the same work was filed twice — two people proposed it independently before either pulled —
that is not a conflict but a duplicate, and \`workledger backlog merge <id> --into <id>\` is the
tool for it: the source item is discarded, the target gains its body, and both files record why.
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


/**
 * `workledger init --teammate` — docs/contracts/p5/config-and-identities.md §CLI additions.
 *
 * The clone path. The repo is already enabled and its hook files came down with the checkout,
 * so the one thing that is *not* shared — which git identity this machine records sessions
 * under — is what this confirms, and the one thing that must not happen is a write to a hook
 * file the repo already owns. A teammate who ran plain `init` here would be offered a diff
 * against a settings file that is already correct; worse, on a repo whose hooks were hand-edited
 * after the merge, they would be offered the contract's version of them.
 *
 * "`init --teammate` in a repo that is not enabled exits 4 with 'run `workledger init`
 * instead'".
 */
export async function runTeammate(
  root: string,
  options: InitOptions,
  io: InitIo,
): Promise<number> {
  if (!isEnabled(root)) {
    io.stderr(`workledger init --teammate: ${root} is not an enabled repo; run \`workledger init\` instead`);
    return EXIT_NOT_ENABLED;
  }

  const identity = gitIdentity(root, io);
  if (identity.name === undefined || identity.email === undefined) {
    const missing = [
      identity.name === undefined ? "user.name" : undefined,
      identity.email === undefined ? "user.email" : undefined,
    ].filter((key): key is string => key !== undefined);
    io.stderr(
      `workledger init --teammate: git ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} empty in ${root}; ` +
        "set them so the ledger can record who did the work",
    );
    return EXIT_USAGE;
  }

  io.stdout(`workledger init --teammate: ${root}`);
  io.stdout(`  identity: ${identity.name} <${identity.email}>`);
  io.stdout("  hooks: committed with the repo; nothing was written");

  // The backfill offer. Declining is the common case — most people join a repo without a
  // history of their own in it — so it is a question rather than something `--teammate` does.
  if (options.backfill !== false) {
    const wanted =
      options.yes === true ||
      (await io.confirm(`Record digests for your own past sessions in ${root}?`));
    if (wanted) {
      const { backfillCommand } = await import("./backfill.js");
      const code = await backfillCommand({ repo: root, ...(options.yes === true ? { yes: true } : {}) });
      // A backfill that failed is reported and then let go: it is an offer made after the repo
      // was already usable, and its exit code is not this command's (cli.md §Exit codes).
      if (code !== EXIT_OK) io.stderr(`workledger init --teammate: backfill exited ${code}`);
    }
  }

  io.stdout("");
  await recordRepo(root, io);
  io.stdout("you are set — start a session in this repo and SessionStart injects the brief.");
  io.stdout("Run `workledger doctor` to confirm the hooks are live.");
  return EXIT_OK;
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

  // `--teammate` short-circuits every step below: the repo is already enabled and its hook
  // files are the repo's, not this machine's (P5 §CLI additions).
  if (options.teammate === true) return await runTeammate(root, options, io);

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
  await recordRepo(root, io);

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

/**
 * Record the repo in the index's `repos` table (`0003_repos.sql`), so `workledger serve` in
 * machine mode and the home page list it before any hook has run in it
 * (docs/contracts/p8/daemon-and-api.md §CLI). Best effort: the ledger on disk is what "enabled"
 * means, and an index that will not open is `doctor`'s finding, not a reason to fail `init`.
 */
async function recordRepo(root: string, io: InitIo): Promise<void> {
  const home = io.env["WORKLEDGER_HOME"]?.trim();
  try {
    const { openIndex } = await import("../index/db.js");
    const db = openIndex(home ? { home } : {});
    try {
      db.upsertRepo(root);
    } finally {
      db.close();
    }
  } catch (error) {
    io.stderr(`workledger init: could not record ${root} in the index (${error instanceof Error ? error.message : String(error)}); \`workledger serve\` lists it once a session runs`);
  }
}

/** @returns the process exit code. */
export async function initCommand(options: InitOptions): Promise<number> {
  return runInit(options, processInitIo());
}
