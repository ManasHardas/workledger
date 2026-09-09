// usage: import { REDACTION_PATTERNS, redact, scan } from "./redact-patterns.mjs"
//
// The vendored redaction/secret-pattern set used by scripts/capture-fixtures.mjs (redact before
// write) and scripts/check-fixtures.mjs (assert zero findings after write).
//
// This file is deliberately dependency-free and framework-free so that the core secret scanner
// (P1 slot 5, packages/core) can be diffed against it: same pattern names, same intent, no
// imports to reconcile. If the two drift, the drift is a contract question, not a silent fix.
//
// Contract (plans/feature-p1-data-flow.md §8): a finding names a file path and a *pattern name*.
// The matched text is never returned, printed, or logged by anything in this module.

/**
 * Ordered secret/PII patterns. Order matters: multi-line block patterns run before the
 * single-token patterns that could otherwise nibble at their contents, and the broad
 * `generic-api-key` heuristic runs after the specific vendor formats so findings get the most
 * precise name available.
 *
 * Every entry is `{ name, re }` where `re` carries the `g` flag. `name` is the label that shows
 * up in `<redacted:NAME>` and in scan findings.
 *
 * Invariant, verified by scripts/check-fixtures.mjs on every CI run: redaction is idempotent —
 * no replacement string (`<redacted:NAME>`, `/home/user`) matches any pattern in this set.
 */
export const REDACTION_PATTERNS = [
  {
    name: "private-key",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: "aws-access-key-id", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA)[0-9A-Z]{16}\b/g },
  {
    name: "aws-secret-access-key",
    re: /\baws_?secret_?access_?key\b["'\s]*[:=][:=\s]*["']?[A-Za-z0-9/+=]{40}/gi,
  },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,255}\b/g },
  { name: "github-pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g },
  { name: "slack-token", re: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g },
  { name: "slack-webhook", re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+_-]{10,}/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g },
  { name: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  {
    name: "generic-api-key",
    // Deliberately a heuristic: a key-ish assignment followed by something long enough to be a
    // credential. False positives are acceptable here — over-redacting a fixture costs nothing,
    // under-redacting costs a leak.
    re: /\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["'\s]*[:=][:=\s]*["']?[A-Za-z0-9._~+/-]{16,}/gi,
  },
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
];

/**
 * Absolute home directories, rewritten rather than tagged: fixtures stay *readable* as paths so
 * transcript-shaped tests still see a plausible path, they just stop naming a real person.
 * `<name>` is any single path segment, so `/Users/alice/x` becomes `/home/user/x`.
 */
export const HOME_PATH_PATTERNS = [
  { name: "home-path", re: /\/Users\/[A-Za-z0-9._%+-]+/g, replacement: "/home/user" },
  { name: "home-path", re: /\/home\/(?!user\b)[A-Za-z0-9._%+-]+/g, replacement: "/home/user" },
  // The JSON-escaped form that shows up inside transcript JSONL string values.
  { name: "home-path", re: /\\\/Users\\\/[A-Za-z0-9._%+-]+/g, replacement: "\\/home\\/user" },
  // Claude Code's project-directory slug: the absolute path with `/` turned into `-`, so
  // `/Users/alice/Projects` becomes `-Users-alice-Projects`. The username segment excludes `-`
  // so only that one segment is eaten and the rest of the slug survives.
  { name: "home-path", re: /-Users-[A-Za-z0-9._%+]+/g, replacement: "-home-user" },
];

/**
 * Known gaps — deliberately not patterns, recorded so nobody mistakes "0 findings" for "clean".
 *
 * 1. **Personal names.** No vendored regex can find "Ada Lovelace" in prose. capture-fixtures.mjs
 *    handles this at capture time from `git config user.name` / `user.email` and `--redact-name`,
 *    which is machine-derived and therefore *not* re-checkable by check-fixtures.mjs in CI. An
 *    earlier revision of this slot derived only the account name and left the operator's real
 *    full name in a committed transcript seven times; that is the failure mode this note exists
 *    for. Grep the fixtures for the name before committing.
 * 2. **Usernames containing a dash.** The Claude-slug rule above eats one `-`-free segment, so
 *    `-Users-ada-lovelace-Projects` would keep `lovelace`. The capture-time identity pass covers
 *    it in practice; the pattern set alone does not.
 * 3. **IP addresses and localhost ports.** No rule. The current fixtures carry third-party public
 *    IPs and `localhost:3000/5173/8000` inside quoted prose about other companies' sites — benign,
 *    and a generic IPv4 rule would shred version numbers and byte counts. If a fixture ever
 *    carries an address belonging to *this* machine or its network, redact it by hand or with
 *    `--redact-name`.
 */
export const KNOWN_GAPS = ["personal-names", "dashed-usernames", "ip-addresses"];

/** The tag written in place of a match. Kept here so slot 5 can assert the same shape. */
export function redactionTag(name) {
  return `<redacted:${name}>`;
}

/**
 * Redact `text`. Home paths are rewritten to `/home/user`; every other pattern match becomes
 * `<redacted:NAME>`. Returns `{ text, findings }` where `findings` is `[{ name, count }]` —
 * counts only, never the matched text.
 */
export function redact(text) {
  let out = text;
  const findings = [];
  for (const { name, re, replacement } of [...HOME_PATH_PATTERNS, ...REDACTION_PATTERNS]) {
    let count = 0;
    out = out.replace(new RegExp(re.source, re.flags), () => {
      count += 1;
      return replacement ?? redactionTag(name);
    });
    if (count > 0) {
      const existing = findings.find((f) => f.name === name);
      if (existing) existing.count += count;
      else findings.push({ name, count });
    }
  }
  return { text: out, findings };
}

/**
 * Scan `text` without modifying it. Returns `[{ name, count }]` — the pattern names that hit and
 * how often. Used by the post-write assertion; a non-empty result from a committed fixture is a
 * build failure, not a warning.
 */
export function scan(text) {
  const findings = [];
  for (const { name, re } of [...HOME_PATH_PATTERNS, ...REDACTION_PATTERNS]) {
    const matches = text.match(new RegExp(re.source, re.flags));
    if (!matches) continue;
    const existing = findings.find((f) => f.name === name);
    if (existing) existing.count += matches.length;
    else findings.push({ name, count: matches.length });
  }
  return findings;
}
