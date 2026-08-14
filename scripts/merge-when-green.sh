#!/usr/bin/env bash
# Merge a pull request, and refuse if its gates are not green.
#
# This exists because a red gate did not block a merge. On #30 the gates
# reported FAILURE, the polling loop that was watching them treated FAILURE as a
# terminal state to STOP WAITING ON, and the next command merged without
# re-reading anything. Terminal-and-failed and terminal-and-passed took the same
# code path. The guard fired by name and the process around it ignored the
# output — so the fix is not to poll more carefully, it is to make the merge
# itself read the verdict and refuse.
#
# There is no branch protection catching this server-side. This script is the
# only thing between a red gate and main, which is why it fails closed on
# anything it cannot read rather than assuming the best.
#
# Usage:  scripts/merge-when-green.sh <pr-number> [squash|merge|rebase]
# Exit:   0 merged · 1 refused (reports which state) · 2 could not read a verdict
#
# Testing seam: MERGE_VERDICT_JSON supplies the payload instead of calling gh,
# so every refusal path can be probed without a live pull request. It is only
# read when set, and scripts/test-guards.sh drives all of them.
set -uo pipefail

pr="${1:-}"
method="${2:-squash}"
if [[ -z "$pr" ]]; then
  echo "usage: $(basename "$0") <pr-number> [squash|merge|rebase]" >&2
  exit 2
fi

refuse() { echo "REFUSING TO MERGE #$pr: $1" >&2; exit 1; }
blind()  { echo "REFUSING TO MERGE #$pr: $1" >&2; exit 2; }

# Read the verdict NOW, not from whatever a caller was told earlier. Everything
# below depends on this being the fresh value.
if [[ -n "${MERGE_VERDICT_JSON:-}" ]]; then
  verdict="$MERGE_VERDICT_JSON"
else
  verdict=$(gh pr view "$pr" --json state,mergeStateStatus,statusCheckRollup 2>/dev/null)
  [[ $? -eq 0 && -n "$verdict" ]] || blind "could not read the pull request's status — failing closed"
fi

# jq is what gh ships with; without it we cannot judge, so we do not guess.
command -v jq >/dev/null 2>&1 || blind "jq is not available to parse the verdict — failing closed"

state=$(printf '%s' "$verdict" | jq -r '.state // empty' 2>/dev/null) \
  || blind "the verdict is not readable JSON — failing closed"
[[ -n "$state" ]] || blind "the verdict carries no state — failing closed"
[[ "$state" == "OPEN" ]] || refuse "the pull request is $state, not OPEN"

# A pull request with NO checks is not a passing pull request. Silence here has
# meant "nothing ran", never "nothing was wrong".
count=$(printf '%s' "$verdict" | jq -r '(.statusCheckRollup // []) | length')
[[ "$count" =~ ^[0-9]+$ ]] || blind "could not count the checks — failing closed"
(( count > 0 )) || refuse "no checks reported at all — a pull request with no gates has not passed them"

# SUCCESS is the only conclusion that permits a merge. Everything else is named
# rather than lumped together, because "it did not pass" and "it never ran" send
# a reader to different places.
not_green=$(printf '%s' "$verdict" | jq -r '
  (.statusCheckRollup // [])
  | map(select((.conclusion // .state // "PENDING") != "SUCCESS"))
  | map("\(.name // .context // "unnamed")=\(.conclusion // .state // "PENDING")")
  | join(", ")')

if [[ -n "$not_green" ]]; then
  refuse "checks are not green — $not_green"
fi

merge_state=$(printf '%s' "$verdict" | jq -r '.mergeStateStatus // "UNKNOWN"')
case "$merge_state" in
  CLEAN|HAS_HOOKS|UNSTABLE) ;;
  *) refuse "mergeStateStatus is $merge_state" ;;
esac

echo "verdict re-read immediately before merging: $count check(s), all SUCCESS, mergeStateStatus $merge_state"
[[ -n "${MERGE_VERDICT_JSON:-}" ]] && { echo "(dry run: MERGE_VERDICT_JSON set, not merging)"; exit 0; }

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) \
  || blind "could not resolve the repository — failing closed"
gh api -X PUT "repos/$repo/pulls/$pr/merge" -f merge_method="$method"
