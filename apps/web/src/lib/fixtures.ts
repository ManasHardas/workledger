/**
 * In-memory ledger data for the fixture `LedgerSource`.
 *
 * These are shaped by the frozen P1 schemas (`@workledger/core`), not by what the views happen to
 * render, so a view that reads a field the real ledger does not carry fails to typecheck here
 * rather than at the first `workledger serve`. Issues #37–#39 replace the fixture source with
 * `LocalServerSource`; this file goes with it.
 */
import type { BacklogView, Health, NoteRef, ParsedSession } from "./ledger-source.js";

const AUTHOR = { name: "Manas Hardas", email: "manas.hardas@gmail.com" };
const REPO = "github.com/ManasHardas/workledger";

const session = (
  id: string,
  goal: string,
  overrides: Partial<ParsedSession["frontmatter"]>,
  body: Pick<ParsedSession, "done" | "remaining" | "notes">,
): ParsedSession => ({
  frontmatter: {
    schema_version: 1,
    id,
    harness: "claude-code",
    harness_session_id: `cc-${id.slice(-6).toLowerCase()}`,
    repo: REPO,
    branch: "main",
    author: AUTHOR,
    started: "2026-09-08T09:12:00Z",
    status: "ended",
    private: false,
    source: "live",
    needs_repair: false,
    checkpoint_failures: 0,
    checkpoints: [
      { n: 1, at: "2026-09-08T09:41:00Z", turns: 18, transcript_offset: 41_233, trigger: "bytes" },
      { n: 2, at: "2026-09-08T10:24:00Z", turns: 37, transcript_offset: 96_400, trigger: "minutes" },
    ],
    ...overrides,
  },
  data: {},
  goal: [{ cp: 1, raw: `- [cp 1] ${goal}`, text: goal }],
  ...body,
  unparsed: [],
  preamble: "",
  extra: "",
});

export const FIXTURE_SESSIONS: ParsedSession[] = [
  session(
    "01JBQ4Z8W2K7N3RQ9XMDT5V0AE",
    "Wire the P2 server's file watcher to the SSE endpoint",
    { status: "open", started: "2026-09-09T08:02:00Z" },
    {
      done: [
        {
          cp: 1,
          raw: "",
          text: "Debounced the .workledger watcher at 100 ms",
          files: ["packages/server/src/watch.ts"],
          commit: "9c1f2ab",
          verified: "tests-passed",
        },
      ],
      remaining: [
        {
          cp: 1,
          raw: "",
          ref: "WL-01JBQ50R6TT4YB8H2ZC3D9KQ7M",
          rel: "new",
          text: "Reconnect the EventSource after a dropped stream",
          why: "A dropped SSE stream currently leaves the Now view frozen with no indication",
        },
      ],
      notes: [
        {
          cp: 1,
          raw: "",
          type: "question",
          by: "agent",
          text: "Should a watcher failure fall back to polling silently, or surface in Health?",
        },
      ],
    },
  ),
  session(
    "01JBPX2M4H6E1TSA7VYJ0G8WQD",
    "Freeze the P2 contracts: api.md, ledger-source.md, backlog-cli.md",
    { status: "ended", ended: "2026-09-08T12:10:00Z", end_reason: "clean" },
    {
      done: [
        {
          cp: 1,
          raw: "",
          text: "Froze the LedgerSource interface and the REST surface it maps onto",
          files: ["docs/contracts/p2/ledger-source.md", "docs/contracts/p2/api.md"],
          commit: "4e77b03",
          verified: "not-verified",
        },
        {
          cp: 2,
          raw: "",
          text: "Split P2 into build issues #32–#39",
          files: ["plans/wave-state.md"],
          commit: "1ab90d5",
          verified: "not-verified",
        },
      ],
      remaining: [
        {
          cp: 2,
          raw: "",
          ref: "WL-01JBPXK9NC5F2QW8ARJ6Z3H1TV",
          rel: "new",
          text: "Decide whether the card target ships in P2 or P6",
          why: "apps/card reuses apps/web's screens, so the split changes what the shell may assume",
          blockedBy: [],
        },
      ],
      notes: [
        {
          cp: 2,
          raw: "",
          type: "decision",
          by: "human",
          text: "The UI depends on LedgerSource only — never on a server being present",
          reason: "Keeps the Dome card target a source swap rather than a rewrite",
        },
        {
          cp: 1,
          raw: "",
          type: "blocker",
          by: "agent",
          text: "packages/api-client is unmerged, so apps/web cannot import the real source yet",
        },
      ],
    },
  ),
];

const item = (
  id: string,
  title: string,
  status: BacklogView["frontmatter"]["status"],
  rank: number,
  body: string,
  overrides: Partial<BacklogView["frontmatter"]> = {},
): BacklogView => ({
  frontmatter: {
    schema_version: 1,
    id,
    title,
    status,
    proposed_by: {
      harness: "claude-code",
      session: "01JBPX2M4H6E1TSA7VYJ0G8WQD",
      checkpoint: 2,
      author: AUTHOR,
    },
    rank,
    area: ["web"],
    blocked_by: [],
    created: "2026-09-08T12:04:00Z",
    updated: "2026-09-09T08:31:00Z",
    history: [
      { at: "2026-09-08T12:04:00Z", by: { session: "01JBPX2M4H6E1TSA7VYJ0G8WQD", checkpoint: 2 }, op: "create" },
    ],
    ...overrides,
  },
  body,
});

export const FIXTURE_BACKLOG: BacklogView[] = [
  item(
    "WL-01JBQ50R6TT4YB8H2ZC3D9KQ7M",
    "Reconnect the EventSource after a dropped stream",
    "accepted",
    10,
    "A dropped SSE stream currently leaves the Now view frozen with no indication.",
    { priority: "p1", owner: AUTHOR, confirmed_by: { ...AUTHOR, at: "2026-09-09T08:31:00Z" } },
  ),
  item(
    "WL-01JBPXK9NC5F2QW8ARJ6Z3H1TV",
    "Decide whether the card target ships in P2 or P6",
    "proposed",
    20,
    "apps/card reuses apps/web's screens, so the split changes what the shell may assume.",
    { priority: "p2", area: ["web", "card"] },
  ),
  item(
    "WL-01JBQ61YAD8G3MZP4KX7T2SNBC",
    "Generate the Tailwind preset from Figma variables",
    "in_progress",
    30,
    "packages/tokens is the single source of truth; the Figma pass lands after Ledger and Next work.",
    { priority: "p3", owner: AUTHOR },
  ),
];

export const FIXTURE_NOTES: NoteRef[] = [
  {
    session: "01JBQ4Z8W2K7N3RQ9XMDT5V0AE",
    cp: 1,
    raw: "",
    type: "question",
    by: "agent",
    text: "Should a watcher failure fall back to polling silently, or surface in Health?",
  },
  {
    session: "01JBPX2M4H6E1TSA7VYJ0G8WQD",
    cp: 1,
    raw: "",
    type: "blocker",
    by: "agent",
    text: "packages/api-client is unmerged, so apps/web cannot import the real source yet",
  },
];

export const FIXTURE_HEALTH: Health = {
  cli: "0.0.1",
  repo: REPO,
  harnesses: [
    { harness: "claude-code", hooksInstalled: true, lastSeenAt: "2026-09-09T08:02:00Z", problems: [] },
    { harness: "cursor", hooksInstalled: false, lastSeenAt: null, problems: ["hooks not installed"] },
  ],
  index: { path: "~/.workledger/index.sqlite", bytes: 262_144, openSessions: 1 },
  config: { valid: true, problems: [] },
  lastHookAt: "2026-09-09T08:02:00Z",
};

export const FIXTURE_BRIEF = [
  "# Brief — github.com/ManasHardas/workledger",
  "",
  "Open session: Wire the P2 server's file watcher to the SSE endpoint (2 checkpoints).",
  "Next: reconnect the EventSource after a dropped stream.",
].join("\n");
