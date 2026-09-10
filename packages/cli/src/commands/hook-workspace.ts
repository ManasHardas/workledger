/**
 * The hook for a session started in a workspace folder — a non-git directory that holds repos
 * and that `workledger init --workspace <dir>` wrote hook files into (docs/contracts/p8/
 * daemon-and-api.md amendment 8, #105).
 *
 * Such a session belongs to no repo at `SessionStart`: it is recorded against the workspace on
 * a row with `workspace = 1` (`0006_workspaces`) and no ledger file. At `Stop`, once a threshold
 * is crossed, the transcript's touched paths decide which enabled repos the session worked in —
 * at least five references to a root, or one write under it — and the block asks for one
 * `workledger checkpoint --session <ulid> --repo <root>` per repo, most-touched first, each
 * against an ordinary session row and ledger file opened in that repo at that moment. Repos the
 * transcript never touched are never written to.
 *
 * Reached only by a lazy import from `hook.ts`, and only after the cheap hook-file check there,
 * so a repo session's allow path pays nothing for this file. The scanner runs on the block path
 * alone and only over the bytes since the last scan (`scan_offset`, `scan_counts`).
 */
import { statSync } from "node:fs";

import { loadConfig } from "../config.js";
import { EXIT_OK } from "../exit-codes.js";
import { workspaceCheckpointInstruction } from "../instruction.js";
import { isEnabled, listOpenBacklogIds } from "../ledger-fs.js";
import { meetsRule, scanTranscript } from "../onboarding/touched.js";
import { trackedReposUnder } from "./init-workspace.js";
import { END_REASON_MAP, createSession, describe, firstCrossed, minutesSince, patchFrontmatter } from "./hook.js";
import type { HookInput } from "../adapters/types.js";
import type { SessionRow } from "../index/db.js";
import type { TouchTally } from "../onboarding/touched.js";
import type { WorkspaceTarget } from "../instruction.js";
import type { HookEvent } from "./hook-events.js";
import type { Context, HookIo } from "./hook.js";

/** `scan_counts` parsed, or empty. */
function readCounts(row: SessionRow): Record<string, TouchTally> {
  if (row.scan_counts === null) return {};
  try {
    return JSON.parse(row.scan_counts) as Record<string, TouchTally>;
  } catch {
    return {};
  }
}

/** The roots the accumulated counts attribute the session to, most-referenced first. */
export function touchedRootsOf(counts: Record<string, TouchTally>): string[] {
  return Object.entries(counts)
    .filter(([, tally]) => meetsRule(tally))
    .sort(([a, ta], [b, tb]) => tb.refs - ta.refs || tb.writes - ta.writes || a.localeCompare(b))
    .map(([root]) => root);
}

/**
 * The whole workspace path of `hook`, after the guards `runHook` shares with the repo path.
 * The index is opened here, not earlier: the workspace check is the first thing that needs it.
 */
export async function runWorkspaceHook(event: HookEvent, io: HookIo, input: HookInput, workspace: string): Promise<number> {
  const { openIndex } = await import("../index/db.js");
  const home = io.env["WORKLEDGER_HOME"]?.trim();
  const db = openIndex(home ? { home } : {});
  try {
    // A folder with a hook file that `init --workspace` never registered is somebody else's.
    if (!db.isWorkspace(workspace)) return EXIT_OK;
    const now = io.now();
    const ctx: Context = {
      io,
      db,
      root: workspace,
      input,
      // No `.workledger/` in a workspace: the defaults, and `private_paths` cannot apply.
      config: loadConfig(workspace),
      private: io.env["WORKLEDGER_PRIVATE"] === "1",
      now,
      nowIso: now.toISOString(),
    };
    if (event === "SessionStart") return await sessionStart(ctx);
    if (event === "Stop") return await stop(ctx);
    return await sessionEnd(ctx);
  } finally {
    db.close();
  }
}

/** The workspace row for this harness session, if any. */
function workspaceRow(ctx: Context): SessionRow | undefined {
  return ctx.db.getSessionByHarnessId(ctx.io.adapter.harness, ctx.input.harnessSessionId, ctx.root);
}

/** `SessionStart`: open (or reopen) the workspace row. No brief — there is no repo to brief on. */
async function sessionStart(ctx: Context): Promise<number> {
  const { io, db, input } = ctx;
  const existing = workspaceRow(ctx);
  const size = io.adapter.transcriptSize(input.transcriptPath);
  if (existing !== undefined) {
    db.updateSession(existing.ulid, {
      status: "open",
      transcript_path: input.transcriptPath ?? existing.transcript_path,
      updated_at: ctx.nowIso,
    });
    return EXIT_OK;
  }
  const { newSessionId } = await import("@workledger/core/ids");
  db.insertSession({
    ulid: newSessionId(),
    repo_path: ctx.root,
    harness: io.adapter.harness,
    harness_session_id: input.harnessSessionId,
    status: "open",
    transcript_path: input.transcriptPath ?? null,
    private: ctx.private ? 1 : 0,
    last_offset: size ?? 0,
    last_checkpoint_at: ctx.nowIso,
    updated_at: ctx.nowIso,
    cwd: ctx.root,
    workspace: 1,
    // From the start of the file, not from `size`: attribution is a property of the whole
    // session, and a resumed transcript's earlier work is still this session's.
    scan_offset: 0,
  });
  return EXIT_OK;
}

/** `Stop`: the repo state machine's thresholds and block ladder, with the scan on the block path. */
async function stop(ctx: Context): Promise<number> {
  const { io, db, input } = ctx;
  const session = workspaceRow(ctx);
  if (session === undefined) return EXIT_OK;

  const ulid = session.ulid;
  const turnsTotal = session.turns_total + 1;
  const turnsSince = session.turns_since_checkpoint + 1;
  const transcript = input.transcriptPath ?? session.transcript_path ?? undefined;
  const size = io.adapter.transcriptSize(transcript);
  let offset = session.last_offset;
  if (size !== undefined && size < offset) {
    io.stderr(`workledger: hook Stop: transcript shrank from ${offset} to ${size} bytes; offset reset`);
    offset = size;
  }
  const measured = {
    bytes: size === undefined ? 0 : size - offset,
    minutes: minutesSince(session.last_checkpoint_at, ctx.now),
    turns: turnsSince,
  };
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
  if (ctx.private || input.stopHookActive || input.neverBlock) return allow();

  const blocks = session.blocks_since_checkpoint;
  if (blocks === 0) {
    const trigger = firstCrossed(measured, ctx.config.thresholds);
    if (trigger === undefined) return allow();
    // The scan, on the block path only, over the bytes since the last scan.
    const touched = await scan(ctx, session, transcript);
    if (touched.length === 0) return allow();
    const targets = await openTargets(ctx, touched, size);
    db.updateSession(ulid, {
      ...advance,
      blocks_since_checkpoint: 1,
      last_block_turn: turnsTotal,
      last_block_trigger: trigger,
      last_attempt_at: null,
      last_attempt_exit: null,
      last_attempt_errors: null,
    });
    return block(ctx, targets, undefined);
  }

  const targets = await openTargets(ctx, touchedRootsOf(readCounts(session)), size);
  if (blocks === 1) {
    const rows = targets.map((target) => db.getSessionByUlid(target.sessionId)).filter((row): row is SessionRow => row !== undefined);
    const failed = rows.find((row) => row.last_attempt_at !== null && (row.last_attempt_exit ?? 0) !== 0);
    if (failed !== undefined) {
      db.updateSession(ulid, { ...advance, blocks_since_checkpoint: 2 });
      return block(ctx, targets, failed.last_attempt_errors ?? undefined);
    }
    if (rows.length > 0 && rows.every((row) => row.last_attempt_at !== null && row.last_attempt_exit === 0)) {
      // Every touched repo got its checkpoint: the workspace row starts a fresh window.
      db.resetAfterCheckpoint(ulid, { offset: size ?? offset, at: ctx.nowIso });
      db.updateSession(ulid, { turns_total: turnsTotal, transcript_path: advance.transcript_path });
      return EXIT_OK;
    }
    db.updateSession(ulid, advance);
    if (turnsTotal - (session.last_block_turn ?? turnsTotal) >= ctx.config.thresholds.turns) {
      db.giveUp(ulid, { offset: size ?? offset, at: ctx.nowIso });
    }
    return EXIT_OK;
  }

  db.updateSession(ulid, advance);
  db.giveUp(ulid, { offset: size ?? offset, at: ctx.nowIso });
  return EXIT_OK;
}

/**
 * Scan the new bytes, fold them into the row, and return the touched enabled roots.
 *
 * The roots are every enabled repo the index knows plus every enabled repo under the workspace
 * itself — the index is a cache, and the folder's own repos are the ones a workspace exists for.
 * The scanner is `scanTranscript` from `scan_offset` to the file's current size; the tallies are
 * added to the row's `scan_counts`, so each Stop reads only what arrived since the last one.
 * Relative paths in the new bytes resolve against the workspace, the session's start directory.
 */
async function scan(ctx: Context, session: SessionRow, transcript: string | undefined): Promise<string[]> {
  const roots = [
    ...new Set([...ctx.db.listRepos().map((repo) => repo.repo_path).filter(isEnabled), ...trackedReposUnder(ctx.root)]),
  ];
  const counts = readCounts(session);
  if (transcript !== undefined && roots.length > 0) {
    try {
      const size = statSync(transcript).size;
      if (size > session.scan_offset) {
        const result = await scanTranscript(transcript, roots, { homeDir: ctx.io.homeDir, cwd: ctx.root, start: session.scan_offset });
        for (const [root, tally] of result.roots) {
          const entry = counts[root] ?? { refs: 0, writes: 0 };
          counts[root] = { refs: entry.refs + tally.refs, writes: entry.writes + tally.writes };
        }
        ctx.db.updateSession(session.ulid, { scan_offset: size, scan_counts: JSON.stringify(counts) });
      }
    } catch (error) {
      ctx.io.stderr(`workledger: hook Stop: transcript scan skipped (${describe(error)})`);
    }
  }
  return touchedRootsOf(counts).filter((root) => roots.includes(root));
}

/** One session row and ledger file per touched repo, opened on first use. */
async function openTargets(ctx: Context, roots: readonly string[], size: number | undefined): Promise<WorkspaceTarget[]> {
  const targets: WorkspaceTarget[] = [];
  for (const root of roots) {
    if (!isEnabled(root)) continue;
    const existing = ctx.db.getSessionByHarnessId(ctx.io.adapter.harness, ctx.input.harnessSessionId, root);
    const sessionId = existing?.ulid ?? (await createSession(ctx, size, root, { cwd: ctx.root }));
    targets.push({ sessionId, root, openIds: await listOpenBacklogIds(root) });
  }
  return targets;
}

/** Raise the block: the per-repo rows' attempt windows are opened, then the instruction. */
function block(ctx: Context, targets: WorkspaceTarget[], previousErrors: string | undefined): number {
  if (targets.length === 0) return EXIT_OK;
  for (const target of targets) {
    ctx.db.updateSession(target.sessionId, { last_attempt_at: null, last_attempt_exit: null, last_attempt_errors: null });
  }
  const reason = workspaceCheckpointInstruction({ targets, previousErrors });
  return ctx.io.adapter.blockStop(reason, { stdout: ctx.io.stdout, stderr: ctx.io.stderr });
}

/** `SessionEnd`: close the workspace row and every repo row it opened. */
async function sessionEnd(ctx: Context): Promise<number> {
  const { io, db, input } = ctx;
  const rows = db.listSessionsByHarnessId(io.adapter.harness, input.harnessSessionId);
  const workspace = rows.find((row) => row.workspace === 1 && row.repo_path === ctx.root);
  if (workspace === undefined) return EXIT_OK;
  const needsRepair = workspace.turns_since_checkpoint > ctx.config.stale_turns;
  const endReason = END_REASON_MAP[input.reason ?? "other"] ?? "unknown";
  for (const row of rows) {
    if (row.workspace === 0) {
      await patchFrontmatter(row.repo_path, row.ulid, (data) => {
        data["ended"] = ctx.nowIso;
        data["end_reason"] = endReason;
        data["status"] = "ended";
        data["needs_repair"] = needsRepair;
      });
    }
    db.updateSession(row.ulid, { status: "ended", updated_at: ctx.nowIso });
  }
  return EXIT_OK;
}
