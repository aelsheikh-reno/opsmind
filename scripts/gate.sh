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
from_backlog() {
  awk -v id="$1" -v key="$2" '
    $0 == "- id: " id { inblock = 1; next }
    /^- id: / { inblock = 0 }
    inblock && $0 ~ "^[[:space:]]*" key ":" {
      sub("^[[:space:]]*" key ":[[:space:]]*", ""); sub(/[[:space:]]*(#.*)?$/, "")
      gsub(/"/, ""); if ($0 != "") { print; exit }
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

# ---- fast checks (always) ---------------------------------------------------
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run "boundaries"  "\"$here/check-boundaries.sh\""

if [[ "$mode" == "--summary" ]]; then
  echo "risk level:  $risk  (from $risk_source)"
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
# Lockfiles are excluded from both: generated, not authored, unsplittable across
# PRs, and required by npm ci — counting them made phase 0 unpassable by any
# code change at all. The gate measures what a human has to review.
#
# Every pathspec carries :(top) so the measurement is relative to the repository
# root, not the shell's directory. Without it, running the gate from a subtree
# measures only that subtree and quietly reports a smaller diff — under-counting
# is the direction that lets an oversized task through.
nolock=(':(top,exclude)*package-lock.json')
base="${GATE_BASE:-origin/main}"
git rev-parse --verify -q "$base" >/dev/null || git fetch -q origin main 2>/dev/null || true
if git rev-parse --verify -q "$base" >/dev/null; then
  added() { git diff --numstat "$base..." -- ':(top)' "${nolock[@]}" "$@" 2>/dev/null | awk '{a+=$1} END {print a+0}'; }
  impl=$(added ':(top,exclude)tests/'); total=$(added)
  run "size-impl"  "test $impl -lt 400  || { echo 'implementation is $impl added lines, limit 400 — split the task'; false; }"
  run "size-total" "test $total -lt 800 || { echo 'whole diff is $total added lines, limit 800 — split the task'; false; }"
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
