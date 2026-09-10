# Hook contract — Codex CLI (P4, frozen 2026-09-09)

Source: https://learn.chatgpt.com/docs/hooks fetched 2026-09-09; installed reference `codex-cli 0.150.1`.
Docs state: "The transcript format isn't a stable interface for hooks and may change over time."
workledger never parses the transcript on the live path; it reads its size only.

## Configuration written by `workledger init` (project level)

`<repo>/.codex/hooks.json` (Codex also reads `~/.codex/hooks.json` and `config.toml`). Codex
requires the user to **trust** project hooks once; `init` prints that step. Same three-event shape
as Claude Code, with the harness flag:

```json
{
  "hooks": {
    "SessionStart": [ { "hooks": [ { "type": "command", "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook SessionStart --harness codex; fi", "timeout": 10 } ] } ],
    "Stop":         [ { "hooks": [ { "type": "command", "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook Stop --harness codex; fi", "timeout": 10 } ] } ],
    "SessionEnd":   [ { "hooks": [ { "type": "command", "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook SessionEnd --harness codex; fi", "timeout": 3 } ] } ]
  }
}
```

`SessionEnd` defaults to a 1 s timeout in Codex; the hook targets < 200 ms and the entry sets 3 s.

## Inputs consumed

| Event | Fields read |
|---|---|
| `SessionStart` | `session_id`, `transcript_path` (may be null), `cwd`, `source` (`startup`, `resume`, `clear`, `compact`) |
| `Stop` | `session_id`, `transcript_path`, `cwd`, `stop_hook_active`, `turn_id` (ignored) |
| `SessionEnd` | `session_id`, `transcript_path`, `cwd`, `reason` (currently always `other` → `unknown`) |

A null `transcript_path` disables the bytes threshold for that session (turns and minutes still
apply) and marks provenance spans unavailable.

## Outputs

- `SessionStart`: `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<brief>" } }`.
- `Stop` allow: exit 0, no output. Block: exit 2 with the checkpoint instruction on stderr (docs:
  exit code 2 with the reason on stderr "becomes a continuation prompt for the model").
  `stop_hook_active: true` always allows.
- `SessionEnd`: nothing, exit 0.

## Headless resume (P3 repair and backfill)

`codex exec --sandbox workspace-write resume <SESSION_ID> "<instruction>"`, the prompt being the
checkpoint instruction; hooks must be trusted for the resumed run or invoked with the CLI's
run-hooks-without-trust flag, which `repair` never does silently (it prints the command).
Amendment (2026-09-09, #85): `--sandbox` is an option of `codex exec`, not of `exec resume` — on
0.150.1 `codex exec resume --sandbox …` exits 2 with a usage error, so the flag goes before the
subcommand. Store: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; `session_meta.cwd` maps a file
to a repo and `session_meta.id` is the id the resume takes, for backfill enumeration
(`src/onboarding/stores.ts`).

## Version drift

`doctor` records the Codex version tested (0.150.x) and warns on a newer major.
