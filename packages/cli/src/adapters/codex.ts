/**
 * The Codex CLI adapter — `docs/contracts/p4/hooks-codex.md`, frozen 2026-09-09 against
 * `codex-cli 0.150.1`.
 *
 * Codex's hook surface is Claude Code's: the same three event names, the same `session_id` /
 * `transcript_path` / `cwd` fields, the same `stop_hook_active` loop guard, the same exit-2 block
 * and the same `hookSpecificOutput.additionalContext` injection. So the payload reader is shared
 * (`claude-shaped.ts`) and this file holds only the three places the two harnesses differ:
 *
 * 1. **`transcript_path` may be null.** Codex's docs say the transcript format "isn't a stable
 *    interface for hooks", and a session can run without one at all. Absent comes back as
 *    `undefined`, which measures no bytes — so the bytes threshold is disabled for that session
 *    and provenance spans are unavailable, while turns and minutes still apply. workledger never
 *    parses a Codex transcript on the live path; it reads its size only.
 * 2. **`source` has no `fork`.** Codex sends `startup`, `resume`, `clear`, `compact`.
 * 3. **`reason` is currently always `other`.** The ledger maps that to `unknown`, so this admits
 *    only `other` and lets everything else fall through to the same place.
 */
import process from "node:process";

import { EXIT_BLOCK } from "../exit-codes.js";
import { parseClaudeShaped } from "./claude-shaped.js";
import { spawnResume } from "./spawn-resume.js";
import type { HookEvent } from "../commands/hook-events.js";
import type {
  BlockOutput,
  EndReasonInput,
  HarnessAdapter,
  HookInput,
  HookInputError,
  ResumeOptions,
  ResumeResult,
  StartSource,
} from "./types.js";

import { statSize } from "./types.js";

/** The `harness` value this adapter writes to the ledger and the index. */
export const CODEX = "codex";

/** The executable a headless resume spawns. Overridable so a test can stand in for it. */
export const CODEX_BIN_ENV = "WORKLEDGER_CODEX_BIN";

/**
 * The sandbox a resumed Codex session runs under.
 *
 * `workspace-write` is the contract's (hooks-codex.md §Headless resume). Codex has no
 * `--allowedTools` equivalent, so {@link ResumeOptions.allowedTools} cannot be enforced as an
 * allow-list the way Claude Code's is; the sandbox is what keeps a repair inside the repo it was
 * asked about, and `read-only` is not an option because the checkpoint the resume exists to
 * record is itself a write.
 */
export const CODEX_SANDBOX = "workspace-write";

/** `source` values Codex sends on `SessionStart` (hooks-codex.md §Inputs consumed). */
const START_SOURCES: readonly StartSource[] = ["startup", "resume", "clear", "compact"];

/**
 * `reason` values Codex sends on `SessionEnd`.
 *
 * One entry, because the contract records exactly one: "currently always `other` → `unknown`".
 * A future Codex that starts sending `clear` would land as `undefined` here and be mapped to
 * `unknown` too — the same answer, arrived at without this file pretending to know more than the
 * contract does. Widening the list is a contract amendment.
 */
const END_REASONS: readonly EndReasonInput[] = ["other"];

/** The Codex hook protocol. */
export const codexAdapter: HarnessAdapter = {
  harness: CODEX,

  parseHookInput(event: HookEvent, raw: string): HookInput | HookInputError {
    return parseClaudeShaped(event, raw, { startSources: START_SOURCES, endReasons: END_REASONS });
  },

  // "exit code 2 with the reason on stderr becomes a continuation prompt for the model"
  // (hooks-codex.md §Outputs).
  blockStop(reason: string, out: BlockOutput): number {
    out.stderr(reason);
    return EXIT_BLOCK;
  },

  injectContext(context: string): string {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    });
  },

  transcriptSize: statSize,

  resumeHeadless,
};

/**
 * `codex exec --sandbox workspace-write resume <id> "<instruction>"`.
 *
 * `--sandbox` belongs to `codex exec`, not to its `resume` subcommand: on codex-cli 0.150.1
 * `codex exec resume --sandbox …` exits 2 with a usage error, and `codex exec --sandbox … resume
 * <id> "<prompt>"` resumes (verified 2026-09-09, #85). The prompt is the checkpoint instruction,
 * exactly as Claude Code's `-p` argument is.
 *
 * Hooks must be trusted for the resumed run to record anything — Codex requires a one-time trust
 * of a project's hook file. `repair` never passes `--dangerously-bypass-hook-trust` silently
 * (hooks-codex.md §Headless resume): a resume against untrusted hooks comes back having recorded
 * nothing, and `repair` reports that rather than escalating its own privileges to hide it.
 *
 * The child is its own process group, so the timeout kills everything Codex spawned rather than
 * just Codex — see `spawn-resume.ts`. Never throws.
 */
async function resumeHeadless(sessionId: string, options: ResumeOptions): Promise<ResumeResult> {
  const bin = process.env[CODEX_BIN_ENV]?.trim() || "codex";
  return await spawnResume(
    bin,
    ["exec", "--sandbox", CODEX_SANDBOX, "resume", sessionId, options.instruction],
    options,
  );
}
