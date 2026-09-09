import { SECRET_PATTERNS, type SecretPattern } from "./secretscan-patterns.js";

/**
 * The secret scanner behind the three scan points in `plans/feature-p1-data-flow.md` §8:
 * `checkpoint` step 3 on the raw payload, `checkpoint` step 6 on the rendered session and backlog
 * text, and the fixture-capture script on anything about to be committed.
 *
 * ## The one invariant
 *
 * **A {@link Finding} never carries the matched text, or any substring of the scanned value —
 * including a substring of an object key.** It carries a JSON path, a pattern *name*, and the
 * span (`index`, `length`) where the match sat, which is enough for a caller to redact or to
 * point a human at the right line and not enough to reconstruct a character of the credential.
 * `docs/contracts/p1/cli.md` step 3 turns a finding into `secret detected at <json-path>
 * (<pattern>)` on stderr and exits `3` having written nothing; the CLI also records that stderr
 * text in the index as `last_attempt_errors`, so anything this module returns ends up persisted.
 *
 * Object keys are the sharp edge there, because a key is caller data that ends up *in the path*.
 * Two rules, both enforced in `keySegment` and both unconditional — they do not rely on the
 * caller having validated the payload first:
 *
 * 1. A key is scanned like any other string. A credential used as a key is a finding at that
 *    position, not a silent miss.
 * 2. A key only appears in a path if it is a short plain identifier *and* it scans clean.
 *    Anything else is reported positionally as `<key#3>`.
 *
 * `secretscan.test.ts` holds the invariant with a substring assertion over every planted case.
 *
 * ## Failing closed
 *
 * `[]` from {@link scanValue} means "I read everything and found nothing". It never means "I
 * declined to look": a container this walker cannot read — a `Map`, a `Set`, a class instance, a
 * function — and a subtree past {@link MAX_SCAN_DEPTH} both produce a reserved
 * {@link UNSCANNABLE} finding at that path, so step 3 exits `3` rather than waving through a
 * payload it never inspected. A string with more matches than {@link MAX_FINDINGS_PER_STRING}
 * produces a reserved {@link TRUNCATED} finding instead of the remainder.
 *
 * This module is pure: no Node built-ins, no I/O, no dependencies.
 */

/**
 * One secret match, or one reserved marker. Location and pattern name only — never the value,
 * and never a substring of the input: see the module note on object keys.
 */
export interface Finding {
  /**
   * JSON path of the string the match sat in, e.g. `done[0].text`, or the `scanText` label.
   *
   * An object key appears here only when it is a short plain identifier, is not a long hex run,
   * and scans clean — so it is safe *to the limit of what this scanner detects*, which is a
   * weaker claim than "carries no credential". Everything else is positional (`<key#3>`).
   */
  readonly path: string;
  /**
   * The {@link SecretPattern} name that matched, e.g. `github-token`, or one of the reserved
   * names {@link UNSCANNABLE} and {@link TRUNCATED}.
   */
  readonly pattern: string;
  /** Character offset of the match within that string; `0` for a reserved marker. */
  readonly index: number;
  /** Character length of the match; `0` for a reserved marker. */
  readonly length: number;
}

/**
 * Reserved pattern name: this walker could not read the value at that path, so nothing about it
 * is known. Emitted for a `Map`, a `Set`, a class instance, a function, a symbol, a bigint, and
 * for any subtree past {@link MAX_SCAN_DEPTH}.
 */
export const UNSCANNABLE = "unscannable";

/**
 * Reserved pattern name: the string at that path had more than {@link MAX_FINDINGS_PER_STRING}
 * matches and the remainder was not reported. The findings that *were* reported are still exact.
 */
export const TRUNCATED = "truncated";

/**
 * How deep {@link scanValue} descends before it stops and reports {@link UNSCANNABLE}. A
 * checkpoint payload is three levels deep (`done[0].files[0]`); 32 is far past any legitimate
 * shape. This bounds recursion depth; the memo in {@link scanValue} is what bounds total work,
 * so a shared subgraph costs one walk rather than one walk per path into it.
 */
export const MAX_SCAN_DEPTH = 32;

/**
 * Cap on findings reported for a single string, after which {@link TRUNCATED} stands in for the
 * rest. A payload is capped at 4 KB by the schema, but scan point 3 runs over arbitrary captured
 * transcripts, where an unbounded result array is a denial of service against the tool that is
 * supposed to be protecting the repo.
 */
export const MAX_FINDINGS_PER_STRING = 1000;

/**
 * Cap on findings reported by one {@link scanValue} call, after which {@link TRUNCATED} stands in
 * for the rest. The memo bounds how much *walking* a shared subgraph costs, but a diamond has
 * genuinely exponentially many distinct paths to its leaf — every one a real path — so the output
 * needs its own bound. A caller exits `3` on the first finding regardless; a thousand is far past
 * what any human or log reads.
 */
export const MAX_FINDINGS_TOTAL = 1000;

/** A key may appear in a path only if it is at most this long and a plain identifier. */
const MAX_PATH_SEGMENT = 40;

/** Keys allowed into a path verbatim — provided they also scan clean. */
const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_$]{0,39}$/;

/**
 * A long hex run is a valid identifier but is far likelier to be a credential than a field name,
 * and the scanner cannot always tell (see the 40-hex note on {@link PROJECT_SHAPES}). Keys of
 * this shape are reported positionally rather than trusted.
 */
const HEX_KEY = /^[0-9a-fA-F]{16,}$/;

/** The longest unbroken alphanumeric run a generated credential is expected to contain. */
const CREDENTIAL_RUN = /[A-Za-z0-9]{16,}/;

/** Symbols a human picks for a password and prose, paths, and identifiers do not use. */
const PASSWORD_SYMBOL = /[@!#$%^&*]/;

/** A canonical UUID: the shape an `.npmrc` token or a `client_secret` often takes. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * This project's own identifier shapes, rejected for a keyword-anchored match. A checkpoint note
 * names a `WL-` id or a commit hash next to the word "token" constantly, and a finding there
 * costs the user the whole checkpoint.
 */
const PROJECT_SHAPES: readonly RegExp[] = [
  /^WL-[0-9A-HJKMNP-TV-Z]{26}$/, // backlog id
  /^[0-9A-HJKMNP-TV-Z]{26}$/, // ULID
  // Git's canonical hash forms only — lowercase, and at an abbreviation or full SHA-1 length.
  // Anything else hex is far more likely a credential: a 32- or 48-character hex API key, an
  // HMAC secret, a 64-character Django `SECRET_KEY`. Rejecting all of 7-64 (revision 2) silently
  // traded away the entire hex-credential class, which revision 1 caught.
  //
  // 40 lowercase hex stays rejected, and that is a real collision: `access_token=<40 hex>` is
  // byte-identical to `token: <commit sha>`, which Code Review pinned as a false positive. A
  // false positive there is unrecoverable — data-flow §2 retries the identical input, fails
  // identically, and gives up with no `--force` — while a false negative degrades. So the
  // ambiguous length resolves toward the user keeping their checkpoint. `KNOWN_GAPS` says so.
  /^[0-9a-f]{7,12}$/, // abbreviated git hash
  /^[0-9a-f]{40}$/, // full SHA-1: a commit hash, or a 40-hex credential we cannot tell apart
  /^\d{4}-\d{2}-\d{2}(?:T[\d:.]{1,15}(?:Z|[+-]\d{2}:?\d{2})?)?$/, // ISO timestamp
  /^\$\{?[A-Za-z_]/, // shell or env-var reference
  /^<[A-Za-z0-9:._-]{1,64}>$/, // <redacted:…> tag and friends
  // SCREAMING_SNAKE with at least one underscore: an env-var name or a doc placeholder
  // (`YOUR_TOKEN_HERE`, `NPM_TOKEN`), never a generated credential. The required underscore is
  // what keeps an all-uppercase base64 blob out of this shape.
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/,
  /^~?[./]{0,2}(?:[A-Za-z0-9._~-]{1,64}\/){1,16}[A-Za-z0-9._~-]{0,64}\.[A-Za-z0-9]{1,10}$/, // path with an extension
  /^@?[A-Za-z0-9._~/-]{1,64}@\d{1,4}\.\d{1,4}\.\d{1,4}/, // package@semver
];

/**
 * Scan a single string and return every match, ordered by position.
 *
 * `label` names the string in the returned findings — a JSON path when the caller is walking a
 * payload, or a file-ish label such as `session.md` when the caller is scanning rendered text
 * (data-flow §8 point 2).
 *
 * Overlapping matches collapse to the first-listed pattern: {@link SECRET_PATTERNS} runs specific
 * vendor formats before broad heuristics, so a credential is reported under the most precise name
 * available rather than twice. At most {@link MAX_FINDINGS_PER_STRING} findings are returned,
 * followed by a {@link TRUNCATED} marker if there were more.
 */
export function scanText(text: string, label: string): Finding[] {
  const accepted: Finding[] = [];
  // Bitmap of the characters already claimed by an accepted finding. Allocated on the first hit,
  // so the common case — a clean string — allocates nothing. Keeps overlap detection linear in
  // the matched length rather than quadratic in the number of findings.
  let claimed: Uint8Array | undefined;
  let truncated = false;

  for (const pattern of SECRET_PATTERNS) {
    if (truncated) break;
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
      if (accepted.length >= MAX_FINDINGS_PER_STRING) {
        truncated = true;
        break;
      }
      claimed ??= new Uint8Array(text.length);
      claimed.fill(1, match.index, match.index + length);
      accepted.push({ path: label, pattern: pattern.name, index: match.index, length });
    }
    regex.lastIndex = 0;
  }

  accepted.sort((a, b) => (a.index === b.index ? comparePattern(a, b) : a.index - b.index));
  if (truncated) accepted.push({ path: label, pattern: TRUNCATED, index: 0, length: 0 });
  return accepted;
}

/**
 * Walk `value` and scan every string in it — and every object key — reporting each finding at its
 * JSON path.
 *
 * Strings, arrays, and plain objects are traversed; `number`, `boolean` and `null` carry no text
 * and are skipped. Anything else — a `Map`, a `Set`, a class instance, a function, `undefined` —
 * is reported as {@link UNSCANNABLE} rather than passed over, and so is any subtree past
 * {@link MAX_SCAN_DEPTH}. See the module note on failing closed.
 *
 * A container already on the current path is a cycle and is not re-entered. A container reached
 * twice by different paths is walked once and its findings are re-pathed, so a diamond costs one
 * walk rather than two and a deep shared subgraph cannot blow up exponentially.
 *
 * @param value the payload, or any fragment of one.
 * @param path JSON path prefix for the reported findings; defaults to the empty root.
 */
export function scanValue(value: unknown, path = ""): Finding[] {
  const state: WalkState = {
    ancestors: new Set<object>(),
    memo: new Map<object, Memo>(),
    truncated: false,
  };
  const relative = walk(value, 0, state);
  const out: Finding[] = [];
  for (const finding of relative) out.push({ ...finding, path: absolutePath(path, finding.path) });
  if (state.truncated) {
    out.push({ path: absolutePath(path, ""), pattern: TRUNCATED, index: 0, length: 0 });
  }
  return out;
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

/** A walked container's findings, relative to that container, and the depth they were taken at. */
interface Memo {
  readonly depth: number;
  readonly findings: readonly Finding[];
}

/** Mutable state shared across one {@link scanValue} walk. */
interface WalkState {
  /** Containers on the current path, for cycle detection. */
  readonly ancestors: Set<object>;
  /** Containers already walked, so a shared subgraph costs one walk. */
  readonly memo: Map<object, Memo>;
  /** Whether the {@link MAX_FINDINGS_TOTAL} cap was hit and a {@link TRUNCATED} marker is owed. */
  truncated: boolean;
}

/**
 * Walk one node and return its findings with paths *relative to that node* — `""` for the node
 * itself, `[0]` or `.key` for a child. Relative paths are what make the memo re-usable: the same
 * container reached by two paths yields one walk and two re-pathings.
 */
function walk(value: unknown, depth: number, state: WalkState): readonly Finding[] {
  if (typeof value === "string") return scanText(value, "");
  if (value === null || typeof value === "number" || typeof value === "boolean") return [];
  if (typeof value !== "object") return [unscannable("")];

  const container = value as object;
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(container)) return [unscannable("")];
  if (state.ancestors.has(container)) return [];

  const cached = state.memo.get(container);
  // A memo taken at least as deep as this visit saw at least as much of the subtree, so it is
  // safe to reuse. A shallower visit may reach further and is re-walked.
  if (cached !== undefined && cached.depth <= depth) return cached.findings;

  if (depth >= MAX_SCAN_DEPTH) return [unscannable("")];

  const out: Finding[] = [];
  state.ancestors.add(container);
  try {
    if (isArray) {
      const items = value as unknown[];
      for (let i = 0; i < items.length && !state.truncated; i += 1) {
        appendRepathed(out, `[${i}]`, walk(items[i], depth + 1, state), state);
      }
    } else {
      const entries = Object.entries(container as Record<string, unknown>);
      for (let i = 0; i < entries.length && !state.truncated; i += 1) {
        const [key, item] = entries[i]!;
        const { segment, findings } = keySegment(key, i);
        appendRepathed(out, segment, findings, state);
        appendRepathed(out, segment, walk(item, depth + 1, state), state);
      }
    }
  } finally {
    state.ancestors.delete(container);
  }
  state.memo.set(container, { depth, findings: out });
  return out;
}

/**
 * Decide how one object key is named in a path, and scan it.
 *
 * A key reaches the path verbatim only when it is a short plain identifier *and* it carries no
 * credential; otherwise it is `<key#i>`, positional and value-free. Anything the key scan finds
 * is returned as a finding at the key's own position, so a credential used as a key is detected
 * rather than silently skipped.
 */
function keySegment(key: string, index: number): { segment: string; findings: readonly Finding[] } {
  const hits = scanText(key, "");
  const safe =
    hits.length === 0 &&
    key.length <= MAX_PATH_SEGMENT &&
    PLAIN_KEY.test(key) &&
    !HEX_KEY.test(key);
  return { segment: safe ? `.${key}` : `.<key#${index}>`, findings: hits };
}

/**
 * Prefix `findings` (relative to a child) with the child's own path segment, stopping at
 * {@link MAX_FINDINGS_TOTAL} for this container.
 *
 * The cap is applied per container rather than as a single running budget so that hitting it deep
 * in a diamond still leaves a full result to carry upward: a running budget spent at the bottom
 * would leave every level above it with nothing to re-path.
 *
 * A spread (`out.push(...findings)`) would also throw `RangeError` past ~124k elements, which
 * scan point 3 can reach over an arbitrary captured transcript.
 */
function appendRepathed(
  out: Finding[],
  segment: string,
  findings: readonly Finding[],
  state: WalkState,
): void {
  for (const finding of findings) {
    if (out.length >= MAX_FINDINGS_TOTAL) {
      state.truncated = true;
      return;
    }
    out.push({ ...finding, path: `${segment}${finding.path}` });
  }
}

function unscannable(path: string): Finding {
  return { path, pattern: UNSCANNABLE, index: 0, length: 0 };
}

/**
 * Join the caller's prefix with a relative path. A relative path starts with `.` or `[`, so at
 * the empty root the leading `.` is dropped and `done[0].text` comes out as the contract writes
 * it. A finding on the root value itself reports `$`, never the empty string.
 */
function absolutePath(prefix: string, relative: string): string {
  if (prefix === "") return relative === "" ? "$" : relative.replace(/^\./, "");
  return `${prefix}${relative}`;
}

/** Only `{}`-shaped objects are walked; `Object.create(null)` counts, a class instance does not. */
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isClaimed(claimed: Uint8Array, index: number, length: number): boolean {
  for (let i = index; i < index + length; i += 1) if (claimed[i] === 1) return true;
  return false;
}

/**
 * Tiebreak two findings at the same index by pattern name. Unreachable while the claimed-span
 * bitmap forbids overlapping accepted findings, but a plain codepoint comparison — not
 * `localeCompare` — keeps the ordering byte-identical on every ICU build if that ever changes.
 */
function comparePattern(a: Finding, b: Finding): number {
  if (a.pattern < b.pattern) return -1;
  return a.pattern > b.pattern ? 1 : 0;
}

/**
 * For a keyword-anchored pattern, decide whether the matched value is a credential or a phrase.
 * Three gates; a value passes on either of two routes.
 *
 * **Generated credentials** — hex, base64, base62 — are one long unbroken alphanumeric run. A
 * 16-character run is the floor, and it is what rejects `token: use-the-ci-token-from-1password`
 * and `PRIVATE_KEY_PATH=~/.ssh/id_ed25519.pub`: both clear an entropy floor comfortably and both
 * are word sequences whose longest run is under ten characters.
 *
 * **Human passwords** are shorter and broken up, but they use symbols (`@ ! # $ % ^ & *`) that
 * prose, paths, ULIDs and identifiers do not. A value carrying one of those, at least 12
 * characters long, is credential-shaped too — and so is a canonical UUID, whose runs are only
 * eight characters but which is a credential whenever a keyword put it there.
 *
 * Both routes then require the entropy floor and a mixed alphabet, and neither may be one of this
 * project's own {@link PROJECT_SHAPES} when the pattern asks for that filter.
 *
 * **Known floor**: a human-chosen password shorter than 12 characters, or 12–15 characters with
 * no symbol, is not detected. That is a decision, not an oversight — it is listed in
 * `KNOWN_GAPS`. Below that length a password is indistinguishable from an identifier, and the
 * cost of guessing wrong is the user losing the checkpoint with no way to override (data-flow §2
 * retries the identical input, then gives up; `cli.md` offers no `--force`).
 *
 * The value is read here and nowhere else; nothing derived from it reaches a {@link Finding}.
 */
function isCredentialShaped(match: RegExpExecArray, pattern: SecretPattern): boolean {
  const floor = pattern.minEntropyBits;
  if (floor === undefined && pattern.rejectProjectShapes !== true) return true;
  const value = match[1] ?? match[0];

  if (pattern.rejectProjectShapes === true && PROJECT_SHAPES.some((re) => re.test(value))) {
    return false;
  }
  if (floor === undefined) return true;

  const generated = CREDENTIAL_RUN.test(value);
  const humanPassword = value.length >= 12 && PASSWORD_SYMBOL.test(value);
  // A UUID's runs are only 8 characters, but a UUID sitting behind `client_secret=` is a
  // credential and a bare UUID never reaches here — the pattern is keyword-anchored.
  if (!generated && !humanPassword && !UUID.test(value)) return false;

  return shannonBitsPerChar(value) >= floor && hasMixedAlphabet(value);
}

/**
 * Shannon entropy of `text` in bits per character. `0` for an empty or single-symbol string.
 * Counts code points on both sides of the division, so an astral character cannot understate the
 * result the way a code-point histogram over a code-unit length would.
 */
function shannonBitsPerChar(text: string): number {
  const counts = new Map<string, number>();
  let total = 0;
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return 0;
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / total;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Whether `text` carries a digit, a symbol, or both an uppercase and a lowercase letter. */
function hasMixedAlphabet(text: string): boolean {
  if (/[0-9]/.test(text) || PASSWORD_SYMBOL.test(text)) return true;
  return /[a-z]/.test(text) && /[A-Z]/.test(text);
}
