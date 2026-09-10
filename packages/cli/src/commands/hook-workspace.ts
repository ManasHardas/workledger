/**
 * The hook for a session started in a workspace folder — a non-git directory that holds repos
 * and that `workledger init --workspace <dir>` wrote hook files into (docs/contracts/p8/
 * daemon-and-api.md amendments 8 and 10, #105, #116).
 *
 * Such a session belongs to no repo at `SessionStart`: it is recorded against the workspace on
 * a row with `workspace = 1` (`0007_workspaces`) and no ledger file. From there it is the repo
 * session's state machine (`hook.ts` `stop`, `sessionEnd`): at `Stop`, once a threshold is
 * crossed, the transcript's content decides which enabled repos the session is about
 * (`./hook-context.ts`), and the block asks for one `workledger checkpoint --session <ulid>
 * --repo <root>` per repo, each against an ordinary row and ledger file opened in that repo.
 * The one difference is the fallback: a workspace is no repo, so a session that qualifies
 * nothing is allowed rather than filed.
 *
 * Reached only by a lazy import from `hook.ts`, and only after the cheap hook-file check there,
 * so a repo session's allow path pays nothing for this file.
 */
import { loadConfig } from "../config.js";
import { EXIT_OK } from "../exit-codes.js";
import { sessionEnd, stop } from "./hook.js";
import type { HookInput } from "../adapters/types.js";
import type { SessionRow } from "../index/db.js";
import type { HookEvent } from "./hook-events.js";
import type { Context, HookIo } from "./hook.js";

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
      startDir: workspace,
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
    start_dir: ctx.root,
    workspace: 1,
    // From the start of the file, not from `size`: attribution is a property of the whole
    // session, and a resumed transcript's earlier work is still this session's.
    scan_offset: 0,
  });
  return EXIT_OK;
}
