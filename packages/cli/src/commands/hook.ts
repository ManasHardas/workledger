/**
 * `workledger hook <SessionStart|Stop|SessionEnd>` — docs/contracts/p1/cli.md §`workledger hook`
 * and docs/contracts/p1/hooks-claude-code.md.
 *
 * The session state machine of `plans/feature-p1-data-flow.md` §2, and nothing else: the wire
 * format lives in `src/adapters/`, the block text in `src/instruction.ts`, the counters in
 * `src/index/db.ts`, the atomic writes in `src/ledger-fs.ts`, the rendering in
 * `@workledger/core`.
 *
 * Two properties this file is built around:
 *
 * **It fails open.** Every path is inside one `try`; any exception becomes a single stderr line
 * prefixed `workledger:` and exit 0 (data-flow §7). The one deliberate non-zero exit is the Stop
 * block's 2. A hook that throws is a hook that wedges a session.
 *
 * **The Stop allow path is cheap.** It has a p95 budget of 100 ms *including Node startup*
 * (data-flow §6), against ~40 ms of bare Node. So: the module's static imports reach nothing
 * heavier than `node:fs`; `better-sqlite3` arrives through the lazy `import("../index/db.js")`
 * below, after the disable / not-enabled checks have had their chance to return; and
 * `@workledger/core` — ~30 ms of zod schema construction plus `yaml` — is imported only on the
 * paths that render something, always off a deep specifier rather than the barrel.
 * `packages/cli/test/hook-timing.test.ts` measures it and asserts core stays out.
 */
import process from "node:process";
import os from "node:os";

import { DEFAULT_HARNESS, adapterFor } from "../adapters/registry.js";
import { isPrivatePath, loadConfig } from "../config.js";
import { EXIT_OK } from "../exit-codes.js";
import { checkpointInstruction } from "../instruction.js";
import {
  findRepoRoot,
  isEnabled,
  listOpenBacklogIds,
  readTextFile,
  sessionFile,
  writeFileAtomic,
} from "../ledger-fs.js";
import { HOOK_EVENTS } from "./hook-events.js";
import type { HarnessAdapter, HookInput } from "../adapters/types.js";
import type { HookConfig } from "../config.js";
import type { IndexDb } from "../index/db.js";
import type { HookEvent } from "./hook-events.js";

export { HOOK_EVENTS };
export type { HookEvent };

/**
 * Everything the command touches outside itself, so the state machine can be driven from a test
 * worker against a temp repo and a temp `WORKLEDGER_HOME` — and so the two sources of
 * nondeterminism, the clock and the ULID factory, are inputs rather than ambient facts.
 */
export interface HookIo {
  /** The raw hook JSON. Read lazily: `WORKLEDGER_DISABLE` returns before stdin is touched. */
  readStdin: () => Promise<string>;
  /** One stdout line; the newline is added here. Only `SessionStart` writes any. */
  stdout: (line: string) => void;
  /** One stderr line; the newline is added here. */
  stderr: (line: string) => void;
  /** Where the repo-root walk starts when neither `CLAUDE_PROJECT_DIR` nor `cwd` is usable. */
  cwd: string;
  /** The process environment, read for the three `WORKLEDGER_*` knobs and `CLAUDE_PROJECT_DIR`. */
  env: Record<string, string | undefined>;
  /** The user's home directory — `~` in `private_paths`, and git's global config. */
  homeDir: string;
  now: () => Date;
  /** The harness whose wire format this invocation speaks. */
  adapter: HarnessAdapter;
}

/** The real environment, speaking one harness's wire format. */
function processIo(adapter: HarnessAdapter): HookIo {
  return {
    readStdin: () => readAll(process.stdin),
    stdout: (line) => void process.stdout.write(`${line}\n`),
    stderr: (line) => void process.stderr.write(`${line}\n`),
    cwd: process.cwd(),
    env: process.env,
    homeDir: os.homedir(),
    now: () => new Date(),
    adapter,
  };
}

/** Hook payloads are small; the whole stream is read before anything is parsed. */
async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** `reason` on the wire → the ledger's `end_reason` enum (data-flow §2). */
export const END_REASON_MAP: Readonly<Record<string, string>> = {
  prompt_input_exit: "clean",
  clear: "clear",
  resume: "resume",
  logout: "logout",
  other: "unknown",
};

/** Which threshold a Stop crossed, in the contract's precedence order: bytes, minutes, turns. */
export function firstCrossed(
  measured: { bytes: number; minutes: number; turns: number },
  thresholds: { bytes: number; minutes: number; turns: number },
): "bytes" | "minutes" | "turns" | undefined {
  if (measured.bytes >= thresholds.bytes) return "bytes";
  if (measured.minutes >= thresholds.minutes) return "minutes";
  if (measured.turns >= thresholds.turns) return "turns";
  return undefined;
}

/** Whole minutes between two ISO instants; `0` when `from` is missing or unparseable. */
export function minutesSince(from: string | null, now: Date): number {
  if (from === null) return 0;
  const started = Date.parse(from);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, (now.getTime() - started) / 60000);
}

/**
 * Read `sessions/<ulid>.md`, hand its frontmatter mapping to `mutate`, and write the file back
 * atomically.
 *
 * The mapping is the one `parseFrontmatter` read — unknown keys and key order intact — so a
 * hook write never drops a field a later schema version added. A missing or unparseable file is
 * a no-op rather than an error: the ledger file is the source of truth, and a hook must not be
 * the thing that destroys one it could not read (data-flow §3).
 *
 * @returns `true` when the file was rewritten.
 */
async function patchFrontmatter(
  root: string,
  ulid: string,
  mutate: (data: Record<string, unknown>) => void,
): Promise<boolean> {
  const file = sessionFile(root, ulid);
  const text = readTextFile(file);
  if (text === undefined) return false;
  const { parseFrontmatter, stringifyFrontmatter } = await import("@workledger/core/frontmatter");
  let parsed;
  try {
    parsed = parseFrontmatter(text);
  } catch {
    return false;
  }
  mutate(parsed.data);
  writeFileAtomic(file, stringifyFrontmatter(parsed.data, parsed.body));
  return true;
}

// ---------------------------------------------------------------------------
// SessionStart
// ---------------------------------------------------------------------------

/** What every event handler is handed once the guards have run. */
interface Context {
  io: HookIo;
  db: IndexDb;
  /** The enabled repo root. */
  root: string;
  input: HookInput;
  config: HookConfig;
  /** `WORKLEDGER_PRIVATE=1` or a `private_paths` match: boundary record only, never a block. */
  private: boolean;
  now: Date;
  nowIso: string;
}

/**
 * `SessionStart` — data-flow §2.
 *
 * `startup` and `clear` mint a new ulid, `resume`, `fork` and `compact` reuse the row the index
 * already has for this `(harness, harness_session_id)`. A `startup` whose id the index *does*
 * know is reuse too, and not by preference: `(harness, harness_session_id)` is unique, so the
 * only alternative to reuse is a constraint violation. In practice it is the hook firing twice
 * for one session, and reuse is what makes that idempotent.
 */
async function sessionStart(ctx: Context): Promise<number> {
  const { io, db, input } = ctx;
  const harness = io.adapter.harness;
  const existing = db.getSessionByHarnessId(harness, input.harnessSessionId);
  const size = io.adapter.transcriptSize(input.transcriptPath);

  let ulid: string;
  if (existing !== undefined) {
    ulid = existing.ulid;
    // `compact` rewrote the context but changed nothing about the session; `resume` and `fork`
    // pick it back up. Counters are left exactly where they were (data-flow §2).
    db.updateSession(ulid, {
      status: "open",
      transcript_path: input.transcriptPath ?? existing.transcript_path,
      updated_at: ctx.nowIso,
    });
  } else {
    ulid = await createSession(ctx, size);
  }

  if (ctx.private) return EXIT_OK;

  if (ctx.config.brief.inject) {
    const brief = await buildSessionBrief(ctx, ulid);
    if (brief !== undefined) {
      const payload = io.adapter.injectContext(brief);
      if (payload !== undefined) io.stdout(payload);
    }
  }

  await opportunisticScan(ctx, ulid);
  return EXIT_OK;
}

/** At most this many open sessions are examined by the `SessionStart` sweep (cli.md §scan). */
export const OPPORTUNISTIC_SCAN_LIMIT = 20;
/** And it gives up after this long, whether or not it got through them. */
export const OPPORTUNISTIC_SCAN_MS = 200;

/**
 * The orphan sweep, run off the back of a `SessionStart` — cli.md §`workledger scan`: "Also runs
 * opportunistically inside `hook SessionStart` (bounded to 200 ms, at most 20 sessions)".
 *
 * A crash leaves no event behind, so without this a repo would only ever notice its orphans when
 * someone typed `workledger scan`. Starting a new session is the moment the previous one's death
 * became certain, which is what makes this the right hook to hang it on.
 *
 * Three things keep it off the hook's critical path: the caps, the fact that it runs *after* the
 * brief has already been written to stdout, and this catch. A hook that failed here would wedge
 * a session over bookkeeping for sessions that are already over.
 */
async function opportunisticScan(ctx: Context, ulid: string): Promise<void> {
  try {
    const { newSessionId } = await import("@workledger/core/ids");
    const { runScan } = await import("./scan.js");
    await runScan({
      db: ctx.db,
      root: ctx.root,
      now: ctx.io.now,
      newId: newSessionId,
      limit: OPPORTUNISTIC_SCAN_LIMIT,
      budgetMs: OPPORTUNISTIC_SCAN_MS,
      // The session this hook is starting is alive by construction.
      skipUlid: ulid,
    });
  } catch (error) {
    ctx.io.stderr(`workledger: hook SessionStart: scan skipped (${describe(error)})`);
  }
}

/** Mint the ulid, write the session file, and open the index row. */
async function createSession(ctx: Context, size: number | undefined): Promise<string> {
  const { io, db, root, input, nowIso } = ctx;
  const [{ newSessionId }, { SCHEMA_VERSION }, { createSessionText }, { gitInfo }] =
    await Promise.all([
      import("@workledger/core/ids"),
      import("@workledger/core/schema"),
      import("@workledger/core/render/session"),
      import("../git-info.js"),
    ]);

  const ulid = newSessionId();
  const git = gitInfo(root, io.homeDir);
  // A harness that reports the signed-in user's address knows something git config does not:
  // whose session this actually was. Cursor's `user_email` is the only such field in P4
  // (docs/contracts/p4/hooks-cursor.md §Inputs consumed); `author.name` still comes from git.
  const author =
    input.userEmail === undefined ? git.author : { ...git.author, email: input.userEmail };
  const text = createSessionText({
    schema_version: SCHEMA_VERSION,
    id: ulid,
    harness: io.adapter.harness as "claude-code",
    harness_session_id: input.harnessSessionId,
    repo: git.repo,
    branch: git.branch,
    author,
    started: nowIso,
    status: "open",
    private: ctx.private,
    // `source` is the ledger's provenance enum (`live` vs `backfill`), not the hook's
    // `startup | resume | …`; a hook-observed session is always `live`.
    source: "live",
    model: input.model ?? null,
    needs_repair: false,
    checkpoint_failures: 0,
    checkpoints: [],
  });
  writeFileAtomic(sessionFile(root, ulid), text);

  db.insertSession({
    ulid,
    repo_path: root,
    harness: io.adapter.harness,
    harness_session_id: input.harnessSessionId,
    status: "open",
    transcript_path: input.transcriptPath ?? null,
    private: ctx.private ? 1 : 0,
    // Bytes are counted from wherever the transcript already is, so a resumed transcript's
    // history is not billed to this session's first Stop.
    last_offset: size ?? 0,
    // The instant `minutes_since` is measured from until the first checkpoint lands. §2 defines
    // it as `now - max(last_checkpoint_at, started)`; seeding the column with `started` is that
    // maximum with no second column to keep in step.
    last_checkpoint_at: nowIso,
    updated_at: nowIso,
  });
  return ulid;
}

/**
 * The brief, with the session ulid on its first line so the agent can pass it to
 * `workledger checkpoint --session <ulid>` (hooks-claude-code.md §Outputs emitted).
 *
 * Built without a `now`: `buildBrief` stamps a `generated` line only when it is given one, and
 * an unchanged ledger should produce a byte-identical injection. The ledger read is
 * `commands/brief.ts`'s `readBriefInput`, shared with `workledger brief` so the injected text
 * and the printed one cannot drift apart.
 */
async function buildSessionBrief(ctx: Context, ulid: string): Promise<string | undefined> {
  const [{ buildBrief }, { readBriefInput }] = await Promise.all([
    import("@workledger/core/brief"),
    import("./brief.js"),
  ]);
  const input = await readBriefInput(ctx.root);

  try {
    return buildBrief(input, { maxTokens: ctx.config.brief.max_tokens, sessionId: ulid });
  } catch (error) {
    // A `max_tokens` below the brief's floor is a config problem, not a reason to fail the hook.
    ctx.io.stderr(`workledger: hook SessionStart: brief not injected (${describe(error)})`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

/**
 * `Stop` — data-flow §2, exactly.
 *
 * Every branch ends in exit 0 except the two blocks, which are exit 2 with the instruction on
 * stderr. The counters are advanced on every branch, including the blocks, so a session that is
 * never checkpointed still has an honest `turns_total` for `SessionEnd`'s `needs_repair`.
 */
async function stop(ctx: Context): Promise<number> {
  const { io, db, input } = ctx;
  const session = db.getSessionByHarnessId(io.adapter.harness, input.harnessSessionId);
  // No SessionStart was seen for this id (a session that predates `init`, or a lost index).
  // There is nothing to count against and nothing to checkpoint into: allow.
  if (session === undefined) return EXIT_OK;

  const ulid = session.ulid;
  const turnsTotal = session.turns_total + 1;
  const turnsSince = session.turns_since_checkpoint + 1;

  const size = io.adapter.transcriptSize(input.transcriptPath ?? session.transcript_path ?? undefined);
  let offset = session.last_offset;
  if (size !== undefined && size < offset) {
    // The harness rotated or truncated the transcript. Measuring `size - offset` now would give
    // a negative delta forever; the offset restarts from the file's real size (data-flow §2).
    io.stderr(
      `workledger: hook Stop: transcript shrank from ${offset} to ${size} bytes; offset reset`,
    );
    offset = size;
  }

  const measured = {
    bytes: size === undefined ? 0 : size - offset,
    minutes: minutesSince(session.last_checkpoint_at, ctx.now),
    turns: turnsSince,
  };

  /** The counter advance every branch shares. */
  const advance = {
    turns_total: turnsTotal,
    turns_since_checkpoint: turnsSince,
    last_offset: offset,
    transcript_path: input.transcriptPath ?? session.transcript_path,
    updated_at: ctx.nowIso,
  };

  const allow = (): number => {
    db.updateSession(ulid, advance);
    return EXIT_OK;
  };

  // A private session records boundaries only; `stop_hook_active` is the harness telling us a
  // Stop hook has already blocked this attempt — the documented loop guard, which is in addition
  // to the index's never-twice rule (hooks-claude-code.md §Outputs emitted → Stop); and
  // `neverBlock` is a session nobody is watching, so a block would be a prompt into an empty
  // room (Cursor background agents, hooks-cursor.md §Inputs consumed).
  if (ctx.private || input.stopHookActive || input.neverBlock) return allow();

  const blocks = session.blocks_since_checkpoint;

  if (blocks === 0) {
    const trigger = firstCrossed(measured, ctx.config.thresholds);
    if (trigger === undefined) return allow();
    db.updateSession(ulid, {
      ...advance,
      blocks_since_checkpoint: 1,
      last_block_turn: turnsTotal,
      last_block_trigger: trigger,
      // The block opens a fresh attempt window: an older failure belongs to a cycle that is
      // over, and leaving it would make the very next Stop read `last_attempt_exit != 0` and
      // raise the retry block for an attempt this block never asked for.
      last_attempt_at: null,
      last_attempt_exit: null,
      last_attempt_errors: null,
    });
    return await block(ctx, ulid, undefined);
  }

  if (blocks === 1) {
    // `last_attempt_*` were cleared when the block was raised, so a row here is by definition an
    // attempt made *since* it.
    if (session.last_attempt_at !== null && (session.last_attempt_exit ?? 0) !== 0) {
      db.updateSession(ulid, { ...advance, blocks_since_checkpoint: 2 });
      return await block(ctx, ulid, session.last_attempt_errors ?? undefined);
    }
    // Either the agent ignored the block, or its attempt succeeded — in which case `checkpoint`
    // already reset `blocks_since_checkpoint` to 0 and we would not be here. Allow, and keep
    // counting: `blocks_since` stays 1, so no further block until a checkpoint lands or the
    // give-up rule below fires.
    db.updateSession(ulid, advance);
    const ignoredFor = turnsTotal - (session.last_block_turn ?? turnsTotal);
    if (ignoredFor >= ctx.config.thresholds.turns) {
      // The block was ignored for a full turn threshold. Start over — without touching
      // `checkpoint_failures`, because no attempt was made to fail (data-flow §2, give-up rule).
      db.giveUp(ulid, { offset: size ?? offset, at: ctx.nowIso });
    }
    return EXIT_OK;
  }

  // blocks >= 2: the block was raised, the attempt failed, the retry failed too. Give up for
  // now — thresholds must re-accumulate before another block, so a block is never immediately
  // repeated — and record the failure where an operator will see it.
  db.updateSession(ulid, advance);
  db.giveUp(ulid, { offset: size ?? offset, at: ctx.nowIso });
  await patchFrontmatter(ctx.root, ulid, (data) => {
    const current = data["checkpoint_failures"];
    data["checkpoint_failures"] = (typeof current === "number" ? current : 0) + 1;
  });
  return EXIT_OK;
}

/** Raise a block: exit 2 with the instruction on stderr, never a JSON decision field. */
async function block(ctx: Context, ulid: string, previousErrors: string | undefined): Promise<number> {
  const openIds = await listOpenBacklogIds(ctx.root);
  const reason = checkpointInstruction({ sessionId: ulid, openIds, previousErrors });
  return ctx.io.adapter.blockStop(reason, { stdout: ctx.io.stdout, stderr: ctx.io.stderr });
}

// ---------------------------------------------------------------------------
// SessionEnd
// ---------------------------------------------------------------------------

/** `SessionEnd` — data-flow §2. No output, exit 0 always. */
async function sessionEnd(ctx: Context): Promise<number> {
  const { io, db, input } = ctx;
  const session = db.getSessionByHarnessId(io.adapter.harness, input.harnessSessionId);
  if (session === undefined) return EXIT_OK;

  // `needs_repair` is a turn count, never a content read: a session that stopped many turns
  // after its last checkpoint has work the ledger does not describe (data-flow §2).
  const needsRepair = session.turns_since_checkpoint > ctx.config.stale_turns;
  const endReason = END_REASON_MAP[input.reason ?? "other"] ?? "unknown";

  await patchFrontmatter(ctx.root, session.ulid, (data) => {
    data["ended"] = ctx.nowIso;
    data["end_reason"] = endReason;
    data["status"] = "ended";
    data["needs_repair"] = needsRepair;
  });

  db.updateSession(session.ulid, { status: "ended", updated_at: ctx.nowIso });
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** The message of a thrown value, without a stack and without quoting a payload. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The whole command, with its environment injected.
 *
 * @returns the process exit code: 2 for a Stop block, 0 for everything else including failure.
 */
export async function runHook(event: HookEvent, io: HookIo): Promise<number> {
  try {
    // Before stdin, before the index, before anything: cli.md §Global environment says every
    // `hook` invocation exits 0 immediately with no output.
    if (io.env["WORKLEDGER_DISABLE"] === "1") return EXIT_OK;

    const parsed = io.adapter.parseHookInput(event, await io.readStdin());
    if ("message" in parsed) {
      io.stderr(parsed.message);
      return EXIT_OK;
    }

    // `CLAUDE_PROJECT_DIR` is set for hook commands and is the repo root when present; the
    // payload's `cwd` otherwise (hooks-claude-code.md §Environment).
    const from = io.env["CLAUDE_PROJECT_DIR"]?.trim() || parsed.cwd || io.cwd;
    const root = findRepoRoot(from);
    // Not a repo, or a repo nobody ran `workledger init` in. Silence is the contract: a hook
    // that printed here would print on every turn of every unrelated session.
    if (root === undefined || !isEnabled(root)) return EXIT_OK;

    const config = loadConfig(root);
    const isPrivate =
      io.env["WORKLEDGER_PRIVATE"] === "1" ||
      isPrivatePath(root, config.private_paths, io.homeDir);

    // The first module that costs anything: `better-sqlite3` is a native addon, and the three
    // returns above are the ones that must not pay for it.
    const { openIndex } = await import("../index/db.js");
    const home = io.env["WORKLEDGER_HOME"]?.trim();
    const db = openIndex(home ? { home } : {});
    const now = io.now();
    const ctx: Context = {
      io,
      db,
      root,
      input: parsed,
      config,
      private: isPrivate,
      now,
      nowIso: now.toISOString(),
    };
    try {
      if (event === "SessionStart") return await sessionStart(ctx);
      if (event === "Stop") return await stop(ctx);
      return await sessionEnd(ctx);
    } finally {
      db.close();
    }
  } catch (error) {
    io.stderr(`workledger: hook ${event}: ${describe(error)}`);
    return EXIT_OK;
  }
}

/** Options commander parses for `hook`. */
export interface HookOptions {
  /** Which harness's wire format stdin speaks. Defaults to `claude-code`. */
  harness?: string;
}

/**
 * @returns the process exit code.
 *
 * An unknown `--harness` is one stderr line and exit 0, not a usage error: the flag is written
 * into a hook file that outlives the CLI that wrote it, and a hook that failed loudly because the
 * binary was downgraded would wedge every session in the repo.
 */
export async function hookCommand(event: HookEvent, options: HookOptions = {}): Promise<number> {
  const name = options.harness?.trim() || DEFAULT_HARNESS;
  const adapter = adapterFor(name);
  if (adapter === undefined) {
    process.stderr.write(`workledger: hook ${event}: unknown harness ${name}; allowing\n`);
    return EXIT_OK;
  }
  return runHook(event, processIo(adapter));
}
