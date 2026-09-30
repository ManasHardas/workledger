/**
 * workledger's OpenCode plugin — written by `workledger init`. Commit it.
 *
 * It translates OpenCode's event bus into workledger hook invocations and asks the agent for a
 * checkpoint when one is due. It never writes the ledger itself; every write goes through
 * `workledger checkpoint` or the backlog commands. If the `workledger` binary is not on PATH
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
