# The Stop state machine

Summary of `packages/cli/src/commands/hook.ts` (the `stop` handler) and how it lands in
`packages/core/src/render/session.ts` (`appendCheckpoint`). Normative source:
`plans/feature-p1-data-flow.md` §2.

- **Every Stop advances the counters, then decides.** The handler looks up the session row by
  `(harness, harness_session_id)`; an unknown id allows immediately. Otherwise it computes
  `turns_total + 1`, `turns_since_checkpoint + 1`, the transcript byte delta since `last_offset`
  (resetting the offset with a stderr note if the transcript shrank), and minutes since
  `last_checkpoint_at`. That advance is written on every branch, including the blocks, so an
  uncheckpointed session still has an honest `turns_total` for `SessionEnd`'s `needs_repair`.

- **Two unconditional allows come first.** A private session (`WORKLEDGER_PRIVATE=1` or a
  `private_paths` match) records boundaries only and never blocks. `stop_hook_active` on the wire
  means the harness has already blocked this attempt, so the hook allows to avoid a loop. Both
  short-circuit before any threshold is consulted.

- **`blocks_since_checkpoint == 0`: threshold check, first block.** `firstCrossed` compares the
  measured bytes, minutes, and turns against config thresholds in that precedence order. Nothing
  crossed means allow. A crossing writes `blocks_since_checkpoint = 1`, `last_block_turn`,
  `last_block_trigger`, clears the `last_attempt_*` trio (so a stale failure from an earlier cycle
  cannot trigger a retry block), and exits 2 with the checkpoint instruction on stderr, never a
  JSON decision field.

- **`blocks_since_checkpoint == 1`: retry or ignore.** If a `last_attempt_*` row exists with a
  non-zero exit, the agent tried and failed: bump to 2 and block again, feeding the previous
  errors into the instruction. Otherwise the agent ignored the block or its attempt succeeded (in
  which case `checkpoint` already reset the counter to 0 and this branch is not reached). Allow
  and keep counting. If the block has been ignored for a full `thresholds.turns` worth of turns,
  `db.giveUp` resets the cycle without touching `checkpoint_failures`, because no attempt failed.

- **`blocks_since_checkpoint >= 2`: give up and record it.** The block was raised, the attempt
  failed, and the retry failed too. Allow, `db.giveUp` so thresholds must re-accumulate before
  another block, and increment `checkpoint_failures` in the session file's frontmatter via
  `patchFrontmatter` so an operator sees it. On the success side, `appendCheckpoint` in core is
  what closes a cycle: it re-parses the whole file, refuses a stamp whose `n` is already recorded
  or behind the last one (`duplicate-checkpoint`), requires a goal at checkpoint 1, prepends new
  Done and Remaining lines, appends Notes, and re-emits unparsed strays verbatim so a hook retry
  can never double-append or destroy a hand edit.
