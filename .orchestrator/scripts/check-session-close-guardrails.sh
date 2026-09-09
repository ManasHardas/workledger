#!/usr/bin/env bash
# Session-close guardrails — non-negotiable invariant checks.
#
# Run by Orchestrator/PM at session-close BEFORE drafting the close-chore commit.
# Each check prints [OK] / [WARN] / [FAIL] / [INFO]; exit code summarizes:
#   0 = all clean
#   1 = at least one BLOCKER fail (close MUST be paused)
#   2 = WARN only (close may proceed, document the warnings in the chore commit)
#
# Usage:
#   scripts/check-session-close-guardrails.sh                # auto-detect session
#   scripts/check-session-close-guardrails.sh --session 42   # explicit
#   scripts/check-session-close-guardrails.sh --verbose      # detail per check
#   scripts/check-session-close-guardrails.sh --no-gh        # skip GitHub API checks
#   scripts/check-session-close-guardrails.sh --no-color     # disable color output
#
# Cost: ~5s wall clock; ~200-300 tokens of output (without --verbose).
# Without --no-gh: adds ~3-5s and ~5-10k tokens for issue/branch network round-trips.
#
# Source of truth: agents/pm.md §Session close.
# Background: drift in non-negotiable spec invariants is invisible in normal
# development — agents follow stale memory, the spec keeps living in the doc.
# This script makes drift impossible to miss at close-time. Companion to
# scripts/session-close.sh (which prints WHAT to do; this verifies it was done).

set -euo pipefail

# Resolve the project root from this script's own location, so the framework works
# both at a repo root and vendored into a subdirectory (e.g. .orchestrator/, the
# layout README.md §Adoption recommends). A plain `dirname "$0"/..` resolves to the
# framework directory when vendored — every plans/** path below would miss, and the
# git invariant checks would run against the wrong tree.
# Falls back to the parent directory outside a git repo.
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
_ROOT="$(git -C "$_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$_ROOT" ]] || _ROOT="$(cd "$_SCRIPT_DIR/.." && pwd)"
cd "$_ROOT"

# ---------- args ----------
SESSION=""
VERBOSE=0
USE_GH=1
USE_COLOR=1
for arg in "$@"; do
  case "$arg" in
    --session) shift; SESSION="$1"; shift ;;
    --session=*) SESSION="${arg#*=}" ;;
    --verbose|-v) VERBOSE=1 ;;
    --no-gh) USE_GH=0 ;;
    --no-color) USE_COLOR=0 ;;
    -h|--help)
      sed -n '2,28p' "$0" | sed 's/^# *//'
      exit 0 ;;
  esac
done

# ---------- color ----------
if [[ $USE_COLOR -eq 1 && -t 1 ]]; then
  C_OK="$(printf '\033[32m')"; C_WARN="$(printf '\033[33m')"
  C_FAIL="$(printf '\033[31m')"; C_INFO="$(printf '\033[36m')"
  C_DIM="$(printf '\033[2m')"; C_BOLD="$(printf '\033[1m')"
  C_RST="$(printf '\033[0m')"
else
  C_OK=""; C_WARN=""; C_FAIL=""; C_INFO=""; C_DIM=""; C_BOLD=""; C_RST=""
fi

# ---------- counters ----------
declare -i OKS=0 WARNS=0 FAILS=0 INFOS=0
declare -a FAIL_DETAILS=() WARN_DETAILS=()

ok()   { OKS+=1;   printf "  %s[OK]%s   %s\n" "$C_OK"   "$C_RST" "$1"; }
warn() { WARNS+=1; printf "  %s[WARN]%s %s\n" "$C_WARN" "$C_RST" "$1"; WARN_DETAILS+=("$1"); }
fail() { FAILS+=1; printf "  %s[FAIL]%s %s\n" "$C_FAIL" "$C_RST" "$1"; FAIL_DETAILS+=("$1"); }
info() { INFOS+=1; printf "  %s[INFO]%s %s\n" "$C_INFO" "$C_RST" "$1"; }
detail() { [[ $VERBOSE -eq 1 ]] && printf "       %s%s%s\n" "$C_DIM" "$1" "$C_RST" || true; }

# ---------- detect session ----------
if [[ -z "$SESSION" ]]; then
  # Try wave-state.md "## Current state — YYYY-MM-DD (post-S<N>)"
  SESSION=$(grep -m1 -oE 'post-S[0-9]+' plans/wave-state.md 2>/dev/null \
            | head -1 | tr -d 'post-S' || true)
  # Fallback: latest chore: S<N> commit
  if [[ -z "$SESSION" ]]; then
    SESSION=$(git log --grep='^chore: S[0-9]' --pretty=format:'%s' \
              | head -1 | grep -oE 'S[0-9]+' | head -1 | tr -d 'S' || true)
  fi
  if [[ -z "$SESSION" ]]; then
    printf "%s[ERR]%s could not auto-detect session number; pass --session N\n" "$C_FAIL" "$C_RST"
    exit 1
  fi
fi
NEXT_SESSION=$((SESSION + 1))

# Resolve prior-session SHA — always the most recent chore: S<N> commit OTHER
# than the current session's. Range (PRIOR_SHA, HEAD] covers all merges in this
# session whether the chore-close exists yet or not.
PRIOR_SHA=$(git log --grep="^chore: S[0-9]" --pretty=format:'%H %s' \
            | grep -vE "^[0-9a-f]+ chore: S${SESSION}\b" \
            | head -1 | cut -d' ' -f1 || true)
if [[ -z "$PRIOR_SHA" ]]; then
  PRIOR_SHA="HEAD~30"  # generous fallback for the first session ever
fi

# ---------- header ----------
printf "\n%sSession-close guardrails — S%d%s%s (next: S%d)\n" \
       "$C_BOLD" "$SESSION" "$C_RST" \
       "" "$NEXT_SESSION"
printf "%sPrior SHA: %s%s\n\n" "$C_DIM" "$PRIOR_SHA" "$C_RST"

# ============================================================
# BLOCKER checks (exit 1 if any fail)
# ============================================================
printf "%sBLOCKER checks%s\n" "$C_BOLD" "$C_RST"

# 1. velocity.json — every merged PR this session has a pr_merge row
check_velocity_rollup() {
  if [[ ! -f plans/velocity.json ]]; then
    fail "1. velocity.json — file missing"; return
  fi
  # Exclude the chore-close commit itself — velocity.json only tracks build PRs.
  local merged_prs
  merged_prs=$(git log "${PRIOR_SHA}..HEAD" --pretty=format:'%s' \
               | grep -vE '^chore: S[0-9]' \
               | grep -oE '\(#[0-9]+\)$' \
               | grep -oE '[0-9]+' | sort -u || true)
  local merged_count
  merged_count=$(echo "$merged_prs" | grep -c . || true)
  local logged_prs
  logged_prs=$(jq -r --argjson s "$SESSION" \
               '.entries[] | select(.session==$s and .kind=="pr_merge") | .pr' \
               plans/velocity.json 2>/dev/null | sort -u || true)
  local logged_count
  logged_count=$(echo "$logged_prs" | grep -c . || true)
  if [[ "$merged_count" -eq 0 ]]; then
    info "1. velocity.json rollup — no PRs merged this session (planning/spec)"
    return
  fi
  if [[ "$merged_count" -le "$logged_count" ]]; then
    ok "1. velocity.json rollup — ${logged_count}/${merged_count} pr_merge rows present"
  else
    local missing
    missing=$(comm -23 <(echo "$merged_prs") <(echo "$logged_prs") | tr '\n' ' ')
    fail "1. velocity.json rollup — ${logged_count}/${merged_count} rows; missing PRs: ${missing}"
    detail "spec: agents/pm.md §Per-merge step 3 — append entry per PR (non-negotiable invariant)"
  fi
}
check_velocity_rollup

# 2. wave-state.md — current state block updated to this session
check_wave_state() {
  if [[ ! -f plans/wave-state.md ]]; then
    fail "2. wave-state.md — file missing"; return
  fi
  if grep -qE "post-S${SESSION}\b" plans/wave-state.md; then
    ok "2. wave-state.md — current state references post-S${SESSION}"
  else
    fail "2. wave-state.md — current state does not reference post-S${SESSION}"
    detail "expected: '## Current state — YYYY-MM-DD (post-S${SESSION})'"
  fi
}
check_wave_state

# 3. next-session.md (SHD) — exists and references S<N+1>
check_shd() {
  if [[ ! -f plans/next-session.md ]]; then
    fail "3. next-session.md — SHD missing for S${NEXT_SESSION}"
    detail "spec: agents/pm.md §SHD protocol — regenerate at every close"
    return
  fi
  if grep -qiE "session ?${NEXT_SESSION}|S${NEXT_SESSION}\b" plans/next-session.md; then
    ok "3. next-session.md — SHD present and references S${NEXT_SESSION}"
  else
    fail "3. next-session.md — SHD present but does not reference S${NEXT_SESSION}"
    detail "the SHD must be regenerated for the NEXT session, not the just-closed one"
  fi
}
check_shd

# 4. capacity-log.md — has an entry for this session
check_capacity_log() {
  if [[ ! -f plans/capacity-log.md ]]; then
    fail "4. capacity-log.md — file missing"; return
  fi
  if grep -qE "(^|[^0-9])S${SESSION}([^0-9]|$)|Session ${SESSION}\b" plans/capacity-log.md; then
    ok "4. capacity-log.md — has entry for S${SESSION}"
  else
    fail "4. capacity-log.md — no entry for S${SESSION}"
    detail "spec: agents/pm.md §Session close step 1"
  fi
}
check_capacity_log

# 5. Clean working tree (no uncommitted changes)
#    Exception list is project-specific — edit the grep below for files your
#    project legitimately leaves untracked (e.g. coverage outputs).
check_clean_tree() {
  local dirty
  dirty=$(git status --porcelain | grep -vE '^\?\? (\.coverage|coverage\.xml|.*\.coverage\..*)$' || true)
  if [[ -z "$dirty" ]]; then
    ok "5. clean working tree"
  else
    local count
    count=$(echo "$dirty" | wc -l | tr -d ' ')
    fail "5. dirty working tree — ${count} unstaged/uncommitted file(s)"
    detail "$(echo "$dirty" | head -5 | sed 's/^/         /')"
  fi
}
check_clean_tree

# 6. Clean worktrees (.worktrees/ empty; git worktree list count = 1)
check_worktrees() {
  local wt_count
  wt_count=$(git worktree list | wc -l | tr -d ' ')
  local stray=""
  if [[ -d .worktrees ]]; then
    stray=$(find .worktrees -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true)
  fi
  if [[ "$wt_count" -eq 1 && -z "$stray" ]]; then
    ok "6. clean worktrees — only main checkout present"
  else
    local items=""
    [[ "$wt_count" -gt 1 ]] && items+="git-worktree count=${wt_count} "
    [[ -n "$stray" ]] && items+=".worktrees/ has $(echo "$stray" | wc -l | tr -d ' ') subdir(s)"
    fail "6. stray worktrees — ${items}"
    detail "fix: git worktree remove .worktrees/<name>; git branch -D <branch>; gh api -X DELETE repos/.../git/refs/heads/<branch>"
  fi
}
check_worktrees

# 7. CC session id (or equivalent harness session id) on entries (project-defined gate-on threshold)
#    Set GUARDRAIL_CC_SESSION_GATE=<min_session> env var to activate this check
#    from a specific session number onward. Default: never gate (info only).
check_cc_session_id() {
  local gate="${GUARDRAIL_CC_SESSION_GATE:-99999}"
  if [[ "$SESSION" -lt "$gate" ]]; then
    info "7. cc_session_id — gate inactive (set GUARDRAIL_CC_SESSION_GATE=<N> to enforce from session N)"
    return
  fi
  if [[ ! -f plans/velocity.json ]]; then
    fail "7. cc_session_id — velocity.json missing"; return
  fi
  local total missing
  total=$(jq --argjson s "$SESSION" '[.entries[] | select(.session==$s)] | length' \
          plans/velocity.json 2>/dev/null || echo 0)
  missing=$(jq --argjson s "$SESSION" \
            '[.entries[] | select(.session==$s and (.cc_session_id == null or .cc_session_id == ""))] | length' \
            plans/velocity.json 2>/dev/null || echo 0)
  if [[ "$total" -eq 0 ]]; then
    info "7. cc_session_id — no entries for S${SESSION} yet"
  elif [[ "$missing" -eq 0 ]]; then
    ok "7. cc_session_id — present on all ${total} S${SESSION} entries"
  else
    fail "7. cc_session_id — missing on ${missing}/${total} S${SESSION} entries"
    detail "ask user at session-start; thread through every agent_dispatch + pr_merge row"
  fi
}
check_cc_session_id

# ============================================================
# WARN checks (exit 2 if any fail and no BLOCKER fired)
# ============================================================
printf "\n%sWARN checks%s\n" "$C_BOLD" "$C_RST"

# 8. Stale local branches matching merged PRs
check_stale_local_branches() {
  local heads
  heads=$(git for-each-ref --format='%(refname:short)' refs/heads/ \
          | grep -vE '^(main|master)$' || true)
  if [[ -z "$heads" ]]; then
    ok "8. local branches — only main present"
    return
  fi
  local count
  count=$(echo "$heads" | wc -l | tr -d ' ')
  warn "8. local branches — ${count} non-main branch(es) remain"
  detail "$(echo "$heads" | head -5 | sed 's/^/         /')"
  detail "fix: scripts/gc-branches.sh (or git branch -D <name>)"
}
check_stale_local_branches

# 9. Stale remote branches matching merged PRs (gh API)
check_stale_remote_branches() {
  if [[ $USE_GH -eq 0 ]] || ! command -v gh >/dev/null 2>&1; then
    info "9. remote branches — skipped (no --gh or gh not installed)"
    return
  fi
  local merged_prs
  merged_prs=$(git log "${PRIOR_SHA}..HEAD" --pretty=format:'%s' \
               | grep -vE '^chore: S[0-9]' \
               | grep -oE '\(#[0-9]+\)$' | grep -oE '[0-9]+' || true)
  if [[ -z "$merged_prs" ]]; then
    info "9. remote branches — no build PRs merged this session"
    return
  fi
  local stale=0 detail_lines=""
  while IFS= read -r pr; do
    [[ -z "$pr" ]] && continue
    local branch
    branch=$(gh pr view "$pr" --json headRefName -q '.headRefName' 2>/dev/null || true)
    [[ -z "$branch" ]] && continue
    if gh api "repos/{owner}/{repo}/branches/${branch}" >/dev/null 2>&1; then
      stale=$((stale + 1))
      detail_lines+="         PR #${pr} branch '${branch}' still on remote\n"
    fi
  done <<< "$merged_prs"
  if [[ "$stale" -eq 0 ]]; then
    ok "9. remote branches — all merged PR branches deleted"
  else
    warn "9. remote branches — ${stale} stale on remote"
    [[ -n "$detail_lines" && $VERBOSE -eq 1 ]] && printf "%b" "$detail_lines"
    detail "fix: gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/<branch>"
  fi
}
check_stale_remote_branches

# 10. Operating mode declared (ACTIVE / DEGRADED) — check the most recent
#     close-chore commit message OR the SHD for next session
check_operating_mode() {
  local close_subject
  close_subject=$(git log -1 --grep="^chore: S${SESSION}" --pretty=format:'%B' 2>/dev/null || true)
  local target=""
  if [[ -n "$close_subject" ]]; then
    target="$close_subject"
  elif [[ -f plans/next-session.md ]]; then
    target=$(cat plans/next-session.md)
  fi
  if echo "$target" | grep -qiE 'ACTIVE|DEGRADED'; then
    ok "10. operating mode — ACTIVE/DEGRADED declared"
  else
    warn "10. operating mode — not declared in close-commit or SHD"
    detail "operating mode (ACTIVE vs DEGRADED) MUST be documented at close — see CLAUDE.md.snippet"
  fi
}
check_operating_mode

# 11. Watchdog status declared (T-A / T-G / T-D)
check_watchdog_status() {
  local close_subject
  close_subject=$(git log -1 --grep="^chore: S${SESSION}" --pretty=format:'%B' 2>/dev/null || true)
  local target="${close_subject:-$(cat plans/next-session.md 2>/dev/null || true)}"
  local hits=0
  echo "$target" | grep -qiE "T${SESSION}-A|cumulative ceiling|ceiling" && hits=$((hits + 1))
  echo "$target" | grep -qiE "T${SESSION}-G|per-slot|watchdog trip" && hits=$((hits + 1))
  echo "$target" | grep -qiE "T${SESSION}-D|fix-cycle" && hits=$((hits + 1))
  if [[ "$hits" -ge 2 ]]; then
    ok "11. watchdog status — ${hits}/3 watchdogs mentioned (T-A/T-G/T-D)"
  else
    warn "11. watchdog status — only ${hits}/3 watchdogs mentioned in close-commit"
    detail "include T${SESSION}-A (cumulative), T${SESSION}-G (per-slot), T${SESSION}-D (fix-cycle) status"
  fi
}
check_watchdog_status

# 12. Issues with `Closes #N` from this session's PRs are actually closed
check_issue_closes() {
  if [[ $USE_GH -eq 0 ]] || ! command -v gh >/dev/null 2>&1; then
    info "12. issue closes — skipped (no --gh or gh not installed)"
    return
  fi
  local merged_prs
  merged_prs=$(git log "${PRIOR_SHA}..HEAD" --pretty=format:'%s' \
               | grep -vE '^chore: S[0-9]' \
               | grep -oE '\(#[0-9]+\)$' | grep -oE '[0-9]+' || true)
  if [[ -z "$merged_prs" ]]; then
    info "12. issue closes — no build PRs merged this session"
    return
  fi
  local total_issues=0 stale_issues=0 stale_list=""
  while IFS= read -r pr; do
    [[ -z "$pr" ]] && continue
    local body
    body=$(gh pr view "$pr" --json body -q '.body' 2>/dev/null || true)
    local issues
    issues=$(echo "$body" | grep -oE '^\s*Closes #[0-9]+' | grep -oE '[0-9]+' || true)
    while IFS= read -r issue; do
      [[ -z "$issue" ]] && continue
      total_issues=$((total_issues + 1))
      local state
      state=$(gh issue view "$issue" --json state -q '.state' 2>/dev/null || echo "?")
      if [[ "$state" != "CLOSED" ]]; then
        stale_issues=$((stale_issues + 1))
        stale_list+="#${issue} (PR #${pr}: ${state}) "
      fi
    done <<< "$issues"
  done <<< "$merged_prs"
  if [[ "$total_issues" -eq 0 ]]; then
    info "12. issue closes — no Closes #N keywords in this session's PRs"
  elif [[ "$stale_issues" -eq 0 ]]; then
    ok "12. issue closes — ${total_issues}/${total_issues} closed via PR keywords"
  else
    warn "12. issue closes — ${stale_issues}/${total_issues} still open: ${stale_list}"
    detail "GitHub auto-close requires 'Closes #N' on its own line per PR body — see dispatch-templates/close-keyword-convention.md"
  fi
}
check_issue_closes

# 18. main CI green at session-close (#235 — guardrails-script gap)
#     Reads origin/main HEAD's check-runs via `gh api`. WARN by default;
#     escalates to BLOCKER via GUARDRAIL_MAIN_CI_GATE=<min_session>. Special
#     cases: (a) all runs failed in <10s = INFO "billing-blocked" (don't
#     conflate with a real red); (b) no runs yet = INFO; (c) any non-success
#     conclusion = WARN/FAIL per the gate.
check_main_ci_green() {
  local gate="${GUARDRAIL_MAIN_CI_GATE:-99999}"
  if ! command -v gh >/dev/null 2>&1; then
    info "18. main CI — gh CLI not available; skipping"
    return
  fi
  local sha
  sha=$(git rev-parse origin/main 2>/dev/null || true)
  if [[ -z "$sha" ]]; then
    info "18. main CI — origin/main not resolvable; skipping"
    return
  fi
  local repo
  repo=$(gh repo view --json owner,name --jq '.owner.login + "/" + .name' 2>/dev/null || true)
  if [[ -z "$repo" ]]; then
    info "18. main CI — gh repo view failed; skipping"
    return
  fi
  # Fetch check-runs for origin/main HEAD. --paginate handles >100 runs.
  local raw
  raw=$(gh api "repos/${repo}/commits/${sha}/check-runs" --paginate 2>/dev/null || true)
  if [[ -z "$raw" ]]; then
    info "18. main CI — no check-runs returned for ${sha:0:7}"
    return
  fi
  local total_runs failure_runs success_runs neutral_runs sub_10s_failures
  total_runs=$(echo "$raw" | jq -s '[.[] | .check_runs[]] | length' 2>/dev/null || echo 0)
  failure_runs=$(echo "$raw" | jq -s '[.[] | .check_runs[] | select(.conclusion=="failure")] | length' 2>/dev/null || echo 0)
  success_runs=$(echo "$raw" | jq -s '[.[] | .check_runs[] | select(.conclusion=="success")] | length' 2>/dev/null || echo 0)
  neutral_runs=$(echo "$raw" | jq -s '[.[] | .check_runs[] | select(.conclusion=="neutral" or .conclusion=="skipped")] | length' 2>/dev/null || echo 0)
  # Sub-10s failures = billing-blocked signature (job exited before any
  # actual work — GitHub's "spending limit hit" annotation produces this
  # exact shape). Distinct from a real red CI signal.
  sub_10s_failures=$(echo "$raw" | jq -s '[.[] | .check_runs[]
    | select(.conclusion=="failure" and .started_at != null and .completed_at != null
        and ((.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601)) < 10)] | length' 2>/dev/null || echo 0)
  if [[ "$total_runs" -eq 0 ]]; then
    info "18. main CI — no check-runs at ${sha:0:7}"
    return
  fi
  if [[ "$failure_runs" -eq 0 ]]; then
    ok "18. main CI — ${success_runs}/${total_runs} runs green at ${sha:0:7} (${neutral_runs} neutral/skipped)"
    return
  fi
  if [[ "$sub_10s_failures" -gt 0 && "$sub_10s_failures" -eq "$failure_runs" ]]; then
    info "18. main CI — ${failure_runs}/${total_runs} runs failed in <10s at ${sha:0:7} (likely billing-block; check Actions billing)"
    return
  fi
  local failed_names
  failed_names=$(echo "$raw" | jq -rs '[.[] | .check_runs[] | select(.conclusion=="failure") | .name] | unique | join(",")' 2>/dev/null || echo "")
  if [[ "$SESSION" -ge "$gate" ]]; then
    fail "18. main CI — ${failure_runs}/${total_runs} red at ${sha:0:7}: ${failed_names}"
    detail "GUARDRAIL_MAIN_CI_GATE=${gate} active; close paused until main CI is green or runs are sub-10s billing-block"
  else
    warn "18. main CI — ${failure_runs}/${total_runs} red at ${sha:0:7}: ${failed_names}"
    detail "set GUARDRAIL_MAIN_CI_GATE=<min_session> to escalate to BLOCKER from session N"
  fi
}
check_main_ci_green

# 13. Phase tracking issue mention (informational; only enforced at phase ship)
check_phase_tracking_mention() {
  local close_subject
  close_subject=$(git log -1 --grep="^chore: S${SESSION}" --pretty=format:'%B' 2>/dev/null || true)
  local target="${close_subject:-$(cat plans/next-session.md 2>/dev/null || true)}"
  if echo "$target" | grep -qiE 'tracking issue|p[0-9]+ tracking|#[0-9]+ tracking'; then
    ok "13. phase tracking — mentioned in close-commit/SHD"
  else
    info "13. phase tracking — no mention (only required at phase ship)"
  fi
}
check_phase_tracking_mention

# ============================================================
# INFO checks (always exit 0; helpful context)
# ============================================================
printf "\n%sINFO checks%s\n" "$C_BOLD" "$C_RST"

# 14. Calibration findings count for this session
check_calibration_findings() {
  if [[ ! -f plans/wave-state.md ]]; then
    info "14. calibration findings — wave-state.md missing"
    return
  fi
  local findings
  findings=$(grep -ciE 'CALIBRATION (FINDING|VALIDATED|ADJUSTED)|first.datum|first.of.class' \
             plans/wave-state.md 2>/dev/null || echo 0)
  info "14. calibration findings — ${findings} mention(s) in wave-state.md (current + rolling window)"
}
check_calibration_findings

# 15. velocity.json entry count for this session
check_velocity_entry_count() {
  local count
  count=$(jq --argjson s "$SESSION" \
          '[.entries[] | select(.session==$s)] | length' \
          plans/velocity.json 2>/dev/null || echo 0)
  info "15. velocity.json — ${count} total entries for S${SESSION}"
}
check_velocity_entry_count

# ============================================================
# Summary + exit
# ============================================================
TOTAL=$((OKS + WARNS + FAILS + INFOS))
printf "\n%sResult:%s %d ok / %d warn / %d %sfail%s / %d info  (%d checks)\n" \
       "$C_BOLD" "$C_RST" "$OKS" "$WARNS" "$FAILS" \
       "$([[ $FAILS -gt 0 ]] && printf '%s' "$C_FAIL")" "$C_RST" \
       "$INFOS" "$TOTAL"

if [[ $FAILS -gt 0 ]]; then
  printf "\n%sBLOCKER — close paused.%s Fix the [FAIL] items above, re-run, then proceed.\n" \
         "$C_FAIL$C_BOLD" "$C_RST"
  exit 1
elif [[ $WARNS -gt 0 ]]; then
  printf "\n%sWARN — close may proceed.%s Document the warnings in the chore-close commit body.\n" \
         "$C_WARN$C_BOLD" "$C_RST"
  exit 2
else
  printf "\n%sCLEAN — guardrails satisfied.%s Proceed with the chore-close commit + PR.\n" \
         "$C_OK$C_BOLD" "$C_RST"
  exit 0
fi
