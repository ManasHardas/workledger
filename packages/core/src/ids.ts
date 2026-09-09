/**
 * ULID minting for session and backlog ids.
 *
 * A ULID is 26 Crockford-base32 characters: 10 characters of millisecond timestamp (48 bits)
 * followed by 16 characters of randomness (80 bits). Lexicographic order therefore matches
 * creation order, which is what lets the ledger sort `.workledger/sessions/<ulid>.md` by
 * filename alone and what lets backlog ids be minted in-process with no coordination
 * (data-flow §3).
 *
 * This module is pure: randomness comes from `globalThis.crypto.getRandomValues` (Node ≥ 19 and
 * every modern browser), never `node:crypto`. The published `ulid` package was rejected because
 * its `node` export condition resolves to a build that imports `node:crypto`, which would break
 * the `packages/core` purity fence.
 */

/**
 * Crockford base32: the digits plus the uppercase letters with `I`, `L`, `O` and `U` removed.
 * This is exactly the character class frozen in the contracts as `[0-9A-HJKMNP-TV-Z]`.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Characters of the timestamp field. */
const TIME_CHARS = 10;
/** Bytes of entropy behind the random field. */
const RANDOM_BYTES = 10;
/** Characters of the random field: 10 bytes × 8 bits ÷ 5 bits per character. */
const RANDOM_CHARS = 16;
/** Largest timestamp a 48-bit ULID time field can hold (10889-08-02T05:31:50.655Z). */
const MAX_TIME = 281474976710655;

/** The `WL-` marker that distinguishes a backlog id from a bare session ULID. */
export const BACKLOG_ID_PREFIX = "WL-";

/** Shape of a bare ULID, matching `session-frontmatter.schema.json` §`id`. */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** Shape of a backlog id, matching `backlog-item.schema.json` §`id`. */
export const BACKLOG_ID_PATTERN = /^WL-[0-9A-HJKMNP-TV-Z]{26}$/;

/** The slice of the Web Crypto API this module needs. */
interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/** Overrides for {@link createUlidFactory}; both exist so tests can pin the id stream. */
export interface UlidFactoryOptions {
  /** Milliseconds since the epoch. Defaults to `Date.now`. */
  now?: () => number;
  /** Fresh entropy, exactly {@link RANDOM_BYTES} bytes. Defaults to Web Crypto. */
  random?: () => Uint8Array;
}

function webCrypto(): RandomSource {
  const candidate = (globalThis as Record<string, unknown>)["crypto"];
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof (candidate as RandomSource).getRandomValues !== "function"
  ) {
    throw new Error(
      "@workledger/core needs globalThis.crypto.getRandomValues, which requires Node >= 19 " +
        "or a browser; it never falls back to node:crypto.",
    );
  }
  return candidate as RandomSource;
}

function defaultRandom(): Uint8Array {
  return webCrypto().getRandomValues(new Uint8Array(RANDOM_BYTES));
}

/** Encode a millisecond timestamp as the 10-character time field. */
function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME) {
    throw new RangeError(`ULID timestamp must be an integer in [0, ${MAX_TIME}], got ${ms}`);
  }
  let out = "";
  let rest = ms;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    out = ENCODING.charAt(rest % ENCODING.length) + out;
    rest = Math.floor(rest / ENCODING.length);
  }
  return out;
}

/** Encode 10 bytes as the 16-character random field, big-endian across the whole bit run. */
function encodeRandom(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < RANDOM_BYTES; i += 1) {
    buffer = (buffer << 8) | (bytes[i] ?? 0);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ENCODING.charAt((buffer >>> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/**
 * Add one to a big-endian byte array in place. Returns `false` when every byte was `0xff`,
 * i.e. the 80-bit random field wrapped — 2^80 ids inside a single millisecond.
 */
function incrementBytes(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    const value = bytes[i] ?? 0;
    if (value < 0xff) {
      bytes[i] = value + 1;
      return true;
    }
    bytes[i] = 0;
  }
  return false;
}

function takeRandom(random: () => Uint8Array): Uint8Array {
  const bytes = random();
  if (!(bytes instanceof Uint8Array) || bytes.length !== RANDOM_BYTES) {
    throw new TypeError(`ULID randomness must be a Uint8Array of ${RANDOM_BYTES} bytes`);
  }
  // Copy: the factory mutates its buffer when several ids land in one millisecond, and a
  // caller-supplied `random` may hand back a shared array.
  const copy = new Uint8Array(RANDOM_BYTES);
  copy.set(bytes);
  return copy;
}

/**
 * Build a monotonic ULID generator.
 *
 * Ids from one factory are strictly increasing as strings even when many are minted inside a
 * single millisecond: the timestamp is held and the random field is incremented instead of
 * redrawn. A clock that jumps backwards is treated the same way, so a leap second or an NTP
 * correction can never make the id stream go backwards either.
 */
export function createUlidFactory(options: UlidFactoryOptions = {}): () => string {
  const now = options.now ?? Date.now;
  const random = options.random ?? defaultRandom;
  let lastTime = -1;
  let lastRandom: Uint8Array = new Uint8Array(RANDOM_BYTES);

  return function nextUlid(): string {
    const tick = now();
    if (typeof tick !== "number" || !Number.isFinite(tick)) {
      throw new RangeError(`ULID clock returned a non-finite value: ${String(tick)}`);
    }
    const ms = Math.floor(tick);
    if (ms > lastTime) {
      lastTime = ms;
      lastRandom = takeRandom(random);
    } else if (!incrementBytes(lastRandom)) {
      throw new Error("ULID randomness overflowed: more than 2^80 ids in a single millisecond");
    }
    return encodeTime(lastTime) + encodeRandom(lastRandom);
  };
}

/** The process-wide id stream. Sharing it keeps session and backlog ids mutually ordered. */
const nextUlid = createUlidFactory();

/** Mint the ULID for a new session file, `.workledger/sessions/<ulid>.md`. */
export function newSessionId(): string {
  return nextUlid();
}

/** Mint the id for a new backlog item, `.workledger/backlog/WL-<ulid>.md`. */
export function newBacklogId(): string {
  return BACKLOG_ID_PREFIX + nextUlid();
}

/** True when `value` is a bare 26-character ULID. */
export function isUlid(value: unknown): value is string {
  return typeof value === "string" && ULID_PATTERN.test(value);
}

/** True when `value` is a backlog id: `WL-` followed by a ULID. */
export function isBacklogId(value: unknown): value is string {
  return typeof value === "string" && BACKLOG_ID_PATTERN.test(value);
}

/**
 * Milliseconds since the epoch encoded in a ULID. Accepts a bare ULID or a `WL-` backlog id,
 * so callers can timestamp either kind without stripping the prefix first.
 */
export function ulidTime(id: string): number {
  const ulid = isBacklogId(id) ? id.slice(BACKLOG_ID_PREFIX.length) : id;
  if (!isUlid(ulid)) {
    throw new TypeError(`not a ULID: ${JSON.stringify(id)}`);
  }
  let ms = 0;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    ms = ms * ENCODING.length + ENCODING.indexOf(ulid.charAt(i));
  }
  return ms;
}

/** Character counts, exported so tests and callers assert against one definition. */
export const ULID_LENGTH = TIME_CHARS + RANDOM_CHARS;
