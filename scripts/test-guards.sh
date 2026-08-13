#!/usr/bin/env bash
# Verify the guards block what they claim to. Run after changing any guard.
# A guard that has stopped firing is invisible until the day it mattered.
set -uo pipefail
cd "$(dirname "$0")/.."
python3 - << 'PY'
import json, os, re, shutil, subprocess, sys, tempfile
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

# ---------------------------------------------------------------------------
# The size-total waiver.  A budget that can be raised is only safe while the
# raise is scoped, recorded and visible; a waiver nobody can see is the same
# thing as no budget at all.  These probe gate.sh's budget RESOLUTION, which
# `--summary` must make observable: the resolved size-impl and size-total
# budgets are printed, and an active waiver is printed with its value and its
# reason, in the shape of the existing `risk` line.  Probing resolution this
# way needs no oversized diff, so it stays fast enough to sit in CI.
#
# Two surfaces are used:
#   * the REAL tasks/backlog.yaml, read-only, for the committed staging-deploy
#     waiver and for a neighbouring task that must not inherit it;
#   * a throwaway sandbox — a copy of scripts/ beside a fixture backlog — for
#     the cases that must never be written into the real task graph (a node
#     trying to raise size-impl, a malformed value, a waiver planted in
#     .task-current.yaml).  gate.sh resolves its files from the working
#     directory, so running it there reads the fixture and nothing else.
# The task is always named through GITHUB_HEAD_REF, never by making a branch.
# ---------------------------------------------------------------------------

REPO = os.getcwd()
SANDBOXES = []

def gate_summary(head_ref, cwd=REPO):
    """Run `gate.sh --summary` for one task; return (combined output, code)."""
    env = dict(os.environ)
    env["GITHUB_HEAD_REF"] = head_ref
    try:
        r = subprocess.run(["bash", "scripts/gate.sh", "--summary"], cwd=cwd,
                           env=env, capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        return ("TIMED OUT", 124)
    return (r.stdout + r.stderr, r.returncode)

def sandbox(backlog, task_current=None):
    d = tempfile.mkdtemp(prefix="gate-size-probe-")
    SANDBOXES.append(d)
    shutil.copytree(os.path.join(REPO, "scripts"), os.path.join(d, "scripts"))
    os.mkdir(os.path.join(d, "tasks"))
    with open(os.path.join(d, "tasks", "backlog.yaml"), "w") as f:
        f.write(backlog)
    if task_current is not None:
        with open(os.path.join(d, ".task-current.yaml"), "w") as f:
            f.write(task_current)
    return d

def shows(out, n):
    """The number n appears in the output as a number, not inside a longer one."""
    return re.search(r"(?<![0-9])" + str(n) + r"(?![0-9])", out) is not None

def waiver_claim(out):
    """A line announcing a waiver of something other than the two defaults."""
    for line in out.splitlines():
        if re.search(r"waiv", line, re.I):
            for n in re.findall(r"[0-9]+", line):
                if n not in ("400", "800"):
                    return line.strip()
    return None

size_results = []
def check(label, condition, detail=""):
    print(("PASS  " if condition else "FAIL  ") + label +
          ("" if condition else "   [" + detail.replace("\n", " | ")[:300] + "]"))
    size_results.append(bool(condition))

# A fixture task graph. Nothing here may ever be added to tasks/backlog.yaml:
# probe-impl-override and the malformed nodes exist to be REFUSED.
FIXTURE = """# fixture task graph for scripts/test-guards.sh — not the real backlog
- id: probe-plain
  title: A task that records no size waiver
  phase: 0
  depends_on: []
  produces:
    - nothing
  done_when:
    gates: [lint]
    assertions:
      - "keeps the default total budget"
  risk: low
  status: todo

- id: probe-waived
  title: A task that records a reasoned size waiver
  phase: 0
  depends_on: []
  size_total: 1500
  size_waiver_reason: "PROBEWAIVERREASON7Q3 the shared parsing machinery a split would duplicate"
  produces:
    - nothing
  done_when:
    gates: [lint]
    assertions:
      - "raises its own total budget only"
  risk: low
  status: todo

- id: probe-tight
  title: A task that tightens its own total budget below the default
  phase: 0
  depends_on: []
  size_total: 300
  size_waiver_reason: "PROBETIGHTREASON4M a task may hold itself to less"
  produces:
    - nothing
  done_when:
    gates: [lint]
    assertions:
      - "takes the lower value"
  risk: low
  status: todo

- id: probe-impl-override
  title: A task that tries to buy itself a bigger implementation budget
  phase: 0
  depends_on: []
  size_impl: 5000
  size-impl: 5000
  size_total: 1200
  size_waiver_reason: "PROBEIMPLREASON8V an oversized implementation is the thing the gate exists to catch"
  produces:
    - nothing
  done_when:
    gates: [lint]
    assertions:
      - "size-impl stays 400"
  risk: low
  status: todo
"""

def malformed_fixture(value):
    return one_node_fixture("probe-malformed",
                            ["size_total: " + value,
                             "size_waiver_reason: \"PROBEMALFORMED2X\""],
                            "A task whose size_total is not a number")

def one_node_fixture(nid, keys, title):
    """A fixture graph of one node the gate is expected to refuse."""
    return ("- id: " + nid + "\n"
            "  title: " + title + "\n"
            "  phase: 0\n"
            "  depends_on: []\n"
            + "".join("  " + k + "\n" for k in keys) +
            "  produces:\n"
            "    - nothing\n"
            "  done_when:\n"
            "    gates: [lint]\n"
            "    assertions:\n"
            "      - \"fails loudly\"\n"
            "  risk: low\n"
            "  status: todo\n")

PLANTED = ("- id: %s\n"
           "  title: A waiver planted where CI will never see it\n"
           "  phase: 0\n"
           "  size_total: 9000\n"
           "  size_waiver_reason: \"PROBEFROMTASKCURRENT9K must never be honoured\"\n"
           "  risk: low\n"
           "  status: in_progress\n")

# --- the sandbox must be a working harness before anything it reports counts --
sb = sandbox(FIXTURE)
out, code = gate_summary("task/probe-plain", cwd=sb)
check("sandbox harness resolves the task from the fixture backlog",
      code == 0 and "probe-plain" in out, "exit %s: %s" % (code, out))

# assertion: a task with no size_total keeps the 800 default
check("a task with no size_total resolves the 800 total budget",
      shows(out, 800) and not shows(out, 1500) and not shows(out, 1800), out)
# assertion: ...and nothing else's — a neighbour's waiver never leaks in
check("another node's waiver never leaks into an unwaived task",
      shows(out, 800) and "PROBEWAIVERREASON7Q3" not in out
      and not shows(out, 1500), out)
# assertion: an active waiver is never silent — so no waiver is never announced.
# Each absence is anchored to the budget it should have resolved instead, so a
# gate that prints nothing at all fails here rather than passing vacuously.
claim = waiver_claim(out)
check("an unwaived task announces no waiver value",
      claim is None and shows(out, 800), str(claim) + " :: " + out)

# assertion: size_total raises that task's total budget, printed with its reason
out, code = gate_summary("task/probe-waived", cwd=sb)
check("size_total on a node raises that task's total budget",
      shows(out, 1500), out)
check("an active waiver prints its reason, not just its number",
      "PROBEWAIVERREASON7Q3" in out, out)

# a node may tighten its own budget; the default must never silently rise
out, code = gate_summary("task/probe-tight", cwd=sb)
check("a size_total below the default takes the lower value",
      shows(out, 300) and not shows(out, 800), out)

# assertion: size-impl's 400 is never overridable by any node field
out, code = gate_summary("task/probe-impl-override", cwd=sb)
loud = code != 0 and re.search(r"size[-_ ]?impl", out, re.I) is not None
check("size-impl stays 400 however a node spells the override",
      loud or (shows(out, 400) and not shows(out, 5000)),
      "exit %s: %s" % (code, out))

# assertion: the waiver is read from the committed backlog, never from
# .task-current.yaml — that file is gitignored and absent in CI, so a waiver
# honoured from it would pass locally and vanish on the runner.
sb2 = sandbox(FIXTURE, task_current=PLANTED % "probe-plain")
out, code = gate_summary("task/probe-plain", cwd=sb2)
check("a waiver present only in .task-current.yaml is not honoured",
      shows(out, 800) and not shows(out, 9000)
      and "PROBEFROMTASKCURRENT9K" not in out, "exit %s: %s" % (code, out))

sb3 = sandbox(FIXTURE, task_current=PLANTED % "probe-waived")
out, code = gate_summary("task/probe-waived", cwd=sb3)
check(".task-current.yaml cannot raise a budget the backlog already sets",
      shows(out, 1500) and not shows(out, 9000), "exit %s: %s" % (code, out))

# a malformed value fails loudly; it never falls back to the default and never
# disables the check
for value, name in (("eighteen hundred", "non-numeric text"),
                    ("1800 lines", "a number with trailing text")):
    sbm = sandbox(malformed_fixture(value))
    out, code = gate_summary("task/probe-malformed", cwd=sbm)
    check("a malformed size_total (" + name + ") fails the gate loudly",
          code != 0 and re.search(r"size[-_ ]?total", out, re.I) is not None,
          "exit %s: %s" % (code, out))

# An empty value is malformed, not absent. A key someone bothered to type and
# left blank is a mistake, and defaulting it to 800 hides the mistake behind a
# budget that happens to be the one it would have had anyway.
sbe = sandbox(one_node_fixture(
    "probe-empty", ["size_total:",
                    "size_waiver_reason: \"PROBEEMPTY5R the reason is here; "
                    "the value is not\""],
    "A task whose size_total key is present but blank"))
out, code = gate_summary("task/probe-empty", cwd=sbe)
check("an empty size_total: is malformed, never read as absent",
      code != 0 and re.search(r"size[-_ ]?total", out, re.I) is not None,
      "exit %s: %s" % (code, out))

# A raised budget with no argument attached is a waiver already granted, which
# no reviewer can evaluate — the whole case for scoping the waiver to a node
# instead of raising the budget for everyone rests on it being reviewable. The
# rule is uniform: a task tightening its own budget owes the same one line, and
# blank is not an argument.
for keys, name in (
    (["size_total: 1500"],
     "no size_waiver_reason at all"),
    (["size_total: 1500", "size_waiver_reason: \"\""],
     "a blank reason"),
    (["size_total: 1500", "size_waiver_reason: \"   \""],
     "a whitespace-only reason"),
    (["size_total: 300"],
     "no reason on a budget it tightens"),
):
    sbu = sandbox(one_node_fixture("probe-unreasoned", keys,
                                   "A task raising a budget it does not argue for"))
    out, code = gate_summary("task/probe-unreasoned", cwd=sbu)
    check("a size_total with " + name + " fails the gate loudly",
          code != 0 and re.search(r"reason", out, re.I) is not None,
          "exit %s: %s" % (code, out))

# --- the committed backlog, read-only: the waiver that actually exists --------
out, code = gate_summary("task/staging-deploy")
check("the committed staging-deploy waiver resolves to its 1800 budget",
      shows(out, 1800), out)
check("the committed waiver is printed with its recorded reason",
      "staging-deploy.test.ts" in out, out)

out, code = gate_summary("task/gate-size-waiver")
check("a neighbouring task on the same backlog keeps the 800 default",
      shows(out, 800) and not shows(out, 1800), out)

for d in SANDBOXES:
    shutil.rmtree(d, ignore_errors=True)

if not all(size_results):
    print("\nTHE SIZE BUDGET IS NOT BEING RESOLVED AS SPECIFIED — fix gate.sh")
    sys.exit(1)
print("\nall guards verified")
PY
