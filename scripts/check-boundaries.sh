#!/usr/bin/env bash
# Module ownership, checked statically. Lint covers imports; this covers what a
# lint rule cannot see. Findings are collected in the main shell so a violation
# can never be printed and then forgotten (the classic `| while read` subshell
# bug did exactly that in an earlier version of this script).
set -uo pipefail
findings=()

# Every repository the enforcement layer knows about, in one list.
#
# A capability service's repository is read exactly as a module's is. ADR-039
# makes its reuse target an importable package on the HOST's storage, so the
# network is no longer any part of its boundary and exclusive table ownership
# is the whole of it — declared here, in the same words, or it does not exist.
# eslint permits that file to import the client on precisely this basis, and the
# two halves only move together: exempt it from the import rule while this loop
# still reads two globs and the result is a file that may reach the database and
# is checked by nothing, which is worse than the red lint it replaces because it
# is silent.
#
# One list rather than one per loop, because the loops below drifting apart is
# how a repository ends up read by the ownership check and not by the evasion
# check. Unmatched globs stay literal here; the `-f` guard in each loop is what
# absorbs them, which is why lib/services/ not existing yet costs nothing.
repositories=(lib/modules/*/repository.ts lib/kernel/*/repository.ts lib/services/*/repository.ts)

# a repository must declare its tables and touch only those
for repo in "${repositories[@]}"; do
  [[ -f "$repo" ]] || continue
  mod=$(basename "$(dirname "$repo")")
  owned=$(grep -oE "^\s*//\s*owns:.*" "$repo" | head -1 | sed 's/.*owns://')
  if [[ -z "$owned" ]]; then
    findings+=("$repo has no '// owns:' declaration listing its tables (see CLAUDE.md)")
    continue
  fi
  # The declaration as a list of whole lowercase names, one per line. The
  # comparison below is equality: a substring match let a repository declaring
  # `AlertEvent` touch `Alert` undetected, and this schema is built from such
  # pairs (Person/PersonRole, Deadline/DeadlineRegistration). Split on commas
  # and spaces alike so a declaration written either way is read the same.
  declared=$(echo "$owned" | tr -s ', \t' '\n\n\n' | tr '[:upper:]' '[:lower:]' | grep -v '^$')

  # Inside `db.$transaction(async (tx) => ...)` a table is reached as
  # `tx.alert`, which a `db.` pattern cannot see — so read the transaction
  # handle too. Its name is the author's choice, not always `tx`, so take it
  # from the source: the newlines are squeezed out first because the callback
  # is commonly wrapped onto the line after `$transaction(`, and the second
  # grep keeps the trailing identifier of each match, which is the parameter.
  handles='db'
  while IFS= read -r handle; do
    [[ -n "$handle" ]] && handles="$handles|$handle"
  done < <(tr '\n' ' ' < "$repo" \
           | grep -oE '\$transaction\([[:space:]]*async[[:space:]]*\(?[[:space:]]*[A-Za-z_][A-Za-z0-9_]*' \
           | grep -oE '[A-Za-z_][A-Za-z0-9_]*$' | sort -u)

  # WHAT THIS READER DOES NOT SEE, measured rather than supposed. Each fails in
  # the safe direction — a missed violation, or a demand for a declaration —
  # but a future author needs to know without rediscovering it:
  #   · `$transaction((tx) => ...)` with a NON-ASYNC callback. Ordinary
  #     TypeScript for a one-statement transaction; making `async` optional is a
  #     one-token change and wants a case with it.
  #   · a DESTRUCTURED parameter, `async ({ alert }) => ...`. Exotic, since it
  #     means destructuring model delegates off the client.
  #   · a handle whose name collides with an unrelated variable: a handle named
  #     `t` in a file containing `t.format.call(...)` demands a declaration for
  #     `format`. A false alarm, not a miss.
  # Covered and easy to assume otherwise: a type annotation
  # `async (tx: Prisma.TransactionClient) =>`, and a parameter with no
  # parentheses, `async tx =>`. Both are read correctly.

  while IFS= read -r model; do
    [[ -z "$model" ]] && continue
    grep -qxF "$(echo "$model" | tr '[:upper:]' '[:lower:]')" <<<"$declared" \
      || findings+=("$mod touches '$model' which it does not declare owning")
  done < <(grep -oE "(${handles})\.[a-zA-Z]+\." "$repo" \
           | sed -E "s/^(${handles})[.]//; s/[.]$//" | sort -u)
done

# obfuscated database access is itself a violation — casting or bracket-indexing
# the client is how a gate gets evaded, so the evasion is what gets flagged
for repo in "${repositories[@]}"; do
  [[ -f "$repo" ]] || continue
  while IFS= read -r hit; do
    findings+=("obfuscated db access in $repo: $hit")
  done < <(grep -nE 'db as any|db\)\.|db\[' "$repo" || true)
done

# nothing outside a repository may reach the database.
#
# lib/db.ts is the sole exception, named exactly rather than patterned: it is
# where the single PrismaClient is constructed so every repository imports one
# client and one pool instead of building its own. It holds no query and no
# domain logic — it is the door rule 3 points at, not a way around it. Every
# other file under lib/ and app/ is still refused, re-exporters included.
while IFS= read -r f; do
  findings+=("$f imports the database outside a repository")
done < <(grep -rl "@/lib/db\|@prisma/client" --include="*.ts" --include="*.tsx" lib app 2>/dev/null \
         | grep -v "repository.ts" | grep -vx "lib/db.ts" || true)

# no deep imports past a module or service index. A service is named here for
# ADR-021's reason: the seam is the same call whether the capability is a folder
# or a container, so reaching around it is the same violation.
while IFS= read -r hit; do
  findings+=("deep import: $hit")
done < <(grep -rEn "from ['\"]@/lib/(modules|services)/[a-z-]+/[a-z]" --include="*.ts" --include="*.tsx" lib app 2>/dev/null \
         | grep -vE "/index['\"]" || true)

# no paid booleans in the schema
while IFS= read -r hit; do
  findings+=("paid boolean in schema: $hit")
done < <(grep -nE "isPaid|is_paid" prisma/schema.prisma 2>/dev/null || true)

if (( ${#findings[@]} )); then
  printf 'BOUNDARY: %s\n' "${findings[@]}"
  exit 1
fi
echo "boundaries clean"
