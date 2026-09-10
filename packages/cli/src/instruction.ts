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
 *
 * v4 (#117, P8 amendment 11): `done[].text` is the gist a human reads and the new `done[].detail`
 * carries the specifics for agents, stated with one worked example pair; the instruction asks for
 * 3–8 done items "as you would tell a teammate at standup", one action per remaining item, and
 * the new `memory[]`. The `--payload` single-quote rules of v3 are unchanged.
 */
export const INSTRUCTION_VERSION = 4;

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
  /**
   * Memory files the session wrote to since the last checkpoint, derived by the Stop hook from
   * the transcript's Write/Edit tool inputs (P8 amendment 11). Listed back to the agent so the
   * payload names the facts it saved there instead of omitting `memory[]` — the hook can see
   * *which* file changed, only the agent knows *what* it recorded.
   */
  memoryFiles?: readonly string[] | undefined;
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
    "goal (required at checkpoint 1), done[], remaining[], notes[], memory[]. At most 16384 bytes.",
    "Shapes: done {text, detail?, files[], commit?, verified: tests-passed|tests-failed|not-verified};",
    "remaining {text, why, new: true | ref: WL-…, rel: updates|closes, blocked_by?[]};",
    "notes {type: discovery|decision|blocker|question, text, by?: human|agent, reason?};",
    "memory {text, file?}; decision notes require reason and by.",
    "",
    "done[].text is the gist, and it is read by a human: one outcome in plain words, the way you",
    "would tell a teammate at standup. No file paths, no commit ids, no library names unless the",
    "library is the outcome. The specifics go in done[].detail, which is read by agents. So:",
    "  text: Buyers can now check out from the cart on their phone",
    "  detail: Checkout control is the link itself; pendingCheckout flag plus cart-null detection;",
    "  opens in native top-level hosts, new tab on desktop",
    "Give 3–8 done items — one per outcome, not one per file you touched.",
    "remaining[].text is one action, imperative and short; where you would join two actions in one",
    "item, write two items instead. why is what stays broken or blocked until it is done.",
    "memory[] is the facts you saved to a memory file this span (Claude Code auto-memory,",
    "CLAUDE.md, MEMORY.md, .claude/memory): the fact as you wrote it, and the file it went to.",
    "",
    "Caps: goal ≤ 400 chars; done text ≤ 140 and detail ≤ 300; remaining text and why ≤ 100;",
    "notes text ≤ 500 and reason ≤ 300; memory text ≤ 200; files ≤ 20 per done item;",
    "blocked_by ≤ 10; ≤ 12 items per section; ≤ 16384 bytes total.",
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

  const memoryFiles = input.memoryFiles ?? [];
  if (memoryFiles.length > 0) {
    lines.push(
      "",
      `You wrote to ${memoryFiles.length === 1 ? "this memory file" : "these memory files"} this span: ${memoryFiles.join(", ")}.`,
      "Record what you saved there as memory[] entries, one fact per entry, with its file.",
    );
  }

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

/** One repo a workspace-session block asks a checkpoint for. */
export interface WorkspaceTarget {
  /** The session ulid recorded against this repo. */
  sessionId: string;
  /** The repo root, printed verbatim inside `--repo <root>`. */
  root: string;
  /** Open `WL-` ids in that repo's backlog. */
  openIds: readonly string[];
}

/**
 * The block text for a session started in a workspace folder rather than a repo (P8 amendment
 * 8, #105): one `workledger checkpoint --session <ulid> --repo <root> --payload '<json>'` per
 * repo the transcript touched, most-touched first. The payload rules are the ones
 * {@link checkpointInstruction} states; only the command list differs.
 */
export function workspaceCheckpointInstruction(input: {
  targets: readonly WorkspaceTarget[];
  previousErrors?: string | undefined;
  memoryFiles?: readonly string[] | undefined;
}): string {
  const first = input.targets[0];
  if (first === undefined) throw new RangeError("workspaceCheckpointInstruction: no targets");
  const base = checkpointInstruction({
    sessionId: first.sessionId,
    openIds: [],
    previousErrors: input.previousErrors,
    memoryFiles: input.memoryFiles,
  });
  const commands = input.targets.map(
    (target) => `workledger checkpoint --session ${target.sessionId} --repo ${target.root} --payload '<json>'`,
  );
  const lines = base.split("\n");
  // Replace the single-command line and the "No open backlog items" line with the per-repo list.
  const runAt = lines.findIndex((line) => line.startsWith("Run exactly one command:"));
  lines.splice(
    runAt,
    1,
    `This session worked in ${input.targets.length === 1 ? "one repo" : `${input.targets.length} repos`}; run one command per repo, in this order:`,
    ...commands.map((command) => `  ${command}`),
    "Each <json> describes only that repo's work; the rest of the JSON rules are the same:",
  );
  const backlogAt = lines.findIndex((line) => line.startsWith("No open backlog items."));
  lines.splice(
    backlogAt,
    1,
    ...input.targets.map((target) =>
      target.openIds.length === 0
        ? `${target.root}: no open backlog items; use \`"new": true\` on a remaining item worth tracking.`
        : `${target.root}: open backlog ids for \`ref\` + \`rel\`: ${target.openIds.join(", ")}`,
    ),
  );
  return lines.join("\n");
}

/** What {@link repairInstruction} interpolates on top of {@link InstructionInput}. */
export interface RepairInstructionInput extends InstructionInput {
  /** Why the session is being repaired, as one clause: `crashed`, `ended without a digest`. */
  reason: string;
  /**
   * The repos the session is about when there are several (P8 amendment 10): one
   * `--repo` command each, as {@link workspaceCheckpointInstruction} lists them. Absent, or
   * one target, keeps the single-command form.
   */
  targets?: readonly WorkspaceTarget[] | undefined;
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
  const several = input.targets !== undefined && input.targets.length > 1;
  return [
    `workledger: this session ${input.reason} without recording its work.`,
    several
      ? "Record one checkpoint per repo below describing what this session did there, then stop."
      : "Record one checkpoint describing what this session did, then stop.",
    `Do not edit files, run builds, or start new work — the only command${several ? "s" : ""} you may run ${several ? "are" : "is"} the one${several ? "s" : ""} below.`,
    "",
    several
      ? workspaceCheckpointInstruction({ targets: input.targets as readonly WorkspaceTarget[], previousErrors: input.previousErrors })
      : checkpointInstruction(input),
  ].join("\n");
}
