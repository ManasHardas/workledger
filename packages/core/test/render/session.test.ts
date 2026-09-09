import { describe, expect, it } from "vitest";

import {
  type Checkpoint,
  type CheckpointPayload,
  type ResolvedRef,
  type SessionFrontmatter,
  RenderError,
  SESSION_SECTIONS,
  SessionFrontmatter as SessionFrontmatterSchema,
  appendCheckpoint,
  createSessionText,
  parseSessionText,
  renderNoteLine,
} from "../../src/index.js";

import { PURITY_IMPORT_RE } from "../purity.js";

/**
 * Golden files are loaded through `import.meta.glob` rather than `node:fs`: `packages/core` is
 * pure TypeScript by contract and the eslint fence covers `packages/core/**` — tests included.
 */
const goldens = import.meta.glob<string>("../golden/session/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function golden(name: string): string {
  const key = Object.keys(goldens).find((path) => path.endsWith(`/${name}.md`));
  if (key === undefined) throw new Error(`golden not found: ${name}.md`);
  return goldens[key]!;
}

const SESSION = "01J9AA00000000000000000000";
const WL_SIZE = "WL-01J9AB00000000000000000000";
const WL_RETRY = "WL-01J8ZZ00000000000000000000";
const WL_OPS = "WL-01J9AC00000000000000000000";

const FRONTMATTER = {
  schema_version: 1,
  id: SESSION,
  harness: "claude-code",
  harness_session_id: "hsess-0a1b2c3d4e5f6071",
  repo: "github.com/org/repo",
  branch: "main",
  author: { name: "Ada Lovelace", email: "ada@example.com", dome_user: null },
  started: "2026-09-09T14:02:11Z",
  ended: null,
  end_reason: null,
  status: "open",
  private: false,
  source: "live",
  model: "claude-opus-5",
  needs_repair: false,
  checkpoint_failures: 0,
  checkpoints: [],
} as unknown as SessionFrontmatter;

const CP1: Checkpoint = {
  n: 1,
  at: "2026-09-09T14:31:02Z",
  turns: 7,
  transcript_offset: 48213,
  trigger: "bytes",
};
const CP2: Checkpoint = {
  n: 2,
  at: "2026-09-09T15:04:40Z",
  turns: 16,
  transcript_offset: 131904,
  trigger: "minutes",
};
const CP3: Checkpoint = {
  n: 3,
  at: "2026-09-09T15:40:00Z",
  turns: 22,
  transcript_offset: 190004,
  trigger: "turns",
};

const PAYLOAD_1 = {
  goal: "Make the 40 MB upload stop timing out",
  done: [
    {
      text: "Reproduced the timeout with a 40 MB fixture.",
      files: ["fixtures/big.bin"],
      verified: "not-verified",
    },
  ],
  remaining: [
    {
      text: "Ask ops whether the 50 MB limit is configurable",
      why: "the answer decides whether we cap or chunk",
      new: true,
      blocked_by: [],
    },
  ],
  notes: [
    {
      type: "discovery",
      text: "The upload service strips Content-Length on redirect; retries must re-stream.",
    },
  ],
} as unknown as CheckpointPayload;

const PAYLOAD_2 = {
  done: [
    {
      text: "Added retry to the upload client.",
      files: ["src/upload.ts", "src/upload.test.ts"],
      commit: "a1b2c3d",
      verified: "tests-passed",
    },
  ],
  remaining: [
    {
      text: "Add a size limit before upload",
      why: "server rejects >50 MB with no message",
      new: true,
    },
    {
      text: "Retry on 502 was the open item from Monday",
      why: "it is the last blocker on the Monday thread",
      ref: WL_RETRY,
      rel: "closes",
    },
  ],
  notes: [
    {
      type: "decision",
      text: "Keep uploads synchronous for now",
      by: "human",
      reason: "async path needs the queue work first.",
    },
    { type: "blocker", text: "Staging has no 50 MB fixture; cannot verify the limit path." },
    { type: "question", text: "Should partial uploads be resumable, or is restart acceptable?" },
  ],
} as unknown as CheckpointPayload;

const REFS_1 = new Map<string, ResolvedRef>([["0", { id: WL_OPS, rel: "new" }]]);
const REFS_2 = new Map<string, ResolvedRef>([
  ["0", { id: WL_SIZE, rel: "new" }],
  ["1", { id: WL_RETRY, rel: "closes" }],
]);

describe("createSessionText", () => {
  it("writes validated frontmatter and the four empty section headings", () => {
    const text = createSessionText(FRONTMATTER);
    expect(text).toBe(golden("checkpoint-1.in"));
    const { body } = { body: text.slice(text.lastIndexOf("\n---\n") + 5) };
    expect(body).toBe("## Goal\n\n## Done\n\n## Remaining\n\n## Notes\n");
    for (const heading of SESSION_SECTIONS) expect(text).toContain(`${heading}\n`);
  });

  it("rejects frontmatter that fails the SessionFrontmatter schema", () => {
    const bad = { ...FRONTMATTER, harness: "emacs" } as unknown as SessionFrontmatter;
    expect(() => createSessionText(bad)).toThrow(RenderError);
    try {
      createSessionText(bad);
    } catch (error) {
      expect((error as RenderError).code).toBe("invalid-input");
      expect((error as RenderError).details.join("\n")).toContain("harness");
    }
  });
});

describe("appendCheckpoint golden files", () => {
  it("renders the spec §4.1 example byte for byte", () => {
    const first = appendCheckpoint(golden("checkpoint-1.in"), PAYLOAD_1, CP1, REFS_1);
    expect(first.text).toBe(golden("checkpoint-1.out"));

    const second = appendCheckpoint(golden("checkpoint-2.in"), PAYLOAD_2, CP2, REFS_2);
    expect(second.text).toBe(golden("checkpoint-2.out"));

    // The Done and Notes blocks of §4.1 are reproduced character for character; Remaining differs
    // from the printed spec only in carrying full 26-character ULIDs and the schema-required
    // `; why:` that the spec's abbreviated example omits.
    expect(second.text).toContain(
      "- [cp 2] Added retry to the upload client. files: src/upload.ts, src/upload.test.ts · commit: a1b2c3d · verified: tests-passed",
    );
    expect(second.text).toContain(
      "- [cp 1] Reproduced the timeout with a 40 MB fixture. files: fixtures/big.bin · verified: not-verified",
    );
    expect(second.text).toContain(
      "- discovery [cp 1]: The upload service strips Content-Length on redirect; retries must re-stream.",
    );
    expect(second.text).toContain(
      "- blocker [cp 2]: Staging has no 50 MB fixture; cannot verify the limit path.",
    );
    expect(second.text).toContain(
      "- question [cp 2]: Should partial uploads be resumable, or is restart acceptable?",
    );
  });

  it("reports the counts the CLI prints (cli.md step 8)", () => {
    expect(appendCheckpoint(golden("checkpoint-1.in"), PAYLOAD_1, CP1, REFS_1).summary).toEqual({
      done: 1,
      remaining: 1,
      newItems: 1,
      closed: 0,
      questions: 0,
    });
    expect(appendCheckpoint(golden("checkpoint-2.in"), PAYLOAD_2, CP2, REFS_2).summary).toEqual({
      done: 1,
      remaining: 2,
      newItems: 1,
      closed: 1,
      questions: 1,
    });
  });

  it("a second checkpoint appends without rewriting cp 1 lines", () => {
    const before = parseSessionText(golden("checkpoint-2.in"));
    const after = parseSessionText(golden("checkpoint-2.out"));

    for (const section of ["done", "remaining", "notes"] as const) {
      const kept = after[section].filter((line) => line.cp === 1).map((line) => line.raw);
      expect(kept).toEqual(before[section].filter((line) => line.cp === 1).map((l) => l.raw));
    }
    // Newest first under Done and Remaining, chronological under Notes (spec §4.1 example).
    expect(after.done.map((line) => line.cp)).toEqual([2, 1]);
    expect(after.remaining.map((line) => line.cp)).toEqual([2, 2, 1]);
    expect(after.notes.map((line) => line.cp)).toEqual([1, 2, 2, 2]);
  });

  it("goal is replaced, not appended, on a later checkpoint", () => {
    const before = parseSessionText(golden("goal-replaced.in"));
    expect(before.goal.map((line) => line.text)).toEqual([
      "Make the 40 MB upload stop timing out",
    ]);

    const after = parseSessionText(golden("goal-replaced.out"));
    expect(after.goal).toHaveLength(1);
    expect(after.goal[0]).toMatchObject({ cp: 3, text: "Cap uploads at 50 MB and tell the user" });
    expect(golden("goal-replaced.out")).toBe(
      appendCheckpoint(
        golden("goal-replaced.in"),
        { goal: "Cap uploads at 50 MB and tell the user", done: [], remaining: [], notes: [] },
        CP3,
      ).text,
    );
  });

  it("keeps the previous goal when a later checkpoint carries none", () => {
    const kept = appendCheckpoint(
      golden("checkpoint-2.in"),
      PAYLOAD_2,
      CP2,
      REFS_2,
    );
    expect(parseSessionText(kept.text).goal[0]).toMatchObject({ cp: 1 });
  });
});

describe("line forms", () => {
  it("decision notes render as '- decision [cp n] by <by>: <text>; reason: <reason>'", () => {
    const line = renderNoteLine(2, {
      type: "decision",
      text: "Keep uploads synchronous for now",
      by: "human",
      reason: "async path needs the queue work first.",
    });
    expect(line).toBe(
      "- decision [cp 2] by human: Keep uploads synchronous for now; reason: async path needs the queue work first.",
    );

    const parsed = parseSessionText(golden("checkpoint-2.out")).notes.find(
      (note) => note.type === "decision",
    );
    expect(parsed).toMatchObject({
      cp: 2,
      by: "human",
      text: "Keep uploads synchronous for now",
      reason: "async path needs the queue work first.",
    });
  });

  it("non-decision notes render without a `by` or a `reason`", () => {
    expect(renderNoteLine(1, { type: "blocker", text: "Staging has no fixture." })).toBe(
      "- blocker [cp 1]: Staging has no fixture.",
    );
  });

  it("splits Done evidence off the prose even when the text ends in a period", () => {
    const [done] = parseSessionText(golden("checkpoint-2.out")).done;
    expect(done).toMatchObject({
      cp: 2,
      text: "Added retry to the upload client.",
      files: ["src/upload.ts", "src/upload.test.ts"],
      commit: "a1b2c3d",
      verified: "tests-passed",
    });
  });

  it("renders `blocked_by` only when the payload carries the key, and `none` when it is empty", () => {
    const lines = parseSessionText(golden("checkpoint-2.out")).remaining;
    const withKey = lines.find((line) => line.ref === WL_OPS);
    const withoutKey = lines.find((line) => line.ref === WL_SIZE);
    expect(withKey?.blockedBy).toEqual([]);
    expect(withKey?.raw.endsWith("blocked_by: none")).toBe(true);
    expect(withoutKey?.blockedBy).toBeUndefined();
    expect(withoutKey?.raw).not.toContain("blocked_by");
  });

  it("collapses newlines in agent text so one payload item stays one line", () => {
    const result = appendCheckpoint(
      golden("checkpoint-1.in"),
      {
        goal: "Line one\nline two",
        done: [
          { text: "Did\na\tthing.", files: ["a.ts"], verified: "tests-passed" },
        ],
        remaining: [],
        notes: [{ type: "question", text: "Why\nis this\nwrapped?" }],
      } as unknown as CheckpointPayload,
      CP1,
    );
    const parsed = parseSessionText(result.text);
    expect(parsed.goal[0]?.text).toBe("Line one line two");
    expect(parsed.done[0]?.text).toBe("Did a thing.");
    expect(parsed.notes[0]?.text).toBe("Why is this wrapped?");
    expect(result.text.split("\n").filter((l) => l.startsWith("- ")).length).toBe(3);
  });
});

describe("appendCheckpoint refuses what it cannot render", () => {
  it("rejects appending checkpoint n twice", () => {
    const once = appendCheckpoint(golden("checkpoint-1.in"), PAYLOAD_1, CP1, REFS_1).text;
    expect(() => appendCheckpoint(once, PAYLOAD_1, CP1, REFS_1)).toThrow(RenderError);
    try {
      appendCheckpoint(once, PAYLOAD_1, CP1, REFS_1);
    } catch (error) {
      expect((error as RenderError).code).toBe("duplicate-checkpoint");
      expect((error as RenderError).message).toContain("already recorded");
    }
  });

  it("rejects a stamp that is behind the last recorded checkpoint", () => {
    // A gap in `checkpoints[]` is not an invitation to fill it: an index rebuild derives `n` from
    // the file, so a stamp behind the last one means the caller read stale state.
    const withGap = appendCheckpoint(golden("checkpoint-1.out"), PAYLOAD_2, CP3, REFS_2).text;
    try {
      appendCheckpoint(withGap, PAYLOAD_2, CP2, REFS_2);
      expect.unreachable("expected a RenderError");
    } catch (error) {
      expect((error as RenderError).code).toBe("duplicate-checkpoint");
      expect((error as RenderError).message).toContain("behind the last recorded checkpoint 3");
    }
  });

  it("reads a hand-edited Done line that carries no evidence at all", () => {
    const handEdited = golden("checkpoint-1.out").replace(
      "## Done\n",
      "## Done\n- [cp 1] Someone typed this straight into the file\n",
    );
    const [first] = parseSessionText(handEdited).done;
    expect(first).toMatchObject({
      cp: 1,
      text: "Someone typed this straight into the file",
      files: [],
    });
    expect(first?.commit).toBeUndefined();
    expect(first?.verified).toBeUndefined();
  });

  it("rejects a first checkpoint with no goal", () => {
    expect(() =>
      appendCheckpoint(golden("checkpoint-1.in"), {
        done: [],
        remaining: [],
        notes: [],
      } as unknown as CheckpointPayload, CP1),
    ).toThrowError(/must carry a goal/);
  });

  it("rejects a `new` Remaining item with no resolved backlog id", () => {
    try {
      appendCheckpoint(golden("checkpoint-1.in"), PAYLOAD_1, CP1, new Map());
      expect.unreachable("expected a RenderError");
    } catch (error) {
      expect((error as RenderError).code).toBe("unresolved-ref");
    }
  });

  it("takes an item that already names a ref at its word when the map omits it", () => {
    const text = appendCheckpoint(
      golden("checkpoint-1.in"),
      {
        goal: "g",
        done: [],
        remaining: [{ text: "t", why: "w", ref: WL_RETRY, rel: "updates" }],
        notes: [],
      } as unknown as CheckpointPayload,
      CP1,
    );
    expect(text.summary).toMatchObject({ newItems: 0, closed: 0 });
    expect(parseSessionText(text.text).remaining[0]).toMatchObject({
      ref: WL_RETRY,
      rel: "updates",
    });
  });

  it("rejects an invalid stamp and an invalid payload", () => {
    expect(() =>
      appendCheckpoint(golden("checkpoint-1.in"), PAYLOAD_1, { ...CP1, n: 0 }, REFS_1),
    ).toThrow(RenderError);
    expect(() =>
      appendCheckpoint(
        golden("checkpoint-1.in"),
        { goal: "g", done: [{ text: "no evidence", verified: "tests-passed" }] } as unknown as CheckpointPayload,
        CP1,
      ),
    ).toThrow(RenderError);
  });

  it("rejects a document with no frontmatter", () => {
    try {
      parseSessionText("## Goal\n");
      expect.unreachable("expected a RenderError");
    } catch (error) {
      expect((error as RenderError).code).toBe("invalid-document");
    }
  });

  it("rejects frontmatter that is not a session", () => {
    try {
      parseSessionText("---\nschema_version: 1\n---\n");
      expect.unreachable("expected a RenderError");
    } catch (error) {
      expect((error as RenderError).code).toBe("invalid-document");
      expect((error as RenderError).details.length).toBeGreaterThan(0);
    }
  });
});

describe("round trip", () => {
  it("rendered frontmatter validates against the SessionFrontmatter zod schema", () => {
    for (const name of ["checkpoint-1.out", "checkpoint-2.out", "goal-replaced.out"]) {
      const { frontmatter } = parseSessionText(golden(name));
      expect(SessionFrontmatterSchema.safeParse(frontmatter).success).toBe(true);
    }
    const at2 = parseSessionText(golden("checkpoint-2.out")).frontmatter;
    expect(at2.checkpoints.map((entry) => entry.n)).toEqual([1, 2]);
    expect(at2.checkpoints[1]).toEqual(CP2);
  });

  it("preserves unknown frontmatter keys and a body section this build does not know", () => {
    const withExtras = golden("checkpoint-2.out")
      .replace("\n---\n## Goal", "\nx_future: kept\n---\n## Goal")
      .replace(/\n$/, "\n\n## Provenance\n- an unknown block\n");
    const appended = appendCheckpoint(withExtras, PAYLOAD_2, CP3, REFS_2).text;
    expect(appended).toContain("x_future: kept");
    expect(appended).toContain("## Provenance\n- an unknown block\n");
    expect(parseSessionText(appended).extra).toBe("## Provenance\n- an unknown block\n");
  });

  it("re-appending the same file's own lines is stable", () => {
    const once = golden("checkpoint-2.out");
    const parsed = parseSessionText(once);
    expect(parsed.done.map((line) => line.raw).join("\n")).toBe(
      once
        .split("## Done\n")[1]!
        .split("\n\n")[0]!,
    );
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

/** Deterministic PRNG: the property tests must fail the same way twice. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERIFIED_VALUES = ["tests-passed", "tests-failed", "not-verified"] as const;
const NOTE_TYPE_VALUES = ["discovery", "decision", "blocker", "question"] as const;
/** Strings chosen to attack the parse: separators, arrows, and key-shaped prose. */
const NASTY = [
  "plain text",
  "text with; a semicolon",
  "text with · a middot",
  "talks about files: and commit: and verified: inline",
  "why: looks like a key",
  "→ WL-01J9AB00000000000000000000 (new) looks like a ref",
  "trailing whitespace   ",
  "multi\nline\ttext",
  "- [cp 9] looks like another line",
  "blocked_by: none",
];

function randomPayload(rand: () => number, n: number): {
  payload: CheckpointPayload;
  refs: Map<string, ResolvedRef>;
} {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(rand() * values.length)]!;
  const count = (max: number): number => Math.floor(rand() * (max + 1));

  const done = Array.from({ length: count(4) }, () => ({
    text: pick(NASTY),
    files: rand() < 0.7 ? [`src/${Math.floor(rand() * 1000)}.ts`] : undefined,
    commit: rand() < 0.5 ? "a1b2c3d" : undefined,
    verified: pick(VERIFIED_VALUES),
  })).map((item) =>
    item.files === undefined && item.commit === undefined ? { ...item, commit: "a1b2c3d" } : item,
  );

  const refs = new Map<string, ResolvedRef>();
  const remaining = Array.from({ length: count(4) }, (_unused, index) => {
    const isNew = rand() < 0.5;
    const id = `WL-${`01J9A${String(index)}${String(n % 10)}`.padEnd(26, "0")}`;
    const rel: ResolvedRef["rel"] = isNew ? "new" : rand() < 0.5 ? "updates" : "closes";
    refs.set(String(index), { id, rel });
    const base: Record<string, unknown> = { text: pick(NASTY), why: pick(NASTY) };
    if (isNew) base["new"] = true;
    else {
      base["ref"] = id;
      base["rel"] = rel;
    }
    if (rand() < 0.4) base["blocked_by"] = rand() < 0.5 ? [] : [id];
    return base;
  });

  const notes = Array.from({ length: count(4) }, () => {
    const type = pick(NOTE_TYPE_VALUES);
    const note: Record<string, unknown> = { type, text: pick(NASTY) };
    if (type === "decision") {
      note["by"] = rand() < 0.5 ? "human" : "agent";
      note["reason"] = pick(NASTY);
    }
    return note;
  });

  return {
    payload: { goal: pick(NASTY), done, remaining, notes } as unknown as CheckpointPayload,
    refs,
  };
}

describe("property: rendering never loses a checkpoint", () => {
  it("append then parse preserves checkpoint count and ids over 60 random sequences", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const rand = mulberry32(seed);
      let text = createSessionText(FRONTMATTER);
      const length = 1 + Math.floor(rand() * 5);
      const expectedRefs: string[] = [];

      for (let n = 1; n <= length; n += 1) {
        const { payload, refs } = randomPayload(rand, n);
        const stamp: Checkpoint = {
          n,
          at: "2026-09-09T14:00:00Z",
          turns: n * 3,
          transcript_offset: n * 1000,
          trigger: "manual",
        };
        text = appendCheckpoint(text, payload, stamp, refs).text;
        for (let i = 0; i < payload.remaining.length; i += 1) expectedRefs.push(refs.get(String(i))!.id);
      }

      const parsed = parseSessionText(text);
      expect(parsed.frontmatter.checkpoints.map((entry) => entry.n)).toEqual(
        Array.from({ length }, (_unused, index) => index + 1),
      );
      // Remaining is newest-first, so the ids come back in reverse checkpoint order.
      expect([...parsed.remaining.map((line) => line.ref)].sort()).toEqual(
        [...expectedRefs].sort(),
      );
      expect(parsed.goal).toHaveLength(1);
      expect(SessionFrontmatterSchema.safeParse(parsed.frontmatter).success).toBe(true);
    }
  });

  it("200 random payloads render and re-parse without throwing", () => {
    const rand = mulberry32(20260909);
    let rendered = 0;
    for (let i = 0; i < 200; i += 1) {
      const { payload, refs } = randomPayload(rand, i);
      const stamp: Checkpoint = {
        n: 1,
        at: "2026-09-09T14:00:00Z",
        turns: 1,
        transcript_offset: 1,
        trigger: "manual",
      };
      const result = appendCheckpoint(createSessionText(FRONTMATTER), payload, stamp, refs);
      const parsed = parseSessionText(result.text);
      expect(parsed.done).toHaveLength(payload.done.length);
      expect(parsed.remaining).toHaveLength(payload.remaining.length);
      expect(parsed.notes).toHaveLength(payload.notes.length);
      expect(result.summary.done).toBe(payload.done.length);
      rendered += 1;
    }
    expect(rendered).toBe(200);
  });
});

describe("packages/core/src/render purity", () => {
  const renderSources = import.meta.glob<string>("../../src/render/*.ts", {
    eager: true,
    query: "?raw",
    import: "default",
  });

  it("imports no Node built-ins", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(renderSources)) {
      for (const [, specifier] of source.matchAll(PURITY_IMPORT_RE)) {
        if (
          specifier!.startsWith("node:") ||
          ["fs", "path", "os", "crypto", "url", "child_process"].includes(specifier!)
        ) {
          offenders.push(`${path}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(Object.keys(renderSources).length).toBeGreaterThanOrEqual(3);
  });
});

describe("hand-edited lines survive a write (CR blocker)", () => {
  const STRAY_DONE = "- a bare hand-written done line";
  const STRAY_NOTES = "trailing junk paragraph";

  /** The cp-1 golden with a stray under `## Done` and a prose paragraph under `## Notes`. */
  function handEdited(): string {
    return golden("checkpoint-1.out")
      .replace("## Done\n", `## Done\n${STRAY_DONE}\n`)
      .replace(/\n$/, `\n${STRAY_NOTES}\nsecond line of the same paragraph\n`);
  }

  it("surfaces a line that matches no form instead of guessing at it", () => {
    const parsed = parseSessionText(handEdited());
    expect(parsed.unparsed).toEqual([
      { section: "done", line: STRAY_DONE },
      { section: "notes", line: STRAY_NOTES },
      { section: "notes", line: "second line of the same paragraph" },
    ]);
    // The lines that do parse are unaffected by the strays around them.
    expect(parsed.done).toHaveLength(1);
    expect(parsed.notes).toHaveLength(1);
  });

  it("re-emits a stray under `## Done` and prose under `## Notes` on the next append", () => {
    const appended = appendCheckpoint(handEdited(), PAYLOAD_2, CP2, REFS_2).text;
    expect(appended).toContain(STRAY_DONE);
    expect(appended).toContain(STRAY_NOTES);
    expect(appended).toContain("second line of the same paragraph");
    // At the foot of its own section, not adrift in another one.
    const doneBlock = appended.split("## Done\n")[1]!.split("\n\n")[0]!;
    expect(doneBlock.split("\n").at(-1)).toBe(STRAY_DONE);
    expect(appended.split("## Notes\n")[1]!.trimEnd().split("\n").slice(-2)).toEqual([
      STRAY_NOTES,
      "second line of the same paragraph",
    ]);
  });

  it("preserves both byte for byte across three appends", () => {
    let text = handEdited();
    for (const [n, stamp] of [CP2, CP3, { ...CP3, n: 4 }].entries()) {
      text = appendCheckpoint(text, PAYLOAD_2, { ...stamp, n: n + 2 }, REFS_2).text;
      expect(text).toContain(`\n${STRAY_DONE}\n`);
      expect(text).toContain(`\n${STRAY_NOTES}\nsecond line of the same paragraph\n`);
    }
    // Position is stable once the strays have settled at the foot of their sections.
    const again = appendCheckpoint(text, PAYLOAD_2, { ...CP3, n: 5 }, REFS_2).text;
    expect(parseSessionText(again).unparsed).toEqual(parseSessionText(text).unparsed);
    expect(parseSessionText(again).frontmatter.checkpoints).toHaveLength(5);
  });

  it("a payload goal replaces a hand-written goal rather than keeping both", () => {
    const withProseGoal = golden("checkpoint-1.out").replace(
      "## Goal\n",
      "## Goal\nsomeone typed the goal as bare prose\n",
    );
    expect(parseSessionText(withProseGoal).unparsed).toContainEqual({
      section: "goal",
      line: "someone typed the goal as bare prose",
    });

    const replaced = appendCheckpoint(
      withProseGoal,
      { goal: "the real goal", done: [], remaining: [], notes: [] } as unknown as CheckpointPayload,
      CP2,
    ).text;
    expect(replaced).not.toContain("bare prose");
    expect(parseSessionText(replaced).goal).toHaveLength(1);

    // With no goal in the payload the section is kept whole, prose included.
    const kept = appendCheckpoint(withProseGoal, PAYLOAD_2, CP2, REFS_2).text;
    expect(kept).toContain("someone typed the goal as bare prose");
  });
});

describe("prose shaped like evidence never becomes evidence (CR important 1)", () => {
  it("does not let ` · files: fake.ts` in the text swallow the real files list", () => {
    const text = appendCheckpoint(
      golden("checkpoint-1.in"),
      {
        goal: "g",
        done: [
          {
            text: "Did a thing · files: fake.ts",
            files: ["real.ts", "also.ts"],
            verified: "tests-passed",
          },
        ],
        remaining: [],
        notes: [],
      } as unknown as CheckpointPayload,
      CP1,
    ).text;

    const [done] = parseSessionText(text).done;
    expect(done?.files).toEqual(["real.ts", "also.ts"]);
    expect(done?.text).toBe("Did a thing · files: fake.ts");
    expect(done?.verified).toBe("tests-passed");
  });

  it("keeps an implausible commit or verified value as prose", () => {
    const parsed = parseSessionText(
      golden("checkpoint-1.out").replace(
        "## Done\n",
        "## Done\n- [cp 1] Talked about it · commit: not-a-hash · verified: tests-passed\n",
      ),
    );
    const [done] = parsed.done;
    expect(done?.commit).toBeUndefined();
    expect(done?.text).toBe("Talked about it · commit: not-a-hash");
    expect(done?.verified).toBe("tests-passed");
  });

  it("keeps a prose `blocked_by` out of the parse rather than inventing backlog ids", () => {
    const parsed = parseSessionText(
      golden("checkpoint-1.out").replace(
        "## Remaining\n",
        "## Remaining\n- [cp 1] → WL-01J9AB00000000000000000000 (new) t; why: w; blocked_by: waiting on ops\n",
      ),
    );
    // `waiting on ops` is not a list of backlog ids, so the suffix run is not an attribute run at
    // all: the line degrades to prose whole. Conservative on purpose — a wrong `blocked_by` would
    // show up in P2 as a dependency that does not exist.
    const [first] = parsed.remaining;
    expect(first?.blockedBy).toBeUndefined();
    expect(first?.why).toBeUndefined();
    expect(first?.ref).toBe("WL-01J9AB00000000000000000000");
    expect(first?.text).toBe("t; why: w; blocked_by: waiting on ops");
  });

  it("recovers a hand-edited `verified` that carries trailing spaces", () => {
    const parsed = parseSessionText(
      golden("checkpoint-1.out").replace("verified: not-verified", "verified: not-verified   "),
    );
    expect(parsed.done[0]?.verified).toBe("not-verified");
  });
});

describe("errors stay debuggable (SRE important 2)", () => {
  it("threads the frontmatter error's document line and cause through RenderError", () => {
    try {
      parseSessionText("---\nid: [unclosed\n---\nbody\n");
      expect.unreachable("expected a RenderError");
    } catch (error) {
      const rendered = error as RenderError;
      expect(rendered.code).toBe("invalid-document");
      expect(rendered.cause).toBeInstanceOf(Error);
      // The line is recoverable without string-matching the message we just built.
      expect(rendered.details.some((detail) => /^line \d+: /.test(detail))).toBe(true);
    }
  });

  it("treats a checkpoint number past MAX_SAFE_INTEGER as an unrecognized line", () => {
    const parsed = parseSessionText(
      golden("checkpoint-1.out").replace(
        "## Done\n",
        "## Done\n- [cp 99999999999999999999] not a real checkpoint\n",
      ),
    );
    expect(parsed.done.map((line) => line.cp)).toEqual([1]);
    expect(parsed.unparsed).toContainEqual({
      section: "done",
      line: "- [cp 99999999999999999999] not a real checkpoint",
    });
  });
});
