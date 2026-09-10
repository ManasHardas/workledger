/**
 * Public surface of `@workledger/api-client` — the `LedgerSource` contract
 * (`docs/contracts/p2/ledger-source.md`) and the one implementation P2 ships.
 *
 * `apps/web` imports the interface and `createSource` and nothing else; P6 adds `CardFSSource`
 * and later `CloudSyncSource` behind the same factory, which is why the app never names a class.
 *
 * The package is isomorphic: no Node built-in is imported anywhere under `src/`, enforced by the
 * `no-restricted-imports` fence in `eslint.config.js` — the same fence that keeps
 * `packages/core` pure.
 */
export { ApiClientError, READ_ONLY, readOnlyRejection } from "./errors.js";
export type { ErrorBody } from "./errors.js";
export {
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  backoffDelay,
  globalEventSource,
  subscribeSse,
  toLedgerEvent,
} from "./events.js";
export type {
  EventSourceCtor,
  EventSourceLike,
  MessageEventLike,
  SubscribeOptions,
} from "./events.js";
export { globalFetch, normalizeBaseUrl, queryString, toApiError } from "./http.js";
export type { FetchLike, HttpRequestInit, HttpResponse } from "./http.js";
export { LocalServerSource } from "./local-server-source.js";
export type { LocalServerSourceOptions } from "./local-server-source.js";
export type {
  Actor,
  BackfillEstimate,
  BackfillRequest,
  BacklogItem,
  BacklogStatus,
  BacklogView,
  DoctorEntry,
  EditPatch,
  Excerpt,
  ExtractEstimate,
  Harness,
  Health,
  Identity,
  Job,
  LedgerEvent,
  LedgerSource,
  Line,
  NoteBy,
  NoteLine,
  NoteRef,
  NoteType,
  ParsedSession,
  Priority,
  RemainingLine,
  ScanSummary,
  SessionFrontmatter,
  SessionQuery,
  SourceCapabilities,
  Turn,
  UnparsedLine,
  Verified,
} from "./types.js";

import type { LedgerSource } from "./types.js";
import type { LocalServerSourceOptions } from "./local-server-source.js";

import { ApiClientError } from "./errors.js";
import { LocalServerSource } from "./local-server-source.js";

/**
 * The factory `apps/web` calls. `kind` is a string rather than a class so that swapping a Dome
 * card in for the local server later is a one-word change in the app and no change at all in a
 * view (ledger-source.md).
 */
export function createSource(kind: "local", opts: LocalServerSourceOptions): LedgerSource {
  if (kind !== "local") {
    throw new ApiClientError("unknown-source", `unknown LedgerSource kind: ${String(kind)}`);
  }
  return new LocalServerSource(opts);
}
