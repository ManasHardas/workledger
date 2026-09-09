# Scripts

Read-only helpers that print checklists for orchestrator + PM. They do NOT mutate state — actual file updates remain manual (orchestrator writes commits; PM appends entries).

| Script | Owner | Purpose |
|---|---|---|
| `session-start.sh` | Orchestrator | Print session-start checklist + cat current `plans/wave-state.md` |
| `session-close.sh` | PM | Print session-close protocol (what files to update, in what shape) |

## Enforcement scripts (not read-only in intent — they gate)

| Script | Owner | Gates | Exit codes |
|---|---|---|---|
| `check-session-close-guardrails.sh` | Orchestrator / PM | the chore-close commit, on 17 invariants | 0 clean · 1 BLOCKER · 2 WARN |
| `check-ideation-gate.sh` | Orchestrator | Wave 0 contract freeze, on greenfield projects only (Clause #11) | 0 gate open · 1 BLOCKER · 2 WARN |

Neither has a bypass. If a check is wrong, file an issue against the script.

`check-ideation-gate.sh` reads `plans/ideation-*.md` (or `--file <path>`) and checks it against
`templates/ideation-brief.md`'s structure: placeholder scan, questions asked *and* answered,
assumption dispositions, sourced evidence, ≥5 failure modes across ≥4 categories each with a
mechanism and a leading indicator, ≥3 evidenced reasons it works, falsifiable kill criteria, and a
verdict that states the strongest argument against itself.

**Its limitation, stated plainly:** every check is structural. It can confirm that five failure modes
exist with mechanisms attached; it cannot confirm they are *good* ones. A brief can satisfy all nine
checks and contain no genuine thought. The gate raises the floor and creates an artifact — it does
not certify quality, and treating a green gate as validation is the misuse it is most vulnerable to.

## Why the checklist printers are read-only

Mutating `plans/wave-state.md` from a script risks drifting from what the LLM agent actually believes. The discipline relies on PM reasoning through the update at session-close (Bayesian prior updates, calibration findings, etc.) — automating the file-write would skip that reasoning.

These scripts exist as printed reminders, not automation.

## Usage in a fresh project

After cloning this template into your project:

```bash
chmod +x scripts/*.sh

# Session-start — orchestrator runs this:
./scripts/session-start.sh

# Session-close — PM agent runs this (printed checklist; PM then dispatches to update files):
./scripts/session-close.sh
```
