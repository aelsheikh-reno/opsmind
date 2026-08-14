#!/usr/bin/env bash
# Flip exactly one backlog node's status to done, and refuse to do anything else.
#
# The status lag is six occurrences old and has misdirected /next three times: a
# node cannot record its own merge, so the flip always lands in a later commit
# and there is always a window where the graph lies about what is built. Writing
# "flip the status afterwards" into build-task.md was the previous answer. The
# merge bug proved what an instruction in that file is worth — it said merge only
# when green, and a red gate reached main anyway.
#
# So this is the enforcement, and it is deliberately narrow. tasks/backlog.yaml
# has two writers, and a scripted edit destroyed staging-deploy's waiver reason
# in #30 by anchoring on the file's FIRST occurrence of a field name — twelve
# nodes away from the one it meant. This anchors on the node id, edits the status
# line inside that node's block and nothing else, and then checks the damage
# rather than trusting itself: if the resulting diff is anything other than one
# changed line, the edit is reverted and the run refuses.
#
# Usage:  scripts/mark-task-done.sh <node-id>
# Exit:   0 flipped · 1 refused · 2 could not read the backlog
set -uo pipefail

node="${1:-}"
file="tasks/backlog.yaml"

if [[ -z "$node" ]]; then
  echo "usage: $(basename "$0") <node-id>" >&2
  exit 2
fi
[[ -f "$file" ]] || { echo "REFUSING: $file is not here" >&2; exit 2; }

refuse() { echo "REFUSING to mark '$node' done: $1" >&2; exit 1; }

# Anchored on the node id. The block is everything from `- id: <node>` to the
# next top-level `- id:`, so a status line belonging to any other node is out of
# reach by construction rather than by carefulness.
before=$(mktemp) && cp "$file" "$before"
trap 'rm -f "$before"' EXIT

result=$(NODE="$node" FILE="$file" python3 - <<'PY'
import os, re, sys
node, path = os.environ["NODE"], os.environ["FILE"]
src = open(path).read()

m = re.search(r"^- id: %s\s*$" % re.escape(node), src, re.M)
if not m:
    print("NOTFOUND"); sys.exit(0)

nxt = re.search(r"^- id: ", src[m.end():], re.M)
end = m.end() + (nxt.start() if nxt else len(src) - m.end())
block = src[m.start():end]

statuses = list(re.finditer(r"^  status: (\S+)\s*$", block, re.M))
if len(statuses) != 1:
    print("STATUS_COUNT %d" % len(statuses)); sys.exit(0)
if statuses[0].group(1) == "done":
    print("ALREADY_DONE"); sys.exit(0)

s, e = statuses[0].span()
new_block = block[:s] + "  status: done" + block[e:]
open(path, "w").write(src[:m.start()] + new_block + src[end:])
print("EDITED %s" % statuses[0].group(1))
PY
) || { cp "$before" "$file"; echo "REFUSING: could not read $file" >&2; exit 2; }

case "$result" in
  NOTFOUND)      refuse "no node with that id is in $file" ;;
  ALREADY_DONE)  refuse "it is already done — nothing to flip, and a no-op commit is noise" ;;
  STATUS_COUNT*) cp "$before" "$file"
                 refuse "that node has ${result#STATUS_COUNT } status lines; expected exactly one" ;;
  EDITED*)       ;;
  *)             cp "$before" "$file"; refuse "unrecognised result from the edit: $result" ;;
esac

# Check the damage rather than trust the edit. One line changed, in one file,
# and that line is the status of the node named — anything else is reverted.
changed=$(git diff --numstat -- "$file" 2>/dev/null | awk '{print $1"+"$2}')
if [[ "$changed" != "1+1" ]]; then
  cp "$before" "$file"
  refuse "the diff would be ${changed:-nothing} (added+removed), not 1+1 — reverted. \
Commit or stash other changes to $file first."
fi

touched=$(git diff --name-only 2>/dev/null | grep -c . )
if [[ "$touched" != "1" ]]; then
  cp "$before" "$file"
  refuse "$touched file(s) are modified, not just $file — reverted"
fi

if ! git diff -U0 -- "$file" | grep -qE '^\+  status: done$'; then
  cp "$before" "$file"
  refuse "the one changed line is not a status going to done — reverted"
fi

echo "$node: ${result#EDITED } -> done (1 line, $file)"
