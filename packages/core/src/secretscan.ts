import { SECRET_PATTERNS, type SecretPattern } from "./secretscan-patterns.js";

/**
 * The secret scanner behind the three scan points in `plans/feature-p1-data-flow.md` §8:
 * `checkpoint` step 3 on the raw payload, `checkpoint` step 6 on the rendered session and backlog
 * text, and the fixture-capture script on anything about to be committed.
 *
 * ## The one invariant
 *
 * **A {@link Finding} never carries the matched text, or any substring of the scanned strings.**
 * It carries a JSON path, a pattern *name*, and the span (`index`, `length`) where the match sat,
 * which is enough for a caller to redact or to point a human at the right line and not enough to
 * reconstruct a character of the credential. `docs/contracts/p1/cli.md` step 3 turns a finding
 * into `secret detected at <json-path> (<pattern>)` on stderr and exits `3` having written
 * nothing; the CLI also records that stderr text in the index, so anything this module returns
 * ends up persisted. `secretscan.test.ts` holds the invariant with a substring assertion over
 * every planted case.
 *
 * Object *keys* do become part of the reported path, because the path is the whole point of a
 * finding. That is safe here: the payload is validated against the schema (step 2) before it is
 * scanned (step 3), so its key set is fixed by the contract rather than chosen by the caller.
 *
 * This module is pure: no Node built-ins, no I/O, no dependencies.
 */

/** One secret match. Location and pattern name only — never the value. See the module note. */
export interface Finding {
  /** JSON path of the string the match sat in, e.g. `done[0].text`, or the `scanText` label. */
  readonly path: string;
  /** The {@link SecretPattern} name that matched, e.g. `github-token`. */
  readonly pattern: string;
  /** Character offset of the match within that string. */
  readonly index: number;
  /** Character length of the match. */
  readonly length: number;
}

/**
 * How deep {@link scanValue} descends before it stops. A checkpoint payload is three levels deep
 * (`done[0].files[0]`); 32 is far past any legitimate shape and bounds the work a hostile or
 * accidentally recursive structure can cause.
 */
export const MAX_SCAN_DEPTH = 32;

/** Object keys longer than this are truncated in a reported path, so a path stays readable. */
const MAX_PATH_SEGMENT = 64;

/** Keys rendered as `.name`; anything else gets bracket-quoted so the path stays unambiguous. */
const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Scan a single string and return every match, ordered by position.
 *
 * `label` names the string in the returned findings — a JSON path when the caller is walking a
 * payload, or a file-ish label such as `session.md` when the caller is scanning rendered text
 * (data-flow §8 point 2).
 *
 * Overlapping matches collapse to the first-listed pattern: {@link SECRET_PATTERNS} runs specific
 * vendor formats before broad heuristics, so a credential is reported under the most precise name
 * available rather than twice.
 */
export function scanText(text: string, label: string): Finding[] {
  const accepted: Finding[] = [];
  // Bitmap of the characters already claimed by an accepted finding. Allocated on the first hit,
  // so the common case — a clean string — allocates nothing. Keeps overlap detection linear in
  // the matched length rather than quadratic in the number of findings.
  let claimed: Uint8Array | undefined;

  for (const pattern of SECRET_PATTERNS) {
    const { regex } = pattern;
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const length = match[0].length;
      // A zero-length match would spin forever; no pattern in the set can produce one, but the
      // guard costs nothing and keeps that a local fact rather than a cross-file assumption.
      if (length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      if (!isCredentialShaped(match, pattern)) continue;
      if (claimed !== undefined && isClaimed(claimed, match.index, length)) continue;
      claimed ??= new Uint8Array(text.length);
      claimed.fill(1, match.index, match.index + length);
      accepted.push({ path: label, pattern: pattern.name, index: match.index, length });
    }
    regex.lastIndex = 0;
  }
  return accepted.sort((a, b) => a.index - b.index || a.pattern.localeCompare(b.pattern));
}

/**
 * Walk `value` and scan every string in it, reporting each finding at its JSON path.
 *
 * Strings, arrays, and plain objects are traversed; numbers, booleans, `null`, and non-plain
 * objects (a `Map`, a class instance) are skipped — a checkpoint payload is JSON by contract.
 * Traversal stops at {@link MAX_SCAN_DEPTH} and refuses to re-enter a container already on the
 * current path, so a cycle terminates while a value referenced twice is still scanned twice.
 *
 * @param value the payload, or any fragment of one.
 * @param path JSON path prefix for the reported findings; defaults to the empty root.
 */
export function scanValue(value: unknown, path = ""): Finding[] {
  const findings: Finding[] = [];
  const ancestors = new Set<object>();
  walk(value, path, 0, ancestors, findings);
  return findings;
}

/**
 * Render findings as the stderr lines `docs/contracts/p1/cli.md` step 3 specifies:
 * `secret detected at <json-path> (<pattern>)`. One line per finding, order preserved.
 */
export function formatFindings(findings: readonly Finding[]): string[] {
  return findings.map((finding) => `secret detected at ${finding.path} (${finding.pattern})`);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function walk(
  value: unknown,
  path: string,
  depth: number,
  ancestors: Set<object>,
  out: Finding[],
): void {
  if (typeof value === "string") {
    out.push(...scanText(value, path));
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (depth >= MAX_SCAN_DEPTH) return;

  const container = value as object;
  if (ancestors.has(container)) return;
  ancestors.add(container);
  try {
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) walk(item, `${path}[${i}]`, depth + 1, ancestors, out);
    } else if (isPlainObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        walk(item, childPath(path, key), depth + 1, ancestors, out);
      }
    }
  } finally {
    ancestors.delete(container);
  }
}

/** Only `{}`-shaped objects are walked; `Object.create(null)` counts, a class instance does not. */
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function childPath(parent: string, key: string): string {
  const segment = key.length > MAX_PATH_SEGMENT ? `${key.slice(0, MAX_PATH_SEGMENT)}…` : key;
  if (!PLAIN_KEY.test(segment)) return `${parent}[${JSON.stringify(segment)}]`;
  return parent === "" ? segment : `${parent}.${segment}`;
}

function isClaimed(claimed: Uint8Array, index: number, length: number): boolean {
  for (let i = index; i < index + length; i += 1) if (claimed[i] === 1) return true;
  return false;
}

/**
 * For a pattern carrying `minEntropyBits`, decide whether the matched value is credential-shaped
 * rather than a phrase. Two tests, and both must pass:
 *
 * 1. Shannon entropy at or above the pattern's floor, which rejects filler such as `aaaa…`.
 * 2. A credential alphabet — at least one digit, or both cases of a letter. This is what keeps
 *    `token: rotate-it-monthly-please` out of the findings: it is long enough and varied enough
 *    to clear an entropy floor, and it is still obviously prose. Generated credentials are
 *    hex, base64, or base62; all three carry digits or mixed case.
 *
 * The value is read here and nowhere else; nothing derived from it reaches a {@link Finding}.
 */
function isCredentialShaped(match: RegExpExecArray, pattern: SecretPattern): boolean {
  const floor = pattern.minEntropyBits;
  if (floor === undefined) return true;
  const value = match[1] ?? match[0];
  return shannonBitsPerChar(value) >= floor && hasCredentialAlphabet(value);
}

/** Shannon entropy of `text` in bits per character. `0` for an empty or single-symbol string. */
function shannonBitsPerChar(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Whether `text` carries a digit, or both an uppercase and a lowercase letter. */
function hasCredentialAlphabet(text: string): boolean {
  return /[0-9]/.test(text) || (/[a-z]/.test(text) && /[A-Z]/.test(text));
}
