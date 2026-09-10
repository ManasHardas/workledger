/**
 * `LocalServerSource` — `LedgerSource` over a running `workledger serve`, one method per row of
 * `docs/contracts/p2/api.md` §Endpoints, plus the machine-wide reads of
 * `docs/contracts/p8/daemon-and-api.md` (`MachineSource`).
 *
 * P8's daemon serves every repo on the machine and requires `?repo=<id>` on each per-repo
 * route. A source built with `repo` set is scoped to that one repo: it appends the parameter to
 * every path and drops SSE events stamped for another repo. `forRepo(id)` makes one from an
 * unscoped source, sharing its `fetch` and `EventSource`. An unscoped source against a machine
 * daemon can still list repos and read the aggregates; its per-repo calls come back as the
 * server's 400 `repo-required`, which is the contract, not a client-side guess.
 *
 * There is no caching, no retry on a read and no request coalescing: the server is on loopback
 * and holds the whole ledger in memory, so a round trip is cheaper than the invalidation bugs a
 * client-side cache would buy. The one thing that *is* stateful is the SSE subscription, which
 * owns its own reconnect (`./events.ts`).
 */
import type { EventSourceCtor } from "./events.js";
import type { FetchLike } from "./http.js";
import type {
  Actor,
  BackfillEstimate,
  BackfillRequest,
  BacklogStatus,
  BacklogView,
  DiscoverResult,
  EditPatch,
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
  RunInput,
  RunResult,
  ScanSummary,
  SourceCapabilities,
  Workspace,
} from "./types.js";

import { globalEventSource, subscribeSse } from "./events.js";
import { globalFetch, normalizeBaseUrl, queryString, toApiError } from "./http.js";
import { readOnlyRejection } from "./errors.js";

/** What `createSource("local", …)` takes. `baseUrl` is the contract; the rest is for tests. */
export interface LocalServerSourceOptions {
  /** Where `workledger serve` is listening, e.g. `http://127.0.0.1:7777`. */
  baseUrl: string;
  /** Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Defaults to `globalThis.EventSource`. Resolved lazily, so a read-only run needs none. */
  EventSource?: EventSourceCtor;
  /** Reconnect knobs; the defaults are ledger-source.md's 500 ms doubling to a 10 s cap. */
  retryBaseMs?: number;
  retryMaxMs?: number;
  /**
   * The repo id (from `GET /api/repos`) every per-repo call is scoped to. Required against a
   * machine-mode daemon; optional against `serve --repo`, where the server defaults it.
   */
  repo?: string;
}

/** `["a","b"]` → `"a,b"`, and an empty or absent list → `undefined` (send no parameter at all). */
function commaList(values: readonly string[] | undefined): string | undefined {
  return values === undefined || values.length === 0 ? undefined : values.join(",");
}

export class LocalServerSource implements LedgerSource, MachineSource, OnboardingSource {
  /**
   * The local server owns the ledger files, so it can write and it watches. `provenance` became
   * true in P3 (docs/contracts/p3/api.md): `GET /api/sessions/:ulid/excerpt` hands back the
   * transcript turns behind a checkpoint, which is the affordance the flag gates — a view may now
   * offer "show me what this came from" against a local server. It stays false for a source that
   * cannot reach the machine the transcript is on.
   */
  readonly capabilities: SourceCapabilities = { write: true, live: true, provenance: true };

  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #eventSource: EventSourceCtor | undefined;
  readonly #retryBaseMs: number | undefined;
  readonly #retryMaxMs: number | undefined;
  readonly #options: LocalServerSourceOptions;

  /** The repo id this source is scoped to, or `undefined` for an unscoped one. */
  readonly repo: string | undefined;

  constructor(options: LocalServerSourceOptions) {
    this.#options = options;
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalFetch();
    this.#eventSource = options.EventSource;
    this.#retryBaseMs = options.retryBaseMs;
    this.#retryMaxMs = options.retryMaxMs;
    this.repo = options.repo;
  }

  /** One request. Non-2xx becomes the contract's `ApiClientError`; 2xx is decoded by `decode`. */
  async #request<T>(path: string, init: Parameters<FetchLike>[1], decode: (r: Awaited<ReturnType<FetchLike>>) => Promise<T>): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    const response = await this.#fetch(url, init);
    if (!response.ok) throw await toApiError(url, response);
    return await decode(response);
  }

  /**
   * A per-repo path with the scope's `repo` parameter added (P8), or unchanged when unscoped.
   * `path` may already carry a query string; the parameter joins it either way.
   */
  #scoped(path: string): string {
    if (this.repo === undefined) return path;
    const param = `repo=${encodeURIComponent(this.repo)}`;
    return path.includes("?") ? `${path}&${param}` : `${path}?${param}`;
  }

  /** A GET on a per-repo route. */
  #get<T>(path: string): Promise<T> {
    return this.#request(this.#scoped(path), undefined, async (r) => (await r.json()) as T);
  }

  /** A GET on a machine-wide route, which takes no `repo`. */
  #getMachine<T>(path: string): Promise<T> {
    return this.#request(path, undefined, async (r) => (await r.json()) as T);
  }

  /** A JSON POST on a machine-wide route, which takes no `repo`. */
  #postMachine<T>(path: string, body: unknown): Promise<T> {
    return this.#request(
      path,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      async (r) => (await r.json()) as T,
    );
  }

  #getText(path: string): Promise<string> {
    return this.#request(this.#scoped(path), undefined, (r) => r.text());
  }

  #post<T>(path: string, body?: unknown): Promise<T> {
    // A body-less POST sends no `content-type` at all rather than an empty JSON object: Hono's
    // `c.req.json()` on the server side is only reached by the routes that declare a body.
    const init =
      body === undefined
        ? { method: "POST" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    return this.#request(this.#scoped(path), init, async (r) => (await r.json()) as T);
  }

  // --- MachineSource (P8) ---------------------------------------------------------------------

  listRepos(): Promise<Repo[]> {
    return this.#getMachine<Repo[]>("/api/repos");
  }

  listAllNotes(q: { type?: NoteType[]; open?: boolean } = {}): Promise<NoteAcrossRepos[]> {
    return this.#getMachine<NoteAcrossRepos[]>(
      `/api/notes/all${queryString({ type: commaList(q.type), open: q.open === true ? "true" : undefined })}`,
    );
  }

  listAllJobs(): Promise<JobAcrossRepos[]> {
    return this.#getMachine<JobAcrossRepos[]>("/api/jobs/all");
  }

  /** The same server, scoped to `id`; `fetch`, `EventSource` and the reconnect knobs carry over. */
  forRepo(id: string): LocalServerSource {
    return new LocalServerSource({ ...this.#options, fetch: this.#fetch, repo: id });
  }

  // --- OnboardingSource (P8) ------------------------------------------------------------------
  //
  // Machine-wide like the reads above: no `?repo=` even on a scoped source, because the wizard
  // runs before the repo it would name exists. The POSTs always carry `content-type:
  // application/json` — the server's write guard answers 415 to anything else — and no body-less
  // form, since every one of them has a body.

  discover(roots?: string[]): Promise<DiscoverResult> {
    return this.#getMachine<DiscoverResult>(`/api/onboarding/discover${queryString({ roots: commaList(roots) })}`);
  }

  history(repos: string[]): Promise<HistoryResult> {
    return this.#getMachine<HistoryResult>(`/api/onboarding/history${queryString({ repos: commaList(repos) })}`);
  }

  initRepos(input: InitInput): Promise<InitResult> {
    return this.#postMachine<InitResult>("/api/onboarding/init", input);
  }

  plan(input: PlanInput): Promise<PlanResult> {
    return this.#postMachine<PlanResult>("/api/onboarding/plan", input);
  }

  run(input: RunInput): Promise<RunResult> {
    return this.#postMachine<RunResult>("/api/onboarding/run", input);
  }

  status(): Promise<OnboardingStatus> {
    return this.#getMachine<OnboardingStatus>("/api/onboarding/status");
  }

  /** Amendment 12. Machine-wide and a plain read, so no `?repo=` and no write guard. */
  workspaces(): Promise<Workspace[]> {
    return this.#getMachine<Workspace[]>("/api/workspaces");
  }

  // --- LedgerSource ---------------------------------------------------------------------------

  /**
   * The gate every write goes through. ledger-source.md: "writes: reject with
   * `{ code: "read-only" }` when `capabilities.write` is false". `capabilities` is read off `this`
   * rather than off the literal above, so a subclass that presents this server read-only — a
   * kiosk view, a future replay source — gets the rejection without reimplementing ten methods.
   */
  #write<T>(method: string, send: () => Promise<T>): Promise<T> {
    if (!this.capabilities.write) return Promise.reject(readOnlyRejection(method));
    return send();
  }

  /** `/api/backlog/<id>/<op>`, with the id escaped so a hand-made id cannot forge a path. */
  #backlogOp<T>(id: string, op: string, body?: unknown): Promise<T> {
    return this.#write(op, () => this.#post<T>(`/api/backlog/${encodeURIComponent(id)}/${op}`, body));
  }

  listSessions(q: Parameters<LedgerSource["listSessions"]>[0] = {}): Promise<ParsedSession[]> {
    return this.#get<ParsedSession[]>(
      `/api/sessions${queryString({
        author: q.author,
        harness: q.harness,
        status: q.status,
        since: q.since,
        q: q.q,
        limit: q.limit,
      })}`,
    );
  }

  getSession(ulid: string): Promise<ParsedSession> {
    return this.#get<ParsedSession>(`/api/sessions/${encodeURIComponent(ulid)}`);
  }

  listBacklog(q: { status?: BacklogStatus[] } = {}): Promise<BacklogView[]> {
    return this.#get<BacklogView[]>(`/api/backlog${queryString({ status: commaList(q.status) })}`);
  }

  getBacklogItem(id: string): Promise<BacklogView> {
    return this.#get<BacklogView>(`/api/backlog/${encodeURIComponent(id)}`);
  }

  listNotes(q: { type?: NoteType[]; open?: boolean } = {}): Promise<NoteRef[]> {
    // api.md spells the filter `open=true`; anything else is "all notes", so `open: false` sends
    // no parameter rather than `open=false`, which the server would read as truthy-by-presence.
    return this.#get<NoteRef[]>(
      `/api/notes${queryString({ type: commaList(q.type), open: q.open === true ? "true" : undefined })}`,
    );
  }

  brief(maxTokens?: number): Promise<string> {
    return this.#getText(`/api/brief${queryString({ max_tokens: maxTokens })}`);
  }

  /** Scoped: that repo's report. Unscoped: the machine-wide one on a daemon, the repo's on `serve --repo`. */
  health(): Promise<Health> {
    return this.#get<Health>("/api/health");
  }

  listIdentities(): Promise<Identity[]> {
    return this.#get<Identity[]>("/api/identities");
  }

  accept(id: string): Promise<BacklogView> {
    return this.#backlogOp<BacklogView>(id, "accept");
  }

  discard(id: string): Promise<BacklogView> {
    return this.#backlogOp<BacklogView>(id, "discard");
  }

  done(id: string): Promise<BacklogView> {
    return this.#backlogOp<BacklogView>(id, "done");
  }

  start(id: string): Promise<BacklogView> {
    return this.#backlogOp<BacklogView>(id, "start");
  }

  restore(id: string): Promise<BacklogView> {
    return this.#backlogOp<BacklogView>(id, "restore");
  }

  edit(id: string, patch: EditPatch): Promise<BacklogView> {
    return this.#backlogOp<BacklogView>(id, "edit", patch);
  }

  assign(id: string, owner: Actor | null): Promise<BacklogView> {
    return this.#backlogOp<BacklogView>(id, "assign", { owner });
  }

  rank(id: string, rank: number): Promise<BacklogView> {
    return this.#backlogOp<BacklogView>(id, "rank", { rank });
  }

  merge(id: string, into: string): Promise<{ source: BacklogView; target: BacklogView }> {
    return this.#backlogOp<{ source: BacklogView; target: BacklogView }>(id, "merge", { into });
  }

  resolveNote(
    ref: { session: string; cp: number; index: number },
    decision: string,
  ): Promise<ParsedSession> {
    return this.#write("resolveNote", () =>
      this.#post<ParsedSession>("/api/notes/resolve", { ...ref, decision }),
    );
  }

  listJobs(status?: string): Promise<Job[]> {
    return this.#get<Job[]>(`/api/jobs${queryString({ status })}`);
  }

  scan(): Promise<ScanSummary> {
    return this.#write("scan", () => this.#post<ScanSummary>("/api/jobs/scan"));
  }

  repair(input: { session: string; extract?: boolean; consent?: boolean }): Promise<Job> {
    return this.#write("repair", () => this.#post<Job>("/api/jobs/repair", input));
  }

  backfill(input: BackfillRequest): Promise<{ jobs: Job[]; estimate: BackfillEstimate }> {
    return this.#write("backfill", () =>
      this.#post<{ jobs: Job[]; estimate: BackfillEstimate }>("/api/jobs/backfill", input),
    );
  }

  cancelJob(id: string): Promise<Job> {
    return this.#write("cancelJob", () => this.#post<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`));
  }

  retryJob(id: string): Promise<Job> {
    return this.#write("retryJob", () => this.#post<Job>(`/api/jobs/${encodeURIComponent(id)}/retry`));
  }

  jobLog(id: string): Promise<string> {
    return this.#getText(`/api/jobs/${encodeURIComponent(id)}/log`);
  }

  excerpt(ulid: string, cp: number): Promise<Excerpt> {
    return this.#get<Excerpt>(`/api/sessions/${encodeURIComponent(ulid)}/excerpt${queryString({ cp })}`);
  }

  /**
   * One stream serves the whole machine (P8), so a scoped source drops the frames stamped for
   * another repo; an unstamped frame — a pre-P8 server — is passed through, and an unscoped
   * source passes everything, stamp and all, for a view that spans repos.
   */
  subscribe(handler: (event: LedgerEvent) => void): () => void {
    if (!this.capabilities.live) return () => {};
    const scope = this.repo;
    const filtered =
      scope === undefined
        ? handler
        : (event: LedgerEvent): void => {
            if (event.repo === undefined || event.repo === scope) handler(event);
          };
    return subscribeSse({
      url: `${this.#baseUrl}/api/events`,
      handler: filtered,
      EventSource: this.#eventSource ?? globalEventSource(),
      ...(this.#retryBaseMs === undefined ? {} : { retryBaseMs: this.#retryBaseMs }),
      ...(this.#retryMaxMs === undefined ? {} : { retryMaxMs: this.#retryMaxMs }),
    });
  }
}

