# P5 contracts — config keys, identities, CLI additions (frozen 2026-09-09)

## `.workledger/config.yaml` additions

```yaml
auto_commit: false            # false | on_checkpoint | on_session_end
private_paths: []             # repo-relative globs; a session whose cwd matches is private
identities_file: identities.yaml   # optional, relative to .workledger/
```

`auto_commit` behaviour: after a successful `checkpoint` (`on_checkpoint`) or at `SessionEnd`
(`on_session_end`), run `git add .workledger && git commit -q -m "workledger: checkpoint <n> for
<ulid>"` (or `"workledger: session <ulid> ended"`) in the repo. Never push. Skip silently, with one
stderr line prefixed `workledger:`, when the tree has a merge, rebase, or cherry-pick in progress,
when `.workledger/` has no changes, or when git is missing. Failures never change the hook's exit code.

`private_paths`: matched with picomatch semantics against the session's `cwd` relative to the repo
root; a match sets `private: true` at `SessionStart` (boundary record only, no brief, never a block).

## `.workledger/identities.yaml`

```yaml
schema_version: 1
identities:
  - { email: manas.hardas@gmail.com, name: Manas Hardas, dome_user: null }
```

Resolution: any `Actor` or `HumanStamp` whose `email` matches (case-insensitive) is displayed with the
mapped `name`; `dome_user` maps card edits back to an email in P6. Missing file: emails display as
before. The file is committed and shared.

## CLI additions

```
workledger init --teammate         # repo already enabled: confirm identity, skip hook writing, offer
                                   # backfill of this user's own sessions (P3), print "you are set"
workledger scan --all              # orphan scan across every enabled repo the index knows
workledger doctor                  # gains one row per enabled repo: path, open sessions, last hook
```

Exit codes unchanged. `init --teammate` in a repo that is not enabled exits 4 with "run `workledger
init` instead".
