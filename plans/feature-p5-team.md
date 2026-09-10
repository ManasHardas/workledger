# Phase 5 — Team

**Status:** Frozen pending Wave 0 (lean mode). **Tag:** `p5-shipped`.

**Strategic context.** Everything so far works for one developer on one machine. P5 makes the
same ledger usable by a small team through git, per design spec §9 and §10: committed hook files
already install the behaviour on clone; P5 adds the missing pieces: an optional auto-commit, the
teammate onboarding path, private paths, identity mapping, `doctor` completeness, and the
`dome_workspace`-style multi-repo case (several enabled repos on one machine). No server, no sync.

## Scope (one session)

1. **`auto_commit`** (`config.yaml`: `false | on_checkpoint | on_session_end`): after a successful
   checkpoint or at SessionEnd, `git add .workledger && git commit -m "workledger: checkpoint <n> for <ulid>"`
   in the repo, never a push; failures are logged, never block the hook; skipped when the working
   tree has a rebase/merge in progress. Off by default.
2. **Teammate onboarding**: when a hook runs in an enabled repo and the binary is absent, the
   committed command is already a silent no-op; add `workledger init --teammate` that detects an
   already-enabled repo, confirms identity, skips hook writing, offers backfill of that person's
   own sessions, and prints the two-line "you are set" summary. `README.md` of `.workledger/`
   explains the clone path.
3. **Private paths**: `config.private_paths` (globs, repo-relative) mark a session private when
   its `cwd` matches; plus `WORKLEDGER_PRIVATE=1`; private sessions are boundary records only and
   are never blocked (P1 behaviour, now configurable per repo).
4. **`identities.yaml`** (repo-level, optional): maps emails to display names and, later, Dome
   user ids; `brief`, the UI, and the CLI resolve `owner` and `confirmed_by` display through it.
5. **Multi-repo index hygiene**: `doctor` lists every enabled repo the index knows, with open
   session counts; `workledger scan --all` runs the orphan scan across them.
6. **Conflict guidance**: `.workledger/README.md` documents that concurrent edits to one backlog
   item are ordinary git conflicts in one small file; `backlog merge` is the tool for duplicates.

## Contracts (direct commit)

`docs/contracts/p5/config.md` (new keys with defaults), `docs/contracts/p5/identities.md` (file shape:
`identities: [{ email, name, dome_user? }]`), `docs/contracts/p5/cli.md` (`init --teammate`,
`scan --all`, `doctor` multi-repo rows).

## Wave 0.5 dispatch list

Backend (2): auto_commit + private paths + identities resolution; `init --teammate` + multi-repo
doctor/scan + README text. Frontend (1): identity display in Next and Needs you (name from
identities, email tooltip). QA (0): covered by unit tests; the clone-path check is one integration
test in `packages/cli/test/teammate.test.ts` (clone a temp repo with hooks committed, run `init
--teammate`, run a hook, assert the row).

## Acceptance

- [ ] With `auto_commit: on_checkpoint`, a checkpoint produces exactly one commit touching only `.workledger/`; with `false`, none.
- [ ] Cloning an enabled repo and running `init --teammate` yields a working hook set without editing `.claude/settings.json`.
- [ ] A session started under a `private_paths` match writes a boundary record only and is never blocked.
- [ ] `identities.yaml` names appear in the UI and `brief`; missing file → emails as before.
- [ ] `doctor` and `scan --all` cover every enabled repo in the index.
