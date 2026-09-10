/**
 * The checkpoint instruction — the text a `Stop` block puts on stderr, which Claude Code hands
 * to the model as the reason it may not stop yet (hooks-claude-code.md §Outputs emitted → Stop).
 *
 * It is versioned because it is a prompt: the wording is the interface between workledger and a
 * model, and a session that read v1 and a session that read v2 behave differently. The version
 * is printed so a transcript says which text produced a given checkpoint.
 *
 * Pure string building — no imports. That is what lets the block path stay off
 * `@workledger/core` (plans/feature-p1-data-flow.md §6).
 */

/** Bumped whenever the wording changes, not when a value interpolated into it changes. */
export const INSTRUCTION_VERSION = 2;

/** What {@link checkpointInstruction} interpolates. */
export interface InstructionInput {
  /** The session ULID, printed verbatim inside `--session <ulid>` (data-flow §3). */
  sessionId: string;
  /** Open `WL-` ids the payload may name with `ref` + `rel`. */
  openIds: readonly string[];
  /**
   * The cached stderr of the attempt that just failed (`last_attempt_errors`). Present only for
   * BLOCK #2, the one retry a failed checkpoint gets. Field paths only, never values — the
   * `checkpoint` command scans it on the way into the index.
   */
  previousErrors?: string | undefined;
  /**
   * How many checkpoints the session already has, so the instruction can name the span rather
   * than say "the last checkpoint" — the repair path's wording (docs/contracts/p3/cli.md
   * §`workledger repair`: "the checkpoint instruction with 'since checkpoint n'"). Omitted on
   * the P1 block path, where the text stays byte-identical to instruction v2.
   */
  sinceCheckpoint?: number | undefined;
}

/** How many characters of a cached failure are quoted back before it is truncated. */
export const MAX_PREVIOUS_ERRORS = 1200;

/**
 * The instruction, as one block of text.
 *
 * Written as an imperative addressed to the agent that is being stopped: it names the exact
 * command, says what goes on stdin, and lists the only backlog ids a `ref` may use, because the
 * agent has no other way to discover them from inside the session.
 */
export function checkpointInstruction(input: InstructionInput): string {
  const lines = [
    `workledger: record a checkpoint before you stop (instruction v${INSTRUCTION_VERSION}).`,
    "",
    `Run: workledger checkpoint --session ${input.sessionId}`,
    input.sinceCheckpoint !== undefined && input.sinceCheckpoint > 0
      ? "and pipe a CheckpointPayload JSON on stdin describing the work since checkpoint " +
        `${input.sinceCheckpoint}:`
      : "and pipe a CheckpointPayload JSON on stdin describing the work since the last checkpoint:",
    "goal (required at checkpoint 1), done[], remaining[], notes[]. At most 4096 bytes.",
    "Shapes: done {text, files[], commit?, verified: tests-passed|tests-failed|not-verified};",
    "remaining {text, why, new: true | ref: WL-…, rel: updates|closes, blocked_by?[]};",
    "notes {type: discovery|decision|blocker|question, text, by?: human|agent, reason?}.",
    "",
    input.openIds.length === 0
      ? "No open backlog items. Use `\"new\": true` on a remaining item worth tracking."
      : `Open backlog ids for \`ref\` + \`rel\`: ${input.openIds.join(", ")}`,
  ];

  const previous = input.previousErrors?.trim();
  if (previous !== undefined && previous !== "") {
    const quoted =
      previous.length > MAX_PREVIOUS_ERRORS
        ? `${previous.slice(0, MAX_PREVIOUS_ERRORS)}\n… (truncated)`
        : previous;
    lines.push("", "previous attempt failed:", quoted, "", "Fix those fields and run it again.");
  }

  return lines.join("\n");
}

/** What {@link repairInstruction} interpolates on top of {@link InstructionInput}. */
export interface RepairInstructionInput extends InstructionInput {
  /** Why the session is being repaired, as one clause: `crashed`, `ended without a digest`. */
  reason: string;
}

/**
 * The prompt `workledger repair` hands a resumed session (docs/contracts/p3/cli.md
 * §`workledger repair` step 2).
 *
 * It is the checkpoint instruction with a preamble, because the resumed agent's situation is not
 * the blocked agent's: nothing stopped it, it is being woken up long after the fact and its only
 * job is the digest. The preamble says so, and says it may not do anything else — which is the
 * prompt-side half of the `--allowedTools` pin the adapter applies.
 */
export function repairInstruction(input: RepairInstructionInput): string {
  return [
    `workledger: this session ${input.reason} without recording its work.`,
    "Record one checkpoint describing what this session did, then stop. Do not edit files, run",
    "builds, or start new work — the only command you may run is the one below.",
    "",
    checkpointInstruction(input),
  ].join("\n");
}
