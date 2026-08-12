"""Read a hook event from stdin and print the fields a guard needs.

Guards must fail closed: if this cannot parse the event, it exits non-zero and
the calling guard blocks. A guard that silently allows everything because a
dependency is missing is worse than no guard at all.
"""
import json
import sys

try:
    event = json.load(sys.stdin)
except Exception as exc:                      # noqa: BLE001 - any failure blocks
    print(f"could not parse hook event: {exc}", file=sys.stderr)
    sys.exit(1)

tool_input = event.get("tool_input") or {}
print(tool_input.get("command", ""))
print(tool_input.get("file_path", ""))
print(tool_input.get("content") or tool_input.get("new_string") or "")
