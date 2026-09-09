# P1 data flow — checkpoint protocol, index, and idempotency

Wave 0 artifact for `plans/feature-p1-cli-core.md`. Build agents read this; they do not modify it.
Contract changes go through a contract-amendment PR.

## 1. Actors and stores

| Actor | Reads | Writes |
|---|---|---|
| `workledger hook SessionStart` | index; `.workledger/` (for the brief) | index row; `sessions/<ulid>.md` (frontmatter only); stdout JSON |
| `workledger hook Stop` | index; transcript file size | index counters; exit 2 + stderr on block |
| `workledger hook SessionEnd` | index; transcript file size | index row; `sessions/<ulid>.md` frontmatter (`ended`, `end_reason`, `status`, `needs_repair`) |
| `workledger checkpoint` | stdin; index; transcript size; `backlog/*.md` (open ids) | `sessions/<ulid>.md`; `backlog/*.md`; index `checkpoints` row and counter reset |
| `workledger brief` | `.workledger/**` | stdout |
| `workledger init` | harness stores (metadata), git config | `.workledger/**`, `.claude/settings.json` |

The ledger (`.workledger/`) is the only durable store. The index (`~/.workledger/index.sqlite`)
is a cache rebuildable from the ledger plus transcript sizes; losing it costs at most one extra
or one missed checkpoint block.

## 2. Session lifecycle

```
SessionStart(source)
  ├─ startup | clear        → new ulid; frontmatter written; index row (status open, offset = current size)
  ├─ resume | fork          → if index has harness_session_id → reuse; else new ulid (source recorded)
  └─ compact                → reuse; re-inject brief; counters unchanged
  then: brief → additionalContext (unless private or brief.inject=false)

Stop  (every assistant turn)
  turns_total += 1; turns_since += 1
  size = size(transcript); if size < last_offset → last_offset = size (rotation; one stderr line)
  bytes_since = size - last_offset
  minutes_since = now - max(last_checkpoint_at, started)
  if WORKLEDGER_DISABLE or private or not-enabled-repo           → allow
  if stop_hook_active == true                                    → allow (documented loop guard)
  if blocks_since_checkpoint == 0:
      if bytes_since < B and minutes_since < M and turns_since < T → allow
      else → BLOCK #1: exit 2; stderr = instruction(ulid, open ids); blocks_since = 1;
             last_block_turn = turns_total; last_block_trigger = first crossed of bytes, minutes, turns
  elif blocks_since_checkpoint == 1:
      if last_attempt_at is null or last_attempt_at < block time  → allow (agent ignored; keep counting;
                                    blocks_since stays 1 so no further block until a checkpoint lands
                                    or the counters are reset by the give-up rule below)
      elif last_attempt_exit != 0 → BLOCK #2: same instruction + "previous attempt failed:" +
                                    last_attempt_errors; blocks_since = 2
      else                        → allow (attempt succeeded; `checkpoint` already reset blocks_since to 0)
  else (blocks_since >= 2)         → allow; frontmatter checkpoint_failures += 1; give up for now:
                                    blocks_since = 0, turns_since = 0, last_offset = size,
                                    last_checkpoint_at = now (thresholds must re-accumulate before
                                    another block, so a block is never immediately repeated)
  ignored-block give-up: if blocks_since == 1 and turns_total - last_block_turn >= T
                                  → same give-up reset without incrementing checkpoint_failures
                                    (the agent ignored the block for a full turn threshold; start over)

checkpoint (agent-invoked)
  on validation/secret failure: index.last_attempt_at = now, last_attempt_exit = code,
                                last_attempt_errors = the stderr text (field paths only, never values)
  on success: n = count(checkpoints)+1; offset = size(transcript); turns = turns_total (cumulative)
  render + write; index: insert checkpoints(n); turns_since = 0; blocks_since = 0;
  last_offset = offset; last_checkpoint_at = now; last_attempt_exit = 0;
  last_attempt_errors = null; last_attempt_at = now   (a stale failure must not trigger BLOCK #2
                                                       for a checkpoint that landed; amendment 2)
  trigger = index.last_block_trigger if blocks_since > 0, else `manual`

SessionEnd(reason)
  ended = now; end_reason = map(reason); status = ended
  needs_repair = turns_since > stale_turns   (turn count only; no content read)
```

`end_reason` mapping: `prompt_input_exit` → `clean`; `clear` → `clear`; `resume` → `resume`;
`logout` → `logout`; `other` → `unknown`. `crashed` is only set by the P3 orphan scan.

## 3. Idempotency and concurrency

- **Checkpoint key** is `(session ulid, n)`. `checkpoint` reads `n` inside a SQLite transaction
  (`BEGIN IMMEDIATE`), so two concurrent invocations for one session serialize; the second sees
  `n+1`. The ledger append is a temp-file-plus-rename, so a crash mid-write leaves the previous file.
- **Backlog ids** are ULIDs generated in-process; no coordination needed. `closes` on an item that
  is already `done` is accepted as a no-op with a history entry `op: close` and diff "already done".
- **Stop hooks** may fire concurrently across sessions of the same repo; each session has its own
  row. Rows are keyed by ulid; `(harness, harness_session_id)` is unique, which is what makes
  `resume`, `fork`, and `compact` reuse the row instead of forking the ledger.
- **Session resolution for `checkpoint`**: `--session` (the block instruction and the injected
  brief both print `--session <ulid>` verbatim), else `WORKLEDGER_SESSION`, else the single open
  session for the repo; ambiguity is a usage error listing candidates. No hook sets environment
  variables in the agent's process; that is not possible.
- **Trigger values in P1**: `bytes`, `minutes`, `turns`, `manual`. `end`, `repair`, `backfill`,
  `extract` are reserved in the enum for P3 so no `schema_version` bump is needed then. When two
  thresholds cross in one Stop the first in the order bytes, minutes, turns is recorded.
- **`checkpoints[].turns`** is cumulative (`turns_total` at the checkpoint); per-checkpoint deltas
  are derived by subtraction.
- **Hook writes** to session frontmatter (SessionStart, SessionEnd) use the same temp-file-plus-
  rename path as `checkpoint`; a truncated SessionEnd leaves the previous frontmatter intact and
  the index row open, which P3's orphan scan reconciles.
- **Index rebuild** (`packages/cli/src/index/rebuild.ts`) reconstructs `sessions` and
  `checkpoints` from frontmatter. The *since* counters (`turns_since_checkpoint`,
  `blocks_since_checkpoint`) reset to zero; `turns_total` is restored from the last checkpoint's
  cumulative `turns` so the next checkpoint's `turns` never regresses; `last_offset` is the last
  checkpoint's offset. Two ledger files with the same `(harness, harness_session_id)` (the state a
  lost index followed by a `resume` produces) do not abort the rebuild: the file with the newest
  `started` wins (then more checkpoints, then the earlier filename) and the loser is reported in
  `problems`. This is the recovery path for a deleted or corrupted index. (Amendment 2.)

## 4. Provenance binding

Every rendered line carries `[cp n]`. Checkpoint `n` covers transcript bytes
`[checkpoints[n-1].transcript_offset, checkpoints[n].transcript_offset)`. Nothing in P1 reads
those bytes; P2's provenance panel does, from the local cache, and only on request.

## 5. Brief construction (deterministic)

Inputs: all `backlog/*.md` with status in `{proposed, accepted, in_progress}`; the three most
recent `sessions/*.md` by `started`; open `blocker` and `question` notes across all sessions.
Ordering: backlog by `rank` ascending then `updated` descending; sessions by `started` descending.
Drop order when over `max_tokens`: `proposed` items oldest-first, then notes oldest-first, then
the third and second most recent session's Done lines. Token estimate: `ceil(chars / 4)`.

## 6. Timing budgets

| Path | Budget | Enforced by |
|---|---|---|
| `hook Stop` allow | p95 < 100 ms | `hook-timing.test.ts` over 100 runs |
| `hook SessionStart` | < 300 ms | same file, 20 runs |
| `hook SessionEnd` | < 200 ms (Claude Code budget 1.5 s, raised by the 10 s timeout) | same |
| `checkpoint` | < 1 s for a 4 KB payload and a 500-item backlog | `checkpoint.test.ts` |

Node startup dominates the allow path. If the budget cannot be met, the escape hatch is a shell
wrapper that checks `WORKLEDGER_DISABLE` and the enabled-repo marker before spawning Node.

## 7. Failure policy

Hooks fail open: any exception → one stderr line prefixed `workledger:` → exit 0. The only
deliberate non-zero exit from a hook is the Stop block (2). `checkpoint` fails closed: any error
means nothing is written and the exit code says why.

## 8. Secret scanning points

1. `checkpoint` step 3 on the raw payload (object walk).
2. `checkpoint` step 6 on rendered session and backlog texts.
3. `capture-fixtures.mjs` on every fixture before it is written to `test/fixtures/`.

Findings name a JSON path or file path and a pattern name; the matched text is never printed or
logged.
