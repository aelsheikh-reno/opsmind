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
risk="unknown"
if [[ -f .task-current.yaml ]]; then
  risk=$(grep -E '^\s*risk:' .task-current.yaml | head -1 | sed 's/.*risk:\s*//' | tr -d ' "') || risk="unknown"
fi

# ---- fast checks (always) ---------------------------------------------------
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run "boundaries"  "\"$here/check-boundaries.sh\""

if [[ "$mode" == "--summary" ]]; then
  echo "risk level:  $risk"
  echo "changed:     $(git status --porcelain 2>/dev/null | wc -l) files"
  exit $fail
fi

# ---- full suite -------------------------------------------------------------
run "lint"   "npx eslint ."
run "types"  "npx tsc --noEmit"
run "tests"  "npx vitest run"

case "$risk" in
  money|compliance) cov=90 ;;
  low)              cov=70 ;;
  *)                cov=90; echo "risk:         unknown (.task-current.yaml missing) — strict path" ;;
esac
run "coverage" "npx vitest run --coverage --coverage.thresholds.lines=$cov"

# ---- size: diff against the PR base, never a maybe-missing local ref --------
base="${GATE_BASE:-origin/main}"
git rev-parse --verify -q "$base" >/dev/null || git fetch -q origin main 2>/dev/null || true
if git rev-parse --verify -q "$base" >/dev/null; then
  run "size" "test \$(git diff --numstat $base... 2>/dev/null | awk '{a+=\$1} END {print a+0}') -lt 400"
else
  printf '%-14s' "size"; echo "FAIL"; echo "    cannot resolve $base — refusing to skip the size gate"; fail=1
fi

# ---- differential: required for money and compliance, and when risk unknown -
diffmode=$(grep -E '^\s*differential:' .task-current.yaml 2>/dev/null | head -1 | sed 's/.*differential:\s*//' | tr -d ' "')
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
