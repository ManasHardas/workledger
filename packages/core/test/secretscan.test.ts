import { describe, expect, it } from "vitest";

// `scripts/redact-patterns.mjs` is dependency-free ESM with no Node imports, so reading it from
// here stays inside the `packages/core/**` purity fence — see the superset test below.
import { HOME_PATH_PATTERNS, REDACTION_PATTERNS } from "../../../scripts/redact-patterns.mjs";
import {
  MAX_FINDINGS_PER_STRING,
  MAX_FINDINGS_TOTAL,
  MAX_SCAN_DEPTH,
  KNOWN_GAPS,
  SECRET_PATTERNS,
  SECRET_PATTERN_NAMES,
  TRUNCATED,
  UNSCANNABLE,
  type Finding,
  formatFindings,
  scanText,
  scanValue,
} from "../src/index.js";

/**
 * Planted secrets are **synthesized here**, never committed as fixture files: a fixture that
 * contains a credential shape would be caught by the fixture scan in data-flow §8 point 3, and a
 * repo that carries secret-shaped files trains everyone to ignore the scanner. Every value below
 * is obviously fake — long runs of `x`, the AWS documentation example key — while still matching
 * the shape the pattern is looking for.
 *
 * Fixtures are reached through `import.meta.glob` rather than `node:fs`, matching
 * `schema.test.ts`: the eslint purity fence covers `packages/core/**`, tests included.
 */
const x = (n: number) => "x".repeat(n);
const hex = (n: number) => "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6".repeat(2).slice(0, n);

/** A fake but credential-shaped value: 16 unbroken alphanumerics, mixed case and digits. */
const FAKE_VALUE = "A1b2C3d4E5f6G7h8";
/** A fake base64 blob long enough for the cloud-credential patterns. */
const B64 = "aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9iJ0kL1mN2oP3qR4sT5uV6wX7yZ8a";

interface PlantedCase {
  /** The pattern name the scanner must report. */
  readonly pattern: string;
  /** The secret-shaped text, planted alone or inside a sentence. */
  readonly secret: string;
}

const PLANTED: readonly PlantedCase[] = [
  { pattern: "private-key", secret: "-----BEGIN RSA PRIVATE KEY-----" },
  { pattern: "putty-private-key", secret: "PuTTY-User-Key-File-3: ssh-rsa" },
  { pattern: "pem-key-body", secret: `MII${B64}` },
  {
    pattern: "gcp-service-account",
    secret: `{"private_key_id":"${hex(40)}","client_email":"svc@p.iam.example"}`,
  },
  {
    pattern: "jwt",
    secret: `eyJ${"hbGciOiJIUzI1NiJ9"}.${"eyJzdWIiOiJmYWtlLXN1YmplY3QifQ"}.${x(24)}`,
  },
  { pattern: "aws-access-key-id", secret: `AKIA${"IOSFODNN7EXAMPLE"}` },
  {
    pattern: "aws-secret-access-key",
    secret: `aws_secret_access_key = ${"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`,
  },
  {
    pattern: "aws-secret-access-key-nearby",
    secret: `the deploy secret is ${"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`,
  },
  { pattern: "aws-secret-access-key-shape", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  { pattern: "atlassian-token", secret: `ATATT3xFfGF0${x(30)}` },
  { pattern: "vault-token", secret: `hvs.CAESIH${x(30)}` },
  { pattern: "databricks-token", secret: `dapi${hex(32)}` },
  { pattern: "linear-api-key", secret: `lin_api_${"aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV"}` },
  { pattern: "grafana-token", secret: `glsa_${"aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV"}_a1b2c3d4` },
  { pattern: "doppler-token", secret: `dp.st.prod.${"aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV"}` },
  { pattern: "basic-auth", secret: `Authorization: Basic ${"YWRtaW46c3VwZXJTZWNyZXRQYXNzdzByZA"}==` },
  { pattern: "github-token", secret: `ghp_${x(36)}` },
  { pattern: "github-pat", secret: `github_pat_${x(24)}` },
  { pattern: "slack-token", secret: `xoxb-${"000000000000"}-${x(24)}` },
  { pattern: "slack-webhook", secret: `https://hooks.slack.com/services/T0000/B0000/${x(24)}` },
  {
    pattern: "discord-webhook",
    secret: `https://discord.com/api/webhooks/1234567890123456789/${x(32)}`,
  },
  { pattern: "telegram-bot-token", secret: `1234567890:AA${x(32)}` },
  { pattern: "anthropic-key", secret: `sk-ant-api03-${x(32)}` },
  { pattern: "openai-key", secret: `sk-proj-Ab1_Cd2-Ef3${"T3BlbkFJ"}${x(24)}` },
  { pattern: "stripe-key", secret: `sk_live_${"4eC39HqLyjWDarjtT1zdp7dc"}` },
  { pattern: "google-api-key", secret: `AIza${"SyD"}${x(32)}` },
  { pattern: "sendgrid-key", secret: `SG.${x(22)}.${x(43)}` },
  { pattern: "twilio-account-sid", secret: `AC${hex(32)}` },
  { pattern: "twilio-auth-token", secret: `twilio auth token: ${hex(32)}` },
  { pattern: "shopify-token", secret: `shpat_${hex(32)}` },
  { pattern: "mailgun-key", secret: `key-${"3ax6xnjp29jd6fds4gc373sgvjxteol0"}` },
  { pattern: "azure-storage-key", secret: `AccountKey=${B64}==` },
  { pattern: "azure-sas-token", secret: `?sv=2022-11-02&sig=${"aB3cD4eF5gH6iJ7kL8mN9oP0qR1s"}%3D` },
  { pattern: "docker-config-auth", secret: `{"auths":{"r.example.com":{"auth":"${B64}=="}}}` },
  { pattern: "npm-token", secret: `npm_${x(36)}` },
  { pattern: "npm-auth-token", secret: `//npm.pkg.github.com/:_authToken=8a1b2c3d-4e5f-6a7b-8c9d` },
  {
    pattern: "url-credentials",
    secret: "postgres://wl_app:Hunter2SuperSecret@db.internal:5432/ledger",
  },
  { pattern: "bearer-token", secret: `Authorization: Bearer ${"abc123XYZ"}${x(12)}` },
  { pattern: "generic-api-key", secret: `api_key = "${FAKE_VALUE}"` },
  { pattern: "env-secret-assignment", secret: `DATABASE_PASSWORD=${FAKE_VALUE}` },
];

describe("secretscan patterns", () => {
  it("names every pattern exactly once", () => {
    expect(new Set(SECRET_PATTERN_NAMES).size).toBe(SECRET_PATTERNS.length);
  });

  it("gives every pattern a description and the global flag", () => {
    for (const pattern of SECRET_PATTERNS) {
      expect(pattern.description.length, pattern.name).toBeGreaterThan(0);
      expect(pattern.regex.flags, pattern.name).toContain("g");
    }
  });

  it("freezes the array and every record, so a caller cannot corrupt a shared regex", () => {
    expect(Object.isFrozen(SECRET_PATTERNS)).toBe(true);
    for (const pattern of SECRET_PATTERNS) expect(Object.isFrozen(pattern), pattern.name).toBe(true);
  });

  it("leaves every regex `lastIndex` at 0 after a scan", () => {
    scanText(`ghp_${x(36)} and AKIA${"IOSFODNN7EXAMPLE"}`, "probe");
    for (const pattern of SECRET_PATTERNS) expect(pattern.regex.lastIndex, pattern.name).toBe(0);
  });

  it("is a superset of scripts/redact-patterns.mjs, minus the two documented omissions", () => {
    // Reads the redactor rather than a transcribed literal, so drift on *either* side fails the
    // build. `email` and `home-path` are privacy rewrites for committed fixtures, not credentials:
    // see the module header on why a hit there would cost the user a checkpoint.
    const OMITTED = ["email", "home-path"];
    const redactorNames: string[] = [...REDACTION_PATTERNS, ...HOME_PATH_PATTERNS].map(
      (p: { name: string }) => p.name,
    );
    const expected = redactorNames.filter((name) => !OMITTED.includes(name));

    expect(expected.length).toBeGreaterThan(0);
    expect(SECRET_PATTERN_NAMES).toEqual(expect.arrayContaining(expected));
    // The omissions are omissions on purpose, not names we forgot to look at.
    for (const name of OMITTED) expect(redactorNames).toContain(name);
    for (const name of OMITTED) expect(SECRET_PATTERN_NAMES).not.toContain(name);
  });

  it("publishes the shapes it knowingly does not catch", () => {
    expect(KNOWN_GAPS.length).toBeGreaterThan(0);
    for (const gap of KNOWN_GAPS) expect(gap.length).toBeGreaterThan(20);
  });
});

describe("catches every planted secret", () => {
  it("covers every pattern in the set", () => {
    expect(PLANTED.map((c) => c.pattern).sort()).toEqual([...SECRET_PATTERN_NAMES].sort());
  });

  for (const planted of PLANTED) {
    it(`flags ${planted.pattern}`, () => {
      const findings = scanText(planted.secret, "payload.goal");
      expect(findings.map((f) => f.pattern)).toEqual([planted.pattern]);
      expect(findings[0]!.path).toBe("payload.goal");
      const { index, length } = findings[0]!;
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index + length).toBeLessThanOrEqual(planted.secret.length);
      expect(length).toBeGreaterThan(0);
    });
  }
});

describe("no Finding ever contains a substring of the input", () => {
  for (const planted of PLANTED) {
    it(`leaks nothing for ${planted.pattern}`, () => {
      const findings = scanText(planted.secret, "done[0].text");
      expect(findings.length).toBeGreaterThan(0);

      const serialized = JSON.stringify(findings);
      expect(serialized).not.toContain(planted.secret);
      expect(formatFindings(findings).join("\n")).not.toContain(planted.secret);

      // Stronger than "does not contain the whole secret": no 8-character window of the secret
      // may appear anywhere in the serialized findings.
      const leaked: string[] = [];
      for (let i = 0; i + 8 <= planted.secret.length; i += 1) {
        const window = planted.secret.slice(i, i + 8);
        if (serialized.includes(window)) leaked.push(window);
      }
      expect(leaked).toEqual([]);
    });
  }

  it("keeps a secret hidden in a deeply nested payload out of the findings", () => {
    const secret = `ghp_${x(36)}`;
    const findings = scanValue({ done: [{ text: `pushed with ${secret}`, files: ["a.ts"] }] });
    expect(JSON.stringify(findings)).not.toContain("ghp_");
  });
});

describe("object keys are scanned, and never copied into a path", () => {
  it("detects a credential used as a key and reports it positionally", () => {
    const findings = scanValue({ [`ghp_${x(36)}`]: "clean" });
    expect(findings).toEqual([
      { path: "<key#0>", pattern: "github-token", index: 0, length: 40 },
    ]);
    expect(JSON.stringify(findings)).not.toContain("ghp_");
  });

  it("does not leak a connection-string key into stderr or the index", () => {
    const key = "postgres://u:Hunter2SuperSecretPassword@db.internal:5432/ledger_and_padding";
    const lines = formatFindings(scanValue({ [key]: "clean" }));
    expect(lines).toEqual(["secret detected at <key#0> (url-credentials)"]);
    expect(lines.join("")).not.toContain("Hunter2");
  });

  it("reports a key that is merely unusual positionally too, without scanning it as a hit", () => {
    const findings = scanValue({ "done items": [`npm_${x(36)}`] });
    expect(findings.map((f) => f.path)).toEqual(["<key#0>[0]"]);
    expect(findings[0]!.pattern).toBe("npm-token");
  });

  it("treats a long hex key as positional, not as an identifier", () => {
    // A 32-hex credential used as a key scans clean and is a valid identifier, so without this
    // it would print verbatim into stderr and into `last_attempt_errors`.
    const findings = scanValue({ "9f8e7d6c5b4a39281706f5e4d3c2b1a0": `ghp_${x(36)}` });
    expect(findings.map((f) => f.path)).toEqual(["<key#0>"]);
  });

  it("keeps a plain, clean key verbatim so the contract's path form survives", () => {
    const payload = { notes: [{}, {}, { reason: `deploy uses ghp_${x(36)}` }] };
    expect(formatFindings(scanValue(payload))).toEqual([
      "secret detected at notes[2].reason (github-token)",
    ]);
  });
});

describe("fails closed rather than returning an empty array", () => {
  it("reports a Map as unscannable instead of clean", () => {
    expect(scanValue(new Map([["k", `ghp_${x(36)}`]]))).toEqual([
      { path: "$", pattern: UNSCANNABLE, index: 0, length: 0 },
    ]);
  });

  it("reports a Set, a class instance, and a function as unscannable", () => {
    class Holder {
      token = `ghp_${x(36)}`;
    }
    const findings = scanValue({ s: new Set([1]), h: new Holder(), f: () => 1, u: undefined });
    expect(findings.map((f) => `${f.path}:${f.pattern}`)).toEqual([
      `s:${UNSCANNABLE}`,
      `h:${UNSCANNABLE}`,
      `f:${UNSCANNABLE}`,
      `u:${UNSCANNABLE}`,
    ]);
  });

  it("reports a subtree past MAX_SCAN_DEPTH as unscannable instead of clean", () => {
    const build = (depth: number): unknown => {
      let node: unknown = `ghp_${x(36)}`;
      for (let i = 0; i < depth; i += 1) node = { n: node };
      return node;
    };
    expect(scanValue(build(MAX_SCAN_DEPTH)).map((f) => f.pattern)).toEqual(["github-token"]);
    expect(scanValue(build(MAX_SCAN_DEPTH + 1)).map((f) => f.pattern)).toEqual([UNSCANNABLE]);
  });

  it("still returns [] for genuinely clean scalars", () => {
    expect(scanValue({ a: 1, b: true, c: null, d: "ordinary prose" })).toEqual([]);
  });

  it("caps findings per string and marks the remainder truncated", () => {
    const wide = `ghp_${x(36)} `.repeat(MAX_FINDINGS_PER_STRING + 50);
    const findings = scanText(wide, "big");
    expect(findings.length).toBe(MAX_FINDINGS_PER_STRING + 1);
    expect(findings.at(-1)).toEqual({ path: "big", pattern: TRUNCATED, index: 0, length: 0 });
  });

  it("caps findings per walk and marks the remainder truncated", () => {
    const wide = `ghp_${x(36)} `.repeat(MAX_FINDINGS_TOTAL + 50);
    const findings = scanValue({ big: wide });
    expect(findings.length).toBe(MAX_FINDINGS_TOTAL + 1);
    expect(findings.at(-1)!.pattern).toBe(TRUNCATED);
  });

  it("does not throw on a string with more findings than a spread can carry", () => {
    // V8 caps spread arguments near 124k; the walker must not turn "found many secrets" into a
    // stack overflow at data-flow §8 point 3, which scans arbitrary captured transcripts.
    const wide = `ghp_${x(36)} `.repeat(130_000);
    expect(() => scanValue({ big: wide })).not.toThrow();
  });
});

describe("known false-positive shapes are not flagged", () => {
  const CLEAN: Record<string, string> = {
    "short commit hash": "fixed in 3e71873",
    "long commit hash": "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
    "abbreviated hashes in prose": "reverted 8edd349, then cherry-picked fecafc2 onto main",
    ulid: "01JAV9K3Z5QW8Y2T6M7N0P4RXS",
    "backlog id": "WL-01JAV9K3Z5QW8Y2T6M7N0P4RXS",
    // Crockford base32 excludes I, L, O and U, so an AWS prefix such as AGPA can start a ULID.
    // The trailing \b in `aws-access-key-id` is what stops it matching the first 20 characters.
    "backlog id starting with an AWS account prefix": "WL-AGPA9K3Z5QW8Y2T6M7N0P4RXSV",
    "session file path": ".workledger/sessions/01JAV9K3Z5QW8Y2T6M7N0P4RXS.md",
    "repo-relative source path": "packages/core/src/secretscan-patterns.ts",
    "repo-relative doc path": "docs/contracts/p1/cli.md:52",
    "iso timestamp": "2026-09-09T12:34:56Z",
    "iso timestamp with millis": "2026-09-09T12:34:56.789Z",
    "url without credentials": "https://github.com/ManasHardas/workledger/pull/18",
    "api url without credentials": "https://api.github.com/repos/ManasHardas/workledger/issues/8",
    "url with harmless query": "https://example.com/docs?page=2&sort=name",
    "prose about a token": "Decision: rotate the deploy token quarterly, by Manas, because CI needs it.",
    "prose about a secret": "Blocker: the secret lives in 1Password and nobody has the vault.",
    "prose about a password": "Question: should the password policy move to the config file?",
    "prose about an api key": "Discovery: the API key rotation runbook is missing from docs/.",
    "hyphenated slug after a keyword": "token: rotate-it-monthly-please",
    "env var reference, not a value": "secret: $WORKLEDGER_TOKEN",
    "redaction tag": "<redacted:github-token>",
    "semver and package name": "@workledger/core@0.0.1 depends on zod@4.5.4",
    "markdown checklist": "- [ ] Step 2: Implement; assert no Finding contains the input",

    // --- CR Blocker 1: this project's own id shapes, keyword-prefixed -----------------------
    // `notes[].text` and `remaining[].why` are free prose that names a WL- id or a commit right
    // next to the word "token" or "secret". Bare shapes passing is not enough; these are the
    // shapes that actually reach the scanner.
    "backlog id after the word secret": "secret: WL-01JAV9K3Z5QW8Y2T6M7N0P4RXS",
    "ulid after the word token": "token: 01JAV9K3Z5QW8Y2T6M7N0P4RXS",
    "commit hash after the word token": "token: 9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",

    // --- SRE Blocker: word sequences that clear an entropy floor ----------------------------
    // Each of these exits 3 deterministically, so the retry fails identically and data-flow §2's
    // give-up rule drops the checkpoint; `cli.md` offers no --force. The longest-unbroken-run
    // gate in `isCredentialShaped` is what rejects them.
    "password pointing at a vault": "password: see-the-1password-vault",
    "token pointing at a vault": "token: use-the-ci-token-from-1password",
    "secret naming a policy": "secret: rotate-quarterly-per-SOC2-policy",
    "env assignment naming a placeholder": "SESSION_SECRET=changeme-in-production-1",
    "env assignment holding a path, not a key": "PRIVATE_KEY_PATH=~/.ssh/id_ed25519.pub",
    "bearer across a line break": "Use Bearer\nauthentication-scheme-for-api",
    "env assignment holding a config path": "TOKEN_CACHE_PATH=./.workledger/cache/tokens.json",
    "keyword naming a file": "secret: docs/contracts/p1/checkpoint-payload.schema.json",
    "keyword naming a timestamp": "token: 2026-09-09T12:34:56.789Z",
    "keyword naming a package": "secret: @workledger/core@0.0.1",

    // --- Security re-review B2: the safe, documented, non-secret forms --------------------
    // `_authToken=${NPM_TOKEN}` is the line every .npmrc doc tells you to write, and
    // `<redacted:npm>` is the output of this project's own redactor: the one string guaranteed
    // to hold no credential.
    "npmrc pointing at an env var": "//registry.npmjs.org/:_authToken=${NPM_TOKEN}",
    "npmrc pointing at a bare env var": "_authToken=$NPM_TOKEN",
    "npmrc holding a redaction marker": "set _authToken=<redacted:npm>",
    "npmrc doc placeholder": "docs say to write _authToken=YOUR_TOKEN_HERE in .npmrc",
    "npmrc pointing at a CI secret": "_authToken=${{ secrets.NPM_TOKEN }}",

    // --- Security re-review I2 and the placeholder sweep over the new patterns ------------
    "signature parameter that is not an Azure SAS": "?q=foo&sig=needs-twenty-plus-characters-here",
    "webhook signature parameter": "?sig=verify-the-webhook-signature-header",
    "connection string pointing at an env var": "postgres://u:${PGPASSWORD}@db:5432/x",
    "connection string pointing at a bare env var": "postgres://u:$PGPASS@db:5432/x",
    "azure account key pointing at an env var": "AccountKey=${AZURE_KEY};",
    "gcp private_key holding a redaction marker": '{"private_key":"<redacted:private-key>"}',
    "bearer pointing at an env var": "Authorization: Bearer $GITHUB_TOKEN",
    "a repo path that is 39 base64-class characters": "packages/core/src/index/migrations/tests",
  };

  for (const [label, text] of Object.entries(CLEAN)) {
    it(`does not flag a ${label}`, () => {
      expect(formatFindings(scanText(text, label))).toEqual([]);
    });
  }

  it("still catches a hex credential at every length a git hash does not occupy", () => {
    // Security re-review B1: revision 2 rejected all hex from 7 to 64 characters to keep
    // `token: <commit sha>` quiet, and swallowed the whole hex-credential class with it. Hex is
    // the commonest credential encoding there is, so the filter is now narrowed to git's own
    // canonical forms. 12-15 miss on the 16-character run floor; 40 is a genuine collision with
    // a SHA-1 and resolves toward the user keeping their checkpoint (see KNOWN_GAPS).
    const hexOf = (n: number) => "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432".repeat(3).slice(0, n);
    const missed: number[] = [];
    for (let n = 16; n <= 70; n += 1) {
      if (scanText(`api_key="${hexOf(n)}"`, "sweep").length === 0) missed.push(n);
    }
    expect(missed).toEqual([40]);
  });

  it("finds nothing in a realistic clean checkpoint payload", () => {
    const payload = {
      schema_version: 1,
      goal: "Ship the secret scanner for packages/core",
      done: [
        {
          text: "Added secretscan-patterns.ts with 32 named patterns",
          files: ["packages/core/src/secretscan-patterns.ts"],
          commit: "3e71873",
          verified: "tests-passed",
        },
      ],
      remaining: [{ new: "Wire the scanner into checkpoint step 3", why: "data-flow §8" }],
      notes: [
        {
          type: "decision",
          text: "Header-only PEM matching, because a lazy body is not linear time",
          by: "Manas",
          reason: "keeps the 50 ms adversarial budget",
        },
      ],
    };
    expect(formatFindings(scanValue(payload))).toEqual([]);
  });
});

describe("walks nested objects and arrays and reports JSON paths", () => {
  it("honours a root path prefix", () => {
    expect(scanValue({ goal: `AKIA${"IOSFODNN7EXAMPLE"}` }, "payload")[0]!.path).toBe(
      "payload.goal",
    );
  });

  it("scans a plain string at the root", () => {
    expect(scanValue(`ghp_${x(36)}`, "stdin")[0]!.path).toBe("stdin");
  });

  it("names the root `$` rather than the empty string", () => {
    expect(scanValue(`ghp_${x(36)}`)[0]!.path).toBe("$");
  });

  it("terminates on a cyclic structure", () => {
    const node: Record<string, unknown> = { text: `ghp_${x(36)}` };
    node["self"] = node;
    expect(formatFindings(scanValue(node))).toEqual(["secret detected at text (github-token)"]);
  });

  it("reports a value referenced twice at both of its paths", () => {
    const shared = { text: `ghp_${x(36)}` };
    const findings = scanValue({ a: shared, b: shared });
    expect(findings.map((f) => f.path)).toEqual(["a.text", "b.text"]);
  });

  it("walks a diamond-shaped shared subgraph at depth 20 in linear time", () => {
    // `ancestors` alone is path-scoped, so a shared subgraph would be re-walked once per path to
    // it — 2^20 visits, measured at 567 ms before the memo. The memo makes it one walk.
    let node: unknown = { leaf: `ghp_${x(36)}` };
    for (let i = 0; i < 20; i += 1) node = { a: node, b: node };
    const started = performance.now();
    const findings = scanValue(node);
    expect(performance.now() - started).toBeLessThan(50);
    // 2^20 distinct paths reach that leaf, so the walk is memoised and the *output* is what the
    // MAX_FINDINGS_TOTAL budget bounds; the marker says so rather than the result looking short.
    expect(findings.length).toBe(MAX_FINDINGS_TOTAL + 1);
    expect(findings.at(-1)!.pattern).toBe(TRUNCATED);
    expect(findings[0]!.pattern).toBe("github-token");
  });
});

describe("scans a rendered markdown string as one value", () => {
  const rendered = [
    "---",
    "schema_version: 1",
    "id: 01JAV9K3Z5QW8Y2T6M7N0P4RXS",
    "---",
    "",
    "## Checkpoint 4 — 2026-09-09T12:34:56Z",
    "",
    "### Done",
    `- Wired the deploy job with ghp_${x(36)} (packages/cli/src/deploy.ts)`,
    "",
    "### Remaining",
    "- Rotate the deploy token quarterly",
  ].join("\n");

  it("reports the label as the path and the offset inside the rendered text", () => {
    const findings = scanText(rendered, "session.md");
    expect(formatFindings(findings)).toEqual(["secret detected at session.md (github-token)"]);
    expect(rendered.slice(findings[0]!.index, findings[0]!.index + findings[0]!.length)).toBe(
      `ghp_${x(36)}`,
    );
  });

  it("reports one finding per occurrence, in document order", () => {
    const text = `first ${`ghp_${x(36)}`} then AKIA${"IOSFODNN7EXAMPLE"}`;
    expect(formatFindings(scanText(text, "backlog.md"))).toEqual([
      "secret detected at backlog.md (github-token)",
      "secret detected at backlog.md (aws-access-key-id)",
    ]);
  });

  it("reports an overlapping match under the most precise pattern name only", () => {
    const findings = scanText(`GITHUB_TOKEN=github_pat_${"A1b2C3d4"}${x(20)}`, "env");
    expect(findings.map((f) => f.pattern)).toEqual(["github-pat"]);
  });

  it("returns an empty array, never null, for clean text", () => {
    const findings: Finding[] = scanText("nothing to see here", "session.md");
    expect(findings).toEqual([]);
    expect(formatFindings(findings)).toEqual([]);
  });
});

describe("committed fixtures scan clean", () => {
  const fixtures = import.meta.glob<{ default: unknown }>("./fixtures/**/*.json", { eager: true });

  it("finds no secret in any committed fixture", () => {
    expect(Object.keys(fixtures).length).toBeGreaterThan(0);
    const findings = Object.entries(fixtures).flatMap(([path, mod]) => scanValue(mod.default, path));
    expect(formatFindings(findings)).toEqual([]);
  });
});

describe("runs in linear time", () => {
  const SIZE = 100 * 1024;
  const BUDGET_MS = 50;

  function fill(unit: string): string {
    return unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
  }

  /**
   * Strings built to make a backtracking engine work: each one is a near-miss for one or more
   * patterns, repeated until it is 100 KB, so every start position that the engine tries fails as
   * late as possible. A pattern with a nested quantifier or an unbounded lazy body blows the
   * budget on these by orders of magnitude, not by a few milliseconds.
   */
  const ADVERSARIAL: Record<string, string> = {
    "unterminated PEM headers": fill("-----BEGIN RSA PRIVATE KEZ-----"),
    "PEM prefixes without a key word": fill("-----BEGIN -----BEGIN "),
    "PuTTY headers without a colon": fill("PuTTY-User-Key-File-3 "),
    "MII prefixes one character short": fill(`MII${"A".repeat(59)} `),
    "private_key field names with no value": fill('"private_key_id" : '),
    "jwt prefixes with no separator": fill("eyJ"),
    "jwt first segments that never reach a dot": fill(`eyJ${"A".repeat(60)} `),
    "aws prefixes one character short": fill(`AKIA${"0".repeat(15)} `),
    "aws secret assignments one character short": fill(`aws_secret_access_key=${"A".repeat(39)} `),
    "aws keyword with a 39-character run in range": fill(`aws ${"A".repeat(39)} `),
    "github prefixes past the length cap": fill(`ghp_${"A".repeat(300)} `),
    "openai prefixes one character short": fill(`sk-${"A".repeat(31)} `),
    "sendgrid prefixes with one segment": fill(`SG.${"A".repeat(20)} `),
    "twilio keyword with a 31-hex run": fill(`twilio ${"a1".repeat(15)}b `),
    "telegram ids with no AA": fill("1234567890:AB "),
    "discord webhook prefixes": fill("https://discord.com/api/webhooks/1234567890/ "),
    "AccountKey with a short value": fill(`AccountKey=${"A".repeat(39)};`),
    "sig parameters one character short": fill(`?sig=${"A".repeat(19)} `),
    "auth fields with a short value": fill('"auth" : "AAAA" '),
    "url schemes with no userinfo": fill("postgres://host:5432/db "),
    "url userinfo with no at sign": fill(`postgres://${"u".repeat(60)}:${"p".repeat(60)} `),
    "bearer values one character short": fill(`Bearer ${"a".repeat(15)} `),
    "basic values one character short": fill(`Basic ${"a".repeat(15)} `),
    "40-char base64 runs with no uppercase": fill(`${"a1/".repeat(13)}a `),
    "40-char base64 runs with no slash": fill(`${"aB1".repeat(13)}a `),
    "atlassian prefixes one character short": fill(`ATATT3${"A".repeat(19)} `),
    "vault prefixes with no dot": fill(`hvs${"A".repeat(20)} `),
    "databricks prefixes with 31 hex": fill(`dapi${"a1".repeat(15)}b `),
    "linear prefixes one character short": fill(`lin_api_${"A".repeat(31)} `),
    "grafana prefixes with no checksum": fill(`glsa_${"A".repeat(20)} `),
    "doppler prefixes with no third segment": fill("dp.st. "),
    "sig parameters with no sv sibling": fill(`?sig=${"A".repeat(20)} `),
    "sv parameters that never reach a sig": fill(`?sv=2022-11-02&${"A".repeat(80)} `),
    "keywords followed by a quote run": `api_key${'"'.repeat(SIZE - 7)}`,
    "keyword assignments one character short": fill(`token=${"a1".repeat(5)}b `),
    "env names that are all underscores": fill(`SECRET${"_".repeat(70)}=${"a1".repeat(7)}\n`),
    "one long word": "A".repeat(SIZE),
    "one long quote run": '"'.repeat(SIZE),
    "one long whitespace run": " ".repeat(SIZE),
    "many short lines": fill(`${"A".repeat(78)}\n`),
  };

  for (const [label, text] of Object.entries(ADVERSARIAL)) {
    it(`scans 100 KB of ${label} inside ${BUDGET_MS} ms per pattern`, () => {
      expect(text.length).toBe(SIZE);
      const slow: string[] = [];
      for (const pattern of SECRET_PATTERNS) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        // `performance.now()` rather than `Date.now()`: the latter is not monotonic, so an NTP
        // step mid-assertion would turn a 0.5 ms scan into a spurious CI red.
        const started = performance.now();
        while (regex.exec(text) !== null) {
          if (regex.lastIndex === 0) break;
        }
        const elapsed = performance.now() - started;
        if (elapsed >= BUDGET_MS) slow.push(`${pattern.name}: ${elapsed.toFixed(1)}ms`);
      }
      expect(slow).toEqual([]);
    });
  }

  it("scans 100 KB of every adversarial string through scanText inside a second", () => {
    const started = performance.now();
    for (const [label, text] of Object.entries(ADVERSARIAL)) scanText(text, label);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("formatFindings", () => {
  it("renders the stderr line the CLI contract specifies", () => {
    expect(
      formatFindings([{ path: "done[0].text", pattern: "github-token", index: 12, length: 40 }]),
    ).toEqual(["secret detected at done[0].text (github-token)"]);
  });
});
