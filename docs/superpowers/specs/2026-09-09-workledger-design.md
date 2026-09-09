# workledger — design spec

**Date:** 2026-09-09 · **Status:** draft for operator review · **Supersedes:** the direction in
`plans/ideation-workledger.md` (the operator pivoted on 2026-09-08; the research there remains
valid as evidence, its verdict does not govern this spec).

## 1. What this is

A local observer for coding-agent work. It watches sessions in Claude Code, Cursor, and Codex,
asks the agent itself to write a short structured digest at checkpoints during the session (what
was done, what remains, what it learned, what it needs from a human), files those digests and the
resulting backlog into the repo under `.workledger/`, and shows them in a small local web UI where
a human can edit the backlog. Everything carries provenance (which session, which checkpoint,
which person, which harness) and everything is shared with a team through git.

One sentence: **the agent reports its own work at checkpoints; the ledger lives in the repo; the
UI is where humans edit what comes next.**

### Goals

- Zero recurring cost: the digest is written by the harness the developer already pays for.
- Exact session boundaries via hooks; never infer them from file activity.
- A human can review a session's outcome in under a minute and edit the backlog in place.
- Every item is traceable to the checkpoint that produced it and to the transcript span behind it.
- A teammate who clones the repo gets the hooks; their sessions appear in the shared ledger on push.
- Local first; a later cloud mode is a sync of the same files, not a rewrite.

### Non-goals (v1)

- OpenCode support (no native deny-stop; deferred).
- Reading transcripts with a model during normal operation (only in backfill and crash repair).
- Cross-agent coordination, presence, or blocking of agent actions.
- Replacing an issue tracker; the backlog is a per-repo list, not a project-management system.
- Any server, account, or hosted component.

## 2. Decisions recorded from the design conversation

| # | Decision | Chosen |
|---|---|---|
| D1 | Ledger location | Inside every project repo, under `.workledger/` |
| D2 | Content mechanism | Digest with checkpoints, written by the session's own agent; not transcript extraction |
| D3 | Boundaries | Hooks (`SessionStart`, `Stop`, `SessionEnd`), plus an mtime scan for orphaned sessions |
| D4 | Backfill | Exactly one at onboarding, lookback chosen by the user, resume-based (headless resume of past sessions), transcript extraction only as an opt-in fallback |
| D5 | Crash recovery | Resume the crashed session headless and ask for a digest since the last checkpoint; extraction fallback if resume fails |
| D6 | Harnesses | Claude Code and Cursor first; Codex after its stop-hook semantics are verified; OpenCode deferred |
| D7 | Reconciliation | Checkpoints reference existing backlog ids; the open backlog is injected at every session start |
| D8 | Write path | Agent runs `workledger checkpoint` with a structured payload; the CLI validates, stamps provenance, and renders files. Agents never write ledger markdown directly |
| D9 | Notes | All four types in v1: discovery, decision, blocker, question |
| D10 | Hook scope | Project-level hook files committed to the repo, calling the CLI and silently no-op if it is absent |

## 3. Architecture

```
  Claude Code / Cursor / Codex
        │ hooks: SessionStart · Stop · SessionEnd
        ▼
  workledger hook <event>          (fast, stateless, exits in <100 ms unless it must deny a stop)
        │
        ├─ SessionStart → creates session record, injects brief (open backlog + last done)
        ├─ Stop         → threshold check; if due, deny with the checkpoint instruction
        └─ SessionEnd   → closes record; queues reconcile/repair if needed
        │
        ▼
  workledger checkpoint            (agent-invoked; validates payload, stamps provenance, renders files)
        │
        ▼
  <repo>/.workledger/              (the ledger: sessions/, backlog/, notes are inside sessions)
        │                           git-shared, one file per record, ULID names
        ▼
  workledger serve                 (local web UI + a small index; also runs the orphan scan,
        │                           backfill and repair jobs)
        ▼
  ~/.workledger/                   (local only: transcript offsets, excerpt cache, job state)
```

Components:

1. **CLI** (`workledger`): `init`, `hook <event>`, `checkpoint`, `brief`, `serve`, `backfill`,
   `repair`, `backlog <edit ops>`, `doctor`. Single install, invoked by hooks, by agents, and by the UI.
2. **Harness adapters**: one per harness, each knowing (a) how to read the hook payload,
   (b) how to deny a stop or inject a follow-up, (c) how to inject context at session start,
   (d) how to resume a session headless, (e) where the transcript lives and how to slice a byte range.
3. **Ledger**: files in the repo. The only durable store. Section 4.
4. **Local index and cache** (`~/.workledger/`): SQLite with per-session transcript offsets,
   checkpoint stamps, job queue, and an excerpt cache. Rebuildable from the ledger plus transcripts;
   never the source of truth.
5. **UI**: a local web app served by `workledger serve`. Section 8.
6. **Jobs**: backfill, repair, reconcile, orphan scan. Run by `serve`, or one-shot from the CLI.

## 4. Ledger data model

Directory layout in each enabled repo:

```
.workledger/
  config.yaml                 thresholds, harness settings, privacy defaults (committed)
  sessions/<ulid>.md          one per session; frontmatter + appended checkpoints
  backlog/<WL-id>.md          one per backlog item; frontmatter + body + history
  README.md                   two paragraphs explaining the directory to humans (generated once)
```

### 4.1 Session digest (`sessions/<ulid>.md`)

Frontmatter:

```yaml
id: 01J9…                     # ULID, assigned at SessionStart
harness: claude-code | cursor | codex
harness_session_id: "…"       # the harness's own id
repo: "github.com/org/repo"   # from git remote, else the directory name
branch: main
author: { name: "…", email: "…" }   # git config; Cursor's user_email overrides when present
started: 2026-09-09T14:02:11Z
ended: null | timestamp
end_reason: null | clean | clear | logout | crashed | unknown
status: open | ended | crashed | repaired
private: false
model: "…"                    # when the harness provides it
checkpoints:
  - { n: 1, at: "…", turns: 14, transcript_offset: 183220, trigger: turns|bytes|minutes|end|repair }
  - { n: 2, … }
```

Body, rendered by the CLI from checkpoint payloads (humans and agents do not edit this file
directly; the UI edits through the CLI):

```markdown
## Goal
- [cp 1] Make large uploads reliable without changing the synchronous API.

## Done
- [cp 2] Added retry to the upload client. files: src/upload.ts, src/upload.test.ts · commit: a1b2c3d · verified: tests-passed
- [cp 1] Reproduced the timeout with a 40 MB fixture. files: fixtures/big.bin · verified: not-verified

## Remaining
- [cp 2] → WL-01J9ABCDEFGHJKMNPQRSTVWXYZ (new) Add a size limit before upload; why: server rejects >50 MB with no message
- [cp 2] → WL-01J8ZZCDEFGHJKMNPQRSTVWXYZ (closes) Retry on 502 was the open item from Monday; why: the retry now covers it
- [cp 1] → WL-01J9ACCDEFGHJKMNPQRSTVWXYZ (new) Ask ops whether the 50 MB limit is configurable; why: the limit may be policy, not code; blocked_by: none

## Notes
- discovery [cp 1]: The upload service strips Content-Length on redirect; retries must re-stream.
- decision [cp 2] by human: Keep uploads synchronous for now; reason: async path needs the queue work first.
- blocker [cp 2]: Staging has no 50 MB fixture; cannot verify the limit path.
- question [cp 2]: Should partial uploads be resumable, or is restart acceptable?
```

(Example corrected 2026-09-09, amendment 2: full 26-character ULIDs, the Goal line carries
`[cp n]`, every Remaining line carries `; why:`. Done and Remaining are newest-first, Notes
chronological. The frozen forms live in `docs/contracts/p1/session-frontmatter.schema.json`
`x-body`.)

```

Every line carries `[cp n]`, which binds it to a checkpoint and therefore to a transcript span
(`checkpoints[n-1].transcript_offset` to `checkpoints[n].transcript_offset`).

### 4.2 Backlog item (`backlog/WL-<ulid>.md`)

```yaml
id: WL-01J9AB
title: Add a size limit before upload
status: proposed | accepted | in_progress | done | discarded
proposed_by: { harness: claude-code, session: 01J9…, checkpoint: 2, author: "…" }
confirmed_by: null | { name, email, at }        # a human accepted it; this is the trust tier
owner: null | { name, email }
priority: null | p1 | p2 | p3
rank: 0                                          # manual order within a status group; shared across the team
area: [upload]
blocked_by: []                                   # other WL ids
done_by: null | { session: 01J9…, checkpoint: 3 }
created: …
updated: …
history:
  - { at: "…", by: { name, email } | agent-session-id, op: create | edit | status | assign, diff: "…" }
```

Body: free markdown, initially the "why" line from the checkpoint. Human edits append to `history`.

### 4.3 Identity and ids

- Session ids and backlog ids are ULIDs generated locally; two machines never collide.
- Author is git `user.name`/`user.email` at the time of the hook, overridden by Cursor's
  `user_email` when present. There is no account system.
- `harness_session_id` is kept for resume and for provenance; it is never shown as an actor.

### 4.4 Validation rules (enforced by `workledger checkpoint`)

- `goal` is required at checkpoint 1; optional afterward.
- Each Done item needs at least one of `files` or `commit`, and a `verified` value from the enum.
- Each Remaining item is imperative, has a `why`, and is either `new` or references an existing
  `WL-` id with `updates` or `closes`. Unknown ids are rejected with the list of open ids.
- Each Note has a type from the enum; `decision` needs `by` and `reason`.
- Payload size cap (default 4 KB) and item caps (default 12 per section) to keep checkpoints short.
- Secret scan (gitleaks-style regex set) over every string; a match rejects the payload with the
  offending field named, never the value.

## 5. Session lifecycle and the checkpoint protocol

### 5.1 SessionStart

1. Hook receives `session_id`, `transcript_path`, `cwd`. If `cwd` is not inside an enabled repo
   (no `.workledger/`), exit 0 silently.
2. Create `sessions/<ulid>.md` with frontmatter, status `open`, checkpoint list empty. Record the
   transcript path and offset 0 in the local index.
3. If `private` is requested (env `WORKLEDGER_PRIVATE=1`, or the config's private path list matches),
   set `private: true` and skip everything else for this session.
4. Inject the brief (Section 7) as `additionalContext`, capped by `config.brief.max_tokens` (default 2,000).
5. Run the orphan scan (Section 5.5) opportunistically, bounded to 200 ms.

### 5.2 Stop (every turn)

1. Read the checkpoint stamps for this session from the index. Compute: bytes since last
   checkpoint (from `transcript_path` size), minutes since, turns since (a counter the hook
   increments on each Stop).
2. If none of the thresholds is crossed (defaults: 2,000,000 bytes, 20 minutes, 15 turns), exit 0.
3. Loop guard: if the last Stop for this session already denied and the digest file's mtime is newer
   than that denial, exit 0 (the checkpoint was written). If it denied and nothing was written,
   exit 0 as well and mark the checkpoint as `skipped` (never deny twice in a row).
4. Otherwise deny the stop with the checkpoint instruction (Section 5.3) as the reason. Record the
   denial time.

Harness specifics:
- **Claude Code**: return `hookSpecificOutput.permissionDecision: "deny"` with
  `permissionDecisionReason` set to the instruction. Claude continues, runs the command, stops again.
- **Cursor**: return `followup_message` with the instruction on the `stop` hook; Cursor's
  `loop_limit` is set to 2 in the committed hooks file.
- **Codex**: to be verified on day one against the live docs; if its stop hook cannot feed a reason
  back, Codex falls back to an `AGENTS.md` instruction plus `SessionEnd` repair and is marked
  "best effort" in the UI.

### 5.3 The checkpoint instruction

Fixed text, versioned in the CLI, roughly:

> Before stopping, record a checkpoint for this session. Run `workledger checkpoint` with a JSON
> payload on stdin containing: `goal` (only if this is the first checkpoint or the goal changed);
> `done`: items completed since the last checkpoint, each with `text`, `files`, optional `commit`,
> and `verified` ∈ {tests-passed, tests-failed, not-verified}; `remaining`: next actions, each
> with `text`, `why`, and either `new: true` or `ref: "WL-…"` with `rel: updates|closes`; `notes`:
> entries with `type` ∈ {discovery, decision, blocker, question}, `text`, and for decisions `by`
> and `reason`. Open backlog ids for this repo: WL-…, WL-…. Keep it short: only what is durable.
> Do not summarize the conversation.

The open-id list is included so reconciliation happens in the agent's context (D7).

### 5.4 `workledger checkpoint`

1. Parse and validate (Section 4.4). On failure, print errors to stderr and exit 1; the hook
   allows one retry on the next Stop, then marks the checkpoint `failed` and moves on.
2. Stamp provenance: session ulid, checkpoint number, current transcript offset and turn count,
   author, time, trigger.
3. Render: append to the session file; create or update backlog items (`new` → `proposed`;
   `updates` → body append and history entry; `closes` → status `done` with `done_by`).
4. Secret scan already ran in validation; a second scan runs on the rendered files before write.
5. Print a one-line acknowledgment (`checkpoint 2 recorded: 2 done, 3 remaining, 1 question`).

### 5.5 SessionEnd and orphans

- `SessionEnd`: set `ended`, `end_reason` (from the harness), status `ended`. If the last
  checkpoint is more than `config.stale_turns` (default 5) turns behind the transcript, flag
  `needs_repair: true`.
- **Orphan scan** (at SessionStart and every 5 minutes while `serve` runs): any session with
  status `open` whose transcript file has not grown for `config.orphan_minutes` (default 30) is
  marked `crashed` and queued for repair. This reads file sizes only, never content.

### 5.6 Repair (crash recovery)

1. Resume the session headless with the adapter (`claude -p --resume <id>` with `cwd` set to the
   repo and tools restricted to `Bash(workledger checkpoint*)`; Cursor and Codex equivalents).
2. Send the checkpoint instruction with `trigger: repair` and "since checkpoint n".
3. If resume fails (missing transcript, harness refuses), offer transcript extraction: slice the
   transcript from the last offset, filter to user/assistant/tool-result records, send to an API
   model with the same payload schema, show the estimated cost first, run only on explicit consent.
4. Status becomes `repaired`; the checkpoint is stamped `trigger: repair` or `trigger: extract`.

## 6. Backfill (once, at onboarding)

1. Enumerate sessions per enabled repo from the harness stores (Claude: `~/.claude/projects/<slug>/`;
   Cursor: transcript files when enabled; Codex: `~/.codex/sessions/`). Read only metadata:
   file mtimes, sizes, and the first record for `cwd`.
2. Show the user, per repo: sessions by lookback window (7, 14, 30 days, all), count, total size,
   and a time estimate (count × configured seconds per resume, default 45 s ÷ concurrency).
3. For each chosen session, run the repair path (Section 5.6) with `trigger: backfill`. Concurrency
   default 2; resumable; progress visible in the UI; cancel at any time keeps what's done.
4. Sessions that cannot be resumed are listed; extraction is offered per session with cost shown.
5. Backfilled sessions are marked `source: backfill` so the ledger distinguishes reconstructed
   digests from live ones.

## 7. The brief

Generated deterministically from the ledger, no model:

- Open backlog items (`proposed`, `accepted`, `in_progress`) for this repo, newest first, each as
  `WL-id · title · status · owner`.
- The last three Done items across sessions, with dates.
- Open `blocker` and `question` notes.
- Capped at `brief_max_tokens`; when over, drop `proposed` items first, then oldest.

Injected at SessionStart by default (`config.brief.inject`); the same text is available from
`workledger brief` and a "copy brief" button in the UI.

## 8. UI

`workledger serve` runs a local HTTP server on a random high port (printed and opened) and serves a
single-page app. Views:

- **Now**: sessions with status `open`, one card each: goal, elapsed, checkpoints so far, latest
  Done and Remaining. Cards update on file change (server-sent events from the file watcher over
  `.workledger/` and the index).
- **Ledger**: session cards over time; filters for repo, author, harness, date, status; full-text
  search over goals, items, and notes.
- **Next**: the backlog for a repo. List grouped by status. Inline title edit, body edit, status
  change, assign, priority, drag to reorder (stored as `priority` plus a `rank` field), merge two
  items (the merged item's history records both sources). Agent-proposed items render with a
  distinct marker until `confirmed_by` is set; "Accept" sets it in one keystroke.
- **Needs you**: open `question` and `blocker` notes across sessions, with a "resolve" action that
  appends a note with the human's answer and marks it resolved.
- **Provenance panel**: clicking any line opens the checkpoint's transcript span from the local
  cache (rendered as user/assistant turns, tool noise collapsed). If the transcript is gone, the
  panel says so; the ledger line still stands.
- **Jobs**: backfill and repair progress, failures, retry.
- **Health**: per harness, last hook seen, hook files present, CLI version, orphan count.

All edits go through the CLI, which writes files and appends history. The UI never writes files itself.

Keyboard: `j/k` to move, `e` edit, `a` accept, `d` done, `x` discard, `/` search, `?` help.

## 9. Team model

- Sharing is git. Each developer's hooks write only their own sessions; files are ULID-named so
  merges never conflict. Backlog edits by two people on the same item produce a normal git conflict
  in one small file, which is acceptable at v1.
- Committing: by default the CLI never stages, commits, or pushes; `.workledger/` changes show up
  in `git status` like any other edit. A config option `auto_commit: false | on_checkpoint |
  on_session_end` exists for teams that want it (commit only, never push); default off.
- Onboarding a teammate: clone (hook files present) → run an agent → the hook prints
  "workledger not installed: run X" once per day → install → `workledger init` detects the enabled
  repo, confirms identity, offers backfill of their own history.
- Private sessions leave a boundary record with no content, so a teammate sees that a session
  happened, not what it did.
- Later cloud mode: a sync service that mirrors `.workledger/` files and provides the Now view
  across machines. Out of scope for v1; the file format is the API.

## 10. Onboarding flow (`workledger init`)

1. Detect harnesses (binaries and stores) and git identity; print what was found.
2. List candidate repos from session stores with counts and last activity; pre-select active in the
   last 30 days; user edits the list.
3. For each enabled repo: create `.workledger/` with `config.yaml` and `README.md`; write
   project-level hook files (`.claude/settings.json` hooks block, `.cursor/hooks.json`, Codex
   equivalent), merging into existing files without removing other hooks; print a diff and ask before
   writing to a file that already exists.
4. Backfill choice per repo (Section 6), then start the jobs in the background.
5. One privacy screen (what is written where, how to mark a session private, that nothing leaves the
   machine).
6. Start `serve` and open the UI on the Ledger view with a single call to action.

`workledger doctor` re-runs the checks and reports missing hooks, stale CLI, or unreadable stores.

## 11. Security and privacy

- Nothing leaves the machine in v1. No telemetry.
- Transcript spans live only in `~/.workledger/cache`, never in the repo.
- Every payload and every rendered file is secret-scanned before write; matches reject the write.
- Headless resume runs with tools restricted to the checkpoint command and `cwd` pinned to the repo.
- Hook files committed to the repo call the CLI by name; they contain no secrets and no paths
  outside the repo.
- A session can be marked private; a repo can list private paths.

## 12. Error handling

- Hooks fail open: any exception exits 0 with a one-line stderr message, except the intended deny.
- A denied stop is never repeated back-to-back; a checkpoint that fails validation twice is marked
  `failed` and the session continues.
- Thresholds are per repo in `config.yaml`; a `WORKLEDGER_DISABLE=1` env var silences all hooks.
- If the transcript path is missing, the session is still recorded; provenance spans show "unavailable".
- Backfill and repair jobs are idempotent and resumable; a crashed `serve` loses no ledger data.

## 13. Testing

- **Fixtures**: real transcripts from this machine (Claude Code across the 12 versions present,
  Codex rollouts), scrubbed, checked in under `test/fixtures/`. Adapter tests read them.
- **Hook simulation**: a harness that feeds recorded hook payloads to `workledger hook` and asserts
  outputs (allow/deny, injected context, files written).
- **CLI**: unit tests for validation, rendering, id assignment, secret scan, brief generation with
  the token cap.
- **End to end**: a scripted headless Claude Code session in a temp repo that triggers a checkpoint,
  a simulated crash, and a repair; asserts the ledger files and history.
- **UI**: component tests for the backlog editor; one browser test for accept/edit/done.

## 14. Stack (decided 2026-09-09, DL-15)

Requirements that drove it: the UI must work on desktop web now and on mobile web and native later
without a rewrite; visual design will be produced in Figma and brought in through the Figma MCP
server; one language end to end; `npx` install; hooks must start in well under 100 ms.

TypeScript monorepo (pnpm workspaces):

| Package | Contents | Runtime constraint |
|---|---|---|
| `packages/core` | Ledger schema (zod), checkpoint validation, markdown rendering and parsing, brief generation, secret scan, id generation | Pure TypeScript, no Node-only APIs, so it runs in the CLI, the server, the web app, and a future React Native app |
| `packages/tokens` | Design tokens (W3C design-tokens JSON): color, spacing, type, radius; exported to a Tailwind preset and, later, a React Native theme | Single source of truth synced from Figma variables |
| `packages/api-client` | A `LedgerSource` interface (list sessions, get session, list backlog, edit backlog, subscribe to changes, jobs) with three implementations: `LocalServerSource` (HTTP + SSE to `packages/server`), `CardFSSource` (reads chunked ledger documents from Dome cardFS and writes edits back), and later `CloudSyncSource` | Isomorphic; the UI depends only on the interface, never on a server being present |
| `packages/cli` | `workledger` binary: `init`, `hook`, `checkpoint`, `brief`, `serve`, `backfill`, `repair`, `doctor`; harness adapters | Node; `better-sqlite3` for the local index; `gray-matter` for frontmatter |
| `packages/server` | Hono app: file watcher over `.workledger/`, index, jobs, REST plus server-sent events | Node; started by `workledger serve` |
| `apps/web` | React 19, Vite, Tailwind, shadcn/ui components built on the tokens; mobile-first responsive layouts; installable as a PWA; keyboard shortcuts on desktop only; hash-based routing; every asset bundled, no CDN or web-font requests | Browser; must also run inside an iframe in a secure context |
| `apps/card` | The Dome card target: a Vite entry that boots `dome-embedded-app-sdk` in exactly one file, resolves identity and `canWrite` from the SDK, selects `CardFSSource`, and renders `apps/web`'s screens; carries `manifest-card.json` and the cards-ci `release-build.yml` | Browser inside Dome (iOS, Android, web); built as a self-contained static bundle |
| `apps/mobile` (later) | Expo (React Native) app on the same `core`, `api-client`, and `tokens`; native components, not RN Web | Added when the cloud sync exists; not in v1 |

Rejected: an Expo universal app from day one (RN Web compromises a keyboard-dense desktop UI and
maps poorly to Figma-to-code tooling); Go for the CLI (single binary is attractive but splits the
language; revisit only if Node startup latency in hooks becomes a measured problem).

### 14.1 Design workflow (Figma MCP)

- The spec fixes views, data, and interactions; visuals are designed in Figma later.
- Components are built as small, token-driven shadcn/ui primitives so Figma design context maps
  onto them directly; every component gets a Code Connect file once its Figma counterpart exists.
- Figma variables are exported into `packages/tokens`; Tailwind reads the preset; nothing in
  `apps/web` hardcodes a color, spacing, or type value.
- Until designs exist, the web app uses the default token set and an unstyled-but-usable layout;
  the plan should schedule the Figma pass after the Ledger and Next views work end to end.

### 14.2 Dome card target

The same UI must be hostable as a card inside a Dome (the operator's client platform; constraints
verified in `~/Projects/dome_workspace`). A card is a self-contained static web bundle in an
iframe, in a secure context, with identity from the Dome SDK (phone-based user, `owner`,
`canWrite`), data through cardFS (card-scoped document namespace, user-scoped authorization,
reads over 5 MB silently dropped) or any HTTPS API with permissive CORS, no server, no external
assets in `<head>`, released by pushing a `DomeHQ/*` repository's `release` branch through the
shared cards-ci workflow. What this adds to the design:

- **Publisher**: `workledger publish --target cardfs` renders the repo's `.workledger/` into
  chunked JSON documents (`ledger.json`, `ledger.2.json`, …, each measured under 5 MB, with a
  part count on the first) and writes them to the card instance's cardFS namespace. Run by a
  developer or by CI on push to `main`. The card reads parts in parallel and fails loudly on a
  missing part rather than showing a shrunken ledger.
- **Edits from the card**: backlog edits made in the card are written to cardFS as an
  `edits.json` append-only log with the Dome user as `by`; `workledger pull --from cardfs` on a
  developer machine replays them through the CLI into the repo files, so history stays one
  format. Live two-way sync is the cloud mode's job, not the card's.
- **Identity**: actors gain an optional `dome_user` id next to git name and email; `confirmed_by`
  and `history[].by` accept either. A repo-level `identities.yaml` maps Dome users to git emails
  when both are known.
- **Card behavior**: read-only when `canWrite` is false; no "Now" view (no live sessions reach
  a card until cloud mode exists); provenance panel shows "transcript on the developer's machine"
  instead of a span; hash routing so `openDeepLink` can target a session or item.
- **Repository and release**: `apps/card` lives in this monorepo and is mirrored by `git subtree
  split` into a `DomeHQ/card-workledger` repository that carries the Dome identity and CI secrets
  (created by the Dome founder, never by the assistant); release only by pushing that repo's
  `release` branch, and only after the founder confirms. The personal `manashardas/workledger`
  remote never sees Dome secrets.
- **Theme**: `packages/tokens` ships a `dome` theme sampled from Dome's palette (as the sibling
  cards do in `styles.css`) alongside the default theme.

### 14.3 Dogfooding

This repository enables workledger on itself as soon as the CLI can record a checkpoint
(milestone 1). Decisions from that point are recorded as `decision` notes in `.workledger/`
rather than in `docs/decision-log.md` (DL-14).

## 15. Milestones (for the plan)

1. CLI core: `init` (Claude Code only), `hook`, `checkpoint`, ledger rendering, brief. Dogfood in
   `dome_workspace` and this repo.
2. `serve` and the UI: Ledger, Next with editing, Needs you, provenance panel, behind the
   `LedgerSource` interface from the start.
3. Orphan scan, repair, backfill with the lookback selector.
4. Cursor adapter. 5. Codex adapter after verification. 6. Team polish: auto-commit option,
   teammate onboarding path, `doctor`.
7. Dome card: `CardFSSource`, `publish --target cardfs`, `pull --from cardfs`, `apps/card`,
   the `dome` theme, and the subtree mirror. 8. Figma pass over the web and card screens.

## 16. Open questions (not blocking the plan)

- Codex stop-hook semantics (verify on day one).
- Cursor transcript availability when `transcript_path` is disabled: the provenance panel degrades;
  checkpoints still work.
- Whether `rank` ordering in Next should be per-person or shared (v1: shared, stored in the item).
- Whether the brief should include the last session's Remaining even when those items were
  discarded (v1: no; discarded items never appear).
- Name: `workledger` is the working name; ids are `WL-`.
