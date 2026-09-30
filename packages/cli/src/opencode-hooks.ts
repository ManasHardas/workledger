/**
 * OpenCode's extension point is not a hook file the way the other harnesses' is. It is a
 * **plugin**: a TypeScript module opencode loads from `.opencode/plugins/` at startup (verified
 * against opencode 1.18.33: `opencode debug config` resolves a local file there with
 * `plugin_origins … scope: local`). So `workledger init` writes one whole file, not a merge into
 * a shared config, and that file is workledger's own.
 *
 * The plugin is a translator, nothing more. OpenCode's event bus carries
 * `session.created`/`session.updated` (with `properties.info`), `session.idle` (with
 * `properties.sessionID`) and `session.deleted`; the plugin turns those into
 * `workledger hook <Event> --harness opencode` and feeds the payload the adapter reads. Every
 * ledger write still goes through the CLI — the plugin never touches `.workledger/`.
 *
 * The file is frozen in docs/contracts/p4/hooks-opencode.md; a change to the event names or the
 * payload is a contract amendment, not a patch here.
 */
import path from "node:path";

import { SettingsError, applyTextFile } from "./settings-merge.js";
import type { SettingsIo, SettingsOutcome } from "./settings-merge.js";

/** `.opencode/plugins/workledger.ts`, relative to the repo root. */
export const OPENCODE_PLUGIN_PATH = path.join(".opencode", "plugins", "workledger.ts");

/** The directory opencode scans for project plugins, relative to the repo root. */
export const OPENCODE_PLUGIN_DIR = path.join(".opencode", "plugins");

/**
 * The plugin source, byte-for-byte what `init` writes.
 *
 * Kept as one string rather than a template file so it ships inside the bundled CLI — the
 * published package has no data files (`scripts/check-pack.mjs`). It deliberately uses no
 * template literals or string interpolation of its own, so it stays readable inside this one.
 */
export const OPENCODE_PLUGIN_SOURCE = `/**
 * workledger's OpenCode plugin — written by \`workledger init\`. Commit it.
 *
 * It translates OpenCode's event bus into workledger hook invocations and asks the agent for a
 * checkpoint when one is due. It never writes the ledger itself; every write goes through
 * \`workledger checkpoint\` or the backlog commands. If the \`workledger\` binary is not on PATH
 * it does nothing, so a teammate who has not installed it is never inconvenienced.
 */
import { spawnSync } from "node:child_process"

const BIN = "workledger"

function hook(event: string, payload: Record<string, unknown>): { code: number; stdout: string; stderr: string } | undefined {
  const result = spawnSync(BIN, ["hook", event, "--harness", "opencode"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  })
  if (result.error || result.status === null) return undefined
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" }
}

async function inject(ctx: any, sessionID: string, text: string): Promise<void> {
  try {
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: { noReply: true, parts: [{ type: "text", text }] },
    })
  } catch {
    // Injection is best effort: a session that never receives the brief still records checkpoints.
  }
}

async function continueSession(ctx: any, sessionID: string, text: string): Promise<void> {
  try {
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text }] },
    })
  } catch {
    // A prompt that cannot be delivered is a missed checkpoint, never a wedged session.
  }
}

export const Workledger = async (ctx: any) => {
  const fallback = ctx.worktree || ctx.directory
  const started = new Set<string>()
  return {
    event: async ({ event }: any) => {
      try {
        const properties = event && event.properties ? event.properties : {}
        const info = properties.info || {}
        const sessionID: string | undefined = properties.sessionID || info.id
        if (!sessionID) return
        const cwd: string = info.directory || fallback

        if ((event.type === "session.created" || event.type === "session.updated") && !started.has(sessionID)) {
          started.add(sessionID)
          const result = hook("SessionStart", {
            session_id: sessionID,
            cwd,
            source: "startup",
            never_block: Boolean(info.parentID),
          })
          if (result && result.code === 0 && result.stdout.trim() !== "") {
            await inject(ctx, sessionID, result.stdout.trim())
          }
          return
        }

        if (event.type === "session.idle" && started.has(sessionID)) {
          const result = hook("Stop", { session_id: sessionID, cwd })
          if (result && result.code === 2 && result.stderr.trim() !== "") {
            await continueSession(ctx, sessionID, result.stderr.trim())
          }
          return
        }

        if (event.type === "session.deleted") {
          started.delete(sessionID)
          hook("SessionEnd", { session_id: sessionID, cwd, reason: "other" })
        }
      } catch {
        // A plugin must never break the session it observes.
      }
    },
  }
}
`;

/** The desired plugin text. A trailing newline is already part of {@link OPENCODE_PLUGIN_SOURCE}. */
export function opencodePluginSource(): string {
  return OPENCODE_PLUGIN_SOURCE;
}

/**
 * Write `<root>/.opencode/plugins/workledger.ts`.
 *
 * Whole-file, so there is no merge to perform and no shape to refuse; `applyTextFile` still
 * diffs, asks, and backs up, and leaves an already-correct file untouched.
 */
export async function mergeOpencodePluginFile(
  root: string,
  io: SettingsIo,
  ask: boolean,
): Promise<SettingsOutcome> {
  if (OPENCODE_PLUGIN_SOURCE.trim() === "") {
    throw new SettingsError("the OpenCode plugin source is empty");
  }
  return await applyTextFile(
    path.join(root, OPENCODE_PLUGIN_PATH),
    OPENCODE_PLUGIN_PATH,
    OPENCODE_PLUGIN_SOURCE,
    io,
    ask,
  );
}
