/**
 * The `LedgerSource` contract of `docs/contracts/p2/ledger-source.md` and the wire read models of
 * `docs/contracts/p2/api.md` §Read models.
 *
 * The domain vocabulary — `Actor`, `BacklogItem`, `BacklogStatus`, `SessionFrontmatter`, the four
 * note types — is re-exported from `@workledger/core`, which is where the frozen P1 schemas live.
 * Everything else is defined here rather than imported from `@workledger/server`, because the
 * contract's whole point is that `apps/web` never imports the server: the wire shapes are the
 * boundary, and a UI that could reach into the server's types would drift into its internals.
 *
 * Two names deliberately *differ* from core's. Core's `ParsedSession` and `NoteLine` are
 * parse-time shapes carrying the write-side machinery (`raw` for every line, the unvalidated
 * `data` mapping, the preamble and unknown-heading blocks) so that an append is never lossy. The
 * wire drops all of it, and `goal` collapses from a list of lines to the single current string.
 * These are api.md's versions, not core's.
 */
export type {
  Actor,
  BacklogItem,
  BacklogStatus,
  Harness,
  NoteBy,
  NoteType,
  Priority,
  SessionFrontmatter,
  Verified,
} from "@workledger/core";

import type {
  Actor,
  BacklogItem,
  BacklogStatus,
  NoteBy,
  NoteType,
  SessionFrontmatter,
  Verified,
} from "@workledger/core";

/** A `## Done` line on the wire. */
export interface Line {
  cp: number;
  text: string;
  files?: string[];
  commit?: string;
  verified?: Verified;
}

/** A `## Remaining` line on the wire — core's `blockedBy` renamed to the contract's snake case. */
export interface RemainingLine extends Line {
  ref: string;
  rel: "new" | "updates" | "closes";
  why: string;
  blocked_by?: string[];
}

/** A `## Notes` line on the wire. */
export interface NoteLine {
  cp: number;
  type: NoteType;
  text: string;
  by?: NoteBy;
  reason?: string;
  /** `true` when the session frontmatter's `resolved` list names this note. */
  resolved?: boolean;
}

/** A body line that did not match its section's form, kept so the UI can flag a drifted file. */
export interface UnparsedLine {
  section: string;
  line: string;
}

/** `GET /api/sessions` element — api.md's `ParsedSession`, not core's. */
export interface ParsedSession {
  frontmatter: SessionFrontmatter;
  goal: string | null;
  done: Line[];
  remaining: RemainingLine[];
  notes: NoteLine[];
  unparsed: UnparsedLine[];
}

/** `GET /api/backlog` element. */
export interface BacklogView {
  frontmatter: BacklogItem;
  body: string;
}

/** `GET /api/notes` element — a note plus the ulid of the session it was read from. */
export interface NoteRef extends NoteLine {
  session: string;
  /** The note's 0-based position among the notes of its own checkpoint (api.md §Read models). */
  index: number;
}

/** One harness row of `workledger doctor`, as `/api/health` returns it. */
export interface DoctorEntry {
  harness: string;
  binary: string | null;
  version: string | null;
  contract_tested_version: string;
  store: string;
  store_readable: boolean;
  projects: number | null;
  last_activity: string | null;
}

/**
 * One row of `.workledger/identities.yaml` — docs/contracts/p5/config-and-identities.md.
 *
 * A display map, never a rewrite: the ledger keeps whatever `Actor` was written into it, and a
 * view looks an email up here (case-insensitively) to decide what name to *show*. An email with
 * no row, and a repo with no file at all, both mean "show the email", which is why the absent
 * case is an empty list rather than an error.
 */
export interface Identity {
  email: string;
  name: string;
  dome_user: string | null;
}

/**
 * `GET /api/repos` element — docs/contracts/p8/daemon-and-api.md §Repo identity. `id` is what
 * every per-repo call carries as `?repo=`.
 */
export interface Repo {
  id: string;
  path: string;
  name: string;
  enabled: true;
  harnesses: string[];
  sessions7d: number;
  openBacklog: number;
  openNotes: number;
  lastHookAt: string | null;
  health: "ok" | "warn" | "broken";
}

/**
 * `GET /api/health`. `repo` is `null` for the machine-wide report a daemon gives when no repo is
 * named (P8); `repos` is every repo the server serves, in both modes.
 */
export interface Health {
  cli: string;
  repo: string | null;
  harnesses: DoctorEntry[];
  index: { path: string; bytes: number; openSessions: number };
  config: { valid: boolean; problems: string[] };
  lastHookAt: string | null;
  repos: Repo[];
}

/**
 * The SSE events of api.md §SSE, in the shape the UI subscribes to.
 *
 * `repo` is the P8 stamp (daemon-and-api.md: "SSE events gain `repo: <id>`; a client filters").
 * Optional on the type because a pre-P8 server does not send it; a repo-scoped source drops
 * events stamped for another repo and passes unstamped ones through.
 */
export type LedgerEvent =
  | { type: "session.changed"; ulid: string; repo?: string }
  | { type: "backlog.changed"; id: string; repo?: string }
  | { type: "notes.changed"; repo?: string }
  | { type: "health.changed"; repo?: string }
  /** docs/contracts/p3/api.md: `job.changed { id, status }`. */
  | { type: "job.changed"; id: string; status: string; repo?: string }
  /** daemon-and-api.md amendment 4: the daemon started or stopped serving `repo`; re-read `/api/repos`. */
  | { type: "repos.changed"; repo?: string };

/** A `jobs` row on the wire — docs/contracts/p3/cli.md §Jobs, unchanged. */
export interface Job {
  id: string;
  kind: string;
  session_ulid: string;
  repo_path: string;
  status: string;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  error: string | null;
  cost_estimate_usd: number | null;
  log_path: string | null;
  /** `harness-usage-limit` when the harness refused the job for its window; else `null` (#100). */
  error_code: string | null;
  /** ISO instant before which a `queued` job is not run — the usage window's reset (#100). */
  retry_after: string | null;
}

/** `POST /api/jobs/scan`. */
export interface ScanSummary {
  orphaned: number;
  queued: number;
}

/** What extracting one session would cost (cli.md §repair step 4). */
export interface ExtractEstimate {
  bytes: number;
  model: string;
  usd: number;
}

/** What backfilling would cost (cli.md §backfill step 2). */
export interface BackfillEstimate {
  count: number;
  bytes: number;
  oldest: string | null;
  seconds: number;
}

/** `POST /api/jobs/backfill` body. `consent: false` is the dry estimate. */
export interface BackfillRequest {
  since?: string;
  concurrency?: number;
  extractFallback?: boolean;
  consent: boolean;
}

/** One rendered transcript turn. Tool inputs and outputs are counted, never returned. */
export interface Turn {
  role: "user" | "assistant";
  text: string;
  tools: number;
}

/** `GET /api/sessions/:ulid/excerpt?cp=<n>`. */
export interface Excerpt {
  cp: number;
  /** `[offset(n-1), offset(n))` — the transcript byte range this rendering came from. */
  offset: [number, number];
  turns: Turn[];
}

/** `GET /api/sessions` query. */
export interface SessionQuery {
  author?: string;
  harness?: string;
  status?: string;
  since?: string;
  q?: string;
  limit?: number;
}

/** `POST /api/backlog/:id/edit` body. */
export interface EditPatch {
  title?: string;
  body?: string;
  priority?: "p1" | "p2" | "p3" | null;
  area?: string[];
}

/** `GET /api/notes/all` element: a note plus the repo it lives in. */
export type NoteAcrossRepos = NoteRef & { repo: Repo };

/** `GET /api/jobs/all` element: a job plus the repo it lives in. */
export type JobAcrossRepos = Job & { repo: Repo };

/**
 * The machine-wide half of a P8 daemon — daemon-and-api.md §Multi-repo endpoints. Not part of
 * `LedgerSource`, which is one ledger's worth of reads; a Home view holds one of these and hands
 * each repo card the `LedgerSource` that `forRepo` returns.
 */
export interface MachineSource {
  /** `GET /api/repos`. */
  listRepos(): Promise<Repo[]>;
  /** `GET /api/notes/all?type&open`. */
  listAllNotes(q?: { type?: NoteType[]; open?: boolean }): Promise<NoteAcrossRepos[]>;
  /** `GET /api/jobs/all`. */
  listAllJobs(): Promise<JobAcrossRepos[]>;
  /** A `LedgerSource` over one repo: every call carries `?repo=<id>`, every event is filtered to it. */
  forRepo(id: string): LedgerSource;
}

/** What a source can do. A view must degrade rather than assume any of it (design spec §14.2). */
export interface SourceCapabilities {
  write: boolean;
  live: boolean;
  provenance: boolean;
}

/**
 * The UI's only data dependency, `docs/contracts/p2/ledger-source.md`.
 *
 * `start` and `restore` are additive to the frozen listing: api.md §Endpoints carries
 * `POST /api/backlog/:id/start` and `POST /api/backlog/:id/restore`, and a source that could not
 * reach them would leave two of the backlog's five transitions unreachable from the UI.
 */
export interface LedgerSource {
  readonly capabilities: SourceCapabilities;
  listSessions(q?: SessionQuery): Promise<ParsedSession[]>;
  getSession(ulid: string): Promise<ParsedSession>;
  listBacklog(q?: { status?: BacklogStatus[] }): Promise<BacklogView[]>;
  getBacklogItem(id: string): Promise<BacklogView>;
  listNotes(q?: { type?: NoteType[]; open?: boolean }): Promise<NoteRef[]>;
  brief(maxTokens?: number): Promise<string>;
  health(): Promise<Health>;
  /**
   * P5 (docs/contracts/p5/config-and-identities.md). Empty when the repo has no identities file,
   * which is the contract's "emails display as before" — never an error.
   */
  listIdentities(): Promise<Identity[]>;
  // writes: reject with { code: "read-only" } when capabilities.write is false
  accept(id: string): Promise<BacklogView>;
  discard(id: string): Promise<BacklogView>;
  done(id: string): Promise<BacklogView>;
  start(id: string): Promise<BacklogView>;
  restore(id: string): Promise<BacklogView>;
  edit(id: string, patch: EditPatch): Promise<BacklogView>;
  assign(id: string, owner: Actor | null): Promise<BacklogView>;
  rank(id: string, rank: number): Promise<BacklogView>;
  merge(id: string, into: string): Promise<{ source: BacklogView; target: BacklogView }>;
  resolveNote(
    ref: { session: string; cp: number; index: number },
    decision: string,
  ): Promise<ParsedSession>;
  // P3 (docs/contracts/p3/api.md). A source whose server predates P3 answers these with a 404,
  // which surfaces as the contract's `ApiClientError` rather than as a silent empty list.
  listJobs(status?: string): Promise<Job[]>;
  scan(): Promise<ScanSummary>;
  /**
   * Queue a repair. `extract` without `consent` rejects with `code: "consent-required"`, and the
   * rejection carries the `estimate` the operator has to see before agreeing.
   */
  repair(input: { session: string; extract?: boolean; consent?: boolean }): Promise<Job>;
  /** `consent: false` queues nothing and returns the estimate with an empty `jobs` list. */
  backfill(input: BackfillRequest): Promise<{ jobs: Job[]; estimate: BackfillEstimate }>;
  cancelJob(id: string): Promise<Job>;
  retryJob(id: string): Promise<Job>;
  /**
   * `GET /api/jobs/:id/log` (p8 amendment 5): the resumed session's output the runner kept, as
   * text. Rejects with `code: "not_found"` when the job has no log.
   */
  jobLog(id: string): Promise<string>;
  /** Rejects with `code: "transcript_missing"` when the transcript is gone from this machine. */
  excerpt(ulid: string, cp: number): Promise<Excerpt>;
  // live: no-op unsubscribe when capabilities.live is false
  subscribe(handler: (event: LedgerEvent) => void): () => void;
}

// --- Onboarding (P8) --------------------------------------------------------------------------
//
// docs/contracts/p8/daemon-and-api.md §Onboarding endpoints. Machine-wide by nature: the wizard
// runs before any repo is enabled, so none of these calls carries `?repo=`. The shapes mirror
// `packages/server/src/onboarding.ts` field for field; they are restated here for the same reason
// every other wire type is — the UI never imports the server.

/** The backfill windows the wizard offers; `none` is "no backfill". */
export type OnboardingWindow = "7d" | "30d" | "90d" | "none";

/** How the backfill digests each session; `none` is "no backfill". */
export type OnboardingMethod = "resume" | "extract" | "none";

/** One repo the wizard can offer. */
export interface RepoCandidate {
  /** Absolute repo root. */
  path: string;
  /** `basename(path)`. */
  name: string;
  hasGit: boolean;
  /** `.workledger/config.yaml` exists — `init` has already run here. */
  enabled: boolean;
  /**
   * Amendment 2: `hasGit`, not under the OS temp dir, and not an ancestor of another candidate.
   * The wizard pre-checks a known repo only when this is true. Optional until the backend that
   * sends it lands; a client reads it through {@link isSuggested}, which falls back to `hasGit`.
   */
  suggested?: boolean;
  /** Sessions per harness store that name this repo as their working directory. */
  harnessSessions: { "claude-code"?: number; codex?: number; cursor?: number };
  /** ISO 8601 of the newest such session, or `null` for a repo with none. */
  lastSessionAt: string | null;
}

/** `candidate.suggested`, or `hasGit` for a server from before amendment 2. */
export function isSuggested(candidate: RepoCandidate): boolean {
  return candidate.suggested ?? candidate.hasGit;
}

/** `GET /api/onboarding/discover`. `found` never repeats a path already in `known`. */
export interface DiscoverResult {
  /** Repos the harness stores have sessions for. */
  known: RepoCandidate[];
  /** `.git` directories under `roots` the stores do not mention. */
  found: RepoCandidate[];
  /** The roots that were walked, absolute. */
  roots: string[];
}

/** One backfill window's size. */
export interface HistoryWindow {
  sessions: number;
  /** Total transcript bytes of those sessions. */
  bytes: number;
}

/** `GET /api/onboarding/history`. */
export interface HistoryResult {
  windows: { "7d": HistoryWindow; "30d": HistoryWindow; "90d": HistoryWindow };
}

/** `POST /api/onboarding/init` body. */
export interface InitInput {
  repos: string[];
  /** Harnesses to enable regardless of detection — `init --harness`. */
  harnesses?: string[];
}

/** What `init` did in one repo. */
export interface InitRepoResult {
  path: string;
  ok: boolean;
  /** Hook files written, relative to the repo root; empty for a repo that was already enabled. */
  hooksWritten: string[];
  /** Manual steps left to the operator — Codex's one-time hook trust. */
  trustSteps: string[];
  error?: string;
}

/** `POST /api/onboarding/init` response. */
export interface InitResult {
  results: InitRepoResult[];
}

/** `POST /api/onboarding/plan` body. */
export interface PlanInput {
  repos: string[];
  since: OnboardingWindow;
  method: OnboardingMethod;
}

/** Wall time the resume-based backfill is expected to take. */
export interface ResumeEstimate {
  seconds: number;
}

/** What the extraction would cost, and whether the key it needs is present on the server. */
export interface ExtractionEstimate {
  tokens: number;
  usd: number;
  /** `ANTHROPIC_API_KEY` is absent from the server's environment. */
  needsApiKey: boolean;
}

/** `POST /api/onboarding/plan` response. `estimate` is `null` for method or window `none`. */
export interface PlanResult {
  /** Sessions in the window the index has never seen, across `repos`. */
  sessions: number;
  estimate: ResumeEstimate | ExtractionEstimate | null;
  /**
   * Amendment 3: under method `extract`, the Codex sessions left out of `sessions` and the
   * estimate — the extractor parses Claude Code transcripts only, so they are skipped rather
   * than queued. Resume covers them.
   */
  unsupported?: { codex: number };
}

/** `POST /api/onboarding/run` body. The server refuses anything but `consent: true` (409). */
export interface RunInput extends PlanInput {
  consent: true;
}

/** `POST /api/onboarding/run` response (202). */
export interface RunResult {
  jobs: Job[];
}

/**
 * `GET /api/onboarding/status` — the wizard's jobs by lifecycle state. `running` counts `queued`
 * too, `failed` counts `cancelled`, `waiting` is the queued rows held for a usage window (#100),
 * so `total = done + failed + running + waiting` and `complete` is
 * "nothing is still ahead".
 */
export interface OnboardingStatus {
  total: number;
  done: number;
  failed: number;
  running: number;
  /** Queued jobs held for the harness's usage window (#100) — neither ahead nor failed. */
  waiting: number;
  /** The earliest reset those jobs wait for, or `null` when nothing is waiting. */
  retryAfter: string | null;
  complete: boolean;
}

/**
 * The wizard's half of a P8 daemon — one method per `/api/onboarding/*` route. Not part of
 * `LedgerSource`: onboarding is about the machine, not a ledger, and a source that is not the
 * local server (a card, a replay) has no business offering it.
 */
export interface OnboardingSource {
  /** `GET /api/onboarding/discover?roots=`; no roots → the server's default (`~/Projects`). */
  discover(roots?: string[]): Promise<DiscoverResult>;
  /** `GET /api/onboarding/history?repos=`. */
  history(repos: string[]): Promise<HistoryResult>;
  /** `POST /api/onboarding/init`. */
  initRepos(input: InitInput): Promise<InitResult>;
  /** `POST /api/onboarding/plan`. */
  plan(input: PlanInput): Promise<PlanResult>;
  /** `POST /api/onboarding/run`. 409 `api-key-required` for `extract` without a key. */
  run(input: RunInput): Promise<RunResult>;
  /** `GET /api/onboarding/status`. */
  status(): Promise<OnboardingStatus>;
}
