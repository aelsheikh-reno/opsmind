#!/usr/bin/env bash
# Verify the guards block what they claim to. Run after changing any guard.
# A guard that has stopped firing is invisible until the day it mattered.
set -uo pipefail
cd "$(dirname "$0")/.."
python3 - << 'PY'
import json, subprocess, sys
def probe(script, payload, expect_block, label):
    r = subprocess.run(["bash", script], input=json.dumps(payload),
                       capture_output=True, text=True)
    blocked = r.returncode == 2
    ok = blocked == expect_block
    print(("PASS  " if ok else "FAIL  ") + label)
    return ok

B, W = "scripts/guard-bash.sh", "scripts/guard-write.sh"
cases = [
 (B, {"tool_input":{"command":"git push --force origin main"}}, True,  "force push blocked"),
 (B, {"tool_input":{"command":"npx prisma migrate reset"}},     True,  "migrate reset blocked"),
 (B, {"tool_input":{"command":"git checkout main"}},            True,  "checkout main blocked"),
 (B, {"tool_input":{"command":"git commit --no-verify -m x"}},  True,  "--no-verify blocked"),
 (B, {"tool_input":{"command":"npm test"}},                     False, "npm test allowed"),
 (B, {"tool_input":{"command":"git push -u origin task/foo"}},  False, "task branch push allowed"),
 (W, {"tool_input":{"file_path":"reference/legacy/x.ts","content":"x"}},           True,  "legacy write blocked"),
 (W, {"tool_input":{"file_path":".env","content":"S=1"}},                          True,  ".env write blocked"),
 (W, {"tool_input":{"file_path":"lib/modules/p/calc.ts","content":"@/lib/db"}},    True,  "db outside repository blocked"),
 (W, {"tool_input":{"file_path":"lib/modules/p/repository.ts","content":"@/lib/db"}}, False, "db in repository allowed"),
 (W, {"tool_input":{"file_path":"app/x/page.tsx","content":"@/lib/modules/finance"}}, True, "page importing module blocked"),
 (W, {"tool_input":{"file_path":"prisma/schema.prisma","content":"isPaid Boolean"}}, True, "isPaid blocked"),
 (W, {"tool_input":{"file_path":"lib/x.ts","content":"// eslint-disable"}},        True,  "eslint-disable blocked"),
 (W, {"tool_input":{"file_path":"lib/x.ts","content":"export const x = 1"}},       False, "normal code allowed"),
 # the tests/ exemption: a test may NAME the database package (asserting it is
 # installed, reading the legacy schema) without the substring check firing.
 # The narrow exemption is only safe while the surrounding cases still block, so
 # both directions are pinned here — a future edit that widens it fails loudly.
 (W, {"tool_input":{"file_path":"tests/scaffold/toolchain.test.ts","content":"@prisma/client"}},      False, "tests may name the db package"),
 (W, {"tool_input":{"file_path":"/abs/repo/tests/differential/harness.ts","content":"@/lib/db"}},     False, "tests exemption works on an absolute path"),
 (W, {"tool_input":{"file_path":"lib/modules/p/tax.ts","content":"@prisma/client"}},                  True,  "db in lib still blocked after the exemption"),
 (W, {"tool_input":{"file_path":"app/api/x/route.ts","content":"@prisma/client"}},                    True,  "db in a route still blocked after the exemption"),
 (W, {"tool_input":{"file_path":"tests/x.test.ts","content":"// eslint-disable"}},                    True,  "tests are exempt from the db check only, not the others"),
]
ok = all(probe(*c) for c in cases)
r = subprocess.run(["bash", W], input="not json", capture_output=True, text=True)
fc = r.returncode == 2
print(("PASS  " if fc else "FAIL  ") + "fails closed on a malformed event")
if not (ok and fc):
    print("\nGUARDS ARE NOT WORKING — fix before running the pipeline")
    sys.exit(1)
print("\nall guards verified")
PY
