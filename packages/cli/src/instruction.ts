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
export const INSTRUCTION_VERSION = 1;

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
    "and pipe a CheckpointPayload JSON on stdin describing the work since the last checkpoint:",
    "goal (required at checkpoint 1), done[], remaining[], notes[]. At most 4096 bytes.",
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
