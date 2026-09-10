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
      { "hooks": [ { "type": "command", "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook SessionStart; fi", "timeout": 10 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook Stop; fi", "timeout": 10 } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "if command -v workledger >/dev/null 2>&1; then exec workledger hook SessionEnd; fi", "timeout": 10 } ] }
    ]
  }
}
```

- `Stop` has no matcher support ("`Stop` | no matcher support"), so the group has no `matcher`.
- `SessionEnd` hooks "share a 1.5-second budget; if you set a longer per-hook timeout, Claude Code
  raises the budget to match, up to 60 seconds." The 10 s timeout raises it; the hook still targets
  well under 1 s.
- The command is resolved on `PATH`. `init` writes each command as
  `if command -v workledger >/dev/null 2>&1; then exec workledger hook <Event>; fi`
  so an absent binary exits 0 with no output (an `if` with a false condition and no `else` exits
  0), while `exec` preserves the CLI's exit code, including the Stop block's 2. The plain
  `A && B` form is wrong: it exits 1 when the binary is absent.

## Inputs consumed (stdin JSON)

| Event | Fields read | Ignored |
|---|---|---|
| `SessionStart` | `session_id`, `transcript_path`, `cwd`, `source` (`startup`, `resume`, `clear`, `compact`, `fork`), `model` (optional) | `permission_mode` |
| `Stop` | `session_id`, `transcript_path`, `cwd`, `stop_hook_active`; on the block path, the transcript's tool inputs (amendment 2026-09-10, #116) | `last_assistant_message`, `permission_mode` |
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
- **Where the block files** (amendment 2026-09-10, #116; docs/contracts/p8/daemon-and-api.md
  amendment 10): the Stop hook of every session — started in a repo or in a workspace folder —
  runs one inference on its block path and never on its allow path. When a threshold is crossed,
  the transcript's tool inputs since the last scan are tallied per enabled repo
  (`sessions.scan_offset`, `scan_counts`) and ranked into the session's context repos
  (`packages/cli/src/onboarding/touched.ts` `rankContext`: one write, or five references with a
  path-tool input or `cd` among them; writes, then path inputs, then references; the start
  directory's repo only as fallback and tiebreak, and only for a repo-started session). The block
  asks for one `workledger checkpoint --session <ulid> --repo <root> --payload '<json>'` per
  context repo, best first, each against a row and ledger file opened in that repo; a session
  about its own repo alone gets the P1 text above, byte for byte, and a workspace-started
  session about nothing is allowed. The counted row — the one keyed by the directory the hook
  fired from — records `start_dir` and `context_repos`, starts a fresh window once every target
  has its checkpoint, and `SessionEnd` closes every row of the harness session. A repo-started
  session whose content is about another repo is filed there; its own ledger keeps a session
  record with `started_in` and `about` and no checkpoint.
- **Instruction v3** (amendment 2026-09-10, #97; `packages/cli/src/instruction.ts`, also the
  preamble-wrapped repair instruction of `docs/contracts/p3/cli.md`): the text prescribes
  `workledger checkpoint --session <ulid> --payload '<json>'` — one single-quoted argument — and
  states that heredocs, pipes and stdin are not permitted in headless sessions, because the
  headless permission matcher denies a heredoc ("brace with quote character"), a heredoc-fed pipe
  ("cannot be statically analyzed") and a backslash before whitespace even under
  `Bash(workledger checkpoint*)`, while a single-quoted argument with brackets and nested double
  quotes runs with no denial (probed 2026-09-10). String rule: no single quote and no backslash
  anywhere in the JSON; an apostrophe is written as ’ (U+2019), a double quote inside a string as
  ” (U+201D), a backslash as ⧵ (U+29F5), and every string stays on one line. The cap is 16,384
  bytes, `decision` notes require `reason` (and `by`), and the open-ids line and the
  previous-errors block are unchanged from v2. Wording amendment (2026-09-10, #101, still v3):
  a `Caps:` line after the shapes states every per-field cap the schema enforces —
  "goal ≤ 400 chars; text, why and reason ≤ 300 chars (notes text ≤ 500); files ≤ 20 per done
  item; blocked_by ≤ 10; ≤ 12 items per section; ≤ 16384 bytes total" — because the first
  headless replay lost a turn to the unstated 300-character `done[].text` cap.
- **Instruction v4** (amendment 2026-09-10, #117; `docs/contracts/p8/daemon-and-api.md`
  amendment 11): v3's command line, string rule and previous-errors block are unchanged; the
  wording is not. `done[].text` is asked for as the gist a human reads — one outcome in plain
  words, the way you would tell a teammate at standup, no file paths and no commit ids — with the
  specifics moved to the new `done[].detail`, stated with one worked pair ("Buyers can now check
  out from the cart on their phone" versus "Checkout control is the link itself; pendingCheckout
  flag plus cart-null detection; opens in native top-level hosts, new tab on desktop"). It asks
  for 3–8 done items, one action per remaining item, and the new `memory[]`. The `Caps:` line
  becomes "goal ≤ 400 chars; done text ≤ 140 and detail ≤ 300; remaining text and why ≤ 100;
  notes text ≤ 500 and reason ≤ 300; memory text ≤ 200; files ≤ 20 per done item; blocked_by ≤ 10;
  ≤ 12 items per section; ≤ 16384 bytes total".
- **Memory derivation** (v4): before it raises a block, the Stop hook scans the transcript span
  since the last checkpoint for `Write` and `Edit` tool inputs whose `file_path` is under a memory
  path (`~/.claude/projects/*/memory/`, `.claude/memory/`, any `CLAUDE.md` or `MEMORY.md`) and
  names the distinct files in the instruction, so the agent records what it saved there as
  `memory[]` entries. It runs on the block path only, reads at most 2 MB from the end of the span,
  keeps `file_path` strings and nothing else, and fails to an empty list — the allow path and its
  timing budget are untouched.

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
