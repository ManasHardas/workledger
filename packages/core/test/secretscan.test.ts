import { describe, expect, it } from "vitest";

import {
  MAX_SCAN_DEPTH,
  SECRET_PATTERNS,
  SECRET_PATTERN_NAMES,
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

/** A fake but credential-shaped value: 16 chars, all distinct, mixed case and digits. */
const FAKE_VALUE = "A1b2C3d4E5f6G7h8";

interface PlantedCase {
  /** The pattern name the scanner must report. */
  readonly pattern: string;
  /** The secret-shaped text, planted alone or inside a sentence. */
  readonly secret: string;
  /** The string handed to the scanner; defaults to `secret` on its own. */
  readonly text?: string;
}

const PLANTED: readonly PlantedCase[] = [
  { pattern: "private-key", secret: "-----BEGIN RSA PRIVATE KEY-----" },
  {
    pattern: "jwt",
    secret: `eyJ${"hbGciOiJIUzI1NiJ9"}.${"eyJzdWIiOiJmYWtlLXN1YmplY3QifQ"}.${x(24)}`,
  },
  { pattern: "aws-access-key-id", secret: `AKIA${"IOSFODNN7EXAMPLE"}` },
  {
    pattern: "aws-secret-access-key",
    secret: `aws_secret_access_key = ${"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`,
  },
  { pattern: "github-token", secret: `ghp_${x(36)}` },
  { pattern: "github-pat", secret: `github_pat_${x(24)}` },
  { pattern: "slack-token", secret: `xoxb-${"000000000000"}-${x(24)}` },
  { pattern: "slack-webhook", secret: `https://hooks.slack.com/services/T0000/B0000/${x(24)}` },
  { pattern: "anthropic-key", secret: `sk-ant-api03-${x(32)}` },
  { pattern: "openai-key", secret: `sk-proj-${"T3BlbkFJ"}${x(32)}` },
  { pattern: "stripe-key", secret: `sk_live_${"4eC39HqLyjWDarjtT1zdp7dc"}` },
  { pattern: "google-api-key", secret: `AIza${"SyD"}${x(32)}` },
  { pattern: "npm-token", secret: `npm_${x(36)}` },
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

  it("keeps the names `scripts/redact-patterns.mjs` shares with it", () => {
    // The redactor's set minus its two privacy-only entries (`email`, `home-path`), which core
    // deliberately does not carry — see the note at the top of secretscan-patterns.ts. If this
    // list and the redactor's diverge, that is a contract question, not a silent fix.
    const shared = [
      "private-key",
      "jwt",
      "aws-access-key-id",
      "aws-secret-access-key",
      "github-token",
      "github-pat",
      "slack-token",
      "slack-webhook",
      "anthropic-key",
      "openai-key",
      "npm-token",
      "bearer-token",
      "generic-api-key",
    ];
    expect(SECRET_PATTERN_NAMES).toEqual(expect.arrayContaining(shared));
  });
});

describe("catches every planted secret", () => {
  it("covers every pattern in the set", () => {
    expect(PLANTED.map((c) => c.pattern).sort()).toEqual([...SECRET_PATTERN_NAMES].sort());
  });

  for (const planted of PLANTED) {
    it(`flags ${planted.pattern}`, () => {
      const text = planted.text ?? planted.secret;
      const findings = scanText(text, "payload.goal");
      expect(findings.map((f) => f.pattern)).toEqual([planted.pattern]);
      expect(findings[0]!.path).toBe("payload.goal");
      // The span must actually cover the planted text, so a caller could redact from it.
      const { index, length } = findings[0]!;
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index + length).toBeLessThanOrEqual(text.length);
      expect(text.slice(index, index + length).length).toBe(length);
    });
  }
});

describe("no Finding ever contains a substring of the input", () => {
  for (const planted of PLANTED) {
    it(`leaks nothing for ${planted.pattern}`, () => {
      const text = planted.text ?? planted.secret;
      const findings = scanText(text, "done[0].text");
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
  };

  for (const [label, text] of Object.entries(CLEAN)) {
    it(`does not flag a ${label}`, () => {
      expect(formatFindings(scanText(text, label))).toEqual([]);
    });
  }

  it("finds nothing in a realistic clean checkpoint payload", () => {
    const payload = {
      schema_version: 1,
      goal: "Ship the secret scanner for packages/core",
      done: [
        {
          text: "Added secretscan-patterns.ts with 16 named patterns",
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
  it("reports the exact JSON path of a finding inside notes[2].reason", () => {
    const payload = {
      notes: [
        { type: "discovery", text: "nothing here" },
        { type: "blocker", text: "still nothing" },
        { type: "decision", reason: `deploy uses ghp_${x(36)}` },
      ],
    };
    expect(formatFindings(scanValue(payload))).toEqual([
      "secret detected at notes[2].reason (github-token)",
    ]);
  });

  it("honours a root path prefix", () => {
    expect(scanValue({ goal: `AKIA${"IOSFODNN7EXAMPLE"}` }, "payload")[0]!.path).toBe("payload.goal");
  });

  it("brackets a key that is not a plain identifier", () => {
    const findings = scanValue({ "done items": [`npm_${x(36)}`] });
    expect(findings[0]!.path).toBe('["done items"][0]');
  });

  it("skips numbers, booleans, null, and non-plain objects", () => {
    expect(scanValue({ a: 1, b: true, c: null, d: new Map([["k", `ghp_${x(36)}`]]) })).toEqual([]);
  });

  it("scans a plain string at the root", () => {
    expect(scanValue(`ghp_${x(36)}`, "stdin")[0]!.path).toBe("stdin");
  });

  it("terminates on a cyclic structure", () => {
    const node: Record<string, unknown> = { text: `ghp_${x(36)}` };
    node["self"] = node;
    expect(formatFindings(scanValue(node))).toEqual(["secret detected at text (github-token)"]);
  });

  it("scans a value that appears twice without treating the second as a cycle", () => {
    const shared = { text: `ghp_${x(36)}` };
    const findings = scanValue({ a: shared, b: shared });
    expect(findings.map((f) => f.path)).toEqual(["a.text", "b.text"]);
  });

  it(`stops descending at MAX_SCAN_DEPTH (${MAX_SCAN_DEPTH})`, () => {
    const secret = `ghp_${x(36)}`;
    const build = (depth: number): unknown => {
      let node: unknown = secret;
      for (let i = 0; i < depth; i += 1) node = { n: node };
      return node;
    };
    expect(scanValue(build(MAX_SCAN_DEPTH)).length).toBe(1);
    expect(scanValue(build(MAX_SCAN_DEPTH + 1))).toEqual([]);
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
    // `github_pat_…` would also satisfy the broad env-assignment heuristic; the specific pattern
    // runs first and claims the span, so the generic one is suppressed.
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
    "jwt prefixes with no separator": fill("eyJ"),
    "jwt first segments that never reach a dot": fill(`eyJ${"A".repeat(60)} `),
    "aws prefixes one character short": fill(`AKIA${"0".repeat(15)} `),
    "aws secret assignments one character short": fill(`aws_secret_access_key=${"A".repeat(39)} `),
    "github prefixes past the length cap": fill(`ghp_${"A".repeat(300)} `),
    "openai prefixes one character short": fill(`sk-${"A".repeat(31)} `),
    "bearer values one character short": fill(`Bearer ${"a".repeat(15)} `),
    "keywords followed by a quote run": `api_key${'"'.repeat(SIZE - 7)}`,
    "keyword assignments one character short": fill(`token=${"a1".repeat(7)} `),
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
        const started = Date.now();
        while (regex.exec(text) !== null) {
          if (regex.lastIndex === 0) break;
        }
        const elapsed = Date.now() - started;
        if (elapsed >= BUDGET_MS) slow.push(`${pattern.name}: ${elapsed}ms`);
      }
      expect(slow).toEqual([]);
    });
  }

  it("scans 100 KB of every adversarial string through scanText inside a second", () => {
    const started = Date.now();
    for (const [label, text] of Object.entries(ADVERSARIAL)) scanText(text, label);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("formatFindings", () => {
  it("renders the stderr line the CLI contract specifies", () => {
    expect(
      formatFindings([{ path: "done[0].text", pattern: "github-token", index: 12, length: 40 }]),
    ).toEqual(["secret detected at done[0].text (github-token)"]);
  });
});
