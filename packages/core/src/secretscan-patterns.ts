/**
 * The vendored, gitleaks-style secret pattern set used by every scan point in data-flow §8.
 *
 * Patterns are *data*, not code: each entry is a `{ name, regex, description }` record and the
 * walker in `./secretscan.js` is the only thing that knows how to run them. Adding a credential
 * format is a one-record change here.
 *
 * ## Relationship to `scripts/redact-patterns.mjs`
 *
 * `scripts/redact-patterns.mjs` carries the same set for scrubbing captured fixtures before they
 * are committed. This module is a **superset** of it and agrees on every shared `name`, so a
 * finding reported by one is named identically by the other.
 * `secretscan.test.ts > "is a superset of scripts/redact-patterns.mjs"` imports that module and
 * compares the name sets directly, so drift on either side fails the build rather than going
 * unnoticed. Two deliberate differences:
 *
 * 1. `email` and `home-path` are **not** in this set. They are privacy rewrites for fixtures that
 *    get committed to the repo, not credentials. A ledger is local-only (design spec §11), a note
 *    may legitimately name a colleague or an absolute path, and a hit here rejects the whole
 *    checkpoint with exit `3` (`docs/contracts/p1/cli.md`). Over-redacting a fixture costs
 *    nothing; over-rejecting a checkpoint costs the user their turn — and, per data-flow §2, the
 *    retry sees the same input, fails identically, and the give-up rule drops the checkpoint.
 * 2. `private-key` matches the **BEGIN header alone** rather than the full BEGIN…END block. The
 *    redactor needs the whole block because it rewrites it; the scanner only needs to know one is
 *    present, and header-only matching is strictly broader (it also catches a truncated block) and
 *    strictly linear-time, where a lazy `[\s\S]*?` body is not. `pem-key-body` then covers the
 *    remaining shape: a DER body pasted with its header stripped.
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
 * no unbounded alternation inside a repetition, every unbounded repetition followed by a
 * character that its own class cannot match, and every lookaround bounded. Where a bounded
 * repetition *can* backtrack (the `env-secret-assignment` lookahead walks up to 64 positions per
 * line start), it is the **bound**, not the absence of backtracking, that keeps the pattern
 * linear. `secretscan.test.ts > "runs in linear time"` holds each pattern to 50 ms against
 * 100 KB adversarial strings built to maximise that backtracking.
 *
 * ## Concurrency
 *
 * Every `regex` carries the `g` flag and therefore mutable `lastIndex`. `scanText` resets it
 * before and after each use, so sequential callers are safe, but these are **shared instances**:
 * a caller that runs `SECRET_PATTERNS[i].regex` itself, interleaved with a `scanText` call, will
 * corrupt both. Clone with `new RegExp(p.regex.source, p.regex.flags)` if you need your own.
 *
 * This module is pure: no Node built-ins, no I/O, no dependencies.
 */

/** One named credential shape. */
export interface SecretPattern {
  /** Stable label reported in a {@link import("./secretscan.js").Finding}. Never a value. */
  readonly name: string;
  /**
   * The matcher. Carries the `g` flag (plus `i`/`m` where noted); see the module note on
   * concurrency before running one of these outside `scanText`.
   */
  readonly regex: RegExp;
  /** What the pattern recognises, for humans reading a finding or reviewing this list. */
  readonly description: string;
  /**
   * When set, the match only counts if capture group 1 (or the whole match, when the pattern has
   * no group) is credential-*shaped* rather than a phrase — see `isCredentialShaped` in
   * `./secretscan.js` for the exact rule. Only the keyword-anchored heuristics set it; the vendor
   * formats are self-identifying and stay ungated, so this set can never miss something
   * `scripts/redact-patterns.mjs` catches under the same name.
   *
   * The value is inspected inside `scanText` and never leaves it.
   */
  readonly minEntropyBits?: number;
  /**
   * When true, a match is dropped if its value is one of this project's own identifier shapes —
   * a ULID, a `WL-` backlog id, a git hash, an ISO timestamp, a repo-relative path, a shell
   * variable reference, or a `<redacted:…>` tag. Only the keyword-anchored heuristics set it:
   * `notes[].text` and `remaining[].why` are free prose that routinely names a `WL-` id or a
   * commit right next to the word "token", and a finding there costs the user the checkpoint.
   */
  readonly rejectProjectShapes?: boolean;
}

/**
 * Shapes this set knowingly does not catch. Exported so "0 findings" is never read as "clean" —
 * mirrors `KNOWN_GAPS` in `scripts/redact-patterns.mjs`.
 *
 * These are threat-model decisions, not oversights: the model is an agent *accidentally* echoing
 * a credential into a checkpoint payload, not an attacker deliberately evading the gate.
 */
export const KNOWN_GAPS: readonly string[] = Object.freeze([
  "homoglyphs — Cyrillic А in AKIA… does not match; NFKC and confusables folding are a P2 item, " +
    "and evasion is outside the accidental-echo threat model.",
  "base64-wrapped secrets — a base64'd `ghp_` token is invisible; recursive decode-and-rescan is " +
    "unbounded work and a false-positive engine.",
  "a value split across two fields — structurally undetectable by a per-string scanner.",
  "bare high-entropy hex or base64 with no keyword and no vendor prefix: a commit hash, a " +
    "checksum and a ULID all look identical, and a checkpoint carries those constantly.",
  "human-chosen passwords shorter than 12 characters, or 12-15 characters with no symbol — see " +
    "the length-floor note on `generic-api-key`.",
  "zero-width characters inside a token degrade rather than defeat detection: the run before the " +
    "zero-width character still matches when it is long enough.",
]);

/**
 * The ordered pattern set. Both the array and every record in it are frozen: the module's thesis
 * is that patterns are data, and a caller mutating a shared `regex` would corrupt every scan.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = Object.freeze(
  [
    // --- private keys ---------------------------------------------------------------------
    {
      name: "private-key",
      // Header only, deliberately: see the module note. The optional prefix is a bounded
      // alternation of literals, not a repetition, so there is nothing to backtrack into.
      regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
      description: "PEM private-key block header (RSA, DSA, EC, OpenSSH, PGP, or encrypted).",
    },
    {
      name: "putty-private-key",
      regex: /PuTTY-User-Key-File(?:-\d{1,2})?\s{0,8}:/g,
      description: "PuTTY private-key file header.",
    },
    {
      name: "pem-key-body",
      // A DER body pasted without its header: every RSA/EC private key DER blob base64-encodes to
      // something starting `MII`. Bounded lower, unbounded upper, followed by a class exclusion.
      regex: /\bMII[A-Za-z0-9+/]{60,}={0,2}/g,
      description: "Headerless PEM/DER private-key body (base64 starting `MII`).",
    },
    {
      name: "gcp-service-account",
      // The field name alone is dispositive; the value is never captured.
      regex: /"private_key(?:_id)?"\s{0,8}:\s{0,8}"[^"\n]{8,}/g,
      description: "GCP service-account JSON carrying a `private_key` or `private_key_id` field.",
    },

    // --- tokens with a self-identifying prefix --------------------------------------------
    {
      name: "jwt",
      // Three base64url segments. Each `{8,}` is followed by `\.`, which its own class excludes,
      // so a failed match backtracks at most the length of one segment run.
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
      name: "aws-secret-access-key-nearby",
      // The same 40-character shape without the exact key name, when `aws` or `secret` sits
      // within 40 characters. The lazy run is bounded at 40, so the whole pattern stays linear;
      // `rejectProjectShapes` is what keeps a 40-character commit hash near the word "secret"
      // from firing.
      regex:
        /\b(?:aws|secret)[A-Za-z_]{0,12}\b[^\n]{0,40}?(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{40})(?![A-Za-z0-9+/])/gi,
      description: "A 40-character AWS-secret-shaped value within 40 characters of `aws`/`secret`.",
      minEntropyBits: 3,
      rejectProjectShapes: true,
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
      name: "discord-webhook",
      regex:
        /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{10,25}\/[A-Za-z0-9_-]{20,}/g,
      description: "Discord incoming-webhook URL, which is itself the credential.",
    },
    {
      name: "telegram-bot-token",
      // `{30,40}`, not the `{33}` the shape is usually written as: the Security reviewer's own
      // corpus token carries 32 characters after `AA`, so a fixed count misses real tokens.
      regex: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,40}\b/g,
      description: "Telegram bot token (`<bot id>:AA…`).",
    },
    {
      name: "anthropic-key",
      regex: /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
      description: "Anthropic API key (`sk-ant-`).",
    },
    {
      name: "openai-key",
      // Project keys issued since 2024 carry `-` and `_` inside the body, so the class is wider
      // than the redactor's; `anthropic-key` runs first and the claimed-span bitmap suppresses
      // the double report on `sk-ant-…`.
      regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g,
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
      name: "sendgrid-key",
      regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
      description: "SendGrid API key (`SG.<id>.<secret>`).",
    },
    {
      name: "twilio-account-sid",
      regex: /\bAC[0-9a-f]{32}\b/g,
      description: "Twilio account SID (`AC` and 32 hex characters).",
    },
    {
      name: "twilio-auth-token",
      // The keyword is dispositive, so no project-shape filter: a 32-hex value within 40
      // characters of `twilio` is not a commit hash by coincidence.
      regex: /\btwilio[A-Za-z_]{0,12}\b[^\n]{0,40}?(?<![0-9a-fA-F])([0-9a-fA-F]{32})(?![0-9a-fA-F])/gi,
      description: "Twilio auth token: 32 hex characters within 40 characters of `twilio`.",
    },
    {
      name: "shopify-token",
      regex: /\bshp(?:at|ss|ca|pa)_[A-Za-z0-9]{16,}\b/g,
      description: "Shopify access, shared-secret, custom-app, or private-app token.",
    },
    {
      name: "mailgun-key",
      // base36, not hex: a real Mailgun key carries letters past `f`.
      regex: /\bkey-[0-9a-z]{32}\b/g,
      description: "Mailgun API key (`key-` and 32 base36 characters).",
    },
    {
      name: "azure-storage-key",
      // Not `^`-anchored: an Azure connection string is one long semicolon-separated line, so
      // `env-secret-assignment` can never see it.
      regex: /\bAccountKey\s{0,8}=\s{0,8}[A-Za-z0-9+/]{40,100}={0,2}/gi,
      description: "Azure Storage account key inside a connection string (`AccountKey=`).",
    },
    {
      name: "azure-sas-token",
      regex: /[?&]sig=[A-Za-z0-9%+/_-]{20,}={0,2}/gi,
      description: "Azure shared-access-signature token (the `sig=` parameter).",
    },
    {
      name: "docker-config-auth",
      regex: /"auth"\s{0,8}:\s{0,8}"[A-Za-z0-9+/]{16,}={0,2}"/g,
      description: "Docker registry credential in a `config.json` `auth` field (base64 user:pass).",
    },
    {
      name: "npm-token",
      regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
      description: "npm automation or publish token (`npm_`).",
    },
    {
      name: "npm-auth-token",
      // The key name alone is dispositive, whatever the value looks like — an `.npmrc`
      // `_authToken` is a credential by definition.
      regex: /_authToken\s{0,8}=\s{0,8}["']?[^\s"';]{8,}/gi,
      description: "An `.npmrc` `_authToken=` line, whatever shape the token itself has.",
    },
    {
      name: "url-credentials",
      // Userinfo in a URL: the single most likely credential an agent pastes into a `done` line.
      // Longest scheme alternatives first so `mongodb+srv` is not shadowed by `mongodb`.
      // The value is never captured.
      regex:
        /\b(?:postgresql|postgres|mysql|mongodb\+srv|mongodb|rediss|redis|amqps|amqp|https|http):\/\/[^\s:/@]{1,64}:[^\s/@]{3,64}@/gi,
      description: "URL userinfo carrying a password (`postgres://user:pass@host`, `https://…`).",
    },
    {
      name: "bearer-token",
      // `[ \t]` rather than `\s`, so `Use Bearer\nauthentication` is prose and not a finding.
      // `[A-Za-z0-9._~+/-]` excludes `=`, so `{16,}=*` has no ambiguous split to backtrack through.
      regex: /\bBearer[ \t]+([A-Za-z0-9._~+/-]{16,}=*)/g,
      description: "An `Authorization: Bearer` credential.",
    },

    // --- keyword-anchored heuristics ------------------------------------------------------
    {
      name: "generic-api-key",
      // A credential-ish key assigned a credential-ish value. Broader than the redactor's list by
      // `password`, `passwd`, `token`, and bare `secret`, and the value class admits the symbols
      // a human password uses. The 12-character floor is deliberate — see the length-floor note
      // in `isCredentialShaped` — and `minEntropyBits` plus `rejectProjectShapes` are what keep
      // `token: use-the-ci-token-from-1password` and `secret: WL-01J…` out of the findings.
      regex:
        /\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token)\b["'\s]*[:=][:=\s]*["']?([A-Za-z0-9._~+/=@!#$%^&*-]{12,})/gi,
      description: "An api-key/secret/token/password assignment whose value looks like a credential.",
      minEntropyBits: 3,
      rejectProjectShapes: true,
    },
    {
      name: "env-secret-assignment",
      // A dotenv line whose NAME is credential-shaped. Case-insensitive, so `ClientSecret=` and
      // `api_token=` match as well as the uppercase convention. The bounded lookahead identifies
      // the name in one pass; it *does* backtrack, up to 64 positions per line start, and it is
      // that bound — not the absence of backtracking — that keeps the pattern linear.
      regex:
        /^[ \t]{0,16}(?:export[ \t]+)?(?=[A-Za-z0-9_]{0,64}(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|KEY))[A-Za-z0-9_]{1,64}[ \t]{0,8}=[ \t]{0,8}["']?([A-Za-z0-9._~+/=@!#$%^&*-]{12,})/gim,
      description: "A `.env`-style `NAME=value` line whose name is credential-shaped.",
      minEntropyBits: 3,
      rejectProjectShapes: true,
    },
  ].map((pattern) => Object.freeze(pattern)),
);

/** Every pattern name in {@link SECRET_PATTERNS}, in order. Handy for tests and docs. */
export const SECRET_PATTERN_NAMES: readonly string[] = Object.freeze(
  SECRET_PATTERNS.map((pattern) => pattern.name),
);
