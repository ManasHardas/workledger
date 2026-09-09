import { describe, expect, it } from "vitest";

import { KNOWN_GAPS, scanText } from "../src/index.js";

/**
 * The Security reviewer's corpus for PR #20, pinned.
 *
 * 53 credentials of the kind a coding agent plausibly puts in a `done` or `notes` line, plus the
 * 15-case short-password suite, plus the bypass triage. Every case declares the outcome it
 * expects; a case that flips in either direction fails this file, so the corpus is a regression
 * gate rather than a one-off measurement. The review measured **26/53** against the first
 * revision — {@link MINIMUM_HITS} is the floor this file now holds.
 *
 * Every value is fake: documentation examples, or shapes filled with `x`/`a1b2` runs. None of it
 * is committed as a fixture — `secretscan.test.ts > "committed fixtures scan clean"` is what keeps
 * the fixture directory free of credential shapes.
 *
 * Cases expected to miss carry a one-line reason, and each of those reasons is a threat-model
 * decision recorded in `KNOWN_GAPS`, not an oversight. The threat model is an agent *accidentally*
 * echoing a credential into a payload, not an attacker deliberately evading the gate.
 */
const MINIMUM_HITS = 45;

const x = (n: number) => "x".repeat(n);
const hex = (n: number) => "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6".repeat(3).slice(0, n);
const B64 = "aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9iJ0kL1mN2oP3qR4sT5uV6wX7yZ8a";

interface Case {
  readonly label: string;
  readonly text: string;
  /** `true` when the scanner must find something; `false` when this is a documented gap. */
  readonly hit: boolean;
  /** Required when `hit` is false: why this shape is out of scope for P1. */
  readonly reason?: string;
}

const CORPUS: readonly Case[] = [
  // --- database and service connection strings (Security B2) -----------------------------
  { label: "postgres url", hit: true, text: "postgres://wl_app:Hunter2SuperSecret@db.internal:5432/ledger" },
  { label: "postgresql url", hit: true, text: "postgresql://admin:pR0d_p4ssw0rd_x9@10.0.1.5:5432/main" },
  { label: "mysql url", hit: true, text: "mysql://root:tempRootPass99@127.0.0.1:3306/app" },
  { label: "mongodb+srv url", hit: true, text: "mongodb+srv://appuser:M0ng0Pa55w0rd@cluster0.ab1cd.mongodb.net/prod" },
  { label: "redis url", hit: true, text: "redis://default:AZ8xQm2LpR7vT4nK9wY3@redis-13245.c1.ec2.cloud.redislabs.com:13245" },
  { label: "rediss url", hit: true, text: "rediss://default:AZ8xQm2LpR7vT4nK9wY3@redis.internal:6380" },
  { label: "amqp url", hit: true, text: "amqp://svc:R4bb1tMqSecret@rabbit.internal:5672/vhost" },
  { label: "amqps url", hit: true, text: "amqps://svc:R4bb1tMqSecret@rabbit.internal:5671/vhost" },
  { label: "https url with userinfo", hit: true, text: "https://deploy:S3cretD3ployT0ken@artifacts.example.com/repo" },
  { label: "mongodb url in a DATABASE_URL assignment", hit: true, text: "DATABASE_URL=mongodb://u:M0ng0Pa55w0rd@mongo.internal:27017/prod" },

  // --- cloud provider credentials (Security B3) -------------------------------------------
  { label: "azure storage connection string", hit: true, text: `DefaultEndpointsProtocol=https;AccountName=wlstore;AccountKey=${B64}==;EndpointSuffix=core.windows.net` },
  { label: "azure SAS token", hit: true, text: `https://wlstore.blob.core.windows.net/c/b?sv=2022-11-02&sig=${x(40)}%3D` },
  { label: "gcp service-account json fragment", hit: true, text: `{"private_key_id":"${hex(40)}","client_email":"svc@p.iam.gserviceaccount.com"}` },
  { label: "gcp service-account private_key field", hit: true, text: '{"private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQ..."}' },
  { label: "aws secret with no adjacent key name", hit: true, text: "notes: the secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  { label: "aws access key id", hit: true, text: "AKIAIOSFODNN7EXAMPLE" },
  { label: "aws secret in a credentials file line", hit: true, text: "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },

  // --- vendor tokens (Security B4) ---------------------------------------------------------
  { label: "sendgrid key", hit: true, text: `SG.${x(22)}.${x(43)}` },
  { label: "twilio account sid", hit: true, text: `AC${hex(32)}` },
  { label: "twilio auth token", hit: true, text: `twilio auth token ${hex(32)}` },
  { label: "shopify access token", hit: true, text: `shpat_${hex(32)}` },
  { label: "shopify shared secret", hit: true, text: `shpss_${hex(32)}` },
  { label: "discord webhook", hit: true, text: `https://discord.com/api/webhooks/1234567890123456789/${x(40)}` },
  { label: "telegram bot token", hit: true, text: "1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" },
  { label: "mailgun key", hit: true, text: "key-3ax6xnjp29jd6fds4gc373sgvjxteol0" },
  { label: "docker registry auth", hit: true, text: `{"auths":{"r.example.com":{"auth":"${B64}=="}}}` },
  { label: "npmrc _authToken with a uuid value", hit: true, text: "//npm.pkg.github.com/:_authToken=8a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d" },
  { label: "putty private key header", hit: true, text: "PuTTY-User-Key-File-3: ssh-rsa" },

  // --- private keys (Security I1) ----------------------------------------------------------
  { label: "pem private-key header", hit: true, text: "-----BEGIN RSA PRIVATE KEY-----" },
  { label: "openssh private-key header", hit: true, text: "-----BEGIN OPENSSH PRIVATE KEY-----" },
  { label: "headerless DER key body", hit: true, text: `MIIEowIBAAKCAQEAx7Vd8Qn2${B64}` },

  // --- the formats the first revision already caught ---------------------------------------
  { label: "github classic token", hit: true, text: `ghp_${x(36)}` },
  { label: "github fine-grained pat", hit: true, text: `github_pat_${x(24)}` },
  { label: "slack bot token", hit: true, text: `xoxb-000000000000-${x(24)}` },
  { label: "slack webhook", hit: true, text: `https://hooks.slack.com/services/T0000/B0000/${x(24)}` },
  { label: "anthropic key", hit: true, text: `sk-ant-api03-${x(32)}` },
  { label: "openai project key with symbols", hit: true, text: `sk-proj-Ab1_Cd2-Ef3T3BlbkFJ${x(24)}` },
  { label: "stripe live key", hit: true, text: "sk_live_4eC39HqLyjWDarjtT1zdp7dc" },
  { label: "google api key", hit: true, text: `AIzaSyD${x(32)}` },
  { label: "npm automation token", hit: true, text: `npm_${x(36)}` },
  { label: "jwt", hit: true, text: `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXN1YmplY3QifQ.${x(24)}` },
  { label: "authorization bearer header", hit: true, text: `Authorization: Bearer abc123XYZ${x(12)}` },
  { label: "api_key assignment", hit: true, text: "api_key = \"A1b2C3d4E5f6G7h8\"" },
  { label: "dotenv password line", hit: true, text: "DATABASE_PASSWORD=A1b2C3d4E5f6G7h8" },
  { label: "mixed-case ClientSecret assignment", hit: true, text: "ClientSecret=A1b2C3d4E5f6G7h8" },
  { label: "symbol-rich human password", hit: true, text: "password=P@ssw0rd!Str0ng#2026" },
  { label: "symbol-rich api key", hit: true, text: "api_key=ab!cd@ef#gh$ij%kl^mn" },
  { label: "secret in a url query string", hit: true, text: "curl 'https://api.example.com/v1/x?api_key=A1b2C3d4E5f6G7h8'" },
  { label: "secret in a file path", hit: true, text: "/Users/dev/.aws/credentials holds AKIAIOSFODNN7EXAMPLE" },

  // --- documented gaps (threat-model decisions, see KNOWN_GAPS) -----------------------------
  {
    label: "homoglyph AWS key",
    hit: false,
    text: "АKIAIOSFODNN7EXAMPLE",
    reason: "homoglyph — the leading А is Cyrillic. Deliberate evasion, outside the accidental-echo threat model; NFKC and confusables folding are a P2 item.",
  },
  {
    label: "base64-wrapped github token",
    hit: false,
    text: "Z2hwX0ExYjJDM2Q0RTVmNkc3aDhJOWowSzFsMk0zbjRPNXA2UTdyOA==",
    reason: "base64-wrapped — recursive decode-and-rescan is unbounded work and a false-positive engine.",
  },
  {
    label: "credential split across two fields",
    hit: false,
    text: "prefix ghp_A1b2C3d4 | suffix E5f6G7h8I9j0K1l2M3n4",
    reason: "split-field — structurally undetectable by a per-string scanner; neither half is a credential.",
  },
  {
    label: "bare 64-character hex secret",
    hit: false,
    text: "9f8e7d6c5b4a39281706f5e4d3c2b1a0987654329f8e7d6c5b4a392817061234",
    reason: "bare-hex64 — indistinguishable from a checksum, a tree hash or a content id, all of which a checkpoint carries constantly.",
  },
];

/**
 * The short-password suite. These are the shapes the length floor and the credential-alphabet
 * gate deliberately let through — see `isCredentialShaped` in `secretscan.ts` for why the floor
 * sits at 12 characters, and `KNOWN_GAPS` for the standing note.
 */
const SHORT_PASSWORDS: readonly Case[] = [
  { label: "8 characters with a symbol", hit: false, text: "password=Hunter2!", reason: "under the 12-character floor." },
  { label: "11 characters with a symbol", hit: false, text: "password=Tr0ub4dor&3", reason: "under the 12-character floor." },
  { label: "12 characters, no symbol", hit: false, text: "password=xK9mQ2vT7wZ4", reason: "12-15 characters with no symbol: the unbroken run is under 16, so it is indistinguishable from an identifier." },
  { label: "15 characters, no symbol", hit: false, text: "password=xK9mQ2vT7wZ4aB1", reason: "12-15 characters with no symbol: one short of the generated-credential run floor." },
  { label: "16 characters, no symbol", hit: true, text: "password=xK9mQ2vT7wZ4aB1c" },
  { label: "20 characters with symbols", hit: true, text: "password=P@ssw0rd!Str0ng#2026" },
  { label: "symbol-only alphabet", hit: true, text: "api_key=ab!cd@ef#gh$ij%kl^mn" },
  { label: "uppercase env token, 12 characters", hit: false, text: "API_TOKEN=xK9mQ2vT7wZ4", reason: "12-15 characters with no symbol." },
  { label: "passphrase", hit: false, text: "password=correcthorsebatterystaple", reason: "single-case alphabetic with no digit or symbol: indistinguishable from prose." },
  { label: "low-entropy 16 characters", hit: false, text: "password=aaaaaaaabbbbbbb1", reason: "entropy 1.9 bits/char, under the 3.0 floor — filler, not a credential." },
  { label: "repeating pair", hit: false, text: "secret=abababababababababab", reason: "entropy 1.0 bits/char, under the 3.0 floor." },
  { label: "base64 secret", hit: true, text: "secret=aB3cD4eF5gH6iJ7kL8mN9oP0" },
  { label: "hex secret with a keyword", hit: true, text: "secret=a1b2c3d4e5f6a7b8" },
  { label: "uuid secret", hit: true, text: "client_secret=8a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d" },
  { label: "long generated token", hit: true, text: "auth_token=A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6" },
];

/**
 * The Security **re-review** corpus for `54d71ea`: the two regressions revision 2 introduced, the
 * ten vendor/encoding cases the reviewer probed for the first time, and the Importants. Held
 * separately from {@link CORPUS} so the original 53-case measurement stays comparable across
 * revisions.
 */
const CORPUS_ROUND_2: readonly Case[] = [
  // --- B1: hex credentials behind a keyword (a regression against revision 1) --------------
  { label: "32-hex api_key", hit: true, text: 'api_key="9f8e7d6c5b4a39281706f5e4d3c2b1a0"' },
  { label: "32-hex API_KEY dotenv", hit: true, text: "API_KEY=9f8e7d6c5b4a39281706f5e4d3c2b1a0" },
  { label: "32-hex client_secret", hit: true, text: "client_secret: 9f8e7d6c5b4a39281706f5e4d3c2b1a0" },
  { label: "32-hex apikey", hit: true, text: "apikey=9f8e7d6c5b4a39281706f5e4d3c2b1a0" },
  { label: "32-hex password", hit: true, text: "password=9f8e7d6c5b4a39281706f5e4d3c2b1a0" },
  { label: "64-hex django SECRET_KEY", hit: true, text: `SECRET_KEY=${hex(64)}` },
  { label: "64-hex DJANGO_SECRET_KEY quoted", hit: true, text: `DJANGO_SECRET_KEY="${hex(64)}"` },
  { label: "32-hex api_key in a url query", hit: true, text: "https://api.example.com/v1?api_key=9f8e7d6c5b4a39281706f5e4d3c2b1a0" },
  {
    label: "40-hex access_token",
    hit: false,
    text: "access_token=9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
    reason: "40 lowercase hex is byte-identical to a SHA-1 commit hash, which Code Review pinned as a must-not-flag. A false positive there is unrecoverable (data-flow §2 retries the same input and gives up, and cli.md has no --force) while a false negative degrades, so the ambiguous length resolves toward the user keeping the checkpoint.",
  },
  {
    label: "40-hex GITHUB_TOKEN",
    hit: false,
    text: "GITHUB_TOKEN=9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
    reason: "same SHA-1 collision as the 40-hex access_token above.",
  },

  // --- B2: npm placeholder false positives ---------------------------------------------------
  { label: "npmrc env-var reference", hit: false, text: "//registry.npmjs.org/:_authToken=${NPM_TOKEN}", reason: "the canonical correct .npmrc line, not a credential — an FP here costs the user the checkpoint." },
  { label: "npmrc bare env-var reference", hit: false, text: "_authToken=$NPM_TOKEN", reason: "env-var reference, not a credential." },
  { label: "npmrc redaction marker", hit: false, text: "set _authToken=<redacted:npm>", reason: "the output of this project's own redactor: the one string guaranteed to hold no credential." },
  { label: "npmrc doc placeholder", hit: false, text: "docs say to write _authToken=YOUR_TOKEN_HERE in .npmrc", reason: "SCREAMING_SNAKE doc placeholder, not a credential." },

  // --- I1, I2, I3 ----------------------------------------------------------------------------
  { label: "bare AWS secret access key", hit: true, text: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  { label: "bare AWS secret in a note", hit: true, text: "notes: rotate wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY next week" },
  { label: "39-char base64-class repo path", hit: false, text: "packages/core/src/index/migrations/tests", reason: "not a credential — the AWS-secret shape demands a +/ plus mixed case plus a digit, which a path segment lacks." },
  { label: "azure SAS with an sv sibling", hit: true, text: "https://s.blob.core.windows.net/c/b?sv=2022-11-02&sig=aB3cD4eF5gH6iJ7kL8mN9oP0qR1s%3D" },
  { label: "non-azure sig parameter", hit: false, text: "?q=foo&sig=needs-twenty-plus-characters-here", reason: "`sig=` alone is a common parameter name; the Azure form requires a sibling sv/se/sp/sr." },

  // --- N1, N2: the seven vendors the re-review probed ----------------------------------------
  { label: "http basic auth header", hit: true, text: "Authorization: Basic YWRtaW46c3VwZXJTZWNyZXRQYXNzdzByZA==" },
  { label: "atlassian api token", hit: true, text: `ATATT3xFfGF0${x(30)}` },
  { label: "hashicorp vault token", hit: true, text: `hvs.CAESIH${x(30)}` },
  { label: "databricks token", hit: true, text: `dapi${hex(32)}` },
  { label: "linear api key", hit: true, text: "lin_api_aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV" },
  { label: "grafana service-account token", hit: true, text: "glsa_aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV_a1b2c3d4" },
  { label: "doppler service token", hit: true, text: "dp.st.prod.aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV" },

  // --- the three the re-review found already passing ------------------------------------------
  { label: "cloudflare bearer header", hit: true, text: `Authorization: Bearer ${x(40)}` },
  { label: "segment write key dotenv", hit: true, text: "SEGMENT_WRITE_KEY=aB3cD4eF5gH6iJ7kL8mN9oP0" },
  { label: "url-encoded password in a connection string", hit: true, text: "postgres://u:p%40ssw0rd%21X9@db.internal:5432/x" },
];

function hits(text: string): boolean {
  return scanText(text, "corpus").length > 0;
}

describe("security corpus — 53 realistic credentials", () => {
  it("has 53 cases, and every declared miss carries a reason", () => {
    expect(CORPUS.length).toBe(53);
    for (const c of CORPUS) {
      if (!c.hit) expect(c.reason, c.label).toBeTruthy();
    }
  });

  it(`catches at least ${MINIMUM_HITS} of them`, () => {
    const caught = CORPUS.filter((c) => hits(c.text));
    const missed = CORPUS.filter((c) => !hits(c.text)).map((c) => c.label);
    expect({ caught: caught.length, missed }).toEqual({
      caught: CORPUS.filter((c) => c.hit).length,
      missed: CORPUS.filter((c) => !c.hit).map((c) => c.label),
    });
    expect(caught.length).toBeGreaterThanOrEqual(MINIMUM_HITS);
  });

  for (const c of CORPUS) {
    it(`${c.hit ? "catches" : "documents the gap for"} ${c.label}`, () => {
      expect(hits(c.text)).toBe(c.hit);
    });
  }

  it("never leaks a corpus value into a finding", () => {
    // Checked field by field rather than over `JSON.stringify`: serialising joins a pattern name
    // to the surrounding punctuation, so `"private-key"` in the JSON spuriously "contains" the
    // window `"private` taken from a `{"private_key": …}` input. The fields are what a caller
    // prints and persists, and they are what the invariant is about.
    for (const c of CORPUS) {
      for (const finding of scanText(c.text, "corpus")) {
        for (let i = 0; i + 8 <= c.text.length; i += 1) {
          const window = c.text.slice(i, i + 8);
          expect(finding.path, `${c.label} @ ${i}`).not.toContain(window);
          expect(finding.pattern, `${c.label} @ ${i}`).not.toContain(window);
        }
      }
    }
  });
});

describe("security re-review corpus", () => {
  it("declares a reason for every miss", () => {
    for (const c of CORPUS_ROUND_2) if (!c.hit) expect(c.reason, c.label).toBeTruthy();
  });

  for (const c of CORPUS_ROUND_2) {
    it(`${c.hit ? "catches" : "documents the gap for"} ${c.label}`, () => {
      expect(hits(c.text)).toBe(c.hit);
    });
  }

  it("never leaks a round-2 corpus value into a finding", () => {
    for (const c of CORPUS_ROUND_2) {
      for (const finding of scanText(c.text, "corpus")) {
        for (let i = 0; i + 8 <= c.text.length; i += 1) {
          const window = c.text.slice(i, i + 8);
          expect(finding.path, `${c.label} @ ${i}`).not.toContain(window);
          expect(finding.pattern, `${c.label} @ ${i}`).not.toContain(window);
        }
      }
    }
  });
});

describe("short-password suite", () => {
  it("declares a reason for every miss", () => {
    for (const c of SHORT_PASSWORDS) if (!c.hit) expect(c.reason, c.label).toBeTruthy();
  });

  for (const c of SHORT_PASSWORDS) {
    it(`${c.hit ? "catches" : "documents the gap for"} ${c.label}`, () => {
      expect(hits(c.text)).toBe(c.hit);
    });
  }

  it("records the length floor as a known gap rather than an oversight", () => {
    expect(KNOWN_GAPS.join("\n")).toContain("12");
  });
});
