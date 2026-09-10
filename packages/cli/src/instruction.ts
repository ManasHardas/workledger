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

/**
 * Bumped whenever the wording changes, not when a value interpolated into it changes.
 *
 * v3 (#97): the payload is one `--payload '<json>'` argument rather than stdin. Claude Code's
 * headless permission matcher denies a heredoc ("brace with quote character"), a heredoc-fed
 * pipe, and a backslash before whitespace even under `Bash(workledger checkpoint*)`, while a
 * single-quoted argument with brackets and nested double quotes runs with no denial — probed
 * on 2026-09-10. The string rule below is what keeps every payload inside that safe shape.
 */
export const INSTRUCTION_VERSION = 3;

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
  /**
   * The repo root the checkpoint must land in, printed as `--repo <root>` when the session's
   * working directory is not that repo — a workspace-root session resumed where it started
   * (docs/contracts/p8/daemon-and-api.md amendment 8). Omitted when the cwd is the repo, where
   * the command line stays exactly what it was.
   */
  repo?: string | undefined;
}

/** How many characters of a cached failure are quoted back before it is truncated. */
export const MAX_PREVIOUS_ERRORS = 1200;

/**
 * The instruction, as one block of text.
 *
 * Written as an imperative addressed to the agent that is being stopped: it names the exact
 * command, says how the payload is passed, and lists the only backlog ids a `ref` may use,
 * because the agent has no other way to discover them from inside the session.
 */
export function checkpointInstruction(input: InstructionInput): string {
  const span =
    input.sinceCheckpoint !== undefined && input.sinceCheckpoint > 0
      ? `since checkpoint ${input.sinceCheckpoint}`
      : "since the last checkpoint";
  const lines = [
    `workledger: record a checkpoint before you stop (instruction v${INSTRUCTION_VERSION}).`,
    "",
    `Run exactly one command: workledger checkpoint --session ${input.sessionId}` +
      `${input.repo === undefined ? "" : ` --repo ${input.repo}`} --payload '<json>'`,
    `where <json> is a CheckpointPayload describing the work ${span}:`,
    "goal (required at checkpoint 1), done[], remaining[], notes[]. At most 16384 bytes.",
    "Shapes: done {text, files[], commit?, verified: tests-passed|tests-failed|not-verified};",
    "remaining {text, why, new: true | ref: WL-…, rel: updates|closes, blocked_by?[]};",
    "notes {type: discovery|decision|blocker|question, text, by?: human|agent, reason?};",
    "decision notes require reason and by.",
    "Caps: goal ≤ 400 chars; text, why and reason ≤ 300 chars (notes text ≤ 500); files ≤ 20",
    "per done item; blocked_by ≤ 10; ≤ 12 items per section; ≤ 16384 bytes total.",
    "Strings: no single quote (') and no backslash (\\) anywhere in the JSON — write an",
    "apostrophe as \u2019 (U+2019), a double quote inside a string as \u201d (U+201D), a backslash",
    "as \u29f5 (U+29F5), and keep every string on one line (the JSON itself may span lines).",
    "Heredocs, pipes and stdin are not permitted in headless sessions; the JSON goes in the",
    "single-quoted --payload argument and nowhere else.",
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
