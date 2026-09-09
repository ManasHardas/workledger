/**
 * Public surface of `@workledger/server` — the local read server of `docs/contracts/p2/api.md`.
 * Side effects live here and in `packages/cli`; `packages/core` stays pure (CLAUDE.md).
 */
export { LOOPBACK, createApp } from "./app.js";
export type { CreateAppOptions, RunningServer, ServerApp } from "./app.js";
export { EventBus } from "./events.js";
export type { LedgerEvent, Listener } from "./events.js";
export { DEFAULT_LIMIT, ReadModel, parseLimit } from "./read-model.js";
export type { BacklogQuery, NotesQuery, SessionQuery } from "./read-model.js";
export { LEDGER_DIR, ledgerPaths } from "./paths.js";
export type { LedgerPaths } from "./paths.js";
export { buildHealth, defaultHome } from "./health.js";
export type { DoctorEntry, Health, HealthEnv } from "./health.js";
export { briefMaxTokens, renderBrief } from "./brief.js";
export { DEBOUNCE_MS, POLL_MS, startWatcher } from "./watcher.js";
export type { WatchMode, Watcher, WatcherOptions } from "./watcher.js";
export { resolvedNotes, toBacklogView, toSessionView } from "./views.js";
export type { BacklogView, Line, NoteLine, NoteRef, RemainingLine, SessionView } from "./views.js";
export { ApiError } from "./errors.js";
export type { ErrorBody } from "./errors.js";
