# Hook contract — Claude Code (P1, frozen 2026-09-09)

Source: https://code.claude.com/docs/en/hooks, fetched 2026-09-09. Quotes are verbatim from that
fetch. Installed Claude Code on the reference machine at freeze time: 2.1.x (the adapter records
the version it was tested against in `doctor`).

## Configuration written by `workledger init` (project level)

Merged additively into `<repo>/.claude/settings.json`; existing hooks are preserved.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "workledger hook SessionStart", "timeout": 10 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "workledger hook Stop", "timeout": 10 } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "workledger hook SessionEnd", "timeout": 10 } ] }
    ]
  }
}
```

- `Stop` has no matcher support ("`Stop` | no matcher support"), so the group has no `matcher`.
- `SessionEnd` hooks "share a 1.5-second budget; if you set a longer per-hook timeout, Claude Code
  raises the budget to match, up to 60 seconds." The 10 s timeout raises it; the hook still targets
  well under 1 s.
- The command is resolved on `PATH`. If `workledger` is not installed the shell returns 127; Claude
  Code treats non-2 non-zero exits as a failed hook and proceeds. `init` writes the command as
  `command -v workledger >/dev/null && workledger hook <Event>` so an absent binary is a clean 0.

## Inputs consumed (stdin JSON)

| Event | Fields read | Ignored |
|---|---|---|
| `SessionStart` | `session_id`, `transcript_path`, `cwd`, `source` (`startup`, `resume`, `clear`, `compact`, `fork`), `model` (optional) | `permission_mode` |
| `Stop` | `session_id`, `transcript_path`, `cwd`, `stop_hook_active` | `last_assistant_message`, `permission_mode` |
| `SessionEnd` | `session_id`, `transcript_path`, `cwd`, `reason` (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`) | — |

Adapter rule: unknown fields are ignored; a missing required field logs one stderr line and exits 0.

## Outputs emitted

### SessionStart

Inject the brief as `additionalContext` (docs: "`additionalContext` from a SessionStart hook is
added to the initial system context before the first model call, and plain-text stdout is added
as a system message").

```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<brief text>" } }
```

The brief is prefixed with one line naming the session ulid so the agent can pass it to
`workledger checkpoint --session <ulid>` if the environment variable is unavailable. On
`source: compact` the hook re-injects the brief (context was rewritten); on `resume` and `fork` it
reuses the existing session record when the `session_id` is known, otherwise creates one.

### Stop

- **Allow**: exit 0, no stdout.
- **Block** (request a checkpoint): exit code 2 with the checkpoint instruction on stderr. Docs:
  "Exit code 2: Prevents Claude from stopping, continues the conversation" and "The blocking
  message is the reason from your JSON's blocking decision when it makes one, and your stderr
  text otherwise." The exit-code path is used because the JSON decision field name differs across
  documentation sections (`decision` vs `permissionDecision`); stderr-as-reason is stable.
- **Loop guard**: docs define `stop_hook_active` as "Boolean indicating whether a Stop hook has
  already blocked this attempt to stop." When it is `true`, the hook always allows (exit 0). This
  is in addition to the index-based never-twice guard.

### SessionEnd

No output. Exit 0 always.

## Timing budget

- Allow path (`Stop` with no threshold crossed): p95 < 100 ms including Node startup, measured by
  `packages/cli/test/hook-timing.test.ts`.
- `SessionStart`: < 300 ms (reads the ledger to build the brief).
- `SessionEnd`: < 200 ms.

## Environment

- `CLAUDE_PROJECT_DIR` is available to hook commands and is used as the repo root when present;
  `cwd` from the payload otherwise.
- The hook sets nothing in the agent's environment. The session ulid reaches `workledger
  checkpoint` through the index (`harness_session_id` → ulid lookup using `CLAUDE_SESSION_ID` if
  exposed, else the newest open session for the repo) or `--session`.

## Version drift

`workledger doctor` prints the installed Claude Code version next to the version this contract was
tested with, and warns on mismatch. A change in any consumed field or output shape is a contract
amendment PR, not a silent adapter patch.
