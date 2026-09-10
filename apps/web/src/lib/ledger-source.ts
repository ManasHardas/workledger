/**
 * `LedgerSource` — the app's only data dependency (`docs/contracts/p2/ledger-source.md`).
 *
 * The contract's home is `packages/api-client`. This module is the thin seam the scaffold
 * promised: it re-exports the contract verbatim and adds nothing to it, so a view that needs a
 * new call needs a contract amendment first, not a local method.
 *
 * It also owns the choice of *which* source the app runs on. `createSource("local", …)` is the
 * api-client's `LocalServerSource` talking to `workledger serve`; `createSource("fixture")` is the
 * in-memory ledger of `./fixtures.ts`, kept because it is read-only and not live, which exercises
 * the same degraded paths a Dome card runs in (design spec §14.2) — no view may assume writes or
 * SSE are available.
 */
import { createSource as createApiSource } from "@workledger/api-client";

import {
  FIXTURE_BACKLOG,
  FIXTURE_BRIEF,
  FIXTURE_DISCOVER,
  FIXTURE_HEALTH,
  FIXTURE_HISTORY,
  FIXTURE_JOBS_ALL,
  FIXTURE_NOTES,
  FIXTURE_NOTES_ALL,
  FIXTURE_ONBOARDING_STATUS,
  FIXTURE_PLAN_EXTRACT,
  FIXTURE_PLAN_RESUME,
  FIXTURE_REPOS,
  FIXTURE_SESSIONS,
  FIXTURE_WORKSPACES,
  fixtureInitResult,
} from "./fixtures.js";

import type {
  BackfillEstimate,
  BacklogStatus,
  BacklogView,
  DiscoverResult,
  Excerpt,
  Health,
  HistoryResult,
  Identity,
  InitInput,
  InitResult,
  Job,
  JobAcrossRepos,
  LedgerEvent,
  LedgerSource,
  MachineSource,
  NoteAcrossRepos,
  NoteRef,
  NoteType,
  OnboardingSource,
  OnboardingStatus,
  ParsedSession,
  PlanInput,
  PlanResult,
  Repo,
  RunResult,
  ScanSummary,
  SessionQuery,
  Workspace,
} from "@workledger/api-client";

export { commitHref, editorHref, fileHref, isSuggested } from "@workledger/api-client";
export type {
  Actor,
  BackfillEstimate,
  BackfillRequest,
  BacklogStatus,
  BacklogView,
  DiscoverResult,
  DoctorEntry,
  EditPatch,
  EditorScheme,
  Excerpt,
  ExtractEstimate,
  ExtractionEstimate,
  Health,
  HistoryResult,
  HistoryWindow,
  Identity,
  InitInput,
  InitRepoResult,
  InitResult,
  Job,
  JobAcrossRepos,
  LedgerEvent,
  LedgerSource,
  Line,
  MachineSource,
  MemoryLine,
  NoteAcrossRepos,
  NoteLine,
  NoteRef,
  NoteType,
  OnboardingMethod,
  OnboardingSource,
  OnboardingStatus,
  OnboardingWindow,
  ParsedSession,
  PlanInput,
  PlanResult,
  Repo,
  RepoCandidate,
  RepoRemote,
  ResumeEstimate,
  RunInput,
  RunResult,
  ScanSummary,
  SessionQuery,
  Turn,
  Verified,
  Workspace,
  WorkspaceCandidate,
} from "@workledger/api-client";

/**
 * What the app is handed: one ledger's reads (the server's implicit repo, or nothing useful on a
 * machine daemon until `forRepo`) plus the machine-wide half of P8 and the wizard's six calls
 * (`OnboardingSource`, machine-wide by nature). `main.tsx` builds one; the `#/r/<id>/…` routes
 * hand their views `forRepo(id)`; `#/onboarding` reads it whole through `useMachine()`.
 */
export type AppSource = LedgerSource & MachineSource & OnboardingSource;

/** The rejection every write takes on a source whose `capabilities.write` is false. */
const readOnly = <T>(): Promise<T> => Promise.reject({ code: "read-only" });

/** The in-memory fixture ledger: read-only, not live, two repos over the same data; the wizard's calls answer canned data. */
export function createSource(kind: "fixture"): AppSource;
/**
 * `workledger serve` over HTTP + SSE. With `repo` the source is scoped to that repo (P8's
 * machine-mode daemon requires it); without, it is the server's one repo under `serve --repo`,
 * and the `MachineSource` half lists repos and builds scoped sources with `forRepo`.
 */
export function createSource(kind: "local", opts: { baseUrl: string; repo?: string }): AppSource;
export function createSource(kind: "fixture" | "local", opts?: { baseUrl: string; repo?: string }): AppSource {
  if (kind === "fixture") return new FixtureSource();
  return shareEvents(
    createApiSource("local", { baseUrl: opts?.baseUrl ?? "", ...(opts?.repo === undefined ? {} : { repo: opts.repo }) }),
  );
}

/**
 * One SSE connection per app, however many views subscribe.
 *
 * `LocalServerSource.subscribe` opens an `EventSource` per call, and under P8 the app has more
 * callers than it used to: Home's repo list, a view's own list, its identities map — three per
 * tab, each holding an HTTP/1.1 connection for its whole life. Chromium allows six per host, so
 * two tabs on Next pinned every slot and the next `POST …/accept` queued behind them until the
 * e2e's 60 s timeout. One stream carries every repo's events anyway (daemon-and-api.md: "SSE
 * events gain `repo`; a client filters"), so this wraps the source to open it once, on the first
 * subscriber, and close it after the last; `forRepo(id)` sources filter the same stream rather
 * than opening their own. Everything else is delegated untouched.
 *
 * A `Proxy` rather than `Object.create`: the api-client's class keeps its state in `#private`
 * fields, which only resolve when `this` is the real instance, so each method is bound to it.
 */
export function shareEvents(source: AppSource): AppSource {
  const handlers = new Set<(event: LedgerEvent) => void>();
  let stop: (() => void) | null = null;

  const subscribe = (handler: (event: LedgerEvent) => void): (() => void) => {
    handlers.add(handler);
    if (stop === null) {
      stop = source.subscribe((event) => {
        for (const each of [...handlers]) each(event);
      });
    }
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0 && stop !== null) {
        stop();
        stop = null;
      }
    };
  };

  const scoped = new Map<string, LedgerSource>();
  const forRepo = (id: string): LedgerSource => {
    const found = scoped.get(id);
    if (found !== undefined) return found;
    const filtered = (handler: (event: LedgerEvent) => void) =>
      subscribe((event) => {
        if (event.repo === undefined || event.repo === id) handler(event);
      });
    const made = delegate(source.forRepo(id), { subscribe: filtered });
    scoped.set(id, made);
    return made;
  };

  return delegate(source, { subscribe, forRepo });
}

/** `target` with `overrides` in front of it, every other member bound to `target`. */
function delegate<T extends object>(target: T, overrides: Partial<T>): T {
  return new Proxy(target, {
    get(inner, prop, receiver) {
      if (prop in overrides) return Reflect.get(overrides, prop, receiver) as unknown;
      const value = Reflect.get(inner, prop, inner) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(inner) : value;
    },
  });
}

/**
 * Two fixture repos read the same ledger: `forRepo` hands back the same source for either id, and
 * only the aggregates (`listAllNotes`, `listAllJobs`) tag their rows with a repo, so the Home
 * cards and the machine-wide tabs have a repo per row to show while a per-repo view stays the
 * one P2 shipped.
 */
class FixtureSource implements LedgerSource, MachineSource, OnboardingSource {
  readonly capabilities = { write: false, live: false, provenance: false };

  /**
   * P8's wizard, answered from `./fixtures.ts`.
   *
   * These are not writes on the ledger — `initRepos` scaffolds hook files and `run` queues jobs,
   * neither of which a fixture has — so they *pretend*, with the shapes the daemon sends, rather
   * than rejecting `read-only` the way the backlog writes do. A wizard that could not be walked
   * against the fixture could not be tested step by step, and `pnpm dev` would open on a wall.
   * `status` reports nothing queued, which the contract defines as complete.
   */
  async discover(roots?: string[]): Promise<DiscoverResult> {
    return { ...FIXTURE_DISCOVER, roots: roots ?? FIXTURE_DISCOVER.roots };
  }

  async history(): Promise<HistoryResult> {
    return FIXTURE_HISTORY;
  }

  async initRepos(input: InitInput): Promise<InitResult> {
    return {
      results: input.repos.map(fixtureInitResult),
      ...(input.workspaces === undefined ? {} : { workspaces: input.workspaces.map(fixtureInitResult) }),
    };
  }

  async plan(input: PlanInput): Promise<PlanResult> {
    if (input.since === "none" || input.method === "none") return { sessions: 0, estimate: null };
    return input.method === "extract" ? FIXTURE_PLAN_EXTRACT : FIXTURE_PLAN_RESUME;
  }

  async run(): Promise<RunResult> {
    return { jobs: [] };
  }

  async status(): Promise<OnboardingStatus> {
    return FIXTURE_ONBOARDING_STATUS;
  }

  /** Amendment 12: Home's "Folders with sessions", canned like the rest of the wizard's reads. */
  async workspaces(): Promise<Workspace[]> {
    return FIXTURE_WORKSPACES;
  }

  async listRepos(): Promise<Repo[]> {
    return FIXTURE_REPOS;
  }

  async listAllNotes(q?: { type?: NoteType[]; open?: boolean }): Promise<NoteAcrossRepos[]> {
    return FIXTURE_NOTES_ALL.filter((note) => {
      if (q?.type && !q.type.includes(note.type)) return false;
      if (q?.open && note.resolved) return false;
      return true;
    });
  }

  async listAllJobs(): Promise<JobAcrossRepos[]> {
    return FIXTURE_JOBS_ALL;
  }

  forRepo(): LedgerSource {
    return this;
  }

  async listSessions(q?: SessionQuery): Promise<ParsedSession[]> {
    const needle = q?.q?.toLowerCase();
    const matches = FIXTURE_SESSIONS.filter((session) => {
      if (q?.status && session.frontmatter.status !== q.status) return false;
      if (q?.harness && session.frontmatter.harness !== q.harness) return false;
      if (!needle) return true;
      const haystack = [
        session.goal ?? "",
        ...session.done.map((line) => line.text),
        ...session.remaining.map((line) => line.text),
        ...session.notes.map((line) => line.text),
      ];
      return haystack.some((text) => text.toLowerCase().includes(needle));
    });
    return matches.slice(0, q?.limit ?? 100);
  }

  async getSession(ulid: string): Promise<ParsedSession> {
    const found = (await this.listSessions()).find((s) => s.frontmatter.id === ulid);
    if (!found) throw Object.assign(new Error(`no session ${ulid}`), { code: "not-found" });
    return found;
  }

  async listBacklog(q?: { status?: BacklogStatus[] }): Promise<BacklogView[]> {
    const wanted = q?.status ?? (["proposed", "accepted", "in_progress", "done"] as BacklogStatus[]);
    return FIXTURE_BACKLOG.filter((item) => wanted.includes(item.frontmatter.status)).sort(
      (a, b) => a.frontmatter.rank - b.frontmatter.rank,
    );
  }

  async getBacklogItem(id: string): Promise<BacklogView> {
    const found = (await this.listBacklog()).find((item) => item.frontmatter.id === id);
    if (!found) throw Object.assign(new Error(`no backlog item ${id}`), { code: "not-found" });
    return found;
  }

  async listNotes(q?: { type?: NoteType[]; open?: boolean }): Promise<NoteRef[]> {
    return FIXTURE_NOTES.filter((note) => {
      if (q?.type && !q.type.includes(note.type)) return false;
      if (q?.open && note.resolved) return false;
      return true;
    });
  }

  async brief(): Promise<string> {
    return FIXTURE_BRIEF;
  }

  async health(): Promise<Health> {
    return FIXTURE_HEALTH;
  }

  /**
   * No identities file behind a fixture, so no names to map. The empty list is the contract's
   * "Missing file: emails display as before" (docs/contracts/p5/config-and-identities.md) — a
   * view falls back to the email rather than to a placeholder, which is the same path a real repo
   * that never wrote the file takes.
   */
  async listIdentities(): Promise<Identity[]> {
    return [];
  }

  accept = readOnly<BacklogView>;
  discard = readOnly<BacklogView>;
  done = readOnly<BacklogView>;
  start = readOnly<BacklogView>;
  restore = readOnly<BacklogView>;
  edit = readOnly<BacklogView>;
  assign = readOnly<BacklogView>;
  rank = readOnly<BacklogView>;
  merge = readOnly<{ source: BacklogView; target: BacklogView }>;
  resolveNote = readOnly<ParsedSession>;

  /**
   * P3's job surface, degraded the way §14.2 requires of a source that is not a local server.
   *
   * There is no queue behind a fixture, so the list is empty rather than invented, and every
   * mutation takes the same `read-only` rejection the backlog writes take. `excerpt` refuses for
   * a second reason as well: `capabilities.provenance` is false here, and a view that asked
   * anyway must get an error rather than a plausible-looking transcript that never existed.
   */
  async listJobs(): Promise<Job[]> {
    return [];
  }

  scan = readOnly<ScanSummary>;
  repair = readOnly<Job>;
  backfill = readOnly<{ jobs: Job[]; estimate: BackfillEstimate }>;
  cancelJob = readOnly<Job>;
  retryJob = readOnly<Job>;
  jobLog = readOnly<string>;
  excerpt = readOnly<Excerpt>;

  subscribe(): () => void {
    return () => {};
  }
}
