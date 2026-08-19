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
# $3 is an optional note printed on the verdict line itself. A gate that ran a
# different measurement from the usual one must say so where the verdict is read,
# not in a flag nobody passes.
run() {
  printf '%-14s' "$1"
  if out=$(eval "$2" 2>&1); then echo "pass${3:+  $3}"
  else echo "FAIL${3:+  $3}"; echo "$out" | tail -25 | sed 's/^/    /'; fail=1; fi
}

# ---- the subject: which commit, and is it the one you have ------------------
# A check must state what it measured, and refuse when it cannot measure the
# thing it claims to. This is the fourth instance of one pattern in this
# repository — a check measuring the wrong subject while printing the same word
# a correct one prints. The stale baseline read on every run; `gates=FAILURE`
# treated as terminal, which merged a red gate (#30); an empty diff reading as
# green, which reported size-impl pass on a 450-line task against 400; and this
# one, a gate run before the commit it claimed to measure — ALL GATES PASS
# including size-total, then the commit landed and the true figure was 2746
# against a limit of 1700.
#
# The suite measures two different subjects: the WORKING TREE (lint, types,
# tests, cov-report) and the COMMITTED DIFF `$base...HEAD` (size-impl,
# size-total, diff-cov). While those agree the distinction is invisible. The
# moment they disagree the run reports on a state that exists nowhere, in the
# vocabulary of a run that measured something real.
#
# So: name the commit on every run, pass or fail, and refuse outright when the
# tree does not match it. The refusal exits before any other gate prints, on
# purpose — a verdict that could be about either of two trees is worse than no
# verdict, so no other verdict is offered.
#
# WHERE THE LINE IS DRAWN. "Files the gate measures" is everything git tracks or
# would track, minus two sets:
#
#   * package-lock.json, which the nolock pathspec below already excludes from
#     size-impl and size-total, and which vitest's coverage.include never
#     selects. Committing it moves no number this suite prints.
#   * anything .gitignore covers, as a rule and not as a list. An ignored path
#     cannot reach `$base...HEAD`, so it can move no number this suite prints —
#     that argument holds for whatever .gitignore happens to say, which is why
#     the set is deliberately not enumerated. An enumeration drifts from the file
#     it paraphrases and then describes a set that is not the set. git status
#     omits ignored files unless asked, so the rule needs no pathspec here.
#     Where ignoring and measuring meet is a path .gitignore covers that a commit
#     carries anyway — `git add -f`, or a re-include such as the
#     !prisma/migrations/**/*.sql rule. That is in the committed diff, so it is
#     measured, exactly like any other committed file.
#
# Everything else is measured, because size-total counts every added line of it:
# a dirty docs/ page, a dirty .claude/ prompt and a dirty backlog node each move
# a printed number. The narrower rule — refuse only for lib/ and tests/ — was
# rejected because it would have passed the exact defect that prompted this,
# scripts/gate.sh being neither.
#
# Untracked files count, listed with -uall so a new directory is named by its
# files rather than collapsed to a folder. An untracked file in a measured path
# is precisely a file the committed diff does not have and the next commit will.
#
# Every pathspec carries :(top) for the reason the size measurement does: run
# from a subtree without it, git status reports only that subtree and a dirty
# file elsewhere goes unseen — under-refusing is the direction that reproduces
# the defect.
#
# THE REF IS NAMED FROM symbolic-ref, NOT FROM rev-parse --abbrev-ref. On a
# detached HEAD the latter prints the literal string "HEAD" and exits 0, so a
# `|| echo detached` fallback after it is unreachable and the line reads
# "on HEAD" — a branch name no branch has. The fallback then fires only where
# git could not answer at all, asserting detachment about a repository the
# script could not read. Both halves are the failure this file exists to stop: a
# line stating a subject it did not measure. symbolic-ref fails on a detached
# HEAD and only then, so the three cases separate cleanly — on a branch, off a
# branch, and no readable HEAD, which is a different sentence from either.
base="${GATE_BASE:-origin/main}"
head_sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
if head_ref=$(git symbolic-ref --quiet --short HEAD 2>/dev/null); then :
elif git rev-parse --verify -q HEAD >/dev/null 2>&1; then head_ref="a detached HEAD"
else head_ref="an unreadable repository"; fi
printf '%-14s%s\n' "commit" "$head_sha on $head_ref, measured against $base"

# FAIL CLOSED WHEN THE MEASUREMENT CANNOT BE TAKEN. Discarding git's exit status
# here makes the whole refusal fail OPEN: any failure of this command yields the
# empty string, `-n` reads that as "clean tree", and the run proceeds to report
# on a tree it never looked at — the exact defect one level up. It does not
# self-rescue either, because rev-parse, `diff --quiet` and `diff --numstat` all
# read commits rather than the index and keep answering normally.
#
# The triggers are routine, not exotic: safe.directory refusing a checkout it
# does not own (containers, the self-hosted runner), an unreadable object store,
# a concurrent git holding a lock, a damaged index, a git too old for :(top)
# pathspec magic, and no repository at all. "The tree is dirty" and "the tree
# could not be read" are different facts and must not print the same word, so
# they get different messages — and git's own stderr is surfaced rather than
# swallowed, because `fatal: detected dubious ownership` is the line an operator
# acts on. stderr is captured separately from stdout: folded together, a mere
# warning on a successful run would be reported as an offending file.
#
# Both refusals sit ahead of the mode branch, so --summary gets them unchanged.
status_err=$(mktemp 2>/dev/null) || status_err=/dev/null
measured_dirty=$(git status --porcelain -uall -- \
                 ':(top)' ':(top,exclude)*package-lock.json' 2>"$status_err")
status_rc=$?
status_msg=$(cat "$status_err" 2>/dev/null)
[[ "$status_err" == /dev/null ]] || rm -f "$status_err"
if (( status_rc != 0 )); then
  printf '%-14s' "worktree"; echo "FAIL"
  echo "    could not read the working tree — git status exited $status_rc. Whether any"
  echo "    measured file is uncommitted is unknown here, and a check that cannot"
  echo "    measure what it claims to must refuse rather than assume the good case."
  echo "    git said:"
  echo "${status_msg:-(no message on stderr)}" | sed 's/^/        /'
  echo "    Fix the repository and re-run. Nothing was measured."
  echo "GATES FAILED — do not open a PR"
  exit 1
fi
if [[ -n "$measured_dirty" ]]; then
  printf '%-14s' "worktree"; echo "FAIL"
  echo "    working tree dirty — the gate measures the committed diff"
  echo "    ($base...HEAD, at $head_sha) and would report on a different state"
  echo "    than you have. Uncommitted changes in measured paths:"
  echo "$measured_dirty" | sed 's/^/        /'
  echo "    Commit or stash them and re-run. Nothing else was measured."
  echo "GATES FAILED — do not open a PR"
  exit 1
fi

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
# below the default to tighten its own budget — the value on the node is taken as
# written — but the default never rises by itself.
#
# Two ways to fail closed, both loud:
#   * a size_total that is not a positive integer, INCLUDING an empty value. A
#     key someone typed and left blank is a mistake, not a deliberate no-op, and
#     a typo must neither delete a budget nor silently fall back to the default.
#   * a size_total with no size_waiver_reason. The whole case for a per-task
#     waiver over a global raise is that it is reviewable, and a number with no
#     argument attached is exactly what a reviewer cannot evaluate. It costs one
#     line to explain; refusing to grant it unexplained is the point.
impl_budget=400
total_budget=2600
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
  # Reachable only past the refusal above, so whatever this counts is in a path
  # the gate does not measure — a lockfile, or nothing. Saying "files" flat
  # would read as the old number and invite the old inference.
  echo "changed:     $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') uncommitted file(s), none in a measured path"
  exit $fail
fi

# ---- full suite -------------------------------------------------------------
# THE GUARDS FIRST — the checks that check the checks. This line exists because
# of a fifth instance of the pattern the commit line above documents, and this
# time the check that measured the wrong thing was this file. The refusal above
# was added, `./scripts/gate.sh` printed ALL GATES PASS, and CI went red: every
# sandbox fixture in scripts/test-guards.sh was a bare directory rather than a
# git repository, so the refusal fired inside all ten budget probes and the
# whole guard suite was broken. The local gate calls itself the pre-PR verdict
# while not running a check CI runs, so "pass" here and "pass" there were
# answers to different questions — the same defect one level up.
#
# FULL MODE ONLY, and the reason is structural rather than a matter of speed
# (the suite takes about three seconds, which --summary could afford).
# test-guards.sh probes gate.sh by running it inside throwaway fixture
# repositories. From --summary — which the fixtures call — this line would
# re-enter the suite on every probe and would not terminate. The fixtures stub
# their own copy of test-guards.sh for the same reason, exactly as they already
# stub npx and npm: a sandbox built to observe one measurement proves nothing by
# re-running the whole suite inside itself. That stub is a file in a temporary
# copy of scripts/. There is no flag, and no environment variable, that turns
# this line off in a real checkout.
run "guards" "bash \"$here/test-guards.sh\""

run "lint"   "npx eslint ."
run "types"  "npx tsc --noEmit"
# ONE RUN SERVES THREE GATES, and this is the only place the suite executes.
# `tests` wants a verdict, `test-count` wants numTotalTests, and `cov-report`
# wants coverage/lcov.info — and a coverage run with the json reporter produces
# all three at once. Measured 2026-08-19 on 1323 tests: three separate runs cost
# about 330s, this one costs 123s. The extra 13s over a bare run is coverage
# instrumentation, which cov-report needed anyway.
#
# Every agent pays this too, not only the gate. It was three full suites per
# gate invocation, and a node runs the gate several times.
#
# The report is written to a file rather than /dev/stdout because vitest prints
# "JSON report written to ..." into the same stream, overwriting the head of its
# own JSON — survivable when a sed only needs a field near the end, and not
# something to keep relying on.
suite_report="$(mktemp -t opsmind-suite-XXXXXX.json)"
trap 'rm -f "$suite_report"' EXIT

# ---- WHICH tests: the pipeline's own suite runs when the pipeline changes ----
# tests/gates and tests/scaffold are the pipeline testing itself: 9 of 52 test
# files and 249 of 1350 tests, and those 9 include the cases that shell out and
# run this machinery for real. A product node pays for all of it on every run to
# re-prove something it cannot have broken. Wall-clock savings are deliberately
# not quoted here — three measurements of this change on a shared machine agreed
# on the direction and on no figure — so the file counts are the claim.
#
# So when the COMMITTED DIFF touches none of the paths below, tests/gates and
# tests/scaffold are skipped. The base is $base — the same one size-impl,
# size-total and diff-cov measure — rather than a second notion of "the diff"
# that could disagree with theirs.
#
# A PATH IS A TRIGGER IF CHANGING IT COULD CHANGE WHAT THESE TESTS SHOULD SAY.
# That is the whole rule, and the list below has twice been shorter than the
# rule. tests/gates and tests/scaffold are triggers for THEMSELVES: with only the
# machinery listed, a diff confined to tests/gates was scoped, so the one PR that
# changed those tests was the one PR that did not run them.
#
# THE SAME GAP, FOUND AGAIN, IS WHY package.json AND tsconfig.json ARE HERE.
# Three cases read the REAL repository at run time rather than a fixture:
# tests/scaffold/package-scripts.test.ts and toolchain.test.ts read package.json,
# and toolchain.test.ts reads tsconfig.json. A tsconfig.json-only diff was
# measured as scoped, which means switching `strict` off — making `npx tsc
# --noEmit` pass trivially on code that should fail — skipped the only test in
# the repository that would have caught it, and every gate printed pass.
#
# package-lock.json IS A TRIGGER TOO, and the argument is the transitive case.
# toolchain.test.ts checks what is INSTALLED under node_modules, not only what is
# declared, and node_modules is what `npm ci` builds from the lock: a lock-only
# change can move an installed version, which is exactly the drift those cases
# exist to catch. The cost objection — that a lockfile moves on every dependency
# bump — does not survive measurement. Of the three commits in this repository's
# whole history that touch package-lock.json, none touches it alone; a bump that
# edits the manifest already triggers on package.json, so the lock adds runs only
# in the transitive-only case, which is the case with no other check. n is 3, so
# re-measure rather than trust this if lock-only churn ever becomes routine.
#
# NOT EVERY FILE A CASE READS BELONGS HERE. vitest.config.ts is read by none of
# them — the references are comments and a fixture string. tests/baseline.json is
# deliberately excluded: tests/gates/suite-scope.test.ts asks the gate which key
# holds which floor instead of naming the keys, precisely so that editing a floor
# does not change what the test says, and making it a trigger would take the
# scoping away from nearly every node for nothing.
#
# THE RULE LIVES HERE AND NOT IN gates.yml, because CI runs this script: one rule
# in one file decides for both, and a selection rule in the workflow would let
# local and CI answer different questions (ADR-031, ADR-033).
#
# `guards` above is deliberately outside this: scripts/test-guards.sh is a
# separate gate and the first line of every full invocation, so every run still
# asks whether each gate blocks what it claims to. What a product node skips is
# the deeper logic checks, not the question of whether the gates work at all.
#
# IT FAILS CLOSED. Scoping requires the diff to have been READ and found clean of
# pipeline paths; an unreadable base, an unresolvable ref or any git failure runs
# the FULL suite and says why. "Nothing touched the pipeline" and "what it
# touched could not be determined" are different facts and must not skip the same
# tests. Accepted risk, recorded on the backlog node: a product change that trips
  # AND THE SHARPER FORM OF IT, which is not obvious from the list above: the
  # pipeline's own tests read REAL repository files and assert on their content.
  # tests/gates/stale-input.test.ts reads docs/architecture/decisions.md and
  # asserts ADR-031 states its rule and cites all four instances; size-impl-comments
  # reads ADR-035 and the size-impl row of PIPELINE.md. So a DOCS-ONLY change that
  # guts one of those runs no test that would notice.
  #
  # docs/ is deliberately NOT a trigger, and the number is why: it appears in 32%
  # of commits, so adding it flips about half of recent work to a full run and
  # hands back most of the saving. The failure it guards is a docs-only pull
  # request gutting an ADR the tests quote — visible in review of that same pull
  # request, and a loss of a cross-check on prose rather than on behaviour. High
  # cost, low probability, deliberately accepted.
  #
  # tests/kernel/kernel-source.ts IS a trigger, and the distinction is the point:
  # it is not prose the gate quotes, it is code the gate RUNS. size-impl.mjs
  # classifies every line of every diff through it, so a change mis-reading a
  # comment as code moves every size-impl verdict silently. 3% of commits, a
  # tenth of what docs/ costs. prisma/schema.prisma (6%) is the remaining
  # candidate and is recorded on the node rather than taken.
# an assumption inside tests/gates is not caught until a node touches a trigger.
suite_cmd="npx vitest run --coverage --reporter=json --outputFile=\"$suite_report\""
suite_mode="full"
baseline_key="tests"
if ! pipeline_diff=$(git diff --name-only "$base..." -- \
                     ':(top)scripts/' ':(top)eslint.config.mjs' \
                     ':(top)templates/' ':(top).github/workflows/' \
                     ':(top)tests/gates/' ':(top)tests/scaffold/' \
                     ':(top)package.json' ':(top)package-lock.json' \
                     ':(top)tsconfig.json' \
                     ':(top)tests/kernel/kernel-source.ts' 2>&1); then
  suite_why="the diff against $base could not be read, so what it touches is unknown"
elif [[ -n "$pipeline_diff" ]]; then
  suite_why="the diff touches $(echo "$pipeline_diff" | wc -l | tr -d ' ') pipeline file(s)"
else
  # The exclusion and the floor it will be graded against are chosen HERE, in one
  # branch, and nowhere else — see the ratchet below for why they may not part.
  suite_mode="scoped"
  baseline_key="tests_scoped"
  suite_cmd+=" --exclude 'tests/gates/**' --exclude 'tests/scaffold/**'"
  suite_why="tests/gates and tests/scaffold skipped; the diff touches neither the pipeline nor its own tests"
fi
run "tests"  "$suite_cmd" "[$suite_mode: $suite_why]"

# ---- test count: a ratchet, so the suite cannot quietly shrink ---------------
# Every other gate answers "did what ran pass". None answers "did everything
# still run". A file whose import breaks reports its neighbours green, a
# describe block lost in a merge resolution leaves no trace, and a refactor can
# drop cases without touching a line anyone reads. tests/baseline.json holds the
# floor; this fails on a DECREASE only, so adding tests never blocks anyone.
#
# The count is the runtime total, not a grep for `it(`. Static counting misses
# the failure this exists for — a file that still declares forty tests but no
# longer loads declares them to nobody — and it miscounts `it.each` tables,
# which expand at run time.
#
# A task that legitimately removes tests records `test_count_waiver` on its
# backlog node with a reason, resolved the same way and from the same committed
# file as size_total. A waived floor is printed with its reason; it is never
# silent.
#
# TWO FLOORS, ONE FOR EACH MODE, AND THE MODE PICKS THE KEY IT WAS GIVEN. A
# scoped run collects ~220 fewer tests, so grading it against "tests" is a false
# red, and grading a FULL run against "tests_scoped" is the far worse direction —
# a false green that would swallow the loss of two hundred tests without a word.
# $baseline_key is assigned exactly once, in the same branch that decides the
# vitest exclusion, and the floor is looked up BY that key: there is no path that
# runs one mode and grades the other, because there is nothing else to edit.
#
# Both keys are then required and "tests_scoped" must be strictly BELOW "tests" —
# the scoped run executes a strict subset of the files, so any other ordering
# means one key was edited without the other, or the two were swapped. That is
# refused rather than graded, because the shape it fails in is silent.
read_floor() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" tests/baseline.json 2>/dev/null | head -1
}
full_floor=$(read_floor tests)
scoped_floor=$(read_floor tests_scoped)
test_baseline=$(read_floor "$baseline_key")
if [[ -z "$full_floor" || -z "$scoped_floor" ]]; then
  printf '%-14s' "test-count"; echo "FAIL"
  echo "    tests/baseline.json needs a numeric \"tests\" AND \"tests_scoped\" (found: '$full_floor' / '$scoped_floor')"
  echo "    — the gate cannot grade the mode it ran, and refuses to skip the ratchet"
  fail=1
elif (( scoped_floor >= full_floor )); then
  printf '%-14s' "test-count"; echo "FAIL"
  echo "    \"tests_scoped\" is $scoped_floor and \"tests\" is $full_floor — the scoped run is a strict subset"
  echo "    of the full one, so a scoped floor at or above the full floor means one was edited"
  echo "    without the other. A full run graded against the lower number would pass a shrink."
  fail=1
else
  count_waiver=""
  if [[ -f tasks/backlog.yaml && "$size_branch" == task/* ]]; then
    if declared=$(from_backlog "${size_branch#task/}" test_count_waiver); then
      reason=$(from_backlog "${size_branch#task/}" test_count_waiver_reason)
      reason="${reason#"${reason%%[![:space:]]*}"}"; reason="${reason%"${reason##*[![:space:]]}"}"
      if [[ ! "$declared" =~ ^[0-9]+$ ]]; then
        printf '%-14s' "test-count"; echo "FAIL"
        echo "    test_count_waiver: '$declared' is not a number; refusing to guess a floor"
        fail=1; test_baseline=""
      elif [[ -z "$reason" ]]; then
        printf '%-14s' "test-count"; echo "FAIL"
        echo "    test_count_waiver=$declared with no test_count_waiver_reason — an unexplained"
        echo "    shrink is exactly what this gate exists to surface"
        fail=1; test_baseline=""
      else
        count_waiver="task '${size_branch#task/}' lowers the floor to $declared — $reason"
        test_baseline="$declared"
      fi
    fi
  fi
  if [[ -n "$test_baseline" ]]; then
    [[ -n "$count_waiver" ]] && printf '%-14s%s\n' "count-waiver" "$count_waiver"
    # Read from the one run above rather than executing the suite a second time.
    # A count taken from a different invocation than the pass/fail verdict is a
    # count of a different run — which is how test-count reported 1064 against a
    # floor of 1111 on a docs-only commit while a direct run measured 1111.
    actual=$(sed -n 's/.*"numTotalTests"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$suite_report" 2>/dev/null | head -1)
    #
    # AND THE FLOOR IS CHECKED AGAINST THE EVIDENCE, not against the flag the
    # gate handed vitest. The report names every test file it ran, so whether
    # tests/gates and tests/scaffold were in the run is a fact this file can
    # read — and the floor a run of that shape must be graded against follows
    # from it. Grading proceeds only when the mode asked for, the mode the report
    # shows, and the floor in hand all agree. Both ways of getting this wrong are
    # therefore caught by a measurement rather than by care: an exclusion that
    # did not take effect (a glob typo, a vitest flag change) puts a FULL count
    # under the scoped floor, which is a shrink of two hundred tests reported as
    # a pass, and a mode paired with the wrong key puts a scoped count under the
    # full floor, which is a false red. Neither can print "pass".
    pipeline_files=$(grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]*/tests/(gates|scaffold)/[^"]*"' \
                     "$suite_report" 2>/dev/null | wc -l | tr -d ' ')
    if [[ -z "$actual" ]]; then
      printf '%-14s' "test-count"; echo "FAIL"
      echo "    could not read a test count from vitest — refusing to pass a gate that measured nothing"
      fail=1
    fi
    if (( pipeline_files > 0 )); then evidence_mode="full"; evidence_floor="$full_floor"
    else evidence_mode="scoped"; evidence_floor="$scoped_floor"; fi
    # A waiver lowers the floor on purpose, so only the MODE is checked under one.
    if [[ -z "$actual" ]]; then :
    elif [[ "$evidence_mode" != "$suite_mode" ]] ||
         [[ -z "$count_waiver" && "$test_baseline" != "$evidence_floor" ]]; then
      printf '%-14s' "test-count"; echo "FAIL"
      echo "    the report describes a $evidence_mode run ($pipeline_files pipeline test file(s) in it), which is"
      echo "    graded against $evidence_floor — but this gate ran as '$suite_mode' and is holding $actual against"
      echo "    \"$baseline_key\" = $test_baseline. The mode graded must be the mode that ran: a scoped count"
      echo "    under the full floor is a false red, and a full count under the scoped floor passes a shrink."
      fail=1; actual=""
    fi
    if [[ -z "$actual" ]]; then :
    elif (( actual < test_baseline )); then
      printf '%-14s' "test-count"; echo "FAIL"
      echo "    $actual tests, \"$baseline_key\" floor is $test_baseline — $((test_baseline - actual)) fewer than the base."
      echo "    If that is deliberate, record test_count_waiver on the task with a reason."
      fail=1
    else
      run "test-count" "true" "[$suite_mode: $actual against the \"$baseline_key\" floor of $test_baseline]"
      (( actual > test_baseline )) && echo "    bump \"$baseline_key\" in tests/baseline.json to $actual to keep the ratchet tight"
    fi
  fi
fi

printf '%-14s%s\n' "risk" "$risk  (from $risk_source)"
case "$risk" in
  money|compliance) cov=90 ;;
  low)              cov=70 ;;
  *)                cov=90 ;;
esac
# vitest is run for the REPORT only — no --coverage.thresholds.lines. The
# threshold it used to be given was a whole-repository one, and the repository
# is not what a task is answerable for; coverage-gate.sh measures the lines the
# task changed against $cov, and ratchets the total separately (ADR-030). The
# lcov parsing lives there rather than here because this file is long enough and
# it is the only part of the suite that has to read a report format.
# The suite already ran WITH coverage above, so this only confirms the report it
# was asked to produce actually exists. An absent or empty report is a failure
# here, never a pass — the two gates below read it.
run "cov-report" "test -s coverage/lcov.info || { echo 'coverage/lcov.info is absent or empty after the suite ran with --coverage'; false; }"
"$here/coverage-gate.sh" "$cov" || fail=1

# ---- size: diff against the PR base, never a maybe-missing local ref --------
# Two budgets, because one number cannot serve both jobs this gate has.
#
#   size-impl   400  — the real limit. Its purpose is to force a task to split,
#                      and an oversized task shows up in implementation lines.
#                      Never waived, in the whole history of this repository.
#   size-total  2600 — a backstop on the whole PR. Was 800, then 1500, and now
#                      five of fifteen substantive tasks had to waive it, every
#                      waiver was tests, generated DDL or prose, and none was
#                      implementation. A budget waived that often stops being
#                      read, and the reasons were growing longer than the diffs
#                      they excused (ADR-029).
#
# Tests are counted only against the total. Under a single 400 budget, thorough
# tests compete with implementation for the same allowance, and the cheapest way
# to pass is to write fewer of them — the gate would be paying an agent to skimp
# on exactly what CLAUDE.md calls non-negotiable. A bloated implementation still
# fails on size-impl regardless of how few tests accompany it.
#
# scripts/test-guards.sh is test code that happens to sit outside tests/: it
# does nothing but assert the guards still block what they claim to, and the
# full suite above runs it as a gate line. Counted as implementation it caused
# precisely the damage the split exists to prevent — gate-size-waiver measured
# 413 impl lines against the 400 limit with 276 of them guard probes, so the
# cheapest way to pass was to stop probing the guards, and a guard that has
# stopped firing is invisible until the day it mattered. The one file is named
# rather than scripts/ or a *test* pattern: gate.sh, check-boundaries.sh and
# the guards themselves are implementation and must stay measured, and a
# pattern would silently exempt whatever a later task happens to name. It is
# excluded from size-impl only; size-total still counts every one of its lines.
#
# Documentation is excluded from size-impl for the reason the split exists at
# all. CLAUDE.md requires a behaviour change and its documentation in the same
# PR, and the reviewer fails a PR that lets the docs drift from the code. If
# prose is charged to the code budget, then every task that correctly updates
# its spec pays for doing so out of the allowance meant to force a split, and
# the cheapest way to pass the gate becomes leaving the documentation alone —
# the same perverse incentive that tests/ and test-guards.sh were exempted to
# avoid, pointed at the one artifact the reviewer is instructed to check.
#
# The exclusion assumes markdown never carries executable content. That holds
# today: nothing in this repository extracts and runs fenced code blocks, and no
# tool treats a .md file as a source of behaviour. Should that ever change —
# literate tests, a doc-driven fixture, generated code committed inside a fence —
# markdown stops being prose the gate can safely stop measuring, and this
# exclusion has to be revisited rather than trusted.
#
# Generated migration SQL is excluded from size-impl for the reason the
# lockfile rule already states. `prisma/migrations/*/migration.sql` is the
# byte-for-byte output of `prisma migrate diff` over schema.prisma: nobody wrote
# it, nobody may hand-edit it without the next generate silently disagreeing,
# and it cannot be split across PRs because a migration is atomic. Reviewing it
# means reviewing the schema it came from, which IS counted. Charged to the code
# budget it doubled the apparent cost of every schema line — kernel-schema-base
# measured 450 against 400 with 224 lines of authored schema and 164 of DDL it
# had no choice about, and the only ways to pass were to split a schema below
# the entities its own assertions need or to delete explanatory comments.
#
# Unlike lockfiles this is excluded from size-impl ONLY. size-total still counts
# every line, so a migration that rewrites half the database is still visible as
# volume and still needs a reasoned waiver. The claim here is that generated DDL
# is not implementation, not that it is free.
#
# The exclusion is deliberately narrow: `prisma/migrations/**/*.sql` and nothing
# else. A .sql file anywhere else is hand-written — a view definition, a seed, a
# backfill script — and is implementation that must stay measured.
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
git rev-parse --verify -q "$base" >/dev/null || git fetch -q origin main 2>/dev/null || true
if git rev-parse --verify -q "$base" >/dev/null; then
  # An empty diff is not a pass. The size gates measure `$base...HEAD`, so a
  # branch with nothing committed measures zero and every budget reports green
  # having weighed nothing — which is exactly how a 450-line task once reported
  # size-impl pass against a 400 limit. "Nothing changed" and "nothing
  # committed" are different mistakes and must not print the same word.
  #
  # Checked with --quiet rather than the added-line count: a diff that only
  # deletes lines adds zero and is emphatically not empty.
  if git diff --quiet "$base..." 2>/dev/null; then
    printf '%-14s' "diff"; echo "FAIL"
    if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
      echo "    nothing is committed — $base...HEAD is empty while $(git status --porcelain | wc -l | tr -d ' ') file(s) sit uncommitted."
      echo "    Every gate below would measure an empty tree. Commit, then re-run."
    else
      echo "    the diff against $base is empty and the tree is clean — this task produced nothing."
      echo "    A task that changes nothing has not been done; it has been skipped."
    fi
    fail=1
  fi

  added() { git diff --numstat "$base..." -- ':(top)' "${nolock[@]}" "$@" 2>/dev/null | awk '{a+=$1} END {print a+0}'; }
  # docs/ covers the specification tree; *.md catches prose that lives beside
  # the code it describes — a module README is documentation wherever it sits.
  # Both are size-impl only: size-total below still counts every line.
  #
  # tasks/backlog.yaml is excluded for the same reason and by the same argument
  # (ADR-035, Ahmed 2026-08-17): it is task metadata, not authored source. A node
  # is a title, a dependency edge, a produces list, a set of assertions and the
  # reasoning behind them — the pipeline's own planning record, which every task
  # is required to keep current. Charged to a budget for reviewer cognitive load
  # ON CODE, it makes recording WHY a task exists compete with the code that task
  # writes, and the cheapest way to pass becomes a thinner node. That is the
  # ADR-026 argument about specification prose, pointed at the one document this
  # pipeline reads before every task it runs. size-total still counts every line
  # of it: a backlog rewrite is still a large diff to review.
  impl_paths=(':(top,exclude)docs/' ':(top,exclude)*.md'
              ':(top,exclude)prisma/migrations/**/*.sql'
              ':(top,exclude)tests/' ':(top,exclude)scripts/test-guards.sh'
              ':(top,exclude)tasks/backlog.yaml')
  total=$(added)

  # A COMMENT IS NOT IMPLEMENTATION (ADR-035). size-impl is the one measurement
  # that reads the added lines rather than counting them, because a comment-only
  # line and a blank line are not implementation and must not be charged to a
  # budget whose whole job is to force an oversized task to split. The 400 comes
  # from the SmartBear/Cisco study of reviewer cognitive load, and the same study
  # found that authors who ANNOTATE ship materially fewer defects — so charging
  # annotations to the code budget makes deleting them the cheapest path to
  # green, inverting the finding the number rests on. This is ADR-026 and
  # ADR-028's argument about the third artifact a reviewer reads.
  #
  # IT APPLIES TO EVERY SOURCE LANGUAGE THIS REPOSITORY WRITES: .ts, .tsx, .mjs,
  # .cjs, .js and .sh (Ahmed, 2026-08-17). The argument was never about
  # TypeScript — this file is shell, it carries more explanation than code, and
  # under a TypeScript-only rule the gate paid an agent to delete exactly that.
  #
  # The reading is the TypeScript compiler's, in scripts/size-impl.mjs, via the
  # reader in tests/kernel/kernel-source.ts — never a pattern match. A `//`
  # inside a string literal, a template literal or a JSX expression is code, and
  # only the parser knows the difference; a line scanner reading declarations
  # out of string literals is a mistake this repository has already made once.
  # JavaScript goes through that same reader under ts.ScriptKind.JS. Shell is the
  # one language with no compiler to ask, so size-impl.mjs classifies it itself,
  # against the shell grammar and not against a pattern: a `#` inside '…' or
  # "…", inside a heredoc body, in `${x#prefix}` or on a shebang line is code,
  # and the limits of that reader are listed above it rather than left to be
  # discovered. A line carrying code AND a trailing comment counts as code, in
  # full, in every one of these languages.
  #
  # Everything else is counted exactly as before, by --numstat, and size-total is
  # untouched — it still counts every line of every file, comments and blanks
  # included.
  #
  # It fails closed. If the script cannot run, cannot reach the reader, or
  # cannot classify a file, size-impl FAILS and prints why: a budget that
  # silently classified nothing would under-count, and under-counting is how an
  # oversized implementation gets through (ADR-031).
  if impl=$(node "$here/size-impl.mjs" --base "$base" -- ':(top)' "${nolock[@]}" \
                 "${impl_paths[@]}" 2>&1); then
    run "size-impl"  "test $impl -lt $impl_budget || { echo 'implementation is $impl added code lines, limit $impl_budget — split the task'; false; }"
  else
    printf '%-14s' "size-impl"; echo "FAIL"
    echo "$impl" | tail -25 | sed 's/^/    /'
    echo "    size-impl measured nothing and must not report a budget it did not weigh."
    fail=1
  fi
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
