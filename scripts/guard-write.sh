#!/usr/bin/env bash
# PreToolUse on Write|Edit. Enforces the boundaries at the moment of writing
# rather than discovering them at review.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$here")"

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
# Why each exemption is here: none of them is domain code. Rule 3 exists to stop
# domain logic reaching the database anywhere but a repository, and every entry
# below is a place that must NAME the client without being domain logic.
#
#   repository.ts   the one file rule 3 actually permits to reach the database
#   prisma/         schema and generator tooling; naming the client is its job
#   tests/          a test may assert the package is installed, or read the
#                   legacy schema, without touching a database
#   lib/db.ts       the single client every repository imports. Repositories
#                   reach the database THROUGH it, so it is the one
#                   non-repository file that must name the client package: it
#                   is where the client is constructed, once, instead of once
#                   per module. Anchored to the resolved repository root, so it
#                   is genuinely one path: a bare `*/lib/db.ts` would also match
#                   lib/modules/payroll/lib/db.ts, because `*` spans `/` in a
#                   bash case, and a module minting its own client is exactly
#                   what this must refuse. Matching a literal directory name
#                   instead would refuse the real file in a checkout named
#                   anything else.
#   vitest.config.ts  build/test configuration. It aliases the client package so
#                   legacy oracles resolve the client generated from the LEGACY
#                   schema rather than this build's — configuring resolution, not
#                   importing a database. One filename, deliberately: not a
#                   pattern and not a directory, so nothing else in the root can
#                   inherit the exemption by sitting beside it.
#
# check-boundaries.sh is untouched. The CI-side rule is correct as it stands.
if printf '%s' "$body" | grep -q "@/lib/db\|@prisma/client"; then
  case "$path" in
    */repository.ts|repository.ts|*/prisma/*|prisma/*) ;;
    tests/*|*/tests/*) ;;
    lib/db.ts|"$repo_root/lib/db.ts") ;;
    vitest.config.ts|*/vitest.config.ts) ;;
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
