# workledger

A local observer for coding-agent work. The agent that ran a session writes a short structured
digest at checkpoints (what was done, what remains, what it learned, what it needs from a human),
the ledger lives in the repo under `.workledger/`, and a small local UI is where humans review
sessions and edit what comes next. Everything carries provenance and is shared with a team through
git.

Status: design complete, no code yet.

- Spec: `docs/superpowers/specs/2026-09-09-workledger-design.md`
- Decision log: `docs/decision-log.md`
- Discovery research (2026-09-06, superseded direction but valid evidence): `plans/`
