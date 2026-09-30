# Hook contract — OpenCode (frozen 2026-09-29)

Source: `https://opencode.ai/docs/plugins/` and the installed reference `opencode 1.18.33`; the
plugin install path, the event names and the `session.idle` payload shape were all verified on
that build (`opencode debug config` resolves a local file under `.opencode/plugins/` with
`scope: local`; the binary carries the `session.created|idle|updated|deleted|error` event names).

OpenCode is the one harness with **no external hook command**. Its extension point is a plugin:
a TypeScript module it loads from a plugin directory at startup. So workledger does not merge a
hook block into a file OpenCode owns — it writes one whole file that is workledger's, and that
file talks back to the CLI.

## Configuration written by `workledger init` (project level)

`<repo>/.opencode/plugins/workledger.ts`, rendered from `src/opencode-hooks.ts`
(`OPENCODE_PLUGIN_SOURCE`). OpenCode scans `.opencode/plugins/` (plural) for project plugins and
loads every file there; no `opencode.json` entry is needed. The file is committed. If the
`workledger` binary is not on `PATH` the plugin does nothing, so a teammate who has not installed
it is never inconvenienced.

## The event translation

The plugin subscribes with OpenCode's generic `event` hook and translates three of its events:

| OpenCode event | workledger event | Payload the plugin sends |
|---|---|---|
| `session.created`, `session.updated` (first sighting) | `SessionStart` | `session_id` = `properties.info.id`, `cwd` = `properties.info.directory`, `source: "startup"`, `never_block` = `!!properties.info.parentID` |
| `session.idle` | `Stop` | `session_id` = `properties.sessionID`, `cwd` = the plugin's `worktree`/`directory` |
| `session.deleted` | `SessionEnd` | `session_id` = `properties.info.id` (or `properties.sessionID`), `cwd`, `reason: "other"` |

`parentID` marks an OpenCode **subagent** session. The plugin records it but sets `never_block`,
which the state machine reads as "nobody is at the keyboard": the session is counted and never
blocked (the same rule Cursor's background agents get).

Notes:

- `session.idle` carries `properties.sessionID` and nothing else; `session.created`/`updated`
  carry `properties.info` (the full session). That asymmetry is OpenCode's and is why `Stop` falls
  back to the plugin's own directory for `cwd`.
- `session.updated` fires often; the plugin keeps a per-process `Set` of session ids it has
  already started, so `SessionStart` runs once per session even though it is translated once per
  process (a restart re-translates the first sighting, which reuses the ledger row by
  `(harness, harness_session_id)`).
- There is no OpenCode event that cleanly means "the session ended"; `session.deleted` is the
  closest. A session that is simply abandoned is closed by the orphan scan, as with every harness.

## Inputs consumed

`session_id` (required — the payload is workledger's own, so a field is either present or the
plugin is older than the CLI), `cwd`, optional `source`, `model`, `stop_hook_active`, `reason`,
`never_block`, `user_email`.

**No `transcript_path`.** OpenCode keeps sessions, messages and parts in one SQLite database
(`~/.local/share/opencode/opencode.db`, WAL), not in a per-session JSONL. The plugin sends no
transcript path, which disables the **bytes** threshold for the session and marks provenance spans
unavailable; **turns** and **minutes** still apply, and the plugin fires `Stop` on every
`session.idle`, so turns accrue normally. A future provenance anchor for OpenCode's message/part
ids is a contract amendment.

## Outputs

- `SessionStart`: the brief as **plain text** on stdout. The plugin injects it with
  `client.session.prompt({ noReply: true, parts: [{ type: "text", text }] })`. Unlike the other
  harnesses there is no `hookSpecificOutput` envelope.
- `Stop` allow: exit 0, no output. Block: **exit 2 with the checkpoint instruction on stderr**.
  OpenCode has no deny-stop primitive, so the *plugin* reads the exit code and, on 2, sends the
  instruction back with `client.session.prompt({ parts: [{ type: "text", text }] })` — the
  `followup_message` analogue. The state machine's never-twice guard is what keeps this from
  looping.
- `SessionEnd`: nothing, exit 0.

## Store, discovery and backfill

`src/onboarding/stores.ts` `opencodeSessions()` opens `opencode.db` **read-only**
(`fileMustExist`, never migrated) and returns one entry per `session` row with the tool calls its
`part` rows carry, normalized to the scanner's shape (`write`→`Write`/`file_path`,
`read`→`Read`/`file_path`, `bash`→`Bash`/`command`, `grep`/`glob`→`Grep`/`pattern`+`path`). The
tool calls feed the same context inference as the other harnesses
(`touched.ts` `inferContextFromToolCalls`), so a session is attributed to the repos its writes and
path inputs name. Subagent sessions (`parent_id` set) are excluded from discovery and backfill.

## Headless resume (P3 repair and backfill)

`opencode run --session <SESSION_ID> "<instruction>"`, run in the session's start directory.

**Known difference from the other harnesses:** `opencode run` offers no `--allowedTools`
equivalent, so the resumed agent cannot be pinned to the checkpoint command; the instruction is
the only constraint. This is recorded here rather than hidden: a repair of an OpenCode session is
best-effort in the same sense Codex's untrusted hooks are. A restricted agent definition is the
obvious amendment if this proves unsafe in practice.

## Version drift

`doctor` records the OpenCode version tested (`1.18.x`) and warns on a newer minor/major. The
store schema is OpenCode's and migrates with it; `opencodeSessions()` reads only the columns it
uses and treats any failure as "no sessions" rather than guessing.
