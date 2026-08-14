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
 # vitest.config.ts is exempt so the legacy oracle can be aliased to the client
 # generated from the LEGACY schema. Both directions pinned: the exemption is one
 # filename, and domain code must still be refused.
 (W, {"tool_input":{"file_path":"vitest.config.ts","content":"alias @prisma/client for legacy"}},   False, "vitest.config.ts may name the client package"),
 (W, {"tool_input":{"file_path":"lib/modules/payroll/calc.ts","content":"@prisma/client"}},         True,  "domain code naming the client is still blocked"),
 # lib/db.ts is the single client every repository imports. Exempt for the same
 # reason vitest.config.ts is: it must name the package without being domain
 # code. Both directions pinned — one filename, and domain code still refused.
 (W, {"tool_input":{"file_path":"lib/db.ts","content":"import { PrismaClient } from \"@prisma/client\""}}, False, "lib/db.ts may name the client package"),
 (W, {"tool_input":{"file_path":"lib/modules/deadlines/calc.ts","content":"@prisma/client"}},              True,  "a module calc.ts naming the client is still blocked"),
 # The exemption must be one PATH, not a suffix: `*` spans `/` in a bash case, so
 # a bare */lib/db.ts would let a module mint its own client through the guard.
 (W, {"tool_input":{"file_path":"lib/modules/payroll/lib/db.ts","content":"@prisma/client"}},              True,  "a module cannot mint its own lib/db.ts"),
 (W, {"tool_input":{"file_path":os.path.join(os.getcwd(),"lib/db.ts"),"content":"@prisma/client"}},        False, "the real lib/db.ts is allowed by absolute path"),
 (W, {"tool_input":{"file_path":os.path.join(os.getcwd(),"lib/modules/payroll/lib/db.ts"),"content":"@prisma/client"}}, True, "an absolute path to a module's own lib/db.ts is still blocked"),
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
                if n not in ("400", "1500"):
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
  size_total: 2500
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

# assertion: a task with no size_total keeps the default (1500 since ADR-029)
check("a task with no size_total resolves the default total budget",
      shows(out, 1500) and not shows(out, 2500) and not shows(out, 1800), out)
# assertion: ...and nothing else's — a neighbour's waiver never leaks in
check("another node's waiver never leaks into an unwaived task",
      shows(out, 1500) and "PROBEWAIVERREASON7Q3" not in out
      and not shows(out, 2500), out)
# assertion: an active waiver is never silent — so no waiver is never announced.
# Each absence is anchored to the budget it should have resolved instead, so a
# gate that prints nothing at all fails here rather than passing vacuously.
claim = waiver_claim(out)
check("an unwaived task announces no waiver value",
      claim is None and shows(out, 1500), str(claim) + " :: " + out)

# assertion: size_total raises that task's total budget, printed with its reason
out, code = gate_summary("task/probe-waived", cwd=sb)
check("size_total on a node raises that task's total budget",
      shows(out, 2500), out)
check("an active waiver prints its reason, not just its number",
      "PROBEWAIVERREASON7Q3" in out, out)

# a node may tighten its own budget; the default must never silently rise
out, code = gate_summary("task/probe-tight", cwd=sb)
check("a size_total below the default takes the lower value",
      shows(out, 300) and not shows(out, 1500), out)

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
      shows(out, 1500) and not shows(out, 9000)
      and "PROBEFROMTASKCURRENT9K" not in out, "exit %s: %s" % (code, out))

sb3 = sandbox(FIXTURE, task_current=PLANTED % "probe-waived")
out, code = gate_summary("task/probe-waived", cwd=sb3)
check(".task-current.yaml cannot raise a budget the backlog already sets",
      shows(out, 2500) and not shows(out, 9000), "exit %s: %s" % (code, out))

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
# left blank is a mistake, and defaulting it to 1500 hides the mistake behind a
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
check("a neighbouring task on the same backlog keeps the default budget",
      shows(out, 1500) and not shows(out, 1800), out)

# --- the size MEASUREMENT, against a real diff -------------------------------
# Everything above probes budget RESOLUTION through --summary, which never
# measures anything. The exclusions are a different mechanism — a list of git
# pathspecs — and resolution passing says nothing about whether they match what
# they claim to. ADR-026 stops charging documentation to the 400-line code
# budget, and an exclusion that silently over-matched would stop charging code
# too, which is the failure this gate exists to prevent. So these run gate.sh's
# full path over a throwaway repository with a real two-commit diff.
#
# The node toolchain is stubbed: the sandbox has no node_modules, so lint, types
# and the vitest runs would fail on their own account and prove nothing about
# the measurement. Only the size lines are read.
def size_lines(out, gate):
    for line in out.splitlines():
        if line.startswith(gate):
            return line.strip()
    return ""

def measure(files):
    """Commit `files` (path -> line count) onto a base; return gate.sh output."""
    d = tempfile.mkdtemp(prefix="gate-size-measure-")
    SANDBOXES.append(d)
    shutil.copytree(os.path.join(REPO, "scripts"), os.path.join(d, "scripts"))
    os.mkdir(os.path.join(d, "tasks"))
    with open(os.path.join(d, "tasks", "backlog.yaml"), "w") as f:
        f.write(FIXTURE)
    stub = os.path.join(d, "stub-bin")
    os.mkdir(stub)
    for tool in ("npx", "npm"):
        p = os.path.join(stub, tool)
        with open(p, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(p, 0o755)

    def git(*a):
        subprocess.run(["git"] + list(a), cwd=d, capture_output=True, text=True)
    git("init", "-q")
    git("config", "user.email", "guards@opsmind.test")
    git("config", "user.name", "guards")
    git("add", "-A")
    git("commit", "-qm", "base")
    base = subprocess.run(["git", "rev-parse", "HEAD"], cwd=d,
                          capture_output=True, text=True).stdout.strip()
    for path, count in files.items():
        full = os.path.join(d, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write("".join("line %d\n" % i for i in range(count)))
    git("add", "-A")
    git("commit", "-qm", "change")

    env = dict(os.environ)
    env["GATE_BASE"] = base
    env["GITHUB_HEAD_REF"] = "task/probe-plain"
    env["PATH"] = stub + os.pathsep + env["PATH"]
    r = subprocess.run(["bash", "scripts/gate.sh"], cwd=d, env=env,
                       capture_output=True, text=True, timeout=180)
    return r.stdout + r.stderr

# 600 lines of specification beside 40 lines of code. Under ADR-026 the prose is
# the reviewer's business, not the code budget's: size-impl sees only the 40.
out = measure({"docs/architecture/data-model.md": 600,
               "lib/modules/deadlines/calendar.ts": 40})
impl_line, total_line = size_lines(out, "size-impl"), size_lines(out, "size-total")
check("a docs-heavy change passes size-impl on its code alone",
      impl_line.endswith("pass"), impl_line or out)
check("markdown outside docs/ is documentation too",
      size_lines(measure({"lib/modules/deadlines/README.md": 600,
                          "lib/modules/deadlines/calendar.ts": 40}),
                 "size-impl").endswith("pass"), out)
check("a docs-heavy change under the backstop passes size-total too",
      total_line.endswith("pass"), total_line or out)

# 900 prose lines beside 40 of code: excluded from the code budget, still
# charged in full to the backstop. Documentation is untaxed, not unmeasured —
# without this the exclusion could have been written into both budgets and
# every probe above would still pass.
out = measure({"docs/architecture/data-model.md": 1600,
               "lib/modules/deadlines/calendar.ts": 40})
check("size-total still counts every documentation line",
      "FAIL" in size_lines(out, "size-total") and shows(out, 1640), out)
check("...while that same change stays clear of size-impl",
      size_lines(out, "size-impl").endswith("pass"), out)

# The half that must still fail. An exclusion that leaked would show up here.
out = measure({"lib/modules/deadlines/calendar.ts": 460})
impl_line = size_lines(out, "size-impl")
check("an oversized implementation still fails size-impl",
      "FAIL" in impl_line, impl_line or out)
check("the failure names the real implementation count",
      shows(out, 460), out)

# Prose must not buy an oversized implementation any headroom either.
out = measure({"docs/architecture/data-model.md": 600,
               "lib/modules/deadlines/calendar.ts": 460})
check("documentation never masks an oversized implementation",
      "FAIL" in size_lines(out, "size-impl"), out)

# tests/ and the guard harness keep the exemption they already had.
check("tests/ stays out of size-impl",
      size_lines(measure({"tests/modules/deadlines/calendar.test.ts": 600,
                          "lib/modules/deadlines/calendar.ts": 40}),
                 "size-impl").endswith("pass"), out)
check("scripts/test-guards.sh stays out of size-impl",
      size_lines(measure({"scripts/test-guards.sh": 600,
                          "lib/modules/deadlines/calendar.ts": 40}),
                 "size-impl").endswith("pass"), out)

# --- generated migration DDL is not implementation ---------------------------
# ADR-028. The exclusion has to be narrow or it becomes a way to smuggle
# hand-written SQL past the budget, so the negative case is pinned as hard as
# the positive one: a .sql anywhere outside prisma/migrations/ is authored work
# and must stay measured.
out = measure({"prisma/migrations/20260101000000_x/migration.sql": 600,
               "prisma/schema.prisma": 40})
check("generated migration DDL is outside the implementation budget",
      size_lines(out, "size-impl").endswith("pass"), out)
# 900 lines of DDL beside 40 of schema: untaxed by size-impl, still charged in
# full to the backstop. Without this the exclusion could have been written into
# both budgets and every other probe here would still pass.
big = measure({"prisma/migrations/20260101000000_x/migration.sql": 1600,
               "prisma/schema.prisma": 40})
check("...but size-total still counts every line of it",
      "FAIL" in size_lines(big, "size-total") and shows(big, 1640), big)
check("...while that same change stays clear of size-impl",
      size_lines(big, "size-impl").endswith("pass"), big)

check("a hand-written .sql outside prisma/migrations/ is still implementation",
      "FAIL" in size_lines(measure({"scripts/backfill-direction.sql": 460}),
                           "size-impl"), out)
check("a .sql directly under prisma/ is still implementation",
      "FAIL" in size_lines(measure({"prisma/seed.sql": 460}), "size-impl"), out)
check("generated DDL never masks an oversized schema",
      "FAIL" in size_lines(measure({"prisma/migrations/20260101000000_x/migration.sql": 600,
                                    "prisma/schema.prisma": 460}), "size-impl"), out)

# --- migrations must survive .gitignore --------------------------------------
# `prisma migrate deploy` applies committed migration files and nothing else. It
# runs in gates.yml and again on every staging deploy, so a migration.sql that
# .gitignore swallows means the schema never reaches the database — from a clean
# checkout there is simply nothing to apply, and the deploy is green. gates.yml
# calls that "the one failure direction that hides", and it hid for real: the
# *.sql rule meant for dumps also matched prisma/migrations/*/migration.sql, and
# nothing noticed until kernel-schema-base became the first task to produce a
# migration.
#
# Both directions are pinned, because the fix is a negation and a negation is
# exactly the kind of rule that is easy to widen by accident. `git add -n` is the
# test rather than `git check-ignore`: check-ignore exits 0 when the LAST match
# is a negation too, so it reports a re-included file as though it were ignored.
# Whether git will actually stage the file is the question that matters.
def gitignore_verdict(paths):
    """Copy the real .gitignore into an empty repo; return {path: will_add}."""
    d = tempfile.mkdtemp(prefix="gitignore-probe-")
    SANDBOXES.append(d)
    shutil.copyfile(os.path.join(REPO, ".gitignore"), os.path.join(d, ".gitignore"))
    subprocess.run(["git", "init", "-q"], cwd=d, capture_output=True)
    verdict = {}
    for p in paths:
        full = os.path.join(d, p)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write("-- probe\n")
        r = subprocess.run(["git", "add", "-n", p], cwd=d,
                           capture_output=True, text=True)
        verdict[p] = "add '" in (r.stdout + r.stderr)
    return verdict

v = gitignore_verdict([
    "prisma/migrations/20260101000000_probe/migration.sql",  # must be committable
    "prisma/migrations/migration_lock.toml",                 # must be committable
    "backup.sql",                                            # dump — must not be
    "prisma/dump.sql",                                       # dump beside the schema
    "data.sql.gz",
    "snap.dump",
])
check("a prisma migration is committable",
      v["prisma/migrations/20260101000000_probe/migration.sql"], repr(v))
check("the migration lock file is committable",
      v["prisma/migrations/migration_lock.toml"], repr(v))
check("a database dump at the root is still ignored",
      not v["backup.sql"], repr(v))
check("a dump sitting inside prisma/ is still ignored",
      not v["prisma/dump.sql"], repr(v))
# node_modules must be ignored as a SYMLINK too, not only as a directory. A
# worktree pointing at another checkout's modules is normal; committing that
# pointer is not, and `node_modules/` with a trailing slash does not match it.
# It reached main once exactly this way.
v2 = gitignore_verdict([
    "node_modules/x.js",          # inside the directory
    "vendor/node_modules/y.js",   # nested copies too
])
check("files under node_modules are ignored", not v2["node_modules/x.js"], repr(v2))
check("nested node_modules are ignored too", not v2["vendor/node_modules/y.js"], repr(v2))

def symlink_is_ignored():
    """A SYMLINK named node_modules, which a trailing-slash rule does not match."""
    import tempfile, shutil, subprocess, os
    d = tempfile.mkdtemp(prefix="gitignore-symlink-")
    SANDBOXES.append(d)
    shutil.copyfile(os.path.join(REPO, ".gitignore"), os.path.join(d, ".gitignore"))
    subprocess.run(["git", "init", "-q"], cwd=d, capture_output=True)
    os.symlink("/tmp", os.path.join(d, "node_modules"))
    r = subprocess.run(["git", "add", "-n", "node_modules"], cwd=d, capture_output=True, text=True)
    return "add '" not in (r.stdout + r.stderr)

check("a node_modules SYMLINK is ignored, not just the directory", symlink_is_ignored())

check("compressed dumps and pg_dump archives are still ignored",
      not v["data.sql.gz"] and not v["snap.dump"], repr(v))

for d in SANDBOXES:
    shutil.rmtree(d, ignore_errors=True)

if not all(size_results):
    # The list started as size-budget probes only; it now also carries the
    # .gitignore migration guards, so the banner names the failing check rather
    # than assuming gate.sh is at fault.
    print("\nA REPOSITORY GUARD IS NOT BEHAVING AS SPECIFIED — see the FAIL line(s) above")
    print("(size-* lines are gate.sh; committable/ignored lines are .gitignore)")
    sys.exit(1)
print("\nall guards verified")
PY
