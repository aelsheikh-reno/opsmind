#!/usr/bin/env bash
# The gates. Scripts, not judgements — none of them can be talked out of a
# verdict. Run locally before a PR and again in CI.
#
#   gate.sh            full suite
#   gate.sh --summary  fast checks only (used by the Stop hook)
#
# The current task's risk level is read from .task-current.yaml, written by
# /build-task. money and compliance tasks require the differential suite and a
# higher coverage floor; if the file is missing, the STRICTER path is taken —
# an unarmed gate must fail closed, not stay silent.
set -uo pipefail
mode="${1:-full}"
fail=0
run() {
  printf '%-14s' "$1"
  if out=$(eval "$2" 2>&1); then echo "pass"
  else echo "FAIL"; echo "$out" | tail -25 | sed 's/^/    /'; fail=1; fi
}

# ---- risk level -------------------------------------------------------------
# Locally, /build-task writes .task-current.yaml. In CI that file is never
# present — it is deliberately uncommitted — so before this fallback existed
# every PR read risk as "unknown" and took the strict path. That made the tag
# dead in CI (money and compliance routing, and the 70/90 coverage split, only
# worked on a developer's machine) and deadlocked phase 0 outright: the strict
# path demands tests/differential, which harness-differential builds, which
# depends on scaffold-project, which could not pass the strict path.
#
# So when the file is absent, resolve the task from the branch name and read
# its risk from tasks/backlog.yaml, which IS committed. Anything unresolved
# still falls through to "unknown" and the strict path — this makes the signal
# reachable, it does not lower any bar.
#
# A value written as a folded/literal block scalar (`key: >`) is joined back
# onto one line rather than reported as the bare indicator ">", which is what a
# first-line-only read would print. A truncated or indicator-only reason in the
# gate output is worse than none: it looks like the waiver was explained.
# Continuation lines are those indented deeper than the key; a blank line or
# any line at the key's indent or shallower ends the scalar.
#
# The exit status says whether the KEY was present, which is not the same
# question as whether the output is empty: `size_total:` with nothing after it
# must be reported as a malformed value, not as an absent one. Callers that only
# care about the value are unaffected — the two existing ones already test the
# output as well.
from_backlog() {
  awk -v id="$1" -v key="$2" '
    END { exit(found ? 0 : 1) }
    $0 == "- id: " id { inblock = 1; next }
    /^- id: / { inblock = 0 }
    inblock && $0 ~ "^[[:space:]]*" key ":" {
      found = 1; ind = match($0, /[^ ]/) - 1
      sub("^[[:space:]]*" key ":[[:space:]]*", ""); sub(/[[:space:]]*(#.*)?$/, "")
      gsub(/"/, "")
      if ($0 ~ /^[>|][-+]?[0-9]*$/) {
        folded = ""
        while ((getline nxt) > 0) {
          if (nxt ~ /^[[:space:]]*$/) break
          if (match(nxt, /[^ ]/) - 1 <= ind) break
          sub(/^[[:space:]]+/, "", nxt); sub(/[[:space:]]+$/, "", nxt)
          folded = (folded == "" ? nxt : folded " " nxt)
        }
        if (folded != "") print folded
        exit
      }
      if ($0 != "") { print; exit }
    }' tasks/backlog.yaml 2>/dev/null
}

risk="unknown"
diffmode=""
risk_source=".task-current.yaml"
if [[ -f .task-current.yaml ]]; then
  risk=$(grep -E '^\s*risk:' .task-current.yaml | head -1 | sed 's/.*risk:\s*//' | tr -d ' "') || risk="unknown"
  diffmode=$(grep -E '^\s*differential:' .task-current.yaml | head -1 | sed 's/.*differential:\s*//' | tr -d ' "')
elif [[ -f tasks/backlog.yaml ]]; then
  branch="${GITHUB_HEAD_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)}"
  if [[ "$branch" == task/* ]]; then
    task_id="${branch#task/}"
    if r=$(from_backlog "$task_id" risk) && [[ -n "$r" ]]; then
      risk="$r"
      diffmode=$(from_backlog "$task_id" differential)
      risk_source="tasks/backlog.yaml (task '$task_id' from branch)"
    else
      risk_source="branch 'task/$task_id' matches no backlog node — strict path"
    fi
  else
    risk_source="branch '$branch' is not a task/<id> branch — strict path"
  fi
fi

# ---- size budgets -----------------------------------------------------------
# Resolved before either mode branches, because both modes state them: a budget
# nobody can see is a budget nobody can check, and --summary is meant to say
# what the gate would enforce. The measurement itself stays in the size section.
#
# A task node may raise its OWN size-total budget by carrying `size_total:` with
# a `size_waiver_reason:`. The value is resolved from tasks/backlog.yaml and
# from nothing else — in particular never from .task-current.yaml. That file is
# gitignored and is never present in CI, so a waiver read from it would apply on
# a developer's machine and vanish in the PR: the two runs would disagree and
# the local one would be the liar. Reading only the committed backlog means a
# waiver is always in the diff a reviewer sees, on the task it belongs to, with
# its reason next to it. It is data on one task, not a loosening of the gate.
#
# size-impl's 400 is never overridable — nothing below assigns impl_budget. An
# oversized implementation is precisely what this gate exists to force a split
# on, and the waiver is justified only by test volume. A node may set size_total
# below 800 to tighten its own budget — the value on the node is taken as
# written — but the default never rises by itself.
#
# Two ways to fail closed, both loud:
#   * a size_total that is not a positive integer, INCLUDING an empty value. A
#     key someone typed and left blank is a mistake, not a deliberate no-op, and
#     a typo must neither delete a budget nor silently fall back to 800.
#   * a size_total with no size_waiver_reason. The whole case for a per-task
#     waiver over a global raise is that it is reviewable, and a number with no
#     argument attached is exactly what a reviewer cannot evaluate. It costs one
#     line to explain; refusing to grant it unexplained is the point.
impl_budget=400
total_budget=800
waiver_line=""
waiver_error=""
size_branch="${GITHUB_HEAD_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)}"
if [[ -f tasks/backlog.yaml && "$size_branch" == task/* ]]; then
  size_task="${size_branch#task/}"
  if declared=$(from_backlog "$size_task" size_total); then
    reason=$(from_backlog "$size_task" size_waiver_reason)
    # Trim before testing for blankness. A reason of "   " is not a reason, and
    # it is worse than a missing one: the budget is granted and the printed line
    # trails off after the em-dash looking as though an argument was recorded.
    # Whitespace-only therefore fails exactly as an absent key does.
    reason="${reason#"${reason%%[![:space:]]*}"}"
    reason="${reason%"${reason##*[![:space:]]}"}"
    if [[ ! "$declared" =~ ^[1-9][0-9]*$ ]]; then
      waiver_error="task '$size_task' has size_total: '$declared' — not a positive integer; refusing to guess a budget"
      fail=1
    elif [[ -z "$reason" ]]; then
      waiver_error="task '$size_task' sets size_total=$declared with no size_waiver_reason — an unexplained waiver is not reviewable; refusing to grant it"
      fail=1
    else
      total_budget="$declared"
      waiver_line="task '$size_task' sets size_total=$total_budget (tasks/backlog.yaml) — $reason"
    fi
  fi
fi
# Called by both modes, so an active or broken waiver is on the record whatever
# the size gate then does — it is never silent.
report_waiver() {
  if [[ -n "$waiver_error" ]]; then
    printf '%-14s' "size-waiver"; echo "FAIL"
    echo "    $waiver_error"
    echo "    Fix the node in tasks/backlog.yaml."
  elif [[ -n "$waiver_line" ]]; then
    printf '%-14s%s\n' "size-waiver" "$waiver_line"
  fi
}

# ---- fast checks (always) ---------------------------------------------------
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run "boundaries"  "\"$here/check-boundaries.sh\""

if [[ "$mode" == "--summary" ]]; then
  echo "risk level:  $risk  (from $risk_source)"
  report_waiver
  printf '%-14s%s\n' "size-impl" "$impl_budget"
  printf '%-14s%s\n' "size-total" "$total_budget"
  echo "changed:     $(git status --porcelain 2>/dev/null | wc -l) files"
  exit $fail
fi

# ---- full suite -------------------------------------------------------------
run "lint"   "npx eslint ."
run "types"  "npx tsc --noEmit"
run "tests"  "npx vitest run"

printf '%-14s%s\n' "risk" "$risk  (from $risk_source)"
case "$risk" in
  money|compliance) cov=90 ;;
  low)              cov=70 ;;
  *)                cov=90 ;;
esac
run "coverage" "npx vitest run --coverage --coverage.thresholds.lines=$cov"

# ---- size: diff against the PR base, never a maybe-missing local ref --------
# Two budgets, because one number cannot serve both jobs this gate has.
#
#   size-impl   400  — the real limit. Its purpose is to force a task to split,
#                      and an oversized task shows up in implementation lines.
#   size-total  800  — a backstop on the whole PR.
#
# Tests are counted only against the total. Under a single 400 budget, thorough
# tests compete with implementation for the same allowance, and the cheapest way
# to pass is to write fewer of them — the gate would be paying an agent to skimp
# on exactly what CLAUDE.md calls non-negotiable. A bloated implementation still
# fails on size-impl regardless of how few tests accompany it.
#
# scripts/test-guards.sh is test code that happens to sit outside tests/: it
# does nothing but assert the guards still block what they claim to, and
# gates.yml runs it as a step of its own. Counted as implementation it caused
# precisely the damage the split exists to prevent — gate-size-waiver measured
# 413 impl lines against the 400 limit with 276 of them guard probes, so the
# cheapest way to pass was to stop probing the guards, and a guard that has
# stopped firing is invisible until the day it mattered. The one file is named
# rather than scripts/ or a *test* pattern: gate.sh, check-boundaries.sh and
# the guards themselves are implementation and must stay measured, and a
# pattern would silently exempt whatever a later task happens to name. It is
# excluded from size-impl only; size-total still counts every one of its lines.
#
# Lockfiles are excluded from both: generated, not authored, unsplittable across
# PRs, and required by npm ci — counting them made phase 0 unpassable by any
# code change at all. The gate measures what a human has to review.
#
# Every pathspec carries :(top) so the measurement is relative to the repository
# root, not the shell's directory. Without it, running the gate from a subtree
# measures only that subtree and quietly reports a smaller diff — under-counting
# is the direction that lets an oversized task through.
#
# The budgets themselves are resolved further up, before either mode branches,
# so that --summary can state them too.
report_waiver
nolock=(':(top,exclude)*package-lock.json')
base="${GATE_BASE:-origin/main}"
git rev-parse --verify -q "$base" >/dev/null || git fetch -q origin main 2>/dev/null || true
if git rev-parse --verify -q "$base" >/dev/null; then
  added() { git diff --numstat "$base..." -- ':(top)' "${nolock[@]}" "$@" 2>/dev/null | awk '{a+=$1} END {print a+0}'; }
  impl=$(added ':(top,exclude)tests/' ':(top,exclude)scripts/test-guards.sh'); total=$(added)
  run "size-impl"  "test $impl -lt $impl_budget || { echo 'implementation is $impl added lines, limit $impl_budget — split the task'; false; }"
  run "size-total" "test $total -lt $total_budget || { echo 'whole diff is $total added lines, limit $total_budget — split the task'; false; }"
else
  printf '%-14s' "size"; echo "FAIL"; echo "    cannot resolve $base — refusing to skip the size gate"; fail=1
fi

# ---- differential: required for money and compliance, and when risk unknown -
# $diffmode was resolved alongside $risk, from whichever source supplied it.
if [[ "$risk" != "low" && "$diffmode" != "none" ]]; then
  if [[ -d tests/differential ]]; then
    run "differential" "npx vitest run tests/differential"
  else
    printf '%-14s' "differential"; echo "FAIL"
    echo "    risk '$risk' requires tests/differential and none exists"
    fail=1
  fi
fi

[[ $fail -eq 0 ]] && echo "ALL GATES PASS" || echo "GATES FAILED — do not open a PR"
exit $fail
