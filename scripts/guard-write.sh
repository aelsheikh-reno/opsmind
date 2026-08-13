#!/usr/bin/env bash
# PreToolUse on Write|Edit. Enforces the boundaries at the moment of writing
# rather than discovering them at review.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! parsed=$(python3 "$here/_read_event.py"); then
  echo "BLOCKED: could not read the hook event, failing closed" >&2
  exit 2
fi
path=$(printf '%s' "$parsed" | sed -n '2p')
body=$(printf '%s' "$parsed" | sed -n '3,$p')

block() { echo "BLOCKED: $1" >&2; exit 2; }

case "$path" in
  */reference/legacy/*|reference/legacy/*) block "reference/legacy is a read-only copy of the previous system" ;;
  *.env|*.env.*)                           block "environment files are never written by an agent" ;;
esac

# content rules below apply to code and schema only — documentation may
# legitimately mention isPaid, eslint-disable or @/lib/db when stating the rules
case "$path" in
  *.ts|*.tsx|*.prisma|*.js|*.mjs) ;;
  *) exit 0 ;;
esac

# only a repository may reach the database.
#
# tests/ is exempt because the guard is a substring check and a test has
# legitimate reasons to NAME the package without reaching a database — asserting
# it is installed, and later the differential harness reading the legacy schema.
# Without the exemption the only way past is to split the string, which is the
# same evasion check-boundaries.sh flags as a violation in its own right; a guard
# that can only be satisfied by obfuscating around it teaches exactly the habit
# it exists to prevent. Rule 3 still binds lib/ and app/, where it matters.
if printf '%s' "$body" | grep -q "@/lib/db\|@prisma/client"; then
  case "$path" in
    */repository.ts|repository.ts|*/prisma/*|prisma/*) ;;
    tests/*|*/tests/*) ;;
    *) block "only repository.ts may import the database (CLAUDE.md rule 3)" ;;
  esac
fi

# pages and route handlers hold no domain logic
case "$path" in
  app/*|*/app/*)
    printf '%s' "$body" | grep -q "@/lib/modules/" \
      && block "pages and routes call a module through the API layer, never import it (CLAUDE.md rule 2)" ;;
esac

# the paid-boolean mistake, blocked at the keystroke
printf '%s' "$body" | grep -Eqi "(isPaid|is_paid)[[:space:]]*(:|=)?[[:space:]]*(Boolean|boolean|true|false)" \
  && block "payment state is a Settlement record, never a boolean (CLAUDE.md rule 5)"

# suppressions
printf '%s' "$body" | grep -q "eslint-disable\|@ts-ignore\|@ts-nocheck" \
  && block "suppressing a gate is not a fix; report the problem instead"

exit 0
