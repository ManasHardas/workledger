# Hook contract — Cursor (P4, frozen 2026-09-09)

Source: https://cursor.com/docs/hooks fetched 2026-09-09. Cursor is not installed on the reference
machine; the adapter is verified by unit tests over payloads synthesized from this contract, and the
Cursor CLI's headless resume is **not verified**, so P3 repair for Cursor sessions uses the
extraction path only until it is.

## Configuration written by `workledger init`

`<repo>/.cursor/hooks.json` (Cursor also reads `~/.cursor/hooks.json`):

```json
{
  "hooks": {
    "sessionStart": [ { "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook SessionStart --harness cursor; fi" } ],
    "stop":         [ { "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook Stop --harness cursor; fi", "loop_limit": 2 } ],
    "sessionEnd":   [ { "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook SessionEnd --harness cursor; fi" } ]
  }
}
```

Exact key names (`sessionStart`, `stop`, `sessionEnd`, `command`, `loop_limit`) are checked against
the docs at build time; `doctor` reports a mismatch.

## Inputs consumed

Universal fields on every hook: `conversation_id` (→ `harness_session_id`), `workspace_roots[0]`
(→ repo root), `user_email` (→ `author.email`, with `author.name` from git config), `transcript_path`
(string or null; null in cloud agents and when transcripts are disabled).

| Event | Fields read |
|---|---|
| `sessionStart` | `session_id`, `is_background_agent`, `composer_mode` |
| `stop` | `status`, `loop_count` |
| `sessionEnd` | `reason`, `duration_ms`, `is_background_agent` |

`is_background_agent: true` sessions are recorded with `private: false` but never blocked (no
`followup_message` on background agents).

## Outputs

- `sessionStart`: `{ "additional_context": "<brief>" }` (also `env` is available; unused).
- `stop` allow: exit 0, no output. Block: `{ "followup_message": "<checkpoint instruction>" }` on
  stdout; the instruction is the same text as Claude Code's. Cursor loops at most `loop_limit` (2)
  times, which matches the block/retry rule; `loop_count > 0` is treated like `stop_hook_active`.
- `sessionEnd`: nothing.

## Repair and backfill

No verified headless resume; `repair` on a Cursor session exits 5 with the message "Cursor sessions
can be repaired only by extraction; run with --extract". Backfill enumerates Cursor sessions only
when transcripts are enabled (the `transcript_path` directory is discoverable from a hook payload).
