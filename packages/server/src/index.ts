/**
 * Public surface of `@workledger/server` — the local read server of `docs/contracts/p2/api.md`.
 * Side effects live here and in `packages/cli`; `packages/core` stays pure (CLAUDE.md).
 */
export { LOOPBACK, createApp } from "./app.js";
export type { CreateAppOptions, RunningServer, ServerApp } from "./app.js";
export { RepoRegistry, repoId } from "./repos.js";
export type { Repo, RepoContext, RepoRegistryOptions, ServeMode } from "./repos.js";
export type { JobAcrossRepos, NoteAcrossRepos } from "./routes/repos.js";
export { EventBus } from "./events.js";
export type { LedgerEvent, Listener } from "./events.js";
export { DEFAULT_LIMIT, ReadModel, parseLimit } from "./read-model.js";
export type { BacklogQuery, NotesQuery, SessionQuery } from "./read-model.js";
export { LEDGER_DIR, ledgerPaths } from "./paths.js";
export type { LedgerPaths } from "./paths.js";
export { buildHealth, buildMachineHealth, configHarnesses, defaultHome } from "./health.js";
export type { DoctorEntry, Health, HealthEnv } from "./health.js";
export { briefMaxTokens, renderBrief } from "./brief.js";
export { IDENTITIES_FILE, identitiesFileName, listIdentities } from "./identities.js";
export type { Identity } from "./identities.js";
export { DEBOUNCE_MS, POLL_MS, startWatcher } from "./watcher.js";
export type { WatchMode, Watcher, WatcherOptions } from "./watcher.js";
export { resolvedNotes, toBacklogView, toSessionView } from "./views.js";
export type { BacklogView, Line, NoteLine, NoteRef, RemainingLine, SessionView } from "./views.js";
export { ApiError, toApiError } from "./errors.js";
export type { ErrorBody } from "./errors.js";
export { KeyedMutex } from "./mutex.js";
export { isOpError, opErrorDetails } from "./ops.js";
export { JOB_POLL_MS, startJobWatcher } from "./job-watcher.js";
export type { JobWatcher, JobWatcherOptions } from "./job-watcher.js";
export type {
  BackfillEstimate,
  BackfillInput,
  ExcerptSpan,
  ExtractEstimate,
  Job,
  JobOps,
  RepairInput,
  ScanSummary,
} from "./jobs.js";
export { onboardingRoutes } from "./routes/onboarding.js";
export type { OnboardingRouteDeps } from "./routes/onboarding.js";
export { ONBOARDING_METHODS, ONBOARDING_WINDOWS, isOnboardingRefusal } from "./onboarding.js";
export type {
  DiscoverResult,
  ExtractionEstimate,
  HistoryResult,
  HistoryWindow,
  InitInput,
  InitRepoResult,
  InitResult,
  OnboardingMethod,
  OnboardingOps,
  OnboardingRefusal,
  OnboardingRefusalCode,
  OnboardingStatus,
  OnboardingWindow,
  PlanInput,
  PlanResult,
  RepoCandidate,
  ResumeEstimate,
  RunInput,
  RunResult,
} from "./onboarding.js";
export {
  buildExcerpt,
  excerptCachePath,
  readCachedExcerpt,
  readSpan,
  renderTurns,
  writeCachedExcerpt,
} from "./excerpt.js";
export type { Excerpt, Turn } from "./excerpt.js";
export type {
  BacklogOps,
  EditPatch,
  ItemResult,
  MergeResult,
  OpContext,
  OpError,
  OpErrorCode,
  ResolveNoteResult,
  ResolvedNoteRef,
} from "./ops.js";
