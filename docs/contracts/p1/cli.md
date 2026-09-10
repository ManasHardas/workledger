# CLI contract — P1 (frozen 2026-09-09)

Binary: `workledger` (npm package `workledger`, `packages/cli`). Node ≥ 22. All commands accept
`--help`. All paths are resolved from the repo root, found by walking up from `cwd` (or
`CLAUDE_PROJECT_DIR`) to the nearest directory containing `.workledger/` or `.git/`.

Global environment:

| Variable | Effect |
|---|---|
| `WORKLEDGER_HOME` | Overrides `~/.workledger` (index, cache, logs). Tests set this. |
| `WORKLEDGER_DISABLE=1` | Every `hook` invocation exits 0 immediately with no output. |
| `WORKLEDGER_PRIVATE=1` | `SessionStart` marks the session private: boundary record only, no brief, Stop never blocks. |
| `WORKLEDGER_SESSION` | Session ulid for `checkpoint` when the index lookup is ambiguous. |

Exit codes: `0` ok · `1` validation or usage error · `3` secret detected · `4` not an enabled
repo. Exit `2` has two meanings by command: from `hook Stop` it is the block; from `doctor` it is
"warnings". No other command exits 2.

## `workledger init [--repo <path>] [--yes] [--no-backfill]`

Onboarding for one repo (P1: Claude Code only; `--no-backfill` is accepted and ignored until P3).

1. Detect harnesses: `claude` on `PATH` and `~/.claude/projects/`; report version.
2. Detect identity: `git config user.name` and `user.email` in the repo; refuse if empty.
3. Create `.workledger/config.yaml`, `.workledger/README.md`, `.workledger/sessions/`,
   `.workledger/backlog/` (with `.gitkeep`). Existing files are left untouched.
4. Merge the hooks block from `docs/contracts/p1/hooks-claude-code.md` into
   `.claude/settings.json`: print a unified diff, ask (unless `--yes`), write with a `.bak`.
5. Print next steps.

Stdout: human-readable progress. Exit `0` on success, `2`-style "nothing to do" is reported as
exit `0` with the message "already enabled". Exit `1` on any refusal.

## `workledger hook <SessionStart|Stop|SessionEnd>`

Stdin: the Claude Code hook JSON. Behavior per `docs/contracts/p1/hooks-claude-code.md`. Never
exits non-zero except the deliberate `2` on Stop-block. Any internal error: one line on stderr
prefixed `workledger:`, exit 0.

## `workledger checkpoint [--session <ulid>] [--repo <path>] [--payload <json> | --payload-file <path>] [--dry-run]`

Input: a `CheckpointPayload` (`docs/contracts/p1/checkpoint-payload.schema.json`), at most 16,384
bytes, from exactly one source: the `--payload <json>` argument, the file named by
`--payload-file <path>` (resolved against the cwd), or stdin. Two sources is a usage error (exit
`1`); the cap, the validation and the secret scan are the same whichever source is used.

*Amendment (2026-09-10, #97).* The argv forms were added and the cap raised from 4,096 bytes:
Claude Code's headless permission matcher denies a heredoc and a heredoc-fed pipe even under
`Bash(workledger checkpoint*)`, so a resumed session could not feed stdin at all, and a 100-turn
session's digest did not fit in 4 KB. Instruction v3 prescribes `--payload '<json>'`
(`docs/contracts/p1/hooks-claude-code.md` §Stop).

*Amendment (2026-09-10, #105; `docs/contracts/p8/daemon-and-api.md` amendment 8).* `--repo <path>`
names the repo whose ledger takes the checkpoint regardless of the process cwd — a session started
in a workspace folder above its repos, resumed where it started, writes into the repo it touched.
The path is resolved against the cwd and must be an enabled repo (exit `4` otherwise); a
`--session` row that belongs to a different repo is a usage error naming both (the index row is
keyed by `(harness, harness_session_id, repo_path)`, so one harness session may have a row — and a
digest — per repo it touched). Without `--repo` the repo above the cwd is used as before. The
repair instruction adds `--repo <root>` to the pinned command whenever the session's cwd is not
the repo, and the resume is spawned in that cwd.

*Amendment (2026-09-10, #117; `docs/contracts/p8/daemon-and-api.md` amendment 11).* The payload is
additive-versioned rather than frozen: `done[].text` is now the **gist** a human reads (≤ 140
chars, an outcome in plain words, no paths and no commit ids), the optional `done[].detail`
(≤ 300) carries the specifics for agents, `remaining[].text` and `remaining[].why` tighten to 100
each, and the optional `memory[]` (`{ text ≤ 200, file? }`) records facts the session saved to a
memory file. Instruction v4 states all of it. `workledger brief` carries `text` and `detail`
together, because the brief is read by agents; the session view shows the gist alone. Payloads
written against the older caps still validate, and ledger files whose Done lines carry their
evidence inline still parse.

Steps, in order, each failing fast:

1. Resolve the session: `--session`, else `WORKLEDGER_SESSION`, else the single open session for
   this repo in the index; two or more open sessions is a usage error naming them.
2. Parse and validate against the schema. Errors are printed one per line on stderr as
   `<json-path>: <message>`; an unknown `ref` prints `open backlog ids: WL-…, WL-…`.
3. Secret scan the payload. On a finding: stderr `secret detected at <json-path> (<pattern>)`,
   exit `3`, nothing written. The matched text is never printed.
   On any failure in steps 2–3 the index records `last_attempt_at`, `last_attempt_exit`, and
   `last_attempt_errors` (the stderr text, which never contains values) so the Stop hook can
   decide between a retry block and giving up (data-flow §2).
4. Compute the stamp: `n = last n + 1`, `at = now (UTC, ISO 8601)`, `turns` and
   `transcript_offset` from the index and the transcript file's current size, `trigger` from the
   index (`turns`, `bytes`, `minutes`) or `manual` when the command was run without a pending block.
5. Render through `packages/core`: append to the session file; create, update, or close backlog
   items; append history entries with `by = { session, checkpoint }`.
6. Secret scan the rendered texts; on a finding, exit `3` and write nothing.
7. Write atomically (temp file + rename) and update the index (`checkpoints` row, counters reset).
8. Stdout: `checkpoint <n> recorded: <d> done, <r> remaining (<new> new, <closed> closed), <q> question(s)`.

`--dry-run` performs steps 1–6 and prints the would-be stdout line prefixed `dry-run:`.

## `workledger brief [--repo <path>] [--max-tokens <n>]`

Stdout: the brief (spec §7), deterministic for a given ledger. Default `max_tokens` from
`config.yaml` (2,000). Exit `4` if the repo is not enabled.

## `workledger doctor [--json]`

Reports, per harness: binary found and version, session store readable, project hook files present
and matching the contract, contract-tested version vs installed version. Reports CLI version, index
path and size, and the number of open sessions in the index. Exit `0` clean, `2` warnings, `1` broken.

## `workledger backlog <accept|discard|done|edit|assign|rank> …`

Reserved. Not implemented in P1 (P2 introduces the UI, which calls these). Invoking prints
"not available until P2" and exits `1`.

## `.workledger/config.yaml`

```yaml
schema_version: 1
harnesses: [claude-code]
thresholds: { bytes: 2000000, minutes: 20, turns: 15 }
brief: { inject: true, max_tokens: 2000 }
stale_turns: 5
orphan_minutes: 30
private_paths: []
auto_commit: false
```

Unknown keys are preserved and ignored. Values are validated at load; an invalid file is reported
by `doctor` and treated as defaults by `hook` (fail open).
