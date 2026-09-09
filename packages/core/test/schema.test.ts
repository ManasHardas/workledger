import { describe, expect, it } from "vitest";

import {
  BacklogItem,
  CheckpointPayload,
  Config,
  MAX_PAYLOAD_BYTES,
  MAX_SECTION_ITEMS,
  SCHEMA_VERSION,
  SessionFrontmatter,
  formatIssuePath,
  payloadByteLength,
  requiresGoal,
  validateCheckpointPayload,
} from "../src/index.js";

/**
 * Fixtures are loaded through `import.meta.glob` rather than `node:fs`: `packages/core` is pure
 * TypeScript by contract, and the eslint fence covers `packages/core/**` — tests included.
 */
const validFixtures = import.meta.glob<{ default: unknown }>(
  "./fixtures/checkpoint-payload/valid/*.json",
  { eager: true },
);
const invalidFixtures = import.meta.glob<{ default: unknown }>(
  "./fixtures/checkpoint-payload/invalid/*.json",
  { eager: true },
);
const coreSources = import.meta.glob<string>("../src/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});

function fixture(group: Record<string, { default: unknown }>, name: string): unknown {
  const key = Object.keys(group).find((path) => path.endsWith(`/${name}.json`));
  if (key === undefined) throw new Error(`fixture not found: ${name}.json`);
  return group[key]!.default;
}

/**
 * Every rule in design spec §4.4 has a fixture and an expected error path. `path` is what the
 * CLI prints in front of the message, so it is part of the contract with the agent.
 */
const invalidCases: ReadonlyArray<{ name: string; path: string; message?: RegExp }> = [
  { name: "done-without-evidence", path: "done[0]", message: /needs evidence/ },
  { name: "done-empty-files", path: "done[0]", message: /needs evidence/ },
  {
    name: "done-bad-verified",
    path: "done[0].verified",
    message: /^expected one of tests-passed, tests-failed, not-verified$/,
  },
  { name: "done-bad-commit", path: "done[0].commit", message: /lowercase git commit hash/ },
  { name: "remaining-new-and-ref", path: "remaining[0]", message: /cannot be combined/ },
  { name: "remaining-neither", path: "remaining[0]", message: /expected either `new: true`/ },
  { name: "remaining-ref-without-rel", path: "remaining[0]", message: /`ref` needs a `rel`/ },
  { name: "remaining-rel-without-ref", path: "remaining[0]", message: /`rel` needs a `ref`/ },
  { name: "remaining-missing-why", path: "remaining[0].why" },
  { name: "remaining-bad-wl-id", path: "remaining[0].ref", message: /WL-<ulid>/ },
  { name: "note-decision-without-reason", path: "notes[0].reason", message: /requires `reason`/ },
  { name: "note-decision-without-by", path: "notes[0].by", message: /requires `by`/ },
  {
    name: "note-unknown-type",
    path: "notes[0].type",
    message: /^expected one of discovery, decision, blocker, question$/,
  },
  { name: "too-many-items", path: "done", message: /at most 12 items per section/ },
  { name: "oversize-goal", path: "goal" },
  { name: "unknown-key", path: "(payload)" },
];

describe("CheckpointPayload", () => {
  it("accepts every valid fixture", () => {
    const names = Object.keys(validFixtures);
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) {
      const result = validateCheckpointPayload(validFixtures[name]!.default);
      expect(result.ok, `${name}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it("defaults the three sections to empty arrays", () => {
    const result = validateCheckpointPayload(fixture(validFixtures, "minimal"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      goal: "Ship the zod contracts for P1.",
      done: [],
      remaining: [],
      notes: [],
    });
  });

  it("keeps every item of the full fixture", () => {
    const result = validateCheckpointPayload(fixture(validFixtures, "full"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.done).toHaveLength(3);
    expect(result.value.remaining).toHaveLength(3);
    expect(result.value.notes).toHaveLength(4);
  });

  it("has a fixture for every rule and a rule for every fixture", () => {
    expect(new Set(invalidCases.map((c) => c.name)).size).toBe(invalidCases.length);
    expect(Object.keys(invalidFixtures)).toHaveLength(invalidCases.length);
  });

  it.each(invalidCases)("rejects $name at $path", ({ name, path, message }) => {
    const result = validateCheckpointPayload(fixture(invalidFixtures, name));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const match = result.errors.find((error) => error.path === path);
    expect(match, `errors: ${JSON.stringify(result.errors)}`).toBeDefined();
    if (message !== undefined) expect(match!.message).toMatch(message);
  });

  it("accepts exactly the item cap", () => {
    const done = Array.from({ length: MAX_SECTION_ITEMS }, (_, i) => ({
      text: `Did unit of work ${i + 1}.`,
      commit: "0447dab",
      verified: "not-verified" as const,
    }));
    expect(validateCheckpointPayload({ done }).ok).toBe(true);
  });

  it("rejects a non-object payload without throwing", () => {
    const result = validateCheckpointPayload("not a payload");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe("(payload)");
  });
});

describe("payload size cap", () => {
  it("measures bytes, not characters", () => {
    expect(MAX_PAYLOAD_BYTES).toBe(4096);
    expect(payloadByteLength("")).toBe(0);
    expect(payloadByteLength("ascii")).toBe(5);
    expect(payloadByteLength("é")).toBe(2);
    expect(payloadByteLength("→")).toBe(3);
    expect(payloadByteLength("😀")).toBe(4);
    expect(payloadByteLength("\ud800")).toBe(3);
  });

  it("a 4,097-byte payload is over the cap", () => {
    const raw = `{"goal":"${"g".repeat(MAX_PAYLOAD_BYTES - 11 + 1)}"}`;
    expect(payloadByteLength(raw)).toBe(MAX_PAYLOAD_BYTES + 1);
    expect(payloadByteLength(raw) > MAX_PAYLOAD_BYTES).toBe(true);
  });
});

describe("requiresGoal", () => {
  it("is true at checkpoint 1 and false afterwards", () => {
    expect(requiresGoal(1)).toBe(true);
    expect(requiresGoal(2)).toBe(false);
    expect(requiresGoal(17)).toBe(false);
  });
});

describe("formatIssuePath", () => {
  it("renders array indices and nested keys", () => {
    expect(formatIssuePath([])).toBe("(payload)");
    expect(formatIssuePath(["done", 0, "verified"])).toBe("done[0].verified");
    expect(formatIssuePath(["notes", 2])).toBe("notes[2]");
  });
});

const actor = { name: "Manas Hardas", email: "manas@example.com" };

const session = {
  schema_version: SCHEMA_VERSION,
  id: "01JQZX5N7K8M9P0QRSTVWXYZAB",
  harness: "claude-code",
  harness_session_id: "abc-123",
  repo: "github.com/ManasHardas/workledger",
  author: actor,
  started: "2026-09-09T10:00:00Z",
  status: "open",
  private: false,
  source: "live",
  checkpoints: [
    {
      n: 1,
      at: "2026-09-09T10:05:00Z",
      turns: 4,
      transcript_offset: 40000,
      trigger: "bytes",
    },
  ],
};

describe("SessionFrontmatter", () => {
  it("parses a minimal open session and fills the optional defaults", () => {
    const parsed = SessionFrontmatter.parse(session);
    expect(parsed.needs_repair).toBe(false);
    expect(parsed.checkpoint_failures).toBe(0);
  });

  it("preserves unknown keys", () => {
    const parsed = SessionFrontmatter.parse({ ...session, future_key: "kept" });
    expect((parsed as Record<string, unknown>)["future_key"]).toBe("kept");
  });

  it("reserves the P3 triggers in the enum", () => {
    for (const trigger of ["end", "repair", "backfill", "extract"]) {
      const checkpoints = [{ ...session.checkpoints[0], trigger }];
      expect(SessionFrontmatter.safeParse({ ...session, checkpoints }).success).toBe(true);
    }
  });

  it("rejects a bad ULID and an unknown status", () => {
    expect(SessionFrontmatter.safeParse({ ...session, id: "nope" }).success).toBe(false);
    expect(SessionFrontmatter.safeParse({ ...session, status: "paused" }).success).toBe(false);
  });

  it("accepts nullable ended / end_reason / branch / model", () => {
    const parsed = SessionFrontmatter.parse({
      ...session,
      branch: null,
      ended: null,
      end_reason: null,
      model: null,
    });
    expect(parsed.ended).toBeNull();
  });
});

const backlogItem = {
  schema_version: SCHEMA_VERSION,
  id: "WL-01JQZX5N7K8M9P0QRSTVWXYZAB",
  title: "Add the frontmatter round trip",
  status: "proposed",
  proposed_by: {
    harness: "claude-code",
    session: "01JQZX5N7K8M9P0QRSTVWXYZAB",
    checkpoint: 1,
    author: actor,
  },
  rank: 0,
  created: "2026-09-09T10:05:00Z",
  updated: "2026-09-09T10:05:00Z",
  history: [
    { at: "2026-09-09T10:05:00Z", by: actor, op: "create", diff: "created" },
    {
      at: "2026-09-09T11:05:00Z",
      by: { session: "01JQZX5N7K8M9P0QRSTVWXYZAB", checkpoint: 2 },
      op: "status",
      diff: "status: proposed → accepted",
    },
  ],
};

describe("BacklogItem", () => {
  it("parses a proposed item and defaults area / blocked_by", () => {
    const parsed = BacklogItem.parse(backlogItem);
    expect(parsed.area).toEqual([]);
    expect(parsed.blocked_by).toEqual([]);
    expect(parsed.rank).toBe(0);
  });

  it("accepts an Actor or a SessionRef as a history author", () => {
    const parsed = BacklogItem.parse(backlogItem);
    expect(parsed.history).toHaveLength(2);
  });

  it("rejects a backlog id without the WL- prefix", () => {
    const result = BacklogItem.safeParse({ ...backlogItem, id: "01JQZX5N7K8M9P0QRSTVWXYZAB" });
    expect(result.success).toBe(false);
  });

  it("accepts null for the optional stamps", () => {
    const parsed = BacklogItem.parse({
      ...backlogItem,
      confirmed_by: null,
      owner: null,
      priority: null,
      done_by: null,
    });
    expect(parsed.owner).toBeNull();
  });

  it("rejects an unknown history op", () => {
    const history = [{ at: "2026-09-09T10:05:00Z", by: actor, op: "yeet" }];
    expect(BacklogItem.safeParse({ ...backlogItem, history }).success).toBe(false);
  });
});

describe("Config", () => {
  it("fills every default from an empty file", () => {
    const parsed = Config.parse({ schema_version: SCHEMA_VERSION });
    expect(parsed).toMatchObject({
      harnesses: ["claude-code"],
      thresholds: { bytes: 40000, minutes: 20, turns: 15 },
      brief: { inject: true, max_tokens: 2000 },
      stale_turns: 5,
      orphan_minutes: 30,
      private_paths: [],
      auto_commit: false,
    });
  });

  it("preserves unknown keys", () => {
    const parsed = Config.parse({ schema_version: SCHEMA_VERSION, future_knob: 3 });
    expect((parsed as Record<string, unknown>)["future_knob"]).toBe(3);
  });

  it("rejects an out-of-range threshold and an unknown harness", () => {
    expect(
      Config.safeParse({ schema_version: SCHEMA_VERSION, thresholds: { bytes: 0 } }).success,
    ).toBe(false);
    expect(
      Config.safeParse({ schema_version: SCHEMA_VERSION, harnesses: ["emacs"] }).success,
    ).toBe(false);
  });
});

describe("packages/core purity", () => {
  it("imports no Node built-ins", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(coreSources)) {
      const imports = source.matchAll(/from\s+"([^"]+)"/g);
      for (const [, specifier] of imports) {
        if (specifier!.startsWith("node:") || ["fs", "path", "os", "crypto", "url", "child_process"].includes(specifier!)) {
          offenders.push(`${path}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares zod as its only runtime import", () => {
    const specifiers = new Set<string>();
    for (const source of Object.values(coreSources)) {
      for (const [, specifier] of source.matchAll(/from\s+"([^"]+)"/g)) {
        if (!specifier!.startsWith(".")) specifiers.add(specifier!);
      }
    }
    expect([...specifiers]).toEqual(["zod"]);
  });
});

describe("CheckpointPayload schema object", () => {
  it("is exported as a zod schema as well as a type", () => {
    expect(CheckpointPayload.safeParse({}).success).toBe(true);
  });
});
