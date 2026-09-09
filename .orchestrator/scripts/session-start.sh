#!/usr/bin/env bash
# usage: ./scripts/session-start.sh
# Print the session-start checklist + current wave-state for orchestrator to read.
# This script is read-only — it does NOT mutate any state.
set -euo pipefail

# Resolve the project root from this script's own location, so the framework works
# both at a repo root and vendored into a subdirectory (e.g. .orchestrator/, the
# layout README.md §Adoption recommends). A plain `dirname "$0"/..` resolves to the
# framework directory when vendored, which is not where plans/** lives.
# Falls back to the parent directory outside a git repo.
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
_ROOT="$(git -C "$_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$_ROOT" ]] || _ROOT="$(cd "$_SCRIPT_DIR/.." && pwd)"
cd "$_ROOT"

WAVE_STATE="${WAVE_STATE:-plans/wave-state.md}"

cat <<'EOF'
==============================================================
SESSION-START RITUAL — orchestrator MUST execute these checks
==============================================================

1. Fetch + reset worktree to origin/main:
   $ git fetch origin main && git reset --hard origin/main
   (Verify clean status; ignore expected untracked artifacts)

2. Read the Session Handoff Document FIRST (pre-rendered playbook by
   PM at prior session-close; saves 65-95k vs legacy ritual):
EOF

NEXT_SESSION="${NEXT_SESSION:-plans/next-session.md}"

if [[ -f "$NEXT_SESSION" ]]; then
  echo "   $ cat $NEXT_SESSION"
  echo ""
  echo "------- $NEXT_SESSION -------"
  cat "$NEXT_SESSION"
  echo "------- end -------"
else
  echo "   $NEXT_SESSION not found. Falling back to authoritative state file:"
  echo ""
  if [[ -f "$WAVE_STATE" ]]; then
    echo "   $ cat $WAVE_STATE"
    echo ""
    echo "------- $WAVE_STATE -------"
    cat "$WAVE_STATE"
    echo "------- end -------"
    echo ""
    echo "   NOTE: Legacy session-start ritual applies (PM dispatch at session-start)."
    echo "   PM should generate $NEXT_SESSION at this session's close to enable SHD"
    echo "   protocol from next session onwards."
  else
    echo "   ERROR: Neither $NEXT_SESSION nor $WAVE_STATE found."
    echo "   Create from templates/ if this is a fresh project."
  fi
  echo ""
fi

cat <<'EOF'

3. Cross-reference required activities for current phase+wave from
   agents/orchestrator.md §Wave sequence:

   - Wave -1: (GREENFIELD ONLY, once per project) adversarial ideation
              per Clause #11. Wave 0 is BLOCKED until
              scripts/check-ideation-gate.sh exits 0.
   - Wave 0: orchestrator-only contract freeze + PM-D phase-sanity-check
             + tracking issue creation
   - Wave 0.5: 3 parallel build-agent dispatches (BE + FE + Infra)
               for issue decomposition
   - Wave 1: build loop dispatching per filed issue
   - Wave 2: QA agent
   - Wave 3: Phase close

4. Confirm session budget with user:
   - full window / ~half / tight / specific token estimate

5. Decide operating mode:

   ACTIVE (Stage-2 PM dispatched + filed-issue-derived briefs) is
   REQUIRED if ANY of:
   - New phase boundary (Wave 0)
   - New contract surface introduction
   - >1-issue scope synthesis required
   - Unresolved fix-cycle from prior session
   - First-of-class novel surface

   DEGRADED (PM-skip; orchestrator self-plans) is allowed ONLY when
   ALL of:
   - All planned slots are narrow-fix or sibling-shape
   - All issues filed before session start
   - No new contract artifacts
   - Last session closed cleanly

6. Confirm with user before proceeding if mode is contested.

==============================================================
EOF
