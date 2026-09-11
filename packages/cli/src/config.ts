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

import { matchGlob } from "./glob.js";
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

/**
 * The `backfill:` block (docs/contracts/p3/cli.md §Config additions).
 *
 * `seconds_per_session` is not a timeout — it is the per-session wall time the estimate printed
 * before the confirmation prompt is built from, so an operator can see what a 200-session
 * backfill is going to cost them in minutes before they say yes.
 */
export interface BackfillSettings {
  /** Default `--since` window: one of {@link SINCE_WINDOWS}. */
  since: string;
  /** Default `--concurrency`. */
  concurrency: number;
  /** What one repaired session is assumed to take, for the estimate only. */
  seconds_per_session: number;
}

/** The `extract:` block — the model and the rates the extraction estimate is priced at. */
export interface ExtractSettings {
  /** Anthropic model id the extraction fallback calls. */
  model: string;
  /** USD per million input tokens, used for the estimate the consent prompt shows. */
  usd_per_million_input: number;
  /** USD per million output tokens. */
  usd_per_million_output: number;
}

/** The `--since` windows cli.md §`workledger backfill` allows. */
export const SINCE_WINDOWS = ["7d", "14d", "30d", "all"] as const;
export type SinceWindow = (typeof SINCE_WINDOWS)[number];

/**
 * `auto_commit` (docs/contracts/p5/config-and-identities.md): `false` off, or the moment the
 * ledger is committed for you. Never a push, and never a change to a hook's exit code.
 */
export const AUTO_COMMIT_MODES = ["on_checkpoint", "on_session_end"] as const;
export type AutoCommitMode = (typeof AUTO_COMMIT_MODES)[number];
/** `false` is the off position; the contract spells the key `false | on_checkpoint | on_session_end`. */
export type AutoCommit = false | AutoCommitMode;

/**
 * `editor` (docs/contracts/p8/daemon-and-api.md amendment 13): which editor the UI offers a file
 * to, or `none` for no such control. The CLI never launches anything from it; it is read here
 * only so the server can hand it to the UI alongside the repo's absolute path.
 */
export const EDITORS = ["vscode", "cursor", "none"] as const;
export type Editor = (typeof EDITORS)[number];

/** The subset of `config.yaml` the hook state machine reads. */
export interface HookConfig {
  /**
   * The harnesses enabled for this repo — the ones `init` wrote a hook file for and `doctor`
   * reports a row for. The hook state machine does not read it (the `--harness` flag in each
   * hook command says which adapter to use), but `init` and `doctor` do.
   */
  harnesses: string[];
  thresholds: Thresholds;
  brief: BriefSettings;
  /** `SessionEnd` sets `needs_repair` when `turns_since_checkpoint` exceeds this. */
  stale_turns: number;
  /**
   * How stale an open session's transcript mtime must be before `scan` calls it crashed
   * (docs/contracts/p3/cli.md §`workledger scan`).
   */
  orphan_minutes: number;
  /**
   * Paths that are always private: boundary record only, no brief, never a block.
   *
   * A relative pattern is a picomatch glob against the session's `cwd` relative to the repo
   * root (P5); an absolute or `~`-rooted one keeps P1's prefix semantics against the repo.
   */
  private_paths: string[];
  /** When and whether `.workledger/` is committed for the operator. */
  auto_commit: AutoCommit;
  /** `identities.yaml`, relative to `.workledger/` — the email → display-name map. */
  identities_file: string;
  /** Which editor the UI's open-in-editor control targets (P8 amendment 13). */
  editor: Editor;
  /** `workledger backfill` defaults (docs/contracts/p3/cli.md §Config additions). */
  backfill: BackfillSettings;
  /** `workledger repair --extract` model and rates. */
  extract: ExtractSettings;
}

/** The defaults from cli.md, used for a missing file and for every key that does not parse. */
export const DEFAULT_CONFIG: HookConfig = {
  harnesses: ["claude-code"],
  thresholds: { bytes: 2000000, minutes: 20, turns: 15 },
  brief: { inject: true, max_tokens: 2000 },
  stale_turns: 5,
  orphan_minutes: 30,
  private_paths: [],
  auto_commit: false,
  identities_file: "identities.yaml",
  editor: "vscode",
  backfill: { since: "14d", concurrency: 2, seconds_per_session: 45 },
  extract: { model: "claude-haiku-4-5", usd_per_million_input: 1, usd_per_million_output: 5 },
};

/** A fresh deep copy of {@link DEFAULT_CONFIG}, so a caller can never mutate the shared object. */
export function defaultConfig(): HookConfig {
  return {
    harnesses: [...DEFAULT_CONFIG.harnesses],
    thresholds: { ...DEFAULT_CONFIG.thresholds },
    brief: { ...DEFAULT_CONFIG.brief },
    stale_turns: DEFAULT_CONFIG.stale_turns,
    orphan_minutes: DEFAULT_CONFIG.orphan_minutes,
    private_paths: [...DEFAULT_CONFIG.private_paths],
    auto_commit: DEFAULT_CONFIG.auto_commit,
    identities_file: DEFAULT_CONFIG.identities_file,
    editor: DEFAULT_CONFIG.editor,
    backfill: { ...DEFAULT_CONFIG.backfill },
    extract: { ...DEFAULT_CONFIG.extract },
  };
}

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
  /** `["  bytes: 2000000"]`-style lines, comments stripped, indentation kept. */
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

/**
 * A positive, finite number — unlike {@link positiveInt} this keeps a fraction, because a rate
 * of `0.8` USD per million tokens is a legitimate `extract` value and rounding it to `1` would
 * quietly overstate every estimate printed from it.
 */
function positiveNumber(value: Scalar | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(unquote(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A non-empty string, or `fallback`. */
function nonEmpty(value: Scalar | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  const text = unquote(value);
  return text === "" ? fallback : text;
}

/** One of {@link SINCE_WINDOWS}, or `fallback`. */
function sinceWindow(value: Scalar | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  const text = unquote(value);
  return (SINCE_WINDOWS as readonly string[]).includes(text) ? text : fallback;
}

/**
 * `on_checkpoint` / `on_session_end`, or `false` for `false`, an absent key and anything else.
 *
 * Fails to the off position on purpose: an unreadable value must never make the tool start
 * writing commits into a repo the operator did not ask it to.
 */
function autoCommit(value: Scalar | undefined, fallback: AutoCommit): AutoCommit {
  if (value === undefined) return fallback;
  const text = unquote(value).toLowerCase();
  if ((AUTO_COMMIT_MODES as readonly string[]).includes(text)) return text as AutoCommitMode;
  return false;
}

/** One of {@link EDITORS}, or `fallback` — an editor nobody ships is not a reason to fail. */
function editor(value: Scalar | undefined, fallback: Editor): Editor {
  if (value === undefined) return fallback;
  const text = unquote(value).toLowerCase();
  return (EDITORS as readonly string[]).includes(text) ? (text as Editor) : fallback;
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
  const backfill = mapping(entries.get("backfill"));
  const extract = mapping(entries.get("extract"));
  const defaults = DEFAULT_CONFIG;
  const harnesses = sequence(entries.get("harnesses"))?.filter((name) => name !== "");
  return {
    harnesses: harnesses === undefined || harnesses.length === 0
      ? [...defaults.harnesses]
      : harnesses,
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
    orphan_minutes: positiveInt(entries.get("orphan_minutes")?.value, defaults.orphan_minutes),
    private_paths: sequence(entries.get("private_paths")) ?? [...defaults.private_paths],
    auto_commit: autoCommit(entries.get("auto_commit")?.value, defaults.auto_commit),
    identities_file: nonEmpty(entries.get("identities_file")?.value, defaults.identities_file),
    editor: editor(entries.get("editor")?.value, defaults.editor),
    backfill: {
      since: sinceWindow(backfill["since"], defaults.backfill.since),
      concurrency: positiveInt(backfill["concurrency"], defaults.backfill.concurrency),
      seconds_per_session: positiveInt(
        backfill["seconds_per_session"],
        defaults.backfill.seconds_per_session,
      ),
    },
    extract: {
      model: nonEmpty(extract["model"], defaults.extract.model),
      usd_per_million_input: positiveNumber(
        extract["usd_per_million_input"],
        defaults.extract.usd_per_million_input,
      ),
      usd_per_million_output: positiveNumber(
        extract["usd_per_million_output"],
        defaults.extract.usd_per_million_output,
      ),
    },
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
    return defaultConfig();
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

/**
 * `cwd` as a `/`-separated path relative to `root`, or `undefined` when it is outside the repo.
 * The repo root itself is the empty string, which is what a bare `**` pattern matches.
 */
export function relativeToRoot(root: string, cwd: string): string | undefined {
  const rel = path.relative(path.resolve(root), path.resolve(cwd));
  if (rel === "") return "";
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join("/");
}

/** A pattern that names a filesystem location rather than a repo-relative glob. */
function isAbsolutePattern(pattern: string): boolean {
  return pattern.startsWith("/") || pattern.startsWith("~") || path.isAbsolute(pattern);
}

/**
 * `true` when this session is private by configuration —
 * docs/contracts/p5/config-and-identities.md §`private_paths`.
 *
 * Two pattern shapes, because P5 redefined the key without invalidating what P1 repos already
 * have in it. A **relative** pattern is a picomatch glob matched against the session's `cwd`
 * relative to the repo root, which is the P5 rule and the one an operator writing
 * `experiments/**` expects. An **absolute** (or `~`-rooted) pattern keeps P1's prefix
 * semantics, matched against both the repo root and the session's `cwd` so a repo listed by its
 * path is still private no matter which subdirectory the session started in.
 */
export function isPrivateSession(
  root: string,
  cwd: string,
  patterns: readonly string[],
  home: string,
): boolean {
  const absolute = patterns.filter((pattern) => isAbsolutePattern(pattern.trim()));
  if (absolute.length > 0 && (isPrivatePath(root, absolute, home) || isPrivatePath(cwd, absolute, home))) {
    return true;
  }
  const relative = relativeToRoot(root, cwd);
  if (relative === undefined) return false;
  return patterns.some((raw) => {
    const pattern = raw.trim();
    if (pattern === "" || isAbsolutePattern(pattern)) return false;
    return matchGlob(relative, pattern.replace(/^\.\//, "").replace(/\/+$/, ""));
  });
}

// ---------------------------------------------------------------------------
// Full validation — `init` and `doctor` only
// ---------------------------------------------------------------------------

/**
 * The `.workledger/config.yaml` `workledger init` writes, verbatim from cli.md
 * §`.workledger/config.yaml` with `harnesses` set to the ones `init` enabled. It is assembled as
 * text rather than serialized from an object on purpose: the contract fixes the *text*, including
 * the flow mappings and the key order, and a round-trip through a YAML emitter would quietly
 * reformat it.
 */
export function configYaml(harnesses: readonly string[] = DEFAULT_CONFIG.harnesses): string {
  return [
    "schema_version: 1",
    `harnesses: [${(harnesses.length === 0 ? DEFAULT_CONFIG.harnesses : harnesses).join(", ")}]`,
    "thresholds: { bytes: 2000000, minutes: 20, turns: 15 }",
    "brief: { inject: true, max_tokens: 2000 }",
    "stale_turns: 5",
    "orphan_minutes: 30",
    "private_paths: []",
    // P5 (docs/contracts/p5/config-and-identities.md). `auto_commit` is `false`,
    // `on_checkpoint` or `on_session_end`; `identities_file` is relative to `.workledger/`.
    "auto_commit: false",
    "identities_file: identities.yaml",
    // P8 amendment 13. Read by the UI, never by the CLI: `vscode`, `cursor` or `none`.
    "editor: vscode",
    // P3 (docs/contracts/p3/cli.md §Config additions). Emitted so the knobs are discoverable in
    // the file rather than only in the contract; both blocks fall back to the same values when a
    // repo enabled before P3 has no line for them.
    "backfill: { since: 14d, concurrency: 2, seconds_per_session: 45 }",
    "extract: { model: claude-haiku-4-5, usd_per_million_input: 1, usd_per_million_output: 5 }",
    "",
  ].join("\n");
}

/** {@link configYaml} for a repo where only Claude Code was detected. */
export const DEFAULT_CONFIG_YAML: string = configYaml();
/** The outcome of validating one repo's `config.yaml` against the `Config` zod schema. */
export interface ConfigCheck {
  /** Absolute path of the file that was looked for. */
  file: string;
  /** `false` when there is no `config.yaml` at all — missing is not the same as invalid. */
  present: boolean;
  /** One line per validation failure, `<path>: <message>`. Empty when the file is valid. */
  errors: string[];
  /**
   * The mapping as it was written, unknown keys and key order intact (cli.md: "Unknown keys are
   * preserved and ignored"). Present whenever the YAML parsed, valid or not.
   */
  raw?: Record<string, unknown>;
  /** The validated config, defaults filled in. Present only when `errors` is empty. */
  config?: Record<string, unknown>;
}

/** Drop a BOM and a leading `---` document-start marker, so the whole file is one mapping. */
function withoutDocumentStart(text: string): string {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i += 1;
  if (lines[i]?.trimEnd() === "---") lines.splice(i, 1);
  return lines.join("\n");
}

/**
 * Validate `<root>/.workledger/config.yaml` with the real YAML parser and the `Config` zod
 * schema — the slow, complete path cli.md gives to `doctor` and `init`. The fast
 * {@link loadConfig} above stays the one the Stop hook uses, and an invalid file is defaults
 * there rather than an error (cli.md: "reported by `doctor` and treated as defaults by `hook`").
 *
 * The YAML is read through core's `parseFrontmatter` — the config file is wrapped in a
 * frontmatter fence and parsed as the mapping it is — rather than by adding a second `yaml`
 * dependency to `packages/cli`. Both imports are dynamic because this module is a *static*
 * import of `commands/hook.ts`, whose allow path must not pull `yaml` or zod
 * (plans/feature-p1-data-flow.md §6).
 */
export async function checkConfigFile(root: string): Promise<ConfigCheck> {
  const file = configFile(root);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { file, present: false, errors: [] };
  }

  const [{ parseFrontmatter }, { Config }] = await Promise.all([
    import("@workledger/core/frontmatter"),
    import("@workledger/core/schema"),
  ]);

  let raw: Record<string, unknown>;
  try {
    const parsed = parseFrontmatter(`---\n${withoutDocumentStart(text)}\n---\n`);
    if (parsed.body.trim() !== "") {
      return {
        file,
        present: true,
        errors: ["config.yaml must be a single YAML mapping; found a `---` document separator"],
      };
    }
    raw = parsed.data;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // The wrapper fence is an implementation detail; the user's file has no frontmatter.
    return { file, present: true, errors: [detail.replace(/(?:the )?frontmatter block/g, "config.yaml")] };
  }

  const result = Config.safeParse(raw);
  if (!result.success) {
    return {
      file,
      present: true,
      raw,
      errors: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      ),
    };
  }
  return { file, present: true, raw, errors: [], config: result.data };
}
