/**
 * In-memory ledger data for the fixture `LedgerSource`.
 *
 * These are the *wire* read models of `docs/contracts/p2/api.md`, re-exported through
 * `./ledger-source.js` from `@workledger/api-client` — not core's parse-time shapes. A view that
 * reads a field `workledger serve` does not put on the wire therefore fails to typecheck here
 * rather than at the first real request.
 */
import type {
  BacklogView,
  DiscoverResult,
  Health,
  HistoryResult,
  InitRepoResult,
  JobAcrossRepos,
  NoteAcrossRepos,
  NoteRef,
  OnboardingStatus,
  ParsedSession,
  PlanResult,
  Repo,
  RepoCandidate,
} from "./ledger-source.js";

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
  goal,
  ...body,
  unparsed: [],
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
          text: "Debounced the .workledger watcher at 100 ms",
          files: ["packages/server/src/watch.ts"],
          commit: "9c1f2ab",
          verified: "tests-passed",
        },
      ],
      remaining: [
        {
          cp: 1,
          ref: "WL-01JBQ50R6TT4YB8H2ZC3D9KQ7M",
          rel: "new",
          text: "Reconnect the EventSource after a dropped stream",
          why: "A dropped SSE stream currently leaves the Now view frozen with no indication",
        },
      ],
      notes: [
        {
          cp: 1,
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
          text: "Froze the LedgerSource interface and the REST surface it maps onto",
          files: ["docs/contracts/p2/ledger-source.md", "docs/contracts/p2/api.md"],
          commit: "4e77b03",
          verified: "not-verified",
        },
        {
          cp: 2,
          text: "Split P2 into build issues #32–#39",
          files: ["plans/wave-state.md"],
          commit: "1ab90d5",
          verified: "not-verified",
        },
      ],
      remaining: [
        {
          cp: 2,
          ref: "WL-01JBPXK9NC5F2QW8ARJ6Z3H1TV",
          rel: "new",
          text: "Decide whether the card target ships in P2 or P6",
          why: "apps/card reuses apps/web's screens, so the split changes what the shell may assume",
          blocked_by: [],
        },
      ],
      notes: [
        {
          cp: 2,
          type: "decision",
          by: "human",
          text: "The UI depends on LedgerSource only — never on a server being present",
          reason: "Keeps the Dome card target a source swap rather than a rewrite",
        },
        {
          cp: 1,
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

/**
 * `index` is each note's position among the notes of its own checkpoint in `FIXTURE_SESSIONS`, the
 * same number `/api/notes` sends (`docs/contracts/p2/api.md`, amended 2026-09-09) and the one half
 * of a `resolveNote` ref that a list position cannot supply. Both of these are the only note at
 * their checkpoint, so both are 0.
 */
export const FIXTURE_NOTES: NoteRef[] = [
  {
    session: "01JBQ4Z8W2K7N3RQ9XMDT5V0AE",
    cp: 1,
    index: 0,
    type: "question",
    by: "agent",
    text: "Should a watcher failure fall back to polling silently, or surface in Health?",
    resolved: false,
  },
  {
    session: "01JBPX2M4H6E1TSA7VYJ0G8WQD",
    cp: 1,
    index: 0,
    type: "blocker",
    by: "agent",
    text: "packages/api-client is unmerged, so apps/web cannot import the real source yet",
    resolved: false,
  },
];

/**
 * `GET /api/repos` (docs/contracts/p8/daemon-and-api.md §Repo identity): two repos, so Home has a
 * list to lay out and the machine-wide tabs have a repo to name per row. Both read the same
 * ledger above (`ledger-source.ts`); the second one has never fired a hook, which is the `warn`
 * reading the card must show without a probe.
 */
export const FIXTURE_REPOS: Repo[] = [
  {
    id: "0123456789ab",
    path: "/Users/manas/Projects/workledger",
    name: "workledger",
    enabled: true,
    harnesses: ["claude-code"],
    sessions7d: 3,
    openBacklog: 4,
    openNotes: 2,
    lastHookAt: "2026-09-09T08:02:00Z",
    health: "ok",
  },
  {
    id: "fedcba987654",
    path: "/Users/manas/Projects/dashero",
    name: "dashero",
    enabled: true,
    harnesses: ["claude-code", "codex"],
    sessions7d: 0,
    openBacklog: 1,
    openNotes: 1,
    lastHookAt: null,
    health: "warn",
  },
];

/** `GET /api/notes/all`: the two open notes, one per fixture repo. */
export const FIXTURE_NOTES_ALL: NoteAcrossRepos[] = [
  { ...FIXTURE_NOTES[0]!, repo: FIXTURE_REPOS[0]! },
  { ...FIXTURE_NOTES[1]!, repo: FIXTURE_REPOS[1]! },
];

/** `GET /api/jobs/all`: one failed repair on the second repo, so the aggregate has a row. */
export const FIXTURE_JOBS_ALL: JobAcrossRepos[] = [
  {
    id: "01JBQ7FIXTUREJOB000000001",
    kind: "repair",
    session_ulid: "01JBPX2M4H6E1TSA7VYJ0G8WQD",
    repo_path: FIXTURE_REPOS[1]!.path,
    status: "failed",
    attempts: 2,
    created_at: "2026-09-09T07:40:00Z",
    started_at: "2026-09-09T07:40:02Z",
    finished_at: "2026-09-09T07:41:10Z",
    heartbeat_at: null,
    error: "claude --resume exited 1: session not found",
    cost_estimate_usd: null,
    log_path: null,
    error_code: null,
    retry_after: null,
    repo: FIXTURE_REPOS[1]!,
  },
];

export const FIXTURE_HEALTH: Health = {
  cli: "0.0.1",
  repo: REPO,
  // P8: the served repos ride along on every health report.
  repos: FIXTURE_REPOS,
  // `DoctorEntry` is `workledger doctor`'s harness probe verbatim (api.md §Read models).
  harnesses: [
    {
      harness: "claude-code",
      binary: "/opt/homebrew/bin/claude",
      version: "2.4.1",
      contract_tested_version: "2.4.x",
      store: "~/.claude/projects",
      store_readable: true,
      projects: 12,
      last_activity: "2026-09-09T08:02:00Z",
    },
    {
      harness: "cursor",
      binary: null,
      version: null,
      contract_tested_version: "1.7.x",
      store: "~/.cursor/chats",
      store_readable: false,
      projects: null,
      last_activity: null,
    },
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

// --- Onboarding (P8) --------------------------------------------------------------------------
//
// What `/api/onboarding/*` answers on a machine with a few projects: the wire shapes of
// docs/contracts/p8/daemon-and-api.md §Onboarding endpoints, so the wizard can be walked in dev
// and every step's test reads the same fields the daemon sends.

const PROJECTS = "/Users/me/Projects";

const candidate = (name: string, overrides: Partial<RepoCandidate> = {}): RepoCandidate => ({
  path: `${PROJECTS}/${name}`,
  name,
  hasGit: true,
  enabled: false,
  suggested: true,
  harnessSessions: {},
  lastSessionAt: null,
  ...overrides,
});

/**
 * `known` is sorted the way the daemon sorts it — most recent agent activity first. It holds one
 * repo that is already tracked, two suggested ones, and the projects folder itself, which Claude
 * Code was once started in: known, but an ancestor of the others and so not suggested.
 */
export const FIXTURE_DISCOVER: DiscoverResult = {
  known: [
    candidate("workledger", {
      enabled: true,
      harnessSessions: { "claude-code": 41, codex: 3 },
      lastSessionAt: "2026-09-09T08:02:00Z",
    }),
    candidate("dashero", { harnessSessions: { "claude-code": 12 }, lastSessionAt: "2026-09-07T17:40:00Z" }),
    candidate("kubera", { harnessSessions: { codex: 5 }, lastSessionAt: "2026-09-02T11:15:00Z" }),
    {
      path: PROJECTS,
      name: "Projects",
      hasGit: false,
      enabled: false,
      suggested: false,
      harnessSessions: { "claude-code": 2 },
      lastSessionAt: "2026-08-30T09:00:00Z",
    },
  ],
  found: [candidate("mentat"), candidate("splitfire")],
  roots: [PROJECTS],
};

export const FIXTURE_HISTORY: HistoryResult = {
  windows: {
    "7d": { sessions: 9, bytes: 3_400_000 },
    "30d": { sessions: 27, bytes: 11_800_000 },
    "90d": { sessions: 58, bytes: 26_100_000 },
  },
};

/** The one-time step `workledger init` leaves to the operator when Codex is detected. */
export const FIXTURE_TRUST_STEP = "Open Codex in this repo once and accept its hooks prompt";

/** What `init` reports for `path`: the two files it writes, plus the Codex step for a Codex repo. */
export function fixtureInitResult(path: string): InitRepoResult {
  const known = FIXTURE_DISCOVER.known.find((repo) => repo.path === path);
  if (known?.enabled) return { path, ok: true, hooksWritten: [], trustSteps: [] };
  return {
    path,
    ok: true,
    hooksWritten: [".claude/settings.json", ".workledger/config.yaml"],
    trustSteps: known?.harnessSessions.codex ? [FIXTURE_TRUST_STEP] : [],
  };
}

/** 27 sessions over 30 days, at the config's default 45 s per headless resume. */
export const FIXTURE_PLAN_RESUME: PlanResult = { sessions: 27, estimate: { seconds: 27 * 45 } };

/**
 * The same window priced for extraction, on a daemon started without an API key: kubera's five
 * Codex sessions are left out (amendment 3), so 22 sessions are priced and 5 reported skipped.
 */
export const FIXTURE_PLAN_EXTRACT: PlanResult = {
  sessions: 22,
  estimate: { tokens: 1_900_000, usd: 6.84, needsApiKey: true },
  unsupported: { codex: 5 },
};

/** Nothing queued yet, which the contract defines as complete. */
export const FIXTURE_ONBOARDING_STATUS: OnboardingStatus = {
  total: 0,
  done: 0,
  failed: 0,
  running: 0,
  waiting: 0,
  retryAfter: null,
  complete: true,
};
