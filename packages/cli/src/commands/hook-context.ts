/**
 * The block path of the Stop hook — docs/contracts/p8/daemon-and-api.md amendment 10 (#116)
 * and docs/contracts/p1/hooks-claude-code.md §Stop.
 *
 * Where a session was started says nothing about where its checkpoints belong; its content
 * does. When a Stop crosses a threshold, the transcript's tool inputs since the last scan are
 * tallied per enabled repo (`scan_offset`, `scan_counts`), the accumulated tallies are ranked
 * into the session's context repos (`rankContext`, the same rule discovery and the backfill
 * apply), and the block asks for one `workledger checkpoint --session <ulid> --repo <root>` per
 * context repo — each against a session row and ledger file opened in that repo. A repo-started
 * session whose content qualifies nothing falls back to its own repo, and a session about its
 * own repo alone gets the P1 block, byte for byte; a workspace-started session that qualifies
 * nothing is allowed. Repos the transcript never touched are never written to.
 *
 * Reached only by a lazy import from `hook.ts`, on the block ladder, so the Stop allow path
 * pays nothing for the scanner (the timing budget of hooks-claude-code.md).
 */
import { statSync } from "node:fs";

import { checkpointInstruction, workspaceCheckpointInstruction } from "../instruction.js";
import { isEnabled, listOpenBacklogIds } from "../ledger-fs.js";
import { emptyTally, rankContext, scanTranscript } from "../onboarding/touched.js";
import { trackedReposUnder } from "./init-workspace.js";
import { createSession, describe, patchFrontmatter } from "./hook.js";
import type { SessionRow } from "../index/db.js";
import type { WorkspaceTarget } from "../instruction.js";
import type { ContextRepo, TouchTally } from "../onboarding/touched.js";
import type { Context } from "./hook.js";

/** `scan_counts` parsed, or empty. */
export function readCounts(row: SessionRow): Record<string, TouchTally> {
  if (row.scan_counts === null) return {};
  try {
    return JSON.parse(row.scan_counts) as Record<string, TouchTally>;
  } catch {
    return {};
  }
}

/** `context_repos` parsed, or `undefined` when nothing has been inferred for the row. */
export function readContext(row: SessionRow): ContextRepo[] | undefined {
  if (row.context_repos === null) return undefined;
  try {
    return JSON.parse(row.context_repos) as ContextRepo[];
  } catch {
    return undefined;
  }
}

/**
 * The roots the session may be about: every enabled repo the index knows — the index is a
 * cache, and a repo that was never enabled has no ledger to file into — plus the session's own
 * repo, or the enabled repos under its workspace, which are what the folder exists for.
 */
function candidatesFor(ctx: Context, session: SessionRow): string[] {
  const own = session.workspace === 1 ? trackedReposUnder(ctx.root) : [ctx.root];
  return [...new Set([...ctx.db.listRepos().map((repo) => repo.repo_path), ...own])].filter(isEnabled);
}

/**
 * The context repos the accumulated tallies imply (amendment 10): {@link rankContext} over the
 * candidates, with the session's own repo as the start repo — a workspace-started session has
 * none — so the fallback and the tiebreak land there and nowhere else.
 */
export function contextOf(ctx: Context, session: SessionRow, counts: Record<string, TouchTally>, roots: readonly string[]): ContextRepo[] {
  const tallies = new Map(roots.map((root) => [root, counts[root] ?? emptyTally()]));
  return session.workspace === 1 ? rankContext(tallies, undefined, false) : rankContext(tallies, ctx.root, true);
}

/**
 * Scan the bytes since the last scan, fold them into the row, and infer the context repos.
 *
 * The scanner is `scanTranscript` from `scan_offset` to the file's current size; the tallies
 * are added to the row's `scan_counts`, so each Stop reads only what arrived since the last
 * one. Relative paths in the new bytes resolve against the session's start directory. The
 * inference is recorded as `context_repos` on the row and as `about` in the repo row's
 * frontmatter; a transcript that cannot be read leaves the counts as they were.
 */
export async function scanContext(ctx: Context, session: SessionRow, transcript: string | undefined): Promise<ContextRepo[]> {
  const roots = candidatesFor(ctx, session);
  const counts = readCounts(session);
  if (transcript !== undefined && roots.length > 0) {
    try {
      const size = statSync(transcript).size;
      if (size > session.scan_offset) {
        const result = await scanTranscript(transcript, roots, { homeDir: ctx.io.homeDir, cwd: session.start_dir ?? ctx.root, start: session.scan_offset });
        for (const [root, tally] of result.roots) {
          const entry = counts[root] ?? emptyTally();
          counts[root] = {
            references: entry.references + tally.references,
            writes: entry.writes + tally.writes,
            pathInputs: entry.pathInputs + tally.pathInputs,
          };
        }
        ctx.db.updateSession(session.ulid, { scan_offset: size, scan_counts: JSON.stringify(counts) });
      }
    } catch (error) {
      ctx.io.stderr(`workledger: hook Stop: transcript scan skipped (${describe(error)})`);
    }
  }
  const context = contextOf(ctx, session, counts, roots);
  ctx.db.updateSession(session.ulid, { context_repos: JSON.stringify(context) });
  if (session.workspace === 0) {
    await patchFrontmatter(ctx.root, session.ulid, (data) => {
      data["about"] = context.map((entry) => entry.root);
    });
  }
  return context;
}

/**
 * One session row and ledger file per context repo, opened on first use. The session's own
 * repo is the row the hook already has; another repo gets a row keyed by the same harness
 * session id, carrying the same start directory and inference, and a ledger file that says
 * where the session started and what it is about.
 */
export async function openTargets(ctx: Context, session: SessionRow, context: readonly ContextRepo[], size: number | undefined): Promise<WorkspaceTarget[]> {
  const targets: WorkspaceTarget[] = [];
  const about = context.map((entry) => entry.root);
  for (const { root } of context) {
    if (!isEnabled(root)) continue;
    const existing = ctx.db.getSessionByHarnessId(ctx.io.adapter.harness, ctx.input.harnessSessionId, root);
    let sessionId = existing?.ulid;
    if (sessionId === undefined) {
      sessionId = await createSession(ctx, size, root, {
        start_dir: session.start_dir ?? ctx.root,
        context_repos: JSON.stringify(context),
      });
      await patchFrontmatter(root, sessionId, (data) => {
        data["about"] = about;
      });
    }
    targets.push({ sessionId, root, openIds: await listOpenBacklogIds(root) });
  }
  return targets;
}

/**
 * The targets a block already opened, for the Stops after it: the rows the recorded
 * `context_repos` name, or — for a row from before the column — the ones its accumulated
 * counts imply, or the session's own repo. Nothing is opened here.
 */
export async function cachedTargets(ctx: Context, session: SessionRow): Promise<WorkspaceTarget[]> {
  const context = readContext(session) ?? contextOf(ctx, session, readCounts(session), candidatesFor(ctx, session));
  const targets: WorkspaceTarget[] = [];
  for (const { root } of context) {
    const row = ctx.db.getSessionByHarnessId(ctx.io.adapter.harness, ctx.input.harnessSessionId, root);
    if (row !== undefined) targets.push({ sessionId: row.ulid, root, openIds: await listOpenBacklogIds(root) });
  }
  if (targets.length === 0 && session.workspace === 0) {
    targets.push({ sessionId: session.ulid, root: ctx.root, openIds: await listOpenBacklogIds(ctx.root) });
  }
  return targets;
}

/**
 * Raise the block: every target row's attempt window is opened, then the instruction — the P1
 * text when the one target is the session's own repo, the per-repo list otherwise.
 */
export function raiseBlock(ctx: Context, targets: readonly WorkspaceTarget[], previousErrors: string | undefined): number {
  for (const target of targets) {
    ctx.db.updateSession(target.sessionId, { last_attempt_at: null, last_attempt_exit: null, last_attempt_errors: null });
  }
  const only = targets.length === 1 ? targets[0] : undefined;
  const reason =
    only !== undefined && only.root === ctx.root
      ? checkpointInstruction({ sessionId: only.sessionId, openIds: only.openIds, previousErrors })
      : workspaceCheckpointInstruction({ targets, previousErrors });
  return ctx.io.adapter.blockStop(reason, { stdout: ctx.io.stdout, stderr: ctx.io.stderr });
}
