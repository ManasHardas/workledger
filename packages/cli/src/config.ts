/**
 * `.workledger/config.yaml` — the knobs the hook state machine reads.
 *
 * Deliberately *not* parsed with `yaml`. The Stop hook's allow path has a p95 budget of 100 ms
 * including Node startup (plans/feature-p1-data-flow.md §6) and it needs `thresholds` on every
 * turn; loading `yaml` costs ~29 ms of module init, which is a third of the budget spent on a
 * file that `workledger init` writes itself and that is four scalars deep. So this reads the
 * subset `init` emits — scalars, one level of block mapping, flow mappings, flow and block
 * sequences of strings — and treats anything it cannot read as the default.
 *
 * That fallback is the contract, not a shortcut: cli.md §`.workledger/config.yaml` says an
 * invalid file "is reported by `doctor` and treated as defaults by `hook` (fail open)". `doctor`
 * and `init` are free to use the real parser and the `Config` zod schema in `@workledger/core`;
 * they have no such budget. #13 extends this loader; keep it minimal.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { LEDGER_DIR } from "./ledger-fs.js";

/** Stop-hook thresholds (cli.md §`.workledger/config.yaml`). */
export interface Thresholds {
  /** Transcript bytes written since the last checkpoint. */
  bytes: number;
  /** Minutes since the last checkpoint, or since the session started. */
  minutes: number;
  /** Assistant turns since the last checkpoint. */
  turns: number;
}

/** The `brief:` block. */
export interface BriefSettings {
  /** When false, `SessionStart` writes the boundary record but injects nothing. */
  inject: boolean;
  /** Budget handed to `buildBrief`, measured as `ceil(chars / 4)`. */
  max_tokens: number;
}

/** The subset of `config.yaml` the hook state machine reads. */
export interface HookConfig {
  thresholds: Thresholds;
  brief: BriefSettings;
  /** `SessionEnd` sets `needs_repair` when `turns_since_checkpoint` exceeds this. */
  stale_turns: number;
  /** Repo paths that are always private: boundary record only, no brief, never a block. */
  private_paths: string[];
}

/** The defaults from cli.md, used for a missing file and for every key that does not parse. */
export const DEFAULT_CONFIG: HookConfig = {
  thresholds: { bytes: 40000, minutes: 20, turns: 15 },
  brief: { inject: true, max_tokens: 2000 },
  stale_turns: 5,
  private_paths: [],
};

/** Absolute path of a repo's `.workledger/config.yaml`. */
export function configFile(root: string): string {
  return path.join(root, LEDGER_DIR, "config.yaml");
}

/** A scalar as it appears on the right of a `key:`, before it is coerced. */
type Scalar = string;

/** Strip a `#` comment that is not inside quotes, then trim. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || line[i - 1] === " ")) return line.slice(0, i);
  }
  return line;
}

/** Remove one layer of matching quotes. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === '"' || first === "'") && trimmed.endsWith(first)) return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Split a flow body (`a: 1, b: 2` or `a, b`) on top-level commas. */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** `{ a: 1, b: 2 }` → `{ a: "1", b: "2" }`; anything else → `undefined`. */
function parseFlowMap(value: string): Record<string, Scalar> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  const out: Record<string, Scalar> = {};
  for (const part of splitFlow(trimmed.slice(1, -1))) {
    const colon = part.indexOf(":");
    if (colon < 0) return undefined;
    out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
  }
  return out;
}

/** `[a, b]` → `["a", "b"]`; anything else → `undefined`. */
function parseFlowSeq(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
  return splitFlow(trimmed.slice(1, -1)).map(unquote);
}

/** One top-level key: its inline value plus the block lines indented under it. */
interface Entry {
  value: string;
  /** `["  bytes: 40000"]`-style lines, comments stripped, indentation kept. */
  block: string[];
}

/** Split the document into top-level entries. Tabs and deeper nesting are simply not handled. */
function readEntries(text: string): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  let current: Entry | undefined;
  for (const raw of text.split("\n")) {
    const line = stripComment(raw).replace(/\s+$/, "");
    if (line === "" || line.startsWith("---")) continue;
    if (/^\s/.test(line)) {
      current?.block.push(line);
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      current = undefined;
      continue;
    }
    current = { value: line.slice(colon + 1).trim(), block: [] };
    entries.set(line.slice(0, colon).trim(), current);
  }
  return entries;
}

/** The `key: value` pairs of an entry, whether written as a flow map or as a block mapping. */
function mapping(entry: Entry | undefined): Record<string, Scalar> {
  if (entry === undefined) return {};
  const flow = parseFlowMap(entry.value);
  if (flow !== undefined) return flow;
  if (entry.value !== "") return {};
  const out: Record<string, Scalar> = {};
  for (const line of entry.block) {
    const trimmed = line.trim();
    if (trimmed.startsWith("-")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    out[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  return out;
}

/** The string items of an entry, whether written as `[a, b]` or as `- a` lines. */
function sequence(entry: Entry | undefined): string[] | undefined {
  if (entry === undefined) return undefined;
  const flow = parseFlowSeq(entry.value);
  if (flow !== undefined) return flow;
  if (entry.value !== "") return undefined;
  const items: string[] = [];
  for (const line of entry.block) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    items.push(unquote(trimmed.slice(1)));
  }
  return items;
}

/** A positive integer, or `fallback` for anything else — including `0`, `-1` and `1.5`. */
function positiveInt(value: Scalar | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(unquote(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** `true` / `false`, or `fallback` for anything else. */
function boolean(value: Scalar | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const text = unquote(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return fallback;
}

/** Parse the config text. Never throws: every unreadable key falls back to its default. */
export function parseConfig(text: string): HookConfig {
  const entries = readEntries(text);
  const thresholds = mapping(entries.get("thresholds"));
  const brief = mapping(entries.get("brief"));
  const defaults = DEFAULT_CONFIG;
  return {
    thresholds: {
      bytes: positiveInt(thresholds["bytes"], defaults.thresholds.bytes),
      minutes: positiveInt(thresholds["minutes"], defaults.thresholds.minutes),
      turns: positiveInt(thresholds["turns"], defaults.thresholds.turns),
    },
    brief: {
      inject: boolean(brief["inject"], defaults.brief.inject),
      max_tokens: positiveInt(brief["max_tokens"], defaults.brief.max_tokens),
    },
    stale_turns: positiveInt(entries.get("stale_turns")?.value, defaults.stale_turns),
    private_paths: sequence(entries.get("private_paths")) ?? [...defaults.private_paths],
  };
}

/**
 * Load `<root>/.workledger/config.yaml`. A missing or unreadable file is the defaults — the hook
 * fails open, and a repo whose config an operator deleted still records sessions.
 */
export function loadConfig(root: string): HookConfig {
  let text: string;
  try {
    text = readFileSync(configFile(root), "utf8");
  } catch {
    return { ...DEFAULT_CONFIG, thresholds: { ...DEFAULT_CONFIG.thresholds } };
  }
  return parseConfig(text);
}

/**
 * `true` when `root` is covered by one of `private_paths`.
 *
 * A pattern matches when it equals the repo path, is a parent directory of it, or is a
 * `*`-suffixed prefix of it. `~` expands against `home`. Substring matching is deliberately not
 * supported: `/tmp/a` must not make `/tmp/abc` private.
 */
export function isPrivatePath(root: string, patterns: readonly string[], home: string): boolean {
  const target = path.resolve(root);
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (pattern === "") continue;
    const expanded = pattern.startsWith("~/") ? path.join(home, pattern.slice(2)) : pattern;
    if (expanded.endsWith("*")) {
      if (target.startsWith(path.resolve(expanded.slice(0, -1)))) return true;
      continue;
    }
    const resolved = path.resolve(expanded);
    if (target === resolved || target.startsWith(`${resolved}${path.sep}`)) return true;
  }
  return false;
}
