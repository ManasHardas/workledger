# Phase 1 — CLI core

**Status:** Frozen pending Wave 0 (design approved by the operator 2026-09-09; Wave -1 ideation
gate green on `plans/ideation-workledger.md`).

**Tag at phase close:** `p1-shipped`.

**Strategic context.** P1 ships the thing every later phase depends on: the ledger file format,
the validated write path (`workledger checkpoint`), and the Claude Code hooks that trigger
checkpoints and inject the brief. At the end of P1 a developer can run `workledger init` in a
repo, work in Claude Code as usual, and find `.workledger/sessions/*.md` and `.workledger/backlog/
*.md` filling with attributed, checkpoint-bound records, with no UI yet. This repository and
`~/Projects/dome_workspace` are the first two enabled repos (spec §14.3, DL-14). Spec:
`docs/superpowers/specs/2026-09-09-workledger-design.md` §3–§7, §10–§13, §14.

---

## Sub-phase split

| Sub-phase | Scope | Sessions (estimate) |
|---|---|---|
| **P1a scaffold + core** | pnpm monorepo, `packages/core` (schema, validation, rendering, brief, secret scan), local index, CI | 1–2 |
| **P1b CLI + hooks** | `checkpoint`, Claude Code adapter, `hook`, `init`, `doctor`, fixtures capture | 1–2 |
| **P1c dogfood** | Enable on this repo and `dome_workspace`; Wave 2 QA; Wave 3 docs; Wave 3.5 dogfood pass | 1 |

Total estimate: **3–4 sessions** (bootstrap, no priors).

---

## Wave 0 — Contract freeze (orchestrator alone)

Five artifacts in one PR (orchestrator self-merges). This project has no HTTP API and no database
migration in P1, so the template's artifacts map as follows:

1. **Payload and file contracts** (`docs/contracts/p1/checkpoint-payload.schema.json`,
   `session-frontmatter.schema.json`, `backlog-item.schema.json`): the shapes in §Data model
   below. The JSON Schema files are the frozen contract. `packages/core/src/schema.ts` (zod, slot
   2) must accept and reject the same inputs (parity fixtures), and its exporter, which may merge
   hand-maintained fragments for cross-field constraints that zod cannot emit, must reproduce the
   files byte for byte; a diff is a contract amendment, never an edit to the frozen files.
2. **CLI contract** (`docs/contracts/p1/cli.md`): every P1 command with arguments, stdin/stdout/
   stderr, exit codes, and timing budget (§API surface below).
3. **Hook contract** (`docs/contracts/p1/hooks-claude-code.md`): the input fields consumed and the
   output JSON emitted for `SessionStart`, `Stop`, `SessionEnd`, with the deny and inject shapes
   quoted from the live Claude Code docs at freeze time.
4. **Data-flow doc** (`plans/feature-p1-data-flow.md`): the checkpoint state machine, thresholds,
   loop guard, idempotency key (`session ulid` + `checkpoint n`), index schema, what each command
   reads and writes, and the timing budget for hooks (<100 ms unless denying).
5. **Cleanup**: none (greenfield). Record "no dead code to remove" in the PR body.

Phase tracking issue: `[P1] Phase tracking — CLI core`.

---

## Architecture / pipeline

```
 Claude Code ──hooks──▶ workledger hook <event> ──▶ ~/.workledger/index.sqlite (offsets, stamps)
      │                       │ SessionStart: create session file, print brief as additionalContext
      │                       │ Stop: thresholds → allow | deny(instruction)
      │                       │ SessionEnd: close session, flag stale
      │ (agent runs)          ▼
      └──────▶ workledger checkpoint < payload.json
                              │ validate (zod) → secret scan → stamp provenance → render
                              ▼
                 <repo>/.workledger/sessions/<ulid>.md   backlog/WL-<ulid>.md   config.yaml
                              ▲
                 workledger brief ── deterministic text from the ledger (no model)
```

`packages/core` is pure TypeScript: it knows nothing about Node's filesystem, Claude Code, or
SQLite. It takes strings and objects in and returns strings and objects out, so it can run in
the P2 web app and the P6 card unchanged. `packages/cli` owns every side effect: reading hook
payloads from stdin, touching the index, writing files, printing hook JSON. The Claude Code
adapter is one module in `packages/cli/src/adapters/claude-code.ts` and is the only file that
knows Claude Code's hook field names; P4 adds siblings for Cursor and Codex behind the same
adapter interface.

The hook binary must be fast and fail open. `workledger hook` does no network, no model calls,
and reads at most the index and one file's size; the only slow path is a deny, which is a
constant-time write. If anything throws, the hook exits 0 and logs one line to stderr.

---

## Data model

The ledger is files; the index is a cache. Frontmatter carries `schema_version: 1`.

```yaml
# .workledger/sessions/<ulid>.md — frontmatter (SessionFrontmatter)
schema_version: 1
id: 01J9…                          # ULID
harness: claude-code
harness_session_id: "…"
repo: "github.com/org/repo"        # first git remote's path, else directory basename
branch: main
author: { name: "…", email: "…", dome_user: null }
started: 2026-09-09T14:02:11Z
ended: null
end_reason: null                   # clean | clear | resume | logout | crashed | unknown
status: open                       # open | ended | crashed | repaired
private: false
source: live                       # live | backfill
model: null
checkpoints: []                    # { n, at, turns (cumulative), transcript_offset, trigger }
needs_repair: false
checkpoint_failures: 0
```

```yaml
# .workledger/backlog/WL-<ulid>.md — frontmatter (BacklogItem)
schema_version: 1
id: WL-01J9AB
title: "…"
status: proposed                   # proposed | accepted | in_progress | done | discarded
proposed_by: { harness, session, checkpoint, author }
confirmed_by: null                 # { name, email, dome_user, at }
owner: null
priority: null                     # p1 | p2 | p3
rank: 0
area: []
blocked_by: []
done_by: null                      # { session, checkpoint }
created: …
updated: …
history: []                        # { at, by, op, diff }
```

```json
// stdin to `workledger checkpoint` (CheckpointPayload)
{
  "goal": "optional after cp 1",
  "done": [ { "text": "…", "files": ["…"], "commit": "a1b2c3d", "verified": "tests-passed|tests-failed|not-verified" } ],
  "remaining": [ { "text": "…", "why": "…", "new": true } , { "text": "…", "why": "…", "ref": "WL-…", "rel": "updates|closes", "blocked_by": ["WL-…"] } ],
  "notes": [ { "type": "discovery|decision|blocker|question", "text": "…", "by": "human|agent", "reason": "…" } ]
}
```

```sql
-- ~/.workledger/index.sqlite (cache; rebuildable)
CREATE TABLE sessions (
  ulid TEXT PRIMARY KEY, repo_path TEXT NOT NULL, harness TEXT NOT NULL,
  harness_session_id TEXT NOT NULL, transcript_path TEXT, status TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  last_offset INTEGER NOT NULL DEFAULT 0,
  turns_total INTEGER NOT NULL DEFAULT 0, turns_since_checkpoint INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_at TEXT,
  last_block_turn INTEGER, last_block_trigger TEXT, blocks_since_checkpoint INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT, last_attempt_exit INTEGER, last_attempt_errors TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (harness, harness_session_id)
);
CREATE TABLE checkpoints (
  session_ulid TEXT NOT NULL, n INTEGER NOT NULL, at TEXT NOT NULL,
  transcript_offset INTEGER NOT NULL, turns INTEGER NOT NULL, trigger TEXT NOT NULL,
  PRIMARY KEY (session_ulid, n)
);
CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`config.yaml` (committed, per repo): `thresholds: { bytes: 40000, minutes: 20, turns: 15 }`,
`brief: { inject: true, max_tokens: 2000 }`, `stale_turns: 5`, `orphan_minutes: 30`,
`private_paths: []`, `auto_commit: false`, `harnesses: [claude-code]`.

---

## API surface

There is no HTTP API in P1. The contract is the CLI and the hook I/O.

```yaml
workledger init [--repo <path>] [--yes]
  # detect harnesses + git identity; list candidate repos from session stores;
  # create .workledger/{config.yaml,README.md,sessions/,backlog/}; merge hooks into
  # .claude/settings.json (project-level) showing a diff and asking unless --yes
  exit: 0 ok (including "already enabled") · 1 error

workledger hook <SessionStart|Stop|SessionEnd>      # stdin: Claude Code hook JSON
  stdout: hook JSON per docs/contracts/p1/hooks-claude-code.md (or nothing)
  exit: always 0 (fail open); deny is expressed in JSON, not exit code
  budget: < 100 ms p95 on the allow path

workledger checkpoint [--session <ulid>] [--dry-run]   # stdin: CheckpointPayload JSON
  # session resolved from --session (the block instruction and the brief both name the ulid),
  # else WORKLEDGER_SESSION, else the single open session for this repo in the index;
  # two or more open sessions is a usage error that lists them
  stdout: "checkpoint <n> recorded: <d> done, <r> remaining, <q> questions"
  stderr: validation errors, one per line, with the open WL ids on unknown-ref errors
  exit: 0 ok · 1 validation failed · 3 secret detected (field named, value never printed)

workledger brief [--repo <path>] [--max-tokens N]
  stdout: the brief text (deterministic; no model)

workledger doctor
  stdout: per harness: binary found, store readable, hook files present and current; CLI version
  exit: 0 all good · 2 warnings · 1 broken

workledger backlog <accept|discard|done|edit|assign|rank> …
  reserved; P1 registers the command and exits 1 with "not available until P2"
```

Hook output shapes (frozen at Wave 0 from the live docs, 2026-09-09; full text in
`docs/contracts/p1/hooks-claude-code.md`):

```json
// SessionStart: inject the brief
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<brief>" } }
```

```
// Stop: allow = exit 0, no output.
// Stop: block (request a checkpoint) = exit code 2, the checkpoint instruction on stderr.
//   Docs: "The blocking message is the reason from your JSON's blocking decision when it makes
//   one, and your stderr text otherwise." The exit-code path is used because the JSON field
//   name differs between documentation sections.
// Stop input `stop_hook_active: true` means a Stop hook already blocked this attempt; the hook
//   then always allows (documented loop guard), in addition to the index never-twice guard.
```

Reviewer trio per Clause #6: `checkpoint`, `hook`, and `init` are full-trio (they consume agent
input, inject text into a session, or write outside `.workledger/`); `core` modules are CR + SRE;
scaffold and CI are CR-only. See `plans/agentwaves-stack-map.md` §Clauses adapted.

---

## Hook state machine (replaces the FE flow section)

Authoritative detail: `plans/feature-p1-data-flow.md` §2. Summary:

```
SessionStart(source)
  startup|clear      → new ulid, frontmatter, index row (offset = current transcript size)
  resume|fork|compact→ reuse the row whose (harness, harness_session_id) matches; else new ulid
  private (env or private_paths) → boundary record only; no brief; Stop never blocks
  then inject brief as additionalContext (first line names the session ulid)

Stop (every assistant turn)                       turns_total++ ; turns_since++
  disabled | private | not enabled repo            → allow
  stop_hook_active == true                         → allow (documented loop guard)
  size(transcript) < last_offset                   → last_offset = size (rotation), continue
  blocks_since_checkpoint == 0:
     thresholds not crossed                        → allow
     crossed (bytes, then minutes, then turns)     → BLOCK #1 (exit 2, instruction with ulid + open ids)
  blocks_since_checkpoint == 1:
     no `checkpoint` attempt since block           → allow; agent ignored it; counters keep running
     attempt failed (last_attempt_exit ≠ 0)        → BLOCK #2 with the validation errors appended
  blocks_since_checkpoint ≥ 2                      → allow; checkpoint_failures++; reset counters as if
                                                      a checkpoint landed (no immediate re-block)
`workledger checkpoint` success                    → stamp n; turns_since = 0; blocks = 0; offset = size

SessionEnd(reason) → ended, end_reason, status ended; needs_repair = turns_since > stale_turns
```

"Never block twice in a row" therefore means: never block twice for an agent that ignored the
first block; one retry is allowed when the agent tried and the CLI rejected the payload.

---

## Wave 0.5 dispatch list

Infra agent decomposes into ~4 issues:

1. Monorepo scaffold — pnpm workspaces, root `tsconfig.base.json`, vitest + coverage, eslint,
   `packages/{core,cli}` skeletons, `bin` wiring so `npx workledger` resolves.
2. CI — `.github/workflows/ci.yml` per Clause #9: lint, typecheck, test with 70% coverage on
   changed files; path filters; concurrency group.
3. Fixture capture — `scripts/capture-fixtures.mjs` that copies and scrubs real Claude Code
   transcripts and hook payloads from this machine into `test/fixtures/` (secrets and emails
   redacted; sizes kept).
4. Packaging — `npm publish --dry-run` CI job, version script, `README` install section
   (same slot as issue 2 in the implementation plan: slot 11 is CI + packaging + fixtures).

Backend agent decomposes into ~9 issues:

1. `core/schema` — zod schemas for CheckpointPayload, SessionFrontmatter, BacklogItem, Config;
   JSON Schema export script; tests.
2. `core/ids` and `core/frontmatter` — ULID generation, `WL-` ids, gray-matter round trip
   preserving unknown fields; tests.
3. `core/render` — session file append (Goal/Done/Remaining/Notes with `[cp n]`), backlog
   create/update/close with history entries; golden-file tests.
4. `core/secretscan` — vendored regex set, field-naming errors, tests with true and false positives.
5. `core/brief` — deterministic brief with the token cap and the drop order; tests.
6. `cli/index` — better-sqlite3 index with the two tables, migrations, rebuild from ledger; tests.
7. `cli/checkpoint` — stdin → validate → scan → stamp → render → ack; open-id error listing;
   exit codes; tests via fixtures.
8. `cli/adapters/claude-code` + `cli/hook` — payload parsing, thresholds, loop guard, deny and
   inject JSON, fail-open wrapper, timing test; hook-simulation tests over recorded payloads.
9. `cli/init` + `cli/doctor` + `cli/brief` + `cli/config` — config loader with defaults;
   detection; repo listing from session stores (metadata only); `.workledger/` creation; settings
   merge with diff, `.bak`, and confirm; the hook command string with the absent-CLI no-op and a
   test for it; a printed privacy summary in `init`'s next steps; doctor checks; the `brief`
   command; tests with a temp home and temp repo.

Frontend agent: none in P1 (first Frontend dispatch is P2).

---

## Acceptance criteria (phase tracking issue)

- [ ] `pnpm install && pnpm test` green on a clean clone; coverage gate at 70% on changed files.
- [ ] `workledger init` in a temp repo creates `.workledger/` and a `.claude/settings.json` hooks
      block matching `docs/contracts/p1/hooks-claude-code.md`; a real `claude -p` session started
      in that repo fires `SessionStart` (observed as an index row), which is the loader round-trip.
- [ ] With the CLI absent from `PATH`, every hook command exits 0 with no output.
- [ ] A scripted headless Claude Code session in that repo produces a session file with ≥1
      checkpoint, a proposed backlog item, and a `[cp n]` stamp whose transcript offset lies inside
      the transcript file.
- [ ] `Stop` allow path p95 < 100 ms over 100 simulated invocations; `SessionStart` < 300 ms;
      `SessionEnd` < 200 ms; a block never repeats for an agent that ignored it; one retry block
      fires when the CLI rejected the payload; `stop_hook_active: true` always allows.
- [ ] `WORKLEDGER_PRIVATE=1` yields a boundary-only session record, no brief, and no block.
- [ ] `workledger checkpoint` rejects each invalid fixture with the documented exit code and
      message; a payload containing a fixture secret exits 3 and prints only the field name.
- [ ] `workledger brief` output is byte-identical across two runs on the same ledger and respects
      the token cap.
- [ ] This repository and `~/Projects/dome_workspace` are enabled; at least three real sessions
      in each have recorded checkpoints before phase close (Wave 3.5).
- [ ] HARD CONSTRAINT honored across all PRs (host verification with Node ≥ 22 + pnpm ≥ 10, stated).
- [ ] Clause #3 honored on every Backend PR.

---

## Out of scope

- Any UI, server, SSE, or `serve` command (P2).
- Orphan scan, repair, backfill, extraction (P3). `needs_repair` is set in P1 but nothing acts on it.
- Cursor and Codex adapters (P4); the adapter interface exists in P1 with one implementation.
- `auto_commit`, private paths beyond the env var, `identities.yaml` (P5).
- cardFS, `publish`, `pull`, `apps/card` (P6). Tokens and Figma (P7).

---

## Risks + escape hatches

| Risk | Mitigation |
|---|---|
| Claude Code changes the Stop deny shape or field names | The hook contract is frozen from the live docs at Wave 0 and quoted in `docs/contracts/p1/`; the adapter is one file; `doctor` reports the harness version and warns when it is newer than the tested one |
| Deny-stop loops or annoys the developer | Never deny twice in a row; thresholds in `config.yaml`; `WORKLEDGER_DISABLE=1` silences all hooks; the acknowledgment line makes each checkpoint visible |
| Agent writes a low-quality payload | Validation rejects missing evidence and unknown ids; the instruction text is versioned and can be tuned without code changes; quality is measured in Wave 3.5 on real sessions |
| Node startup makes the allow path slow | Timing test in the acceptance criteria; if p95 > 100 ms, the escape hatch is a tiny shell pre-check that reads the index before spawning Node, or the Go rewrite noted in the spec |
| Settings merge corrupts a developer's `.claude/settings.json` | Merge is additive, shows a diff, asks before writing, and keeps a `.bak`; tested against fixtures with existing hooks |
| Secret leaks into a committed ledger file | Scan runs on the payload and again on rendered output; exit 3 names the field only; fixtures include planted secrets |
