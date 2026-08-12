#!/usr/bin/env bash
# PostToolUse on Write|Edit. Fast feedback only; the full suite runs in gate.sh.
# Output is injected back as context so the agent sees its own breakage.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parsed=$(python3 "$here/_read_event.py") || exit 0
path=$(printf '%s' "$parsed" | sed -n '2p')

case "$path" in *.ts|*.tsx) ;; *) exit 0 ;; esac

out=$(npx tsc --noEmit 2>&1 | head -20)
[[ -n "$out" ]] && printf 'TYPE ERRORS after editing %s:\n%s\n' "$path" "$out"

out=$(npx eslint "$path" 2>&1 | head -20)
[[ -n "$out" ]] && printf 'LINT after editing %s:\n%s\n' "$path" "$out"
exit 0
