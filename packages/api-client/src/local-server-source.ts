/**
 * `LocalServerSource` — `LedgerSource` over a running `workledger serve`, one method per row of
 * `docs/contracts/p2/api.md` §Endpoints.
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
  EditPatch,
  Excerpt,
  Health,
  Identity,
  Job,
  LedgerEvent,
  LedgerSource,
  NoteRef,
  NoteType,
  ParsedSession,
  ScanSummary,
  SourceCapabilities,
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
}

/** `["a","b"]` → `"a,b"`, and an empty or absent list → `undefined` (send no parameter at all). */
function commaList(values: readonly string[] | undefined): string | undefined {
  return values === undefined || values.length === 0 ? undefined : values.join(",");
}

export class LocalServerSource implements LedgerSource {
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

  constructor(options: LocalServerSourceOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalFetch();
    this.#eventSource = options.EventSource;
    this.#retryBaseMs = options.retryBaseMs;
    this.#retryMaxMs = options.retryMaxMs;
  }

  /** One request. Non-2xx becomes the contract's `ApiClientError`; 2xx is decoded by `decode`. */
  async #request<T>(path: string, init: Parameters<FetchLike>[1], decode: (r: Awaited<ReturnType<FetchLike>>) => Promise<T>): Promise<T> {
    const url = `${this.#baseUrl}${path}`;
    const response = await this.#fetch(url, init);
    if (!response.ok) throw await toApiError(url, response);
    return await decode(response);
  }

  #get<T>(path: string): Promise<T> {
    return this.#request(path, undefined, async (r) => (await r.json()) as T);
  }

  #getText(path: string): Promise<string> {
    return this.#request(path, undefined, (r) => r.text());
  }

  #post<T>(path: string, body?: unknown): Promise<T> {
    // A body-less POST sends no `content-type` at all rather than an empty JSON object: Hono's
    // `c.req.json()` on the server side is only reached by the routes that declare a body.
    const init =
      body === undefined
        ? { method: "POST" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    return this.#request(path, init, async (r) => (await r.json()) as T);
  }

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

  excerpt(ulid: string, cp: number): Promise<Excerpt> {
    return this.#get<Excerpt>(`/api/sessions/${encodeURIComponent(ulid)}/excerpt${queryString({ cp })}`);
  }

  subscribe(handler: (event: LedgerEvent) => void): () => void {
    if (!this.capabilities.live) return () => {};
    return subscribeSse({
      url: `${this.#baseUrl}/api/events`,
      handler,
      EventSource: this.#eventSource ?? globalEventSource(),
      ...(this.#retryBaseMs === undefined ? {} : { retryBaseMs: this.#retryBaseMs }),
      ...(this.#retryMaxMs === undefined ? {} : { retryMaxMs: this.#retryMaxMs }),
    });
  }
}

