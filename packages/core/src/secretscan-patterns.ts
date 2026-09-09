/**
 * The vendored, gitleaks-style secret pattern set used by every scan point in data-flow §8.
 *
 * Patterns are *data*, not code: each entry is a `{ name, regex, description }` record and the
 * walker in `./secretscan.js` is the only thing that knows how to run them. Adding a credential
 * format is a one-record change here.
 *
 * ## Relationship to `scripts/redact-patterns.mjs`
 *
 * `scripts/redact-patterns.mjs` (owned by the fixture-capture tooling) carries the same set for
 * scrubbing captured fixtures before they are committed. This module is a **superset** of it and
 * agrees on every shared `name`, so a finding reported by one is named identically by the other.
 * Two deliberate differences, both documented so a diff of the two files is never a silent drift:
 *
 * 1. `email` and `home-path` are **not** in this set. They are privacy rewrites for fixtures that
 *    get committed to the repo, not credentials. A ledger is local-only (design spec §11), a note
 *    may legitimately name a colleague or an absolute path, and a hit here rejects the whole
 *    checkpoint with exit `3` (`docs/contracts/p1/cli.md`). Over-redacting a fixture costs
 *    nothing; over-rejecting a checkpoint costs the user their turn.
 * 2. `private-key` matches the **BEGIN header alone** rather than the full BEGIN…END block. The
 *    redactor needs the whole block because it rewrites it; the scanner only needs to know one is
 *    present, and header-only matching is strictly broader (it also catches a truncated block) and
 *    strictly linear-time, where a lazy `[\s\S]*?` body is not.
 *
 * Additions over the redactor's set: `google-api-key`, `stripe-key`, `env-secret-assignment`, and
 * a widened `generic-api-key` keyword list (`password`, `passwd`, `token`, `secret` on their own).
 *
 * ## Ordering
 *
 * Specific vendor formats come first, broad heuristics last. `scanText` drops a candidate whose
 * span overlaps an already-accepted finding, so a credential is reported under the most precise
 * pattern name available.
 *
 * ## Linear time
 *
 * Every regex here is written to run in time linear in the input length: no nested quantifiers,
 * no alternation inside a repetition, every unbounded repetition followed by a character that its
 * own class cannot match (so a failed match cannot backtrack more than a bounded amount), and
 * every lookahead bounded. `secretscan.test.ts > "runs in linear time"` holds each pattern to
 * 50 ms against 100 KB adversarial strings built to maximise backtracking.
 *
 * This module is pure: no Node built-ins, no I/O, no dependencies.
 */

/** One named credential shape. */
export interface SecretPattern {
  /** Stable label reported in a {@link import("./secretscan.js").Finding}. Never a value. */
  readonly name: string;
  /**
   * The matcher. Carries the `g` flag (plus `i`/`m` where noted); `scanText` resets `lastIndex`
   * before every use, so the shared instance is safe to reuse but is not re-entrant.
   */
  readonly regex: RegExp;
  /** What the pattern recognises, for humans reading a finding or reviewing this list. */
  readonly description: string;
  /**
   * When set, a match only counts if its value looks like a credential rather than a phrase:
   * capture group 1 (or the whole match, when the pattern has no group) must clear this Shannon
   * entropy in bits per character *and* carry a digit or both letter cases. Only the two broad
   * heuristics set it; the vendor formats are self-identifying and stay ungated, so this set can
   * never miss something `scripts/redact-patterns.mjs` catches under the same name.
   *
   * The value is inspected inside `scanText` and never leaves it.
   */
  readonly minEntropyBits?: number;
}

/**
 * The ordered pattern set. The array is frozen; `readonly` keeps the records themselves from
 * being reassigned through this type.
 *
 * @see SecretPattern for the linear-time and naming rules every entry follows.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = Object.freeze([
  {
    name: "private-key",
    // Header only, deliberately: see the module note. `(?:RSA |EC |...)?` is a bounded optional
    // alternation of literals, not a repetition, so there is nothing to backtrack into.
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
    description: "PEM private-key block header (RSA, DSA, EC, OpenSSH, PGP, or encrypted).",
  },
  {
    name: "jwt",
    // Three base64url segments. Each `{8,}` is followed by `\.`, which its own class excludes, so
    // a failed match backtracks at most the length of one segment run.
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    description: "JSON Web Token: a base64url header starting `eyJ` and two more segments.",
  },
  {
    name: "aws-access-key-id",
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA)[0-9A-Z]{16}\b/g,
    description: "AWS access key id: a 4-character account-type prefix and 16 uppercase chars.",
  },
  {
    name: "aws-secret-access-key",
    regex: /\baws_?secret_?access_?key\b["'\s]*[:=][:=\s]*["']?([A-Za-z0-9/+=]{40})/gi,
    description: "AWS secret access key assigned to an `aws_secret_access_key` key.",
  },
  {
    name: "github-token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,255}\b/g,
    description: "GitHub personal, OAuth, user-to-server, server-to-server, or refresh token.",
  },
  {
    name: "github-pat",
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g,
    description: "GitHub fine-grained personal access token (`github_pat_`).",
  },
  {
    name: "slack-token",
    regex: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g,
    description: "Slack bot, app, user, refresh, or legacy token (`xoxb-`, `xoxp-`, …).",
  },
  {
    name: "slack-webhook",
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+_-]{10,}/g,
    description: "Slack incoming-webhook URL, which is itself the credential.",
  },
  {
    name: "anthropic-key",
    regex: /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
    description: "Anthropic API key (`sk-ant-`).",
  },
  {
    name: "openai-key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g,
    description: "OpenAI API key, project-scoped or classic (`sk-`, `sk-proj-`).",
  },
  {
    name: "stripe-key",
    // Underscore-separated, so this cannot collide with the hyphenated `sk-` vendor keys above.
    regex: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
    description: "Stripe secret or restricted key (`sk_live_`, `sk_test_`, `rk_live_`, …).",
  },
  {
    name: "google-api-key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    description: "Google API key (`AIza` and 35 more characters).",
  },
  {
    name: "npm-token",
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
    description: "npm automation or publish token (`npm_`).",
  },
  {
    name: "bearer-token",
    // `[A-Za-z0-9._~+/-]` excludes `=`, so `{16,}=*` has no ambiguous split to backtrack through.
    regex: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/g,
    description: "An `Authorization: Bearer` credential.",
  },
  {
    name: "generic-api-key",
    // A credential-ish key assigned a credential-ish value. Broader than the redactor's list by
    // `password`, `passwd`, `token`, and bare `secret`; `minEntropyBits` is what keeps prose such
    // as `token: rotate it monthly` and `password: see 1Password` from matching.
    regex:
      /\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token)\b["'\s]*[:=][:=\s]*["']?([A-Za-z0-9._~+/-]{16,})/gi,
    description: "An api-key/secret/token/password assignment whose value looks like a credential.",
    minEntropyBits: 3,
  },
  {
    name: "env-secret-assignment",
    // A dotenv line whose NAME is credential-shaped. The bounded lookahead identifies the name
    // without a second unbounded pass, so the leading `[A-Z0-9_]{1,64}` never backtracks into it.
    regex:
      /^[ \t]*(?:export[ \t]+)?(?=[A-Z0-9_]{0,64}(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|KEY))[A-Z0-9_]{1,64}[ \t]*=[ \t]*["']?([A-Za-z0-9._~+/=-]{16,})/gm,
    description: "A `.env`-style `NAME=value` line whose name is credential-shaped.",
    minEntropyBits: 3,
  },
]);

/** Every pattern name in {@link SECRET_PATTERNS}, in order. Handy for tests and docs. */
export const SECRET_PATTERN_NAMES: readonly string[] = Object.freeze(
  SECRET_PATTERNS.map((pattern) => pattern.name),
);
