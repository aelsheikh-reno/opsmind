#!/usr/bin/env bash
# The coverage gate. Two independent measurements, both of which fail closed.
#
#   diff-cov    the lines THIS TASK CHANGED, against the risk-derived floor
#   total-cov   whole-repository line coverage, against a stored baseline it
#               may not fall below — a ratchet, exactly like test-count
#
# Called by gate.sh with the floor as $1, after gate.sh has run vitest with
# --coverage to write coverage/lcov.info. The report parsing lives here rather
# than in gate.sh because gate.sh is already long and this is the only part of
# the suite that has to read a file format.
#
# WHY THE DENOMINATOR CHANGED (Ahmed, 2026-08-15 — ADR-030). The floor used to
# be handed straight to vitest as a whole-repository threshold:
# `--coverage.thresholds.lines=90`. 90 was calibrated against a repository that
# was almost entirely domain logic. It is now also six lib/kernel/*/repository.ts
# files of Prisma plumbing that no unit test can reach — no PostgreSQL is
# reachable outside CI — sitting between 0% and 15% and pinning the total at
# 79.2%. Under a global floor, module-deadlines-civil-date covered 100% of every
# line it wrote and failed anyway, on code it had never opened; two chore
# branches had to be given a backlog node purely to get through (#32, #37). A
# gate that fails a task for somebody else's untested file teaches an agent that
# the coverage number is noise, which is the opposite of what it is for.
#
# THE FLOOR IS NOT THE DEFECT AND DOES NOT MOVE. 90 for money and compliance,
# 70 for low, 90 when the risk is unknown. What changed is what it is a
# percentage OF.
#
# NO PATH IS EXCLUDED TO GET THERE. Excluding lib/kernel/*/repository.ts would
# have turned the number green in one line of vitest.config.ts, and it is the
# wrong line: repositories are what payroll and the money spine read through,
# and an excluded file is one nobody looks at again. Raising them is
# kernel-repository-integration-tests, a separate node with its own assertions.
#
# BOTH CHECKS ARE NEEDED, AND THEY ARE NOT THE SAME CHECK. Diff coverage alone
# lets the total rot one uncovered file at a time, every task green on its own
# lines. The ratchet alone is what was here before in a slower form. Together
# they say: what you wrote is covered, and the repository never gets worse.
set -uo pipefail

lcov="coverage/lcov.info"
baseline="tests/baseline.json"
base="${GATE_BASE:-origin/main}"
floor="${1:-}"
fail=0

pass_line() { printf '%-14s%s\n' "$1" "$2"; }
fail_gate() {
  local label="$1"; shift
  printf '%-14s%s\n' "$label" "FAIL"
  local line; for line in "$@"; do echo "    $line"; done
  fail=1
}
# Basis points — hundredths of a percent — everywhere below, so every
# comparison is between integers. Comparing bash-formatted floats is how a
# ratchet ends up flapping between 79.2 and 79.20 and being switched off.
pct() { printf '%d.%02d%%' $(( $1 / 100 )) $(( $1 % 100 )); }

# A floor this script cannot read is not a floor. gate.sh always passes one;
# anything else means this was invoked by hand or by a caller that changed.
if [[ ! "$floor" =~ ^[1-9][0-9]?$|^100$ ]]; then
  fail_gate "diff-cov" "no usable coverage floor was passed (got '$floor')" \
    "gate.sh passes 90 for money and compliance, 70 for low. Refusing to invent one."
  exit 1
fi

# A deliberate copy of gate.sh's backlog reader, not an import, so this script
# can be run standalone against a fixture repository — which is how
# tests/gates/coverage-gate.test.ts drives it. The two copies must keep the same
# behaviour: a folded block scalar (`key: >`) is joined back onto one line
# rather than reported as the bare indicator ">", because a truncated reason in
# the gate output looks like the waiver was explained when it was not. The exit
# status says whether the KEY was present, which is not the same question as
# whether the value is empty: `coverage_waiver:` with nothing after it is a
# malformed value, not an absent one.
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

# ---- the report -------------------------------------------------------------
# Absent, unreadable or empty are all the same verdict, and it is not "pass".
# A coverage gate that measured nothing must never print the same word as one
# that measured and passed — that is the whole failure mode of a gate that is
# quietly broken in CI for a month.
if [[ ! -r "$lcov" || ! -s "$lcov" ]]; then
  for label in diff-cov total-cov; do
    fail_gate "$label" \
      "no readable coverage report at $lcov — nothing was measured." \
      "vitest writes it via reporter 'lcov' into coverage/ (vitest.config.ts). Run" \
      "\`npx vitest run --coverage\` first; do not treat an absent report as a pass."
  done
  exit 1
fi

# ---- the diff ---------------------------------------------------------------
# $base...HEAD, the same three-dot base the size gates use, so both gates
# measure the same set of changes. --src-prefix/--dst-prefix are forced because
# a developer with diff.noprefix set would otherwise produce headers this parser
# cannot read, and unreadable headers would silently measure zero changed lines
# — the direction that lets an uncovered task through.
#
# The report reflects the WORKING TREE while the diff reflects HEAD. gate.sh
# already fails when nothing is committed, so on the path this runs on the two
# agree; run by hand over uncommitted edits, the line numbers can drift.
diff_file="$(mktemp)"
trap 'rm -f "$diff_file"' EXIT
base_ok=1
git rev-parse --verify -q "$base^{commit}" >/dev/null 2>&1 ||
  git fetch -q origin main 2>/dev/null || true
if git rev-parse --verify -q "$base^{commit}" >/dev/null 2>&1; then
  git diff --unified=0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ \
    "$base..." >"$diff_file" 2>/dev/null
else
  base_ok=0
fi

# One awk over both files. The lcov pass records every DA: (line, hits) it
# declares; the diff pass walks the added line numbers and asks the report
# about each one.
#
# An added line counts ONLY if lcov has a DA: record for it. Comments, type
# declarations, blank lines and import type statements are not executable, are
# not in the report, and must not be counted as uncovered — a task that adds
# forty lines of explanatory comment to a covered file would otherwise fail for
# documenting itself.
#
# `+++` is treated as a file header only when a `---` line came immediately
# before it. Under --unified=0 an added source line is a bare `+`, but a test
# fixture or a document containing diff text can begin `+++ b/…`, and reading
# that as a header would attribute the next hunk's lines to the wrong file.
measured=$(awk -v lcovfile="$lcov" -v root="$PWD/" '
  function ranges(list,   n, a, i, out, s, p) {
    n = split(list, a, " ")
    if (n == 0) return ""
    s = a[1]; p = a[1]
    for (i = 2; i <= n; i++) {
      if (a[i] == p + 1) { p = a[i]; continue }
      out = out (out == "" ? "" : ",") (s == p ? s : s "-" p); s = a[i]; p = a[i]
    }
    return out (out == "" ? "" : ",") (s == p ? s : s "-" p)
  }
  FILENAME == lcovfile {
    if ($0 ~ /^SF:/) { sf = substr($0, 4); sub("^" root, "", sf) }
    else if ($0 ~ /^DA:/) {
      split(substr($0, 4), d, ",")
      known[sf SUBSEP d[1]] = 1; hit[sf SUBSEP d[1]] = d[2] + 0
      total++; if (d[2] + 0 > 0) covered++
    }
    next
  }
  /^--- / { pending = 1; next }
  pending && /^\+\+\+ / {
    pending = 0
    path = ($0 ~ /^\+\+\+ b\//) ? substr($0, 7) : ""
    next
  }
  /^@@ / {
    pending = 0
    if (path != "" && match($0, /\+[0-9]+(,[0-9]+)?/)) {
      n = split(substr($0, RSTART + 1, RLENGTH - 1), h, ",")
      start = h[1] + 0; len = (n > 1 ? h[2] + 0 : 1)
      for (i = 0; i < len; i++) {
        ln = start + i; added++
        if (!((path SUBSEP ln) in known)) continue
        dtotal++
        if (hit[path SUBSEP ln] > 0) { dcovered++; continue }
        if (!(path in miss)) { order[++nf] = path }
        miss[path] = miss[path] " " ln
      }
    }
    next
  }
  { pending = 0 }
  END {
    printf "DIFF %d %d %d\n", dcovered + 0, dtotal + 0, added + 0
    printf "TOTAL %d %d\n", covered + 0, total + 0
    for (i = 1; i <= nf && i <= 12; i++) printf "MISS %s %s\n", order[i], ranges(miss[order[i]])
    if (nf > 12) printf "MORE %d\n", nf - 12
  }
' "$lcov" "$diff_file")

read -r _ diff_covered diff_total diff_added <<<"$(grep '^DIFF ' <<<"$measured")"
read -r _ total_covered total_lines <<<"$(grep '^TOTAL ' <<<"$measured")"

# ---- diff-cov ---------------------------------------------------------------
if (( base_ok == 0 )); then
  fail_gate "diff-cov" "cannot resolve $base, so the changed lines are unknown" \
    "Refusing to skip the gate: an unmeasurable diff is not a covered one."
elif (( diff_total == 0 )); then
  # Docs, a workflow, a backlog node, a test-only change, or an empty diff on a
  # clean main. Nothing executable changed, so there is nothing to cover — but
  # it is said out loud rather than printed as a bare "pass", because "measured
  # nothing" and "measured and passed" must never read the same.
  pass_line "diff-cov" "no coverable lines changed — $diff_added added line(s), none in the coverage report"
else
  diff_bp=$(( diff_covered * 10000 / diff_total ))
  if (( diff_bp < floor * 100 )); then
    fail_gate "diff-cov" \
      "$(pct "$diff_bp") of the $diff_total changed executable line(s) are covered; floor is ${floor}%" \
      "uncovered:"
    while read -r _ file lines; do echo "        $file:$lines"; done < <(grep '^MISS ' <<<"$measured")
    while read -r _ more; do echo "        … and $more more file(s)"; done < <(grep '^MORE ' <<<"$measured")
    echo "    Measured on the lines this task changed, not on the repository. Cover them,"
    echo "    or split the task until they are coverable."
  else
    pass_line "diff-cov" "$(pct "$diff_bp") of $diff_total changed line(s) — floor ${floor}%"
  fi
fi

# ---- total-cov: a ratchet, so the repository cannot rot under diff coverage --
# Diff coverage grades a task on its own lines and would happily let the total
# slide, one uncovered file at a time, each task green. This is the same shape
# as the test-count ratchet directly above it in gate.sh: the floor lives in
# tests/baseline.json, it fails on a DECREASE only, and a task that legitimately
# lowers it records `coverage_waiver` on its backlog node with a
# `coverage_waiver_reason`, resolved from the COMMITTED backlog and from nothing
# else so the waiver is always in the diff a reviewer reads.
#
# Stored in basis points for the reason pct() exists: 7920 is 79.20%, it is an
# integer, and no rounding rule has to be agreed between the writer and the
# reader of the file.
cov_baseline=$(sed -n 's/.*"coverage_bp"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$baseline" 2>/dev/null | head -1)
tree_cov="$cov_baseline"
if (( total_lines == 0 )); then
  fail_gate "total-cov" "$lcov declares no DA: records — it covers no lines at all" \
    "A report that measured nothing is a broken report, not a 0% one."
elif [[ -z "$cov_baseline" ]]; then
  fail_gate "total-cov" "$baseline is missing or has no numeric \"coverage_bp\" — refusing to skip the ratchet" \
    "Record the current total there in basis points (7920 means 79.20%)."
else
  waiver=""
  branch="${GITHUB_HEAD_REF:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)}"
  if [[ -f tasks/backlog.yaml && "$branch" == task/* ]]; then
    if declared=$(from_backlog "${branch#task/}" coverage_waiver); then
      reason=$(from_backlog "${branch#task/}" coverage_waiver_reason)
      # Trimmed before the blankness test. A reason of "   " is worse than an
      # absent one: the floor is lowered and the printed line trails off after
      # the em-dash looking as though an argument was recorded.
      reason="${reason#"${reason%%[![:space:]]*}"}"; reason="${reason%"${reason##*[![:space:]]}"}"
      if [[ ! "$declared" =~ ^[0-9]+$ ]]; then
        fail_gate "cov-waiver" "coverage_waiver: '$declared' is not a number; refusing to guess a floor"
        cov_baseline=""
      elif [[ -z "$reason" ]]; then
        fail_gate "cov-waiver" \
          "coverage_waiver=$declared with no coverage_waiver_reason — a repository that" \
          "covers less than it did yesterday is exactly what this gate exists to surface"
        cov_baseline=""
      else
        waiver="task '${branch#task/}' lowers the floor to $(pct "$declared") — $reason"
        cov_baseline="$declared"
      fi
    fi
  fi
  # THE STORED INTEGER IS PART OF THE RATCHET. Read from the working tree alone
  # it grades itself: a task lowers "coverage_bp", the percentage falls to meet
  # it, the waiver above never runs, no reason is recorded, and the gate prints
  # "coverage rose". So the base's copy is resolved too, and lowering the stored
  # value is treated exactly as an actual decrease — waiver with a reason, or
  # FAIL naming both numbers. Raising it, or leaving it alone, stays free.
  # An unresolvable $base is already a diff-cov failure. A base with no readable
  # baseline file is a broken ratchet and fails closed. A base file carrying no
  # "coverage_bp" is the commit that introduces the key, where there is no
  # earlier value to lower — and a WORKING TREE missing it already failed above.
  if [[ -n "$cov_baseline" ]] && (( base_ok == 1 )); then
    base_json=$(git show "$base:$baseline" 2>/dev/null)
    base_cov=$(sed -n 's/.*"coverage_bp"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' <<<"$base_json" | head -1)
    if [[ -z "$base_json" ]]; then
      fail_gate "total-cov" "$base has no readable $baseline — the ratchet has no base to hold against"
      cov_baseline=""
    elif [[ -n "$base_cov" && -z "$waiver" ]] && (( tree_cov < base_cov )); then
      fail_gate "total-cov" \
        "$baseline lowers \"coverage_bp\" from $(pct "$base_cov") at $base to $(pct "$tree_cov")" \
        "Lowering the stored baseline lowers the ratchet itself and skips the waiver entirely." \
        "Record coverage_waiver with a coverage_waiver_reason, as an actual decrease requires."
      cov_baseline=""
    fi
  fi
  if [[ -n "$cov_baseline" ]]; then
    [[ -n "$waiver" ]] && pass_line "cov-waiver" "$waiver"
    total_bp=$(( total_covered * 10000 / total_lines ))
    if (( total_bp < cov_baseline )); then
      fail_gate "total-cov" \
        "$(pct "$total_bp") total line coverage ($total_covered/$total_lines), baseline is $(pct "$cov_baseline")" \
        "The repository covers less than it did before this task. If that is deliberate," \
        "record coverage_waiver on the task in tasks/backlog.yaml with a reason."
    else
      pass_line "total-cov" "$(pct "$total_bp") ($total_covered/$total_lines) against a baseline of $(pct "$cov_baseline")"
      (( total_bp > cov_baseline )) &&
        echo "    coverage rose — bump \"coverage_bp\" to $total_bp in $baseline to keep the ratchet tight"
    fi
  fi
fi

exit $fail
