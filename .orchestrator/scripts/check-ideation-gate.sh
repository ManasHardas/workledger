#!/usr/bin/env bash
# Adversarial ideation gate — Clause #11 enforcement.
#
# Run by Orchestrator BEFORE Wave 0 contract-freeze on a greenfield project.
# Each check prints [OK] / [WARN] / [FAIL]; exit code summarizes:
#   0 = gate open — Wave 0 may begin
#   1 = BLOCKER — Wave 0 MUST NOT begin
#   2 = WARN only — gate open, acknowledge the warnings in the Wave 0 PR body
#
# Usage:
#   scripts/check-ideation-gate.sh                     # auto-detect plans/ideation-*.md
#   scripts/check-ideation-gate.sh --file plans/x.md   # explicit
#   scripts/check-ideation-gate.sh --verbose           # show what each check matched
#   scripts/check-ideation-gate.sh --no-color
#
# Source of truth: dispatch-templates/clause-11-adversarial-ideation.md
# Artifact template: templates/ideation-brief.md
#
# Background: everything downstream of Wave 0 optimizes for building the specified
# thing correctly. Nothing downstream checks whether it is worth building. This gate
# is the only cheap place to catch that class of error.

set -euo pipefail

# Resolve the project root from the script's own location, so this works both at the
# repo root and vendored under .orchestrator/. Falls back outside a git repo.
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
_ROOT="$(git -C "$_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$_ROOT" ]] || _ROOT="$(cd "$_SCRIPT_DIR/.." && pwd)"
cd "$_ROOT"

# ---------- args ----------
BRIEF=""
VERBOSE=0
USE_COLOR=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) shift; BRIEF="${1:-}"; shift ;;
    --file=*) BRIEF="${1#*=}"; shift ;;
    --verbose|-v) VERBOSE=1; shift ;;
    --no-color) USE_COLOR=0; shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# *//'; exit 0 ;;
    *) shift ;;
  esac
done

# ---------- color ----------
if [[ $USE_COLOR -eq 1 && -t 1 ]]; then
  C_OK="$(printf '\033[32m')"; C_WARN="$(printf '\033[33m')"
  C_FAIL="$(printf '\033[31m')"; C_DIM="$(printf '\033[2m')"
  C_BOLD="$(printf '\033[1m')"; C_RST="$(printf '\033[0m')"
else
  C_OK=""; C_WARN=""; C_FAIL=""; C_DIM=""; C_BOLD=""; C_RST=""
fi

declare -i OKS=0 WARNS=0 FAILS=0
ok()   { OKS+=1;   printf "  %s[OK]%s   %s\n" "$C_OK"   "$C_RST" "$1"; }
warn() { WARNS+=1; printf "  %s[WARN]%s %s\n" "$C_WARN" "$C_RST" "$1"; }
fail() { FAILS+=1; printf "  %s[FAIL]%s %s\n" "$C_FAIL" "$C_RST" "$1"; }
detail() { [[ $VERBOSE -eq 1 ]] && printf "       %s%s%s\n" "$C_DIM" "$1" "$C_RST" || true; }

# ---------- locate the brief ----------
if [[ -z "$BRIEF" ]]; then
  BRIEF=$(ls -1 plans/ideation-*.md 2>/dev/null | head -1 || true)
fi
if [[ -z "$BRIEF" || ! -f "$BRIEF" ]]; then
  printf "\n%sIdeation gate%s\n\n" "$C_BOLD" "$C_RST"
  printf "  %s[FAIL]%s 1. no ideation brief found at plans/ideation-*.md\n" "$C_FAIL" "$C_RST"
  printf "       %sseed one from templates/ideation-brief.md; see%s\n" "$C_DIM" "$C_RST"
  printf "       %sdispatch-templates/clause-11-adversarial-ideation.md%s\n\n" "$C_DIM" "$C_RST"
  printf "%sBLOCKER — Wave 0 must not begin.%s\n\n" "$C_FAIL" "$C_RST"
  exit 1
fi

printf "\n%sIdeation gate — %s%s\n\n" "$C_BOLD" "$BRIEF" "$C_RST"
printf "%sBLOCKER checks%s\n" "$C_BOLD" "$C_RST"

# section <heading-prefix> — emit the lines under a `## ` heading, up to the next `## `
section() { awk -v pat="$1" '$0 ~ "^## " pat {f=1; next} /^## /{f=0} f' "$BRIEF"; }
count()   { grep -cE "$1" <<<"${2:-}" || true; }

# 1. Placeholder scan
check_placeholders() {
  local hits
  hits=$(grep -nE '<[a-z][a-z -]*>|\bTBD\b|\bTODO\b|\bFIXME\b' "$BRIEF" \
         | grep -vE '^\s*[0-9]+:>' || true)
  local n; n=$(grep -c . <<<"$hits" || true); [[ -n "$hits" ]] || n=0
  if [[ "$n" -eq 0 ]]; then
    ok "1. placeholder scan — no unfilled <placeholder> / TBD / TODO"
  else
    fail "1. placeholder scan — ${n} unfilled placeholder(s) or TBD/TODO"
    detail "$(head -5 <<<"$hits")"
  fi
}

# 2. Open questions — >=3, every Q- has an A:
check_questions() {
  local body qs as
  body=$(section "Open questions")
  qs=$(count '\*\*Q-[0-9]+' "$body"); as=$(count '\*\*A:\*\*' "$body")
  if [[ "$qs" -lt 3 ]]; then
    fail "2. open questions — only ${qs} asked (minimum 3; Clause #11 Rule 1)"
  elif [[ "$as" -lt "$qs" ]]; then
    fail "2. open questions — ${qs} asked but only ${as} answered"
    detail "an unanswered question is an assumption in disguise"
  else
    ok "2. open questions — ${qs} asked, ${as} answered"
  fi
}

# 3. Assumption register — every UNVERIFIED row cites a KC-
check_assumptions() {
  local body rows unver unver_no_kc
  body=$(section "Assumption register")
  rows=$(count '^\| *A-[0-9]+' "$body")
  unver=$(grep -E '^\| *A-[0-9]+' <<<"$body" | grep -c 'UNVERIFIED' || true)
  unver_no_kc=$(grep -E '^\| *A-[0-9]+' <<<"$body" | grep 'UNVERIFIED' \
                | grep -cv 'KC-[0-9]' || true)
  if [[ "$rows" -eq 0 ]]; then
    fail "3. assumption register — no A- rows found"
  elif [[ "$unver_no_kc" -gt 0 ]]; then
    fail "3. assumption register — ${unver_no_kc} UNVERIFIED row(s) with no kill-criterion"
    detail "Clause #11 Rule 5: every unverified assumption maps to at least one KC-"
  else
    ok "3. assumption register — ${rows} row(s), ${unver} unverified, all mapped to kill criteria"
  fi
}

# 4. Evidence — >=3 rows, each with a URL or an explicit negative result
check_evidence() {
  local body rows sourced
  body=$(section "Evidence")
  rows=$(count '^\| *E-[0-9]+' "$body")
  sourced=$(grep -E '^\| *E-[0-9]+' <<<"$body" \
            | grep -cE 'https?://|no public data found|no data found' || true)
  if [[ "$rows" -lt 3 ]]; then
    fail "4. evidence — only ${rows} row(s) (minimum 3; Clause #11 Rule 3)"
  elif [[ "$sourced" -lt "$rows" ]]; then
    fail "4. evidence — ${rows} row(s) but only ${sourced} carry a source or a negative result"
    detail "a claim without a link, a date, and a method is a tell, not a show"
  else
    ok "4. evidence — ${rows} row(s), all sourced"
  fi
}

# 5. Case against — >=5 FM-, >=4 categories, each with mechanism + leading indicator
check_case_against() {
  local body fms mechs leads cats
  body=$(section "The case against")
  fms=$(count '^### FM-[0-9]+' "$body")
  mechs=$(count '^\*\*Mechanism:\*\*' "$body")
  leads=$(count '^\*\*Leading indicator:\*\*' "$body")
  cats=$(grep -oiE '\*(demand|distribution|technical|economic|competitive|dependency[a-z/-]*|regulatory|operator)\*' <<<"$body" \
         | tr 'A-Z' 'a-z' | sed 's#/.*##' | sort -u | grep -c . || true)
  if [[ "$fms" -lt 5 ]]; then
    fail "5. case against — only ${fms} failure mode(s) (minimum 5; Clause #11 Rule 4)"
  elif [[ "$cats" -lt 4 ]]; then
    fail "5. case against — ${fms} failure modes but only ${cats} distinct categorie(s) (minimum 4)"
    detail "five variations on one worry is one worry"
  elif [[ "$mechs" -lt "$fms" || "$leads" -lt "$fms" ]]; then
    fail "5. case against — ${fms} FMs but ${mechs} mechanism(s) / ${leads} leading indicator(s)"
    detail "generic risk-listing without a mechanism does not count as a failure mode"
  else
    ok "5. case against — ${fms} failure modes across ${cats} categories, all with mechanism + indicator"
  fi
}

# 6. Case for — >=3 FOR-, each with a mechanism
check_case_for() {
  local body fors mechs
  body=$(section "The case for")
  fors=$(count '^### FOR-[0-9]+' "$body")
  mechs=$(count '^\*\*Mechanism:\*\*' "$body")
  if [[ "$fors" -lt 3 ]]; then
    fail "6. case for — only ${fors} (minimum 3; the steel-man gets equal rigor)"
  elif [[ "$mechs" -lt "$fors" ]]; then
    fail "6. case for — ${fors} reason(s) but only ${mechs} mechanism(s)"
  else
    ok "6. case for — ${fors} reasons, all with mechanism"
  fi
}

# 7. Kill criteria — >=1, each falsifiable ("Stop if:" + a number)
check_kill_criteria() {
  local body kcs stops numeric
  body=$(section "Kill criteria")
  kcs=$(count '^### KC-[0-9]+' "$body")
  stops=$(count '^\*\*Stop if:\*\*' "$body")
  numeric=$(grep -E '^\*\*Stop if:\*\*' <<<"$body" | grep -cE '[0-9]' || true)
  if [[ "$kcs" -lt 1 ]]; then
    fail "7. kill criteria — none defined"
  elif [[ "$stops" -lt "$kcs" ]]; then
    fail "7. kill criteria — ${kcs} defined but only ${stops} state a 'Stop if:' threshold"
  elif [[ "$numeric" -lt "$kcs" ]]; then
    warn "7. kill criteria — ${kcs} defined, ${numeric} carry a number; the rest may not be measurable"
  else
    ok "7. kill criteria — ${kcs} defined, all with a measurable threshold"
  fi
}

# 8. Verdict — decided, and self-critiqued
check_verdict() {
  local body verdict counter
  body=$(section "Verdict")
  verdict=$(grep -oE '\b(GO|NO-GO|RESHAPE)\b' <<<"$body" | head -1 || true)
  # Substance test: the text after the label, minus any <placeholder>, must be real prose.
  # NB: the `|| true` is load-bearing. Without it, a brief with no `## Verdict` section at all
  # makes grep exit 1, and `set -euo pipefail` kills the script mid-run — so checks 8 and 9
  # silently never print. A missing section must FAIL loudly, not abort the gate.
  counter=$(grep -E 'Strongest argument against' <<<"$body" \
            | sed 's/.*://; s/<[^>]*>//g' | tr -d '[:space:]' | wc -c | tr -d ' ' || true)
  [[ -n "$counter" ]] || counter=0
  if [[ -z "$verdict" ]]; then
    fail "8. verdict — no GO / NO-GO / RESHAPE decision recorded"
  elif [[ "$counter" -lt 40 ]]; then
    fail "8. verdict — ${verdict} recorded but no strongest-argument-against stated"
    detail "a verdict that cannot argue against itself has not been tested"
  else
    ok "8. verdict — ${verdict}, with a stated counter-argument"
    # NB: must be a full `if`, not `[[ ]] && warn` — a false test as the function's
    # last statement returns 1 and `set -e` would kill the script mid-run.
    if [[ "$verdict" == "NO-GO" ]]; then
      warn "8b. verdict is NO-GO — the gate is open but Wave 0 should not begin"
    fi
  fi
}

# 9. Alternatives — >=4 ALT- rows (3 candidates + the specification), each with a distribution
#    answer. Clause #11 Rule 6: a session that never scored an alternative did half the job.
check_alternatives() {
  local body rows spec dist
  body=$(section "Alternatives considered")
  rows=$(count '^\| *ALT-[0-9]+' "$body")
  # ALT-0 is reserved for the specification itself, scored on identical terms.
  spec=$(count '^\| *ALT-0' "$body")
  # Every row must name a channel or explicitly admit it has none.
  dist=$(grep -E '^\| *ALT-[0-9]+' <<<"$body" | grep -ciE 'none|channel|market|outreach|search|community|directory|referral|listing|partner|content' || true)
  if [[ "$rows" -lt 4 ]]; then
    fail "9. alternatives — only ${rows} scored (minimum 4: the specification plus 3 candidates; Clause #11 Rule 6)"
    detail "a verdict reached without scoring an alternative is a preference, not a decision"
  elif [[ "$spec" -lt 1 ]]; then
    fail "9. alternatives — ${rows} scored but ALT-0 (the specification itself) is missing"
    detail "scoring the incumbent on identical terms is what stops 'different' meaning 'better'"
  elif [[ "$dist" -lt "$rows" ]]; then
    fail "9. alternatives — ${rows} scored but only ${dist} state a distribution answer"
    detail "a candidate with no channel must say so; distribution is where these die"
  else
    ok "9. alternatives — ${rows} scored including the specification, all with a distribution answer"
  fi
}

check_placeholders
check_questions
check_assumptions
check_evidence
check_case_against
check_case_for
check_kill_criteria
check_verdict
check_alternatives

# 10. Handoff — stack decision present (WARN: needed to fill agents/*.md placeholders)
printf "\n%sWARN checks%s\n" "$C_BOLD" "$C_RST"
if section "Handoff to Wave 0" | grep -qiE 'stack decision'; then
  ok "10. handoff — stack decision recorded"
else
  warn "10. handoff — no stack decision; agents/*.md placeholders stay unfilled"
fi

# ---------- result ----------
printf "\n%sResult:%s %d ok / %d warn / %d fail\n" \
       "$C_BOLD" "$C_RST" "$OKS" "$WARNS" "$FAILS"
if [[ "$FAILS" -gt 0 ]]; then
  printf "\n%sBLOCKER — Wave 0 must not begin. Fix the [FAIL] items and re-run.%s\n\n" "$C_FAIL" "$C_RST"
  exit 1
elif [[ "$WARNS" -gt 0 ]]; then
  printf "\n%sWARN — gate open. Acknowledge each warning in the Wave 0 PR body.%s\n\n" "$C_WARN" "$C_RST"
  exit 2
fi
printf "\n%sGate open — Wave 0 contract freeze may begin.%s\n\n" "$C_OK" "$C_RST"
exit 0
