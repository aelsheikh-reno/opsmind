#!/usr/bin/env bash
# PreToolUse on Bash. Exit 2 blocks the command and tells the model why.
# CLAUDE.md is advisory; this is not.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! parsed=$(python3 "$here/_read_event.py"); then
  echo "BLOCKED: could not read the hook event, failing closed" >&2
  exit 2
fi
cmd=$(printf '%s' "$parsed" | sed -n '1p')

block() { echo "BLOCKED: $1" >&2; exit 2; }

case "$cmd" in
  *"git push"*"--force"*|*"git push -f"*)              block "force push is never allowed" ;;
  *"git push"*" main"*|*"git push origin main"*)       block "push to main is not allowed; open a pull request" ;;
  *"git checkout main"*|*"git switch main"*)           block "work happens on a task branch, never on main" ;;
  *"prisma migrate reset"*|*"prisma db push --force"*) block "destructive database command" ;;
  *"DROP TABLE"*|*"DROP DATABASE"*|*"TRUNCATE"*)       block "destructive SQL" ;;
  *"rm -rf /"*|*"rm -rf ~"*)                           block "destructive filesystem command" ;;
  *"--no-verify"*)                                     block "gates are not to be bypassed" ;;
  *"reference/legacy"*)
    case "$cmd" in
      *" > "*|*rm\ *|*mv\ *|*"sed -i"*) block "reference/legacy is a read-only copy" ;;
    esac ;;
esac
exit 0
