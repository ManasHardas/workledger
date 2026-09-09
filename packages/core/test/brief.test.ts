import { describe, expect, it } from "vitest";

import type {
  Actor,
  BacklogStatus,
  BriefBacklogEntry,
  BriefInput,
  BriefNote,
  BriefSession,
  NoteType,
} from "../src/index.js";
import {
  BRIEF_MAX_SESSIONS,
  MIN_BRIEF_MAX_TOKENS,
  buildBrief,
  estimateTokens,
} from "../src/index.js";

import { PURITY_IMPORT_RE } from "./purity.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Crockford base32, so generated ids match the shape the contracts freeze. */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A deterministic 26-character ULID for the given ordinal. */
function ulid(n: number): string {
  let out = "";
  let value = n;
  for (let i = 0; i < 26; i += 1) {
    out = ULID_ALPHABET[value % 32]! + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function actor(name: string): Actor {
  return { name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com` };
}

/** `2026-09-09T00:00:00Z` plus `n` days, as an ISO instant. */
function day(n: number): string {
  return new Date(Date.UTC(2026, 8, 9) + n * 86_400_000).toISOString().replace(".000", "");
}

interface BacklogSpec {
  n: number;
  title: string;
  status: BacklogStatus;
  rank: number;
  created?: string;
  updated?: string;
  owner?: Actor | null;
}

function backlogItem(spec: BacklogSpec): BriefBacklogEntry {
  return {
    frontmatter: {
      schema_version: 1,
      id: `WL-${ulid(spec.n)}`,
      title: spec.title,
      status: spec.status,
      proposed_by: {
        harness: "claude-code",
        session: ulid(9000),
        checkpoint: 1,
        author: actor("Ada Lovelace"),
      },
      owner: spec.owner ?? null,
      rank: spec.rank,
      area: [],
      blocked_by: [],
      created: spec.created ?? day(0),
      updated: spec.updated ?? day(0),
      history: [],
    },
    body: `why: because of ${spec.title}\n`,
  };
}

interface SessionSpec {
  n: number;
  started: string;
  done?: string[];
  notes?: BriefNote[];
}

function session(spec: SessionSpec): BriefSession {
  return {
    frontmatter: {
      schema_version: 1,
      id: ulid(spec.n),
      harness: "claude-code",
      harness_session_id: `cc-${spec.n}`,
      repo: "github.com/manashardas/workledger",
      branch: "main",
      author: actor("Ada Lovelace"),
      started: spec.started,
      ended: null,
      end_reason: null,
      status: "ended",
      private: false,
      source: "live",
      model: null,
      needs_repair: false,
      checkpoint_failures: 0,
      checkpoints: [],
    },
    done: spec.done ?? [],
    notes: spec.notes ?? [],
  };
}

function note(type: NoteType, text: string, cp = 1): BriefNote {
  return { type, text, cp };
}

/** A fixed `now`, so every assertion below is about the ledger and not about the clock. */
const NOW = "2026-09-20T12:00:00Z";
/** High enough that nothing is dropped in the tests that are not about the cap. */
const NO_CAP = 1_000_000;

const EMPTY: BriefInput = { backlog: [], sessions: [] };

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("buildBrief determinism", () => {
  const input: BriefInput = {
    backlog: [
      backlogItem({ n: 1, title: "Ship the CLI", status: "in_progress", rank: 1 }),
      backlogItem({ n: 2, title: "Write the brief", status: "accepted", rank: 2 }),
      backlogItem({ n: 3, title: "Consider a UI", status: "proposed", rank: 3 }),
    ],
    sessions: [
      session({
        n: 10,
        started: day(1),
        done: ["wired the hook"],
        notes: [note("blocker", "the index is locked")],
      }),
    ],
  };

  it("output is byte-identical across two runs on the same ledger", () => {
    // `plans/feature-p1-cli-core.md` states this of `workledger brief`, which passes no `now` —
    // so pinning `now` here would test a path the criterion is not about. Two runs separated by
    // a real clock tick must agree.
    const first = buildBrief(input, { maxTokens: 2000 });
    const start = Date.now();
    while (Date.now() === start) {
      /* spin until the millisecond ticks over */
    }
    const second = buildBrief(input, { maxTokens: 2000 });
    expect(second).toBe(first);
    expect(first).not.toContain("generated");
  });

  it("is byte-identical across two runs with a sessionId too", () => {
    const first = buildBrief(input, { maxTokens: 2000, sessionId: ulid(10) });
    const second = buildBrief(input, { maxTokens: 2000, sessionId: ulid(10) });
    expect(second).toBe(first);
  });

  it("does not depend on the order the caller read the ledger files in", () => {
    const forwards = buildBrief(input, { maxTokens: 2000, now: NOW });
    const shuffled = buildBrief(
      { backlog: [...input.backlog].reverse(), sessions: [...input.sessions].reverse() },
      { maxTokens: 2000, now: NOW },
    );
    expect(shuffled).toBe(forwards);
  });

  it("ties on rank and updated are broken by id, so equal keys still render one way", () => {
    const tied: BriefBacklogEntry[] = [
      backlogItem({ n: 7, title: "Seven", status: "accepted", rank: 1, updated: day(2) }),
      backlogItem({ n: 5, title: "Five", status: "accepted", rank: 1, updated: day(2) }),
      backlogItem({ n: 6, title: "Six", status: "accepted", rank: 1, updated: day(2) }),
    ];
    const a = buildBrief({ backlog: tied, sessions: [] }, { maxTokens: NO_CAP, now: NOW });
    const b = buildBrief(
      { backlog: [...tied].reverse(), sessions: [] },
      { maxTokens: NO_CAP, now: NOW },
    );
    expect(b).toBe(a);
    expect(titles(a)).toEqual(["Five", "Six", "Seven"]);
  });

  it("renders the same bytes whatever the host timezone thinks a date is", () => {
    // The Done date is derived in UTC, so a session that started late in a western timezone does
    // not render as a different day depending on where the CLI runs.
    const brief = buildBrief(
      {
        backlog: [],
        sessions: [session({ n: 11, started: "2026-09-09T23:30:00-05:00", done: ["late work"] })],
      },
      { maxTokens: NO_CAP, now: NOW },
    );
    expect(brief).toContain("2026-09-10 · late work");
  });
});

/** The titles of the backlog lines, in the order the brief printed them. */
function titles(brief: string): string[] {
  return brief
    .split("\n")
    .filter((line) => line.startsWith("  WL-"))
    .map((line) => line.split(" · ")[1]!);
}

// ---------------------------------------------------------------------------
// Sections and ordering
// ---------------------------------------------------------------------------

describe("buildBrief sections", () => {
  it("backlog ordering is rank asc then updated desc", () => {
    const brief = buildBrief(
      {
        backlog: [
          backlogItem({ n: 1, title: "rank2-old", status: "accepted", rank: 2, updated: day(1) }),
          backlogItem({ n: 2, title: "rank1-old", status: "accepted", rank: 1, updated: day(1) }),
          backlogItem({ n: 3, title: "rank2-new", status: "accepted", rank: 2, updated: day(5) }),
          backlogItem({ n: 4, title: "rank1-new", status: "accepted", rank: 1, updated: day(5) }),
        ],
        sessions: [],
      },
      { maxTokens: NO_CAP, now: NOW },
    );
    expect(titles(brief)).toEqual(["rank1-new", "rank1-old", "rank2-new", "rank2-old"]);
  });

  it("only proposed, accepted and in_progress items appear", () => {
    const brief = buildBrief(
      {
        backlog: [
          backlogItem({ n: 1, title: "is-proposed", status: "proposed", rank: 1 }),
          backlogItem({ n: 2, title: "is-accepted", status: "accepted", rank: 2 }),
          backlogItem({ n: 3, title: "is-in-progress", status: "in_progress", rank: 3 }),
          backlogItem({ n: 4, title: "is-done", status: "done", rank: 4 }),
          backlogItem({ n: 5, title: "is-discarded", status: "discarded", rank: 5 }),
        ],
        sessions: [],
      },
      { maxTokens: NO_CAP, now: NOW },
    );
    expect(titles(brief)).toEqual(["is-proposed", "is-accepted", "is-in-progress"]);
    expect(brief).not.toContain("is-done");
    expect(brief).not.toContain("is-discarded");
  });

  it("renders a backlog line as `WL-id · title · status · owner`", () => {
    const brief = buildBrief(
      {
        backlog: [
          backlogItem({
            n: 42,
            title: "Ship it",
            status: "in_progress",
            rank: 1,
            owner: actor("Grace Hopper"),
          }),
          backlogItem({ n: 43, title: "Nobody's job", status: "proposed", rank: 2 }),
        ],
        sessions: [],
      },
      { maxTokens: NO_CAP, now: NOW },
    );
    expect(brief).toContain(`  WL-${ulid(42)} · Ship it · in_progress · Grace Hopper`);
    expect(brief).toContain(`  WL-${ulid(43)} · Nobody's job · proposed · unassigned`);
  });

  it("collapses newlines in a title so one ledger item stays one brief line", () => {
    const brief = buildBrief(
      {
        backlog: [
          backlogItem({ n: 1, title: "two\nlines\tand   spaces", status: "accepted", rank: 1 }),
        ],
        sessions: [],
      },
      { maxTokens: NO_CAP, now: NOW },
    );
    expect(brief).toContain("· two lines and spaces ·");
    expect(brief.split("\n").filter((line) => line.startsWith("  WL-"))).toHaveLength(1);
  });

  it("shows at most the three most recent sessions by started", () => {
    const brief = buildBrief(
      {
        backlog: [],
        sessions: [
          session({ n: 1, started: day(1), done: ["oldest-work"] }),
          session({ n: 2, started: day(2), done: ["second-work"] }),
          session({ n: 3, started: day(3), done: ["third-work"] }),
          session({ n: 4, started: day(4), done: ["fourth-work"] }),
          session({ n: 5, started: day(5), done: ["newest-work"] }),
        ],
      },
      { maxTokens: NO_CAP, now: NOW },
    );
    expect(BRIEF_MAX_SESSIONS).toBe(3);
    const done = brief.split("\n").filter((line) => line.includes("-work"));
    expect(done).toEqual([
      `  ${day(5).slice(0, 10)} · newest-work`,
      `  ${day(4).slice(0, 10)} · fourth-work`,
      `  ${day(3).slice(0, 10)} · third-work`,
    ]);
    expect(brief).not.toContain("second-work");
    expect(brief).not.toContain("oldest-work");
  });

  it("shows open blocker and question notes, newest first, from every session", () => {
    const brief = buildBrief(
      {
        backlog: [],
        sessions: [
          session({
            // Older than the three most recent sessions above: its notes still surface.
            n: 1,
            started: day(1),
            notes: [note("blocker", "ancient-blocker"), note("discovery", "ancient-discovery")],
          }),
          session({ n: 2, started: day(2), done: ["a"] }),
          session({ n: 3, started: day(3), done: ["b"] }),
          session({
            n: 4,
            started: day(4),
            done: ["c"],
            notes: [note("question", "recent-question", 2), note("decision", "a-decision", 2)],
          }),
        ],
      },
      { maxTokens: NO_CAP, now: NOW },
    );
    const notes = brief
      .split("\n")
      .filter((line) => line.startsWith("  blocker · ") || line.startsWith("  question · "));
    expect(notes).toEqual(["  question · recent-question", "  blocker · ancient-blocker"]);
    expect(brief).not.toContain("ancient-discovery");
    expect(brief).not.toContain("a-decision");
  });

  it("an empty ledger produces a non-empty, stable brief", () => {
    const first = buildBrief(EMPTY, { maxTokens: 2000, now: NOW });
    const second = buildBrief(EMPTY, { maxTokens: 2000, now: NOW });
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first).toContain("Nothing open: no backlog items, no recorded sessions.");
    expect(first).not.toContain("omitted (brief cap)");
    expect(estimateTokens(first)).toBeLessThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// The session-id header line
// ---------------------------------------------------------------------------

describe("buildBrief session line", () => {
  const id = ulid(1234);

  it("names the session ulid and the checkpoint command when sessionId is given", () => {
    const brief = buildBrief(EMPTY, { maxTokens: 2000, now: NOW, sessionId: id });
    expect(brief.split("\n")[0]).toBe(
      `workledger session ${id} — run \`workledger checkpoint --session ${id}\` when asked`,
    );
  });

  it("omits the session line when sessionId is absent", () => {
    const brief = buildBrief(EMPTY, { maxTokens: 2000, now: NOW });
    expect(brief.split("\n")[0]).toBe("workledger brief · generated 2026-09-20T12:00:00Z");
    expect(brief).not.toContain("workledger session ");
  });

  it("keeps the session line even at a cap far below the ledger's size", () => {
    // The ulid is how the agent addresses `workledger checkpoint`; it is never the thing dropped.
    const brief = buildBrief(largeLedger(), {
      maxTokens: MIN_BRIEF_MAX_TOKENS,
      now: NOW,
      sessionId: id,
    });
    expect(brief).toContain(`workledger session ${id}`);
  });

  it("emits the generated stamp only when now is passed, and reads no clock otherwise", () => {
    const stamped = buildBrief(EMPTY, { maxTokens: 2000, now: NOW });
    expect(stamped).toContain(`workledger brief · generated ${NOW}`);

    const unstamped = buildBrief(EMPTY, { maxTokens: 2000 });
    expect(unstamped).not.toContain("generated");
    expect(unstamped.split("\n")[0]).toBe(
      "Nothing open: no backlog items, no recorded sessions.",
    );
  });
});

// ---------------------------------------------------------------------------
// The cap
// ---------------------------------------------------------------------------

/** 500 open backlog items, four sessions with Done lines, and 20 open notes. */
function largeLedger(): BriefInput {
  const statuses: BacklogStatus[] = ["proposed", "accepted", "in_progress"];
  const backlog = Array.from({ length: 500 }, (_, i) =>
    backlogItem({
      n: i + 1,
      title: `Backlog item number ${i} with a realistically wordy title`,
      status: statuses[i % 3]!,
      rank: i % 40,
      created: day(i % 30),
      updated: day((i * 7) % 30),
      owner: i % 4 === 0 ? actor("Ada Lovelace") : null,
    }),
  );
  const sessions = Array.from({ length: 4 }, (_, s) =>
    session({
      n: 1000 + s,
      started: day(s + 1),
      done: Array.from({ length: 12 }, (_, d) => `session ${s} finished unit of work ${d}`),
      notes: Array.from({ length: 5 }, (_, k) =>
        note(k % 2 === 0 ? "blocker" : "question", `session ${s} open item ${k}`, k + 1),
      ),
    }),
  );
  return { backlog, sessions };
}

describe("buildBrief cap", () => {
  it("respects maxTokens on a 500-item ledger at 2000, 500 and 100", () => {
    const ledger = largeLedger();
    for (const maxTokens of [2000, 500, 100]) {
      const brief = buildBrief(ledger, { maxTokens, now: NOW, sessionId: ulid(1) });
      expect(estimateTokens(brief)).toBeLessThanOrEqual(maxTokens);
      expect(brief).toContain("omitted (brief cap)");
    }
  });

  it("drops nothing and reports nothing when the ledger fits", () => {
    const ledger = largeLedger();
    const brief = buildBrief(ledger, { maxTokens: NO_CAP, now: NOW });
    expect(brief).not.toContain("omitted (brief cap)");
    expect(titles(brief)).toHaveLength(500);
  });

  it("reports the number of dropped entries and pluralizes it", () => {
    const ledger = largeLedger();
    const uncapped = buildBrief(ledger, { maxTokens: NO_CAP, now: NOW });
    const capped = buildBrief(ledger, { maxTokens: 500, now: NOW });
    const reported = Number(/… (\d+) items omitted \(brief cap\)$/.exec(capped)![1]);
    const before = countEntries(uncapped);
    const after = countEntries(capped);
    expect(reported).toBe(before - after);

    // Singular: the loosest cap on the staged ledger drops exactly one item.
    const one = tightestCapWhere((brief) => brief.includes("omitted (brief cap)")).brief;
    expect(one).toContain("… 1 item omitted (brief cap)");
  });

  it("rejects a maxTokens below the brief's irreducible floor", () => {
    expect(MIN_BRIEF_MAX_TOKENS).toBe(64);
    for (const bad of [MIN_BRIEF_MAX_TOKENS - 1, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildBrief(EMPTY, { maxTokens: bad })).toThrow(RangeError);
      expect(() => buildBrief(EMPTY, { maxTokens: bad })).toThrow(/at least 64/);
    }
    expect(() => buildBrief(EMPTY, { maxTokens: MIN_BRIEF_MAX_TOKENS })).not.toThrow();
  });

  it("holds the cap at the floor with every optional part present", () => {
    // The floor is the session line plus the generated stamp plus the footer; nothing below
    // MIN_BRIEF_MAX_TOKENS is accepted, so this is the worst case the guarantee has to survive.
    const brief = buildBrief(largeLedger(), {
      maxTokens: MIN_BRIEF_MAX_TOKENS,
      now: NOW,
      sessionId: ulid(7),
    });
    expect(estimateTokens(brief)).toBeLessThanOrEqual(MIN_BRIEF_MAX_TOKENS);
    expect(brief).toContain(`workledger session ${ulid(7)}`);
    expect(brief).toContain("omitted (brief cap)");
  });
});

/** Every droppable line: backlog items, Done lines and notes. */
function countEntries(brief: string): number {
  return brief.split("\n").filter((line) => line.startsWith("  ")).length;
}

// ---------------------------------------------------------------------------
// Drop order (data-flow §5)
// ---------------------------------------------------------------------------

/**
 * A ledger sized so that each drop stage can be reached by tightening the cap: two `proposed`
 * items of different ages, two `accepted` items, two open notes of different ages, and three
 * sessions with one Done line each.
 */
function stagedLedger(): BriefInput {
  return {
    backlog: [
      backlogItem({
        n: 1,
        title: "PROPOSED-OLD",
        status: "proposed",
        rank: 1,
        created: day(0),
      }),
      backlogItem({
        n: 2,
        title: "PROPOSED-NEW",
        status: "proposed",
        rank: 2,
        created: day(4),
      }),
      backlogItem({ n: 3, title: "ACCEPTED-OLD", status: "accepted", rank: 3, created: day(1) }),
      backlogItem({ n: 4, title: "ACCEPTED-NEW", status: "accepted", rank: 4, created: day(5) }),
    ],
    sessions: [
      session({
        n: 101,
        started: day(1),
        done: ["DONE-THIRD"],
        notes: [note("blocker", "NOTE-OLD")],
      }),
      session({ n: 102, started: day(2), done: ["DONE-SECOND"] }),
      session({
        n: 103,
        started: day(3),
        done: ["DONE-FIRST"],
        notes: [note("question", "NOTE-NEW")],
      }),
    ],
  };
}

const MARKERS = [
  "PROPOSED-OLD",
  "PROPOSED-NEW",
  "NOTE-OLD",
  "NOTE-NEW",
  "DONE-THIRD",
  "DONE-SECOND",
  "ACCEPTED-OLD",
  "ACCEPTED-NEW",
  "DONE-FIRST",
] as const;

/** The loosest cap at which every marker in `gone` is absent from the brief. */
function tightestCapWhere(predicate: (brief: string) => boolean): {
  cap: number;
  brief: string;
} {
  for (let cap = 400; cap >= MIN_BRIEF_MAX_TOKENS; cap -= 1) {
    const brief = buildBrief(stagedLedger(), { maxTokens: cap, now: NOW });
    if (predicate(brief)) return { cap, brief };
  }
  throw new Error("no cap satisfied the predicate");
}

describe("buildBrief drop order", () => {
  it("drop order is proposed oldest-first, then notes oldest-first, then session Done lines", () => {
    // Stage 1 — the first thing to go is the oldest `proposed` item, and nothing else.
    const first = tightestCapWhere((brief) => !brief.includes("PROPOSED-OLD"));
    expect(first.brief).toContain("PROPOSED-NEW");
    expect(first.brief).toContain("NOTE-OLD");
    expect(first.brief).toContain("DONE-THIRD");
    expect(first.brief).toContain("ACCEPTED-OLD");
    expect(first.brief).toContain("… 1 item omitted (brief cap)");

    // Stage 2 — both `proposed` items are gone before the oldest note goes.
    const second = tightestCapWhere((brief) => !brief.includes("NOTE-OLD"));
    expect(second.brief).not.toContain("PROPOSED-OLD");
    expect(second.brief).not.toContain("PROPOSED-NEW");
    expect(second.brief).toContain("NOTE-NEW");
    expect(second.brief).toContain("DONE-THIRD");
    expect(second.brief).toContain("ACCEPTED-OLD");

    // Stage 3 — both notes are gone before the third most recent session's Done lines go, and
    // the second and most recent sessions and the `accepted` items all survive that.
    const third = tightestCapWhere((brief) => !brief.includes("DONE-THIRD"));
    expect(third.brief).not.toContain("NOTE-OLD");
    expect(third.brief).not.toContain("NOTE-NEW");
    expect(third.brief).toContain("DONE-SECOND");
    expect(third.brief).toContain("DONE-FIRST");
    expect(third.brief).toContain("ACCEPTED-OLD");
    expect(third.brief).toContain("ACCEPTED-NEW");

    // Stage 3b — then the second most recent session's Done lines, still before any `accepted`.
    const fourth = tightestCapWhere((brief) => !brief.includes("DONE-SECOND"));
    expect(fourth.brief).not.toContain("DONE-THIRD");
    expect(fourth.brief).toContain("DONE-FIRST");
    expect(fourth.brief).toContain("ACCEPTED-OLD");
    expect(fourth.brief).toContain("ACCEPTED-NEW");

    // The caps are strictly tighter at each stage — the stages really are ordered.
    expect(second.cap).toBeLessThan(first.cap);
    expect(third.cap).toBeLessThan(second.cap);
    expect(fourth.cap).toBeLessThan(third.cap);
  });

  it("past data-flow §5 it drops accepted work oldest-first, the last session's Done lines last", () => {
    // The contract's drop order stops at the second most recent session. These two stages are
    // this module's extension, and exist so `maxTokens` is a guarantee rather than a hope.
    const accepted = tightestCapWhere((brief) => !brief.includes("ACCEPTED-OLD"));
    expect(accepted.brief).not.toContain("DONE-SECOND");
    expect(accepted.brief).toContain("ACCEPTED-NEW");
    expect(accepted.brief).toContain("DONE-FIRST");

    // The most recent session's Done lines outlive everything else in the plan.
    const floor = buildBrief(stagedLedger(), { maxTokens: MIN_BRIEF_MAX_TOKENS, now: NOW });
    expect(floor).toContain("DONE-FIRST");
    expect(floor).toContain("omitted (brief cap)");
    expect(floor).not.toContain("Nothing open");
  });

  it("nothing dropped ever comes back as the cap tightens, and the cap always holds", () => {
    let previous: string[] = [...MARKERS];
    for (let cap = 400; cap >= MIN_BRIEF_MAX_TOKENS; cap -= 1) {
      const brief = buildBrief(stagedLedger(), { maxTokens: cap, now: NOW });
      // The O(1) size model the drop loop runs on has to agree with the text it finally renders.
      expect(estimateTokens(brief)).toBeLessThanOrEqual(cap);
      const present = MARKERS.filter((marker) => brief.includes(marker));
      for (const marker of present) expect(previous).toContain(marker);
      previous = present;
    }
    // What survives at the floor is a suffix of the drop plan: the last things to be dropped.
    expect(previous).toEqual([...MARKERS].slice(MARKERS.length - previous.length));
    expect(previous.length).toBeLessThan(MARKERS.length);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

const briefSources = import.meta.glob<string>("../src/{brief,tokens}.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("brief and tokens purity", () => {
  it("import no Node built-ins", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(briefSources)) {
      for (const [, specifier] of source.matchAll(PURITY_IMPORT_RE)) {
        if (
          specifier!.startsWith("node:") ||
          ["fs", "path", "os", "crypto", "url", "child_process"].includes(specifier!)
        ) {
          offenders.push(`${path}: ${specifier}`);
        }
      }
    }
    expect(Object.keys(briefSources)).toHaveLength(2);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Total-order tie-breaks and malformed timestamps
// ---------------------------------------------------------------------------

describe("buildBrief total ordering", () => {
  it("sessions started in the same instant are ordered by id, newest id first", () => {
    const a = session({ n: 20, started: day(3), done: ["from-lower-id"] });
    const b = session({ n: 21, started: day(3), done: ["from-higher-id"] });
    const forwards = buildBrief({ backlog: [], sessions: [a, b] }, { maxTokens: NO_CAP, now: NOW });
    const backwards = buildBrief({ backlog: [], sessions: [b, a] }, { maxTokens: NO_CAP, now: NOW });
    expect(backwards).toBe(forwards);
    expect(forwards.indexOf("from-higher-id")).toBeLessThan(forwards.indexOf("from-lower-id"));
  });

  it("notes recorded in sessions that started together are ordered by session id then cp", () => {
    const a = session({
      n: 30,
      started: day(3),
      notes: [note("blocker", "lower-id-cp1", 1), note("blocker", "lower-id-cp2", 2)],
    });
    const b = session({
      n: 31,
      started: day(3),
      // Two notes recorded at the same checkpoint: file order is the last tie-break.
      notes: [note("question", "higher-id-cp1", 1), note("blocker", "higher-id-cp1-second", 1)],
    });
    const forwards = buildBrief({ backlog: [], sessions: [a, b] }, { maxTokens: NO_CAP, now: NOW });
    const backwards = buildBrief({ backlog: [], sessions: [b, a] }, { maxTokens: NO_CAP, now: NOW });
    expect(backwards).toBe(forwards);
    // Newest first: the higher session id sorts last in age order, so it prints first.
    expect(noteTexts(forwards)).toEqual([
      "higher-id-cp1-second",
      "higher-id-cp1",
      "lower-id-cp2",
      "lower-id-cp1",
    ]);
  });

  it("a hand-edited, unparseable timestamp still yields one stable order", () => {
    // Both frontmatter contracts are `additionalProperties: true` and the files are human-editable,
    // so a `created`/`started` that Date.parse rejects has to degrade to a string compare rather
    // than throwing or producing a NaN-driven, run-dependent sort.
    const input: BriefInput = {
      backlog: [
        backlogItem({ n: 1, title: "BAD-B", status: "proposed", rank: 1, created: "not-a-date-b" }),
        backlogItem({ n: 2, title: "BAD-A", status: "proposed", rank: 1, created: "not-a-date-a" }),
        backlogItem({ n: 3, title: "GOOD", status: "proposed", rank: 1, created: day(1) }),
      ],
      sessions: [session({ n: 40, started: "whenever", done: ["mystery work"] })],
    };
    const first = buildBrief(input, { maxTokens: NO_CAP, now: NOW });
    const second = buildBrief(
      { backlog: [...input.backlog].reverse(), sessions: input.sessions },
      { maxTokens: NO_CAP, now: NOW },
    );
    expect(second).toBe(first);
    // The date column falls back to the first ten characters of the raw value.
    expect(first).toContain("  whenever · mystery work");
    // Rank ties fall through `updated` (all equal) to the id tie-break.
    expect(titles(first)).toEqual(["BAD-B", "BAD-A", "GOOD"]);
  });
});

/** The note texts, in the order the brief printed them. */
function noteTexts(brief: string): string[] {
  return brief
    .split("\n")
    .filter((line) => line.startsWith("  blocker · ") || line.startsWith("  question · "))
    .map((line) => line.split(" · ")[1]!);
}

// ---------------------------------------------------------------------------
// Regression: a busy session must not erase the brief (CR+SRE review of PR #21)
// ---------------------------------------------------------------------------

/** 500 open backlog items and three sessions of 200 Done lines each — the reviewer's fixture. */
function busyLedger(): BriefInput {
  const statuses: BacklogStatus[] = ["proposed", "accepted", "in_progress"];
  const backlog = Array.from({ length: 500 }, (_, i) =>
    backlogItem({
      n: i + 1,
      title: `Backlog item number ${i} with a realistically wordy title`,
      status: statuses[i % 3]!,
      rank: i % 40,
      created: day(i % 30),
      updated: day((i * 7) % 30),
    }),
  );
  const sessions = Array.from({ length: 3 }, (_, s) =>
    session({
      n: 2000 + s,
      started: day(s + 1),
      done: Array.from({ length: 200 }, (_, d) => `session ${s} finished unit of work ${d}`),
    }),
  );
  return { backlog, sessions };
}

describe("buildBrief does not collapse on a long Done section", () => {
  it("keeps the newest session's most recent Done lines and open backlog at the default cap", () => {
    // Before the fix the whole `Recent work:` group was one drop step and the most recent
    // session's group was the last step, so 3 × 200 Done lines at the shipped default of 2,000
    // reduced the brief to a header and a footer.
    const brief = buildBrief(busyLedger(), { maxTokens: 2000, now: NOW });
    expect(estimateTokens(brief)).toBeLessThanOrEqual(2000);

    expect(brief).toContain("Recent work:");
    // Session 2 is the most recent (started day(3)); its newest Done items survive, its oldest go.
    expect(brief).toContain("session 2 finished unit of work 199");
    expect(brief).toContain("session 2 finished unit of work 198");
    expect(brief).not.toContain("session 2 finished unit of work 0 ");

    expect(brief).toContain("Open backlog:");
    const shown = titles(brief);
    expect(shown.length).toBeGreaterThan(10);
    // The `proposed` items go first, so what is left is `accepted` / `in_progress` work.
    const statusesShown = new Set(
      brief
        .split("\n")
        .filter((line) => line.startsWith("  WL-"))
        .map((line) => line.split(" · ")[2]!),
    );
    expect(statusesShown.has("proposed")).toBe(false);
    expect(statusesShown.has("accepted") || statusesShown.has("in_progress")).toBe(true);
  });

  it("keeps both sections alive across every cap from the floor to the default", () => {
    for (const maxTokens of [MIN_BRIEF_MAX_TOKENS, 100, 250, 500, 1000, 2000]) {
      const brief = buildBrief(busyLedger(), { maxTokens, now: NOW });
      expect(estimateTokens(brief)).toBeLessThanOrEqual(maxTokens);
      // At every accepted cap the brief still says something about the ledger.
      expect(brief.split("\n").filter((line) => line.startsWith("  ")).length).toBeGreaterThan(0);
      if (maxTokens >= 250) {
        expect(brief).toContain("Recent work:");
        expect(brief).toContain("Open backlog:");
      }
    }
  });

  it("a single 200-line session never reduces the brief to a footer", () => {
    for (const size of [140, 155, 200, 400]) {
      const brief = buildBrief(
        {
          backlog: [],
          sessions: [
            session({
              n: 3000,
              started: day(1),
              done: Array.from({ length: size }, (_, d) => `unit of work ${d}`),
            }),
          ],
        },
        { maxTokens: 2000, now: NOW },
      );
      expect(estimateTokens(brief)).toBeLessThanOrEqual(2000);
      expect(brief).toContain("Recent work:");
      expect(brief).toContain(`unit of work ${size - 1}`);
      expect(brief.split("\n").filter((line) => line.startsWith("  ")).length).toBeGreaterThan(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

describe("buildBrief cost", () => {
  it("is linear enough that a 2,000-item deep drop stays well inside the hook budget", () => {
    // The drop loop keeps a running character count instead of re-rendering per step. The bound
    // is deliberately loose — this asserts the shape of the cost, not a benchmark, so it does not
    // flake on a loaded CI runner. `SessionStart` has 300 ms in total
    // (docs/contracts/p1/hooks-claude-code.md), with Node startup and ledger I/O still to come.
    const ledger: BriefInput = {
      backlog: Array.from({ length: 2000 }, (_, i) =>
        backlogItem({
          n: i + 1,
          title: `Backlog item number ${i} with a realistically wordy title`,
          status: (["proposed", "accepted", "in_progress"] as BacklogStatus[])[i % 3]!,
          rank: i % 40,
          created: day(i % 30),
          updated: day((i * 7) % 30),
        }),
      ),
      sessions: Array.from({ length: 3 }, (_, s) =>
        session({
          n: 4000 + s,
          started: day(s + 1),
          done: Array.from({ length: 200 }, (_, d) => `session ${s} unit ${d}`),
        }),
      ),
    };

    // Warm up, then measure the deep-drop path (cap at the floor drops nearly everything).
    buildBrief(ledger, { maxTokens: MIN_BRIEF_MAX_TOKENS, now: NOW });
    const start = performance.now();
    for (let i = 0; i < 5; i += 1) buildBrief(ledger, { maxTokens: MIN_BRIEF_MAX_TOKENS, now: NOW });
    const perCall = (performance.now() - start) / 5;
    expect(perCall).toBeLessThan(100);
  });
});
