/**
 * The `.claude/settings.json` merge `workledger init` performs — step 4 of cli.md §`init` and
 * the block frozen in docs/contracts/p1/hooks-claude-code.md §Configuration.
 *
 * The merge is *additive*. A user's `settings.json` is theirs: every key it already carries
 * survives, every hook it already registers survives, and the three workledger groups are
 * appended after them. Running `init` twice changes nothing, which is what makes "already
 * enabled" (cli.md §init) a real state rather than a hopeful message.
 *
 * The file is written only after its unified diff has been printed and — unless `--yes` — the
 * operator has said yes, and only after the previous content has been copied to `<file>.bak`.
 * This is the one place in P1 that writes outside `.workledger/`, so it is deliberately the
 * loudest.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The three events the contract's block registers, in the contract's order. */
export const HOOKED_EVENTS = ["SessionStart", "Stop", "SessionEnd"] as const;

/** One of {@link HOOKED_EVENTS}. */
export type HookedEvent = (typeof HOOKED_EVENTS)[number];

/**
 * Per-hook timeout in seconds, frozen at 10 by the contract. On `SessionEnd` it also raises
 * Claude Code's shared 1.5 s budget to match.
 */
export const HOOK_TIMEOUT_SECONDS = 10;

/** `.claude/settings.json`, relative to the repo root. */
export const SETTINGS_PATH = path.join(".claude", "settings.json");

/**
 * The command string written for one event, verbatim from hooks-claude-code.md.
 *
 * The `if`/`fi` form is the contract's, and the reason is spelled out there: an `if` whose
 * condition is false and which has no `else` exits 0, so an absent binary is a clean 0 with no
 * output — while the plain `A && B` form exits 1. `exec` preserves the CLI's own exit code,
 * including the Stop block's 2.
 */
export function hookCommandString(event: HookedEvent): string {
  return `if command -v workledger >/dev/null 2>&1; then exec workledger hook ${event}; fi`;
}

/** The group `init` appends for one event: one command hook, no `matcher` (`Stop` has none). */
export function hookGroup(event: HookedEvent): Record<string, unknown> {
  return {
    hooks: [
      { type: "command", command: hookCommandString(event), timeout: HOOK_TIMEOUT_SECONDS },
    ],
  };
}

/** The whole `hooks` block from hooks-claude-code.md §Configuration. */
export function hooksBlock(): Record<HookedEvent, unknown[]> {
  return {
    SessionStart: [hookGroup("SessionStart")],
    Stop: [hookGroup("Stop")],
    SessionEnd: [hookGroup("SessionEnd")],
  };
}

/** Raised when `settings.json` holds a shape the merge cannot preserve. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

/** `true` for a JSON object — not an array, not `null`. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A hook entry this tool wrote: any command that invokes `workledger hook <event>`. */
function isOurs(entry: unknown, event: HookedEvent): entry is Record<string, unknown> {
  return isObject(entry) && typeof entry["command"] === "string" &&
    entry["command"].includes(`workledger hook ${event}`);
}

/** The result of merging the contract's block into a settings object. */
export interface MergeResult {
  /** A new settings object; the input is never mutated. */
  settings: Record<string, unknown>;
  /** `true` when the merge added or corrected anything. */
  changed: boolean;
}

/**
 * Merge the contract's hooks block into `settings`.
 *
 * For each event: if a group already carries a `workledger hook <event>` command, that entry's
 * `command` and `timeout` are set to the contract's — so a settings file written by an older
 * build is corrected in place rather than duplicated — and everything else about the group,
 * including a `matcher` the user added, is left alone. Otherwise the contract's group is
 * appended after the existing ones, which is what keeps foreign hooks first and intact.
 *
 * @throws {SettingsError} when `hooks` or one of its event values is not the shape the schema
 * documents. Rewriting such a file would destroy data, so `init` refuses instead.
 */
export function mergeHooks(settings: Record<string, unknown>): MergeResult {
  const merged: Record<string, unknown> = { ...settings };
  const existingHooks = merged["hooks"];
  if (existingHooks !== undefined && !isObject(existingHooks)) {
    throw new SettingsError("`hooks` is not a JSON object");
  }
  const hooks: Record<string, unknown> = { ...(existingHooks ?? {}) };
  let changed = false;

  for (const event of HOOKED_EVENTS) {
    const current = hooks[event];
    if (current !== undefined && !Array.isArray(current)) {
      throw new SettingsError(`\`hooks.${event}\` is not an array`);
    }
    const groups = [...((current ?? []) as unknown[])];

    let patched = false;
    for (let i = 0; i < groups.length && !patched; i += 1) {
      const group = groups[i];
      if (!isObject(group) || !Array.isArray(group["hooks"])) continue;
      const entries = [...(group["hooks"] as unknown[])];
      for (let j = 0; j < entries.length; j += 1) {
        if (!isOurs(entries[j], event)) continue;
        const entry = entries[j] as Record<string, unknown>;
        const wanted = { ...entry, type: "command", command: hookCommandString(event), timeout: HOOK_TIMEOUT_SECONDS };
        if (entry["command"] !== wanted["command"] || entry["timeout"] !== wanted["timeout"] || entry["type"] !== "command") {
          entries[j] = wanted;
          groups[i] = { ...group, hooks: entries };
          changed = true;
        }
        patched = true;
        break;
      }
    }

    if (!patched) {
      groups.push(hookGroup(event));
      changed = true;
    }
    hooks[event] = groups;
  }

  merged["hooks"] = hooks;
  return { settings: merged, changed };
}

// ---------------------------------------------------------------------------
// Unified diff
// ---------------------------------------------------------------------------

/** Lines of context either side of a change, the `diff -U3` default. */
const CONTEXT = 3;

/** One diff line: kept, removed or added. */
interface DiffLine {
  sign: " " | "-" | "+";
  text: string;
}

/** Longest-common-subsequence diff. The inputs are one settings file; O(n·m) is free here. */
function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = before[i] === after[j]
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ sign: " ", text: before[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ sign: "-", text: before[i]! });
      i += 1;
    } else {
      out.push({ sign: "+", text: after[j]! });
      j += 1;
    }
  }
  for (; i < n; i += 1) out.push({ sign: "-", text: before[i]! });
  for (; j < m; j += 1) out.push({ sign: "+", text: after[j]! });
  return out;
}

/**
 * A `diff -u`-shaped rendering of `before` → `after`, with {@link CONTEXT} lines around each
 * change. Returns the empty string when the two texts are equal.
 */
export function unifiedDiff(before: string, after: string, label: string): string {
  if (before === after) return "";
  const beforeLines = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const afterLines = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  const lines = diffLines(beforeLines, afterLines);

  // Indices of lines that must appear: every change, plus CONTEXT lines around it.
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.sign === " ") return;
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(lines.length - 1, index + CONTEXT); k += 1) {
      keep.add(k);
    }
  });

  const out = [`--- a/${label}`, `+++ b/${label}`];
  let beforeNo = 1;
  let afterNo = 1;
  let index = 0;
  while (index < lines.length) {
    if (!keep.has(index)) {
      if (lines[index]!.sign !== "+") beforeNo += 1;
      if (lines[index]!.sign !== "-") afterNo += 1;
      index += 1;
      continue;
    }
    const hunk: string[] = [];
    const startBefore = beforeNo;
    const startAfter = afterNo;
    let countBefore = 0;
    let countAfter = 0;
    while (index < lines.length && keep.has(index)) {
      const line = lines[index]!;
      hunk.push(`${line.sign}${line.text}`);
      if (line.sign !== "+") {
        beforeNo += 1;
        countBefore += 1;
      }
      if (line.sign !== "-") {
        afterNo += 1;
        countAfter += 1;
      }
      index += 1;
    }
    out.push(`@@ -${startBefore},${countBefore} +${startAfter},${countAfter} @@`, ...hunk);
  }
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Applying the merge to a file
// ---------------------------------------------------------------------------

/** What `mergeSettingsFile` did. */
export interface SettingsOutcome {
  /** `unchanged` — the block was already there; `written`; `declined` — the operator said no. */
  status: "unchanged" | "written" | "declined";
  /** Absolute path of `.claude/settings.json`. */
  file: string;
  /** Absolute path of the backup, when one was written (only when the file already existed). */
  backup?: string;
  /** The unified diff that was printed. Empty when nothing changed. */
  diff: string;
}

/** Everything `mergeSettingsFile` touches outside the filesystem. */
export interface SettingsIo {
  /** One line of human-readable output; the newline is added by the caller's writer. */
  stdout: (line: string) => void;
  /** Asked once, unless `--yes` supplied a function that answers `true` without prompting. */
  confirm: (question: string) => Promise<boolean>;
}

/** Serialize settings the way this tool writes them: two-space JSON, one trailing newline. */
function serialize(settings: Record<string, unknown>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * Merge one JSON config file in place: read, transform, diff, ask, back up, write.
 *
 * The order is the contract's and it is the same for every harness's hook file, so it is written
 * once here and `mergeSettingsFile` (`.claude/settings.json`), `codex-hooks.ts`
 * (`.codex/hooks.json`) and `cursor-hooks.ts` (`.cursor/hooks.json`) all reach it. Nothing is
 * written when `transform` reports no change, so a second `init` leaves the file byte-identical —
 * including its indentation, if the operator reformatted it.
 *
 * @param file absolute path of the file to merge into.
 * @param label the path shown in the unified diff, relative to the repo root.
 * @param transform the merge itself, given the parsed object (`{}` for a file that is absent).
 * @throws {SettingsError} when the file is not valid JSON, is not a JSON object, or holds a
 * shape `transform` refuses. Rewriting such a file would destroy data, so `init` refuses instead.
 */
export async function applyJsonFile(
  file: string,
  label: string,
  transform: (existing: Record<string, unknown>) => MergeResult,
  io: SettingsIo,
  ask: boolean,
): Promise<SettingsOutcome> {
  let before = "";
  let existing: Record<string, unknown> = {};
  let exists = false;
  try {
    before = readFileSync(file, "utf8");
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists && before.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(before) as unknown;
    } catch (error) {
      throw new SettingsError(
        `${file} is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (!isObject(parsed)) throw new SettingsError(`${file} is not a JSON object`);
    existing = parsed;
  }

  const { settings, changed } = transform(existing);
  if (!changed) return { status: "unchanged", file, diff: "" };

  const after = serialize(settings);
  const diff = unifiedDiff(before, after, label);
  for (const line of diff.replace(/\n$/, "").split("\n")) io.stdout(line);

  if (ask && !(await io.confirm(`Write these changes to ${file}?`))) {
    return { status: "declined", file, diff };
  }

  mkdirSync(path.dirname(file), { recursive: true });
  let backup: string | undefined;
  if (exists) {
    backup = `${file}.bak`;
    writeFileSync(backup, before, "utf8");
  }
  writeFileSync(file, after, "utf8");
  return { status: "written", file, backup, diff };
}

/**
 * Merge the contract's hooks block into `<root>/.claude/settings.json`.
 *
 * Order is the contract's: compute, print the diff, ask, back up, write. Nothing is written when
 * the merge is a no-op, so a second `init` leaves the file byte-identical — including its
 * indentation, if the operator reformatted it.
 *
 * @throws {SettingsError} when the file is not valid JSON, or holds a `hooks` shape the merge
 * cannot preserve.
 */
export async function mergeSettingsFile(
  root: string,
  io: SettingsIo,
  ask: boolean,
): Promise<SettingsOutcome> {
  return await applyJsonFile(path.join(root, SETTINGS_PATH), SETTINGS_PATH, mergeHooks, io, ask);
}
