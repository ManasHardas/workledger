# `LedgerSource` — the UI's only data dependency (frozen 2026-09-09)

`packages/api-client` exports the interface and `LocalServerSource`. P6 adds `CardFSSource`,
later `CloudSyncSource`. The web app imports only the interface and a factory.

```ts
export interface LedgerSource {
  readonly capabilities: { write: boolean; live: boolean; provenance: boolean };
  listSessions(q?: SessionQuery): Promise<ParsedSession[]>;
  getSession(ulid: string): Promise<ParsedSession>;
  listBacklog(q?: { status?: BacklogStatus[] }): Promise<BacklogView[]>;
  getBacklogItem(id: string): Promise<BacklogView>;
  listNotes(q?: { type?: NoteType[]; open?: boolean }): Promise<NoteRef[]>;
  brief(maxTokens?: number): Promise<string>;
  health(): Promise<Health>;
  // writes: reject with { code: "read-only" } when capabilities.write is false
  accept(id: string): Promise<BacklogView>;
  discard(id: string): Promise<BacklogView>;
  done(id: string): Promise<BacklogView>;
  edit(id: string, patch: EditPatch): Promise<BacklogView>;
  assign(id: string, owner: Actor | null): Promise<BacklogView>;
  rank(id: string, rank: number): Promise<BacklogView>;
  merge(id: string, into: string): Promise<{ source: BacklogView; target: BacklogView }>;
  resolveNote(ref: { session: string; cp: number; index: number }, decision: string): Promise<ParsedSession>;
  // live: no-op unsubscribe when capabilities.live is false
  subscribe(handler: (event: LedgerEvent) => void): () => void;
}
export type LedgerEvent = { type: "session.changed"; ulid: string } | { type: "backlog.changed"; id: string } | { type: "notes.changed" } | { type: "health.changed" };
export type SessionQuery = { author?: string; harness?: string; status?: string; since?: string; q?: string; limit?: number };
export type EditPatch = { title?: string; body?: string; priority?: "p1"|"p2"|"p3"|null; area?: string[] };
export function createSource(kind: "local", opts: { baseUrl: string }): LedgerSource;
```

`LocalServerSource` maps one-to-one onto `docs/contracts/p2/api.md`, with `subscribe` backed by
`EventSource` on `/api/events` and automatic reconnect. Types (`ParsedSession`, `BacklogView`,
`NoteRef`, `Health`) are re-exported from `@workledger/core` where they exist and defined in
`api-client` otherwise, so `apps/web` never imports the server.
