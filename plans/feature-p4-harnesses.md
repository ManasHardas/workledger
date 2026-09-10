# Phase 4 — Cursor and Codex adapters

**Status:** Frozen pending Wave 0 (lean mode). **Tag:** `p4-shipped`.

**Strategic context.** P1–P3 are Claude Code only. P4 adds the two harnesses the design named
(D6): Codex first, because its hook surface is near-identical to Claude Code's (verified from the
live docs 2026-09-09: same event names, `stop_hook_active`, exit 2 + stderr to block,
`additionalContext` on SessionStart, `codex exec resume <id>` for headless resume); then Cursor
(`hooks.json`, `stop` with `followup_message`, `sessionStart` with `additional_context`,
`user_email`; no verified headless resume, so repair falls back to extraction). OpenCode stays
deferred. Contracts: `docs/contracts/p4/hooks-codex.md`, `docs/contracts/p4/hooks-cursor.md`.

## Sub-phase split

| Sub-phase | Scope | Sessions |
|---|---|---|
| P4a Codex | adapter, `init` writes `<repo>/.codex/hooks.json`, `doctor` row, `resumeHeadless`, fixtures, e2e | 0.5 |
| P4b Cursor | adapter, `init` writes `<repo>/.cursor/hooks.json`, `doctor` row, `user_email` as author, transcript path optional, repair via extraction only | 0.5 |

## Architecture

The `HarnessAdapter` interface from P1 (`parseHookInput`, `blockStop`, `injectContext`,
`transcriptSize`) plus P3's `resumeHeadless` gains two implementations. `hook <Event>` selects the
adapter from a `--harness` flag written into each harness's hook command (`workledger hook Stop
--harness codex`), defaulting to `claude-code`. Session rows already key on `(harness,
harness_session_id)`. `init` detects each installed harness and writes its hook file; `config.yaml`
`harnesses` lists the enabled ones; `doctor` reports each.

## Data model

No ledger changes: `harness` already admits `cursor` and `codex`; `author.email` for Cursor comes
from the hook's `user_email` when present, else git config.

## Wave 0.5 dispatch list

Backend (2): Codex adapter + init/doctor + fixtures + e2e behind `WORKLEDGER_E2E` (`codex exec`
in a temp repo with hooks trusted); Cursor adapter + init/doctor + fixtures (synthesized from the
contract; no e2e without the app installed, so the unit tests carry it) + repair path that routes
Cursor sessions to extraction with a clear message. QA (1): the Codex e2e in CI-skipped form and a
doctor run showing all three harnesses.

## Acceptance

- [ ] `workledger init` in a repo with Codex installed writes `.codex/hooks.json` matching the contract; a `codex exec` session in that repo records a checkpoint (e2e).
- [ ] `workledger init` writes `.cursor/hooks.json` matching the contract; unit tests drive the Cursor adapter with fixture payloads for every transition; `author.email` is the hook's `user_email`.
- [ ] `doctor` lists claude-code, codex, cursor with binary/store/hooks status.
- [ ] `repair` on a Cursor session says extraction is the only path and works with `--extract`.
- [ ] Tests and coverage gate green; the Claude Code hook allow path timing unchanged.

## Out of scope
OpenCode; per-harness UI; Cursor headless resume until its CLI is verified on this machine.
