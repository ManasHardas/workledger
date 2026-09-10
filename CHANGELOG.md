# Changelog

## 0.1.0 — P2 Local UI (2026-09-09)

- `workledger serve`: local Hono server on loopback with a file watcher and server-sent events,
  serving the bundled web app (97 KB gzipped) from the same binary; REST per `docs/contracts/p2/api.md`.
- `workledger backlog accept|start|done|restore|discard|edit|assign|rank|merge|show|list` and
  `workledger note resolve`: every edit is a history entry by the git user; the server's POSTs call the
  same functions and produce byte-identical files.
- `packages/api-client`: the `LedgerSource` interface and `LocalServerSource` (isomorphic, SSE with
  backoff); `packages/tokens`: design tokens as the single source for the Tailwind preset.
- `apps/web`: Ledger (cards, filters, search, session detail with `[cp n]` provenance), Next (grouped
  backlog with inline edit, status actions, assign, priority, drag rank, merge, agent-proposed marker),
  Needs you (open blockers and questions with resolve), Health, keyboard help; hash routing, PWA, no
  external assets; mobile-first.
- End-to-end: Playwright over `serve` proves accept and rename from the UI land in the ledger and a
  second tab converges within 2 s.

## 0.0.1 — P1 CLI core (2026-09-09)

First working release, Claude Code only.

- `workledger init`: creates `.workledger/` and installs the three project-level hooks
  (`SessionStart`, `Stop`, `SessionEnd`) into `.claude/settings.json` additively, with a diff,
  a `.bak`, and a no-op when the binary is absent.
- `workledger hook`: exact session boundaries; the Stop hook asks the agent to checkpoint when
  2 MB of transcript, 20 minutes, or 15 turns have passed (block = exit 2 with the instruction),
  never twice for an ignored block, one retry for a rejected payload; `stop_hook_active` always
  allows; private sessions; fail-open on any error; allow path ~73 ms p95 including Node startup.
- `workledger checkpoint`: validates the agent's payload against the frozen contract, secret-scans
  it and the rendered text (40 linear-time patterns, findings never carry values), stamps
  provenance (`[cp n]`, transcript offset, cumulative turns), renders the session file and the
  backlog items, writes atomically, records failed attempts for the retry rule.
- `workledger brief`: deterministic session-start context (open backlog, last done, open blockers
  and questions) under a token cap; injected by `SessionStart`.
- `workledger doctor`: harness, store, hook, config, and index health.
- Ledger format frozen in `docs/contracts/p1/`; the zod schemas export it byte for byte.
- Published package is one bundled file with `better-sqlite3` as its only dependency.

Known limits: Claude Code only; no UI; no crash repair or backfill; `SessionEnd` in `claude -p`
mode reports `end_reason: unknown`.
