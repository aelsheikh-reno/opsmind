# OpsMind autonomous build pipeline

A task graph, a set of specialised agents, and gates that are machine-checkable.
The intent is that you approve *what* gets built and adjudicate business rules;
everything between a task and a merged pull request runs without you.

---

## The problem this design solves

Agents are reliable at mechanics and unreliable at judgement. The pipeline is
built so that everything mechanical is gated by a script that cannot be
persuaded, and the small residue of judgement is routed to you as a specific
question rather than a diff to read.

**The oracle problem.** A test written by the agent that wrote the code proves
only that the code agrees with itself. If both are wrong about Egyptian income
tax brackets, everything passes and the payroll is wrong. There are exactly
three ways to know a business rule is right, and the pipeline uses all three:

| Oracle | Covers | Cost |
|---|---|---|
| **Differential test against the legacy system** | Anything the old system already computes: payroll, tax, prorata, FX, deadlines | Build once, then free |
| **Property-based test** | Invariants that must hold for all inputs — a settlement never exceeds an open item, a schedule always sums to the contract | Cheap, catches whole classes |
| **You** | Cases where the legacy behaviour is itself wrong or absent | Expensive — reserve it |

The differential harness is the highest-value thing in this repository. Build it
in phase 0, before any module.

---

## The task graph

`tasks/backlog.yaml` is the machine-readable plan. Each node declares what it
needs, what it produces, and how it is proven done.

```yaml
- id: kernel-person
  title: Person entity with manager relation and enrolments
  phase: 1
  depends_on: [kernel-schema-base]
  spec: docs/architecture/components-kernel.md#person
  legacy_reference: reference/legacy/prisma/schema.prisma
  produces:
    - prisma/migrations/*_person
    - lib/kernel/person/{index,repository}.ts
    - tests/kernel/person.test.ts
  done_when:
    - gates: [lint, types, boundaries, tests, cov-report, diff-cov, total-cov]
    - assertions:
        - "Person has managerId self-relation"
        - "PersonEnrolment supports multiple jurisdictions per person"
  risk: low          # low | money | compliance
```

`risk` drives routing. `money` and `compliance` tasks require a differential
test against the legacy system and cannot auto-merge without one.

A node may also carry a **size waiver**, which raises that one task's
`size-total` budget and nothing else's:

```yaml
  size_total: 1800
  size_waiver_reason: >
    why this task's line count is legitimate rather than a task that should
    have been split
```

**Only Ahmed grants a waiver.** An agent that hits the ceiling stops and
proposes a split — that is what CLAUDE.md's 400-line rule asks for, and it is
the behaviour the gate exists to force. An agent adding `size_total` to its own
node to get past a failing gate is weakening the gate, and the reviewer fails
the review when it sees one that no decision in the conversation authorised.

The waiver is read from the committed `tasks/backlog.yaml` only, never from the
uncommitted `.task-current.yaml`, so it always appears in the diff a reviewer
reads. `size-impl` is never waivable: an oversized *implementation* is exactly
what the budget exists to catch, and no volume of tests justifies one. A value
below the default tightens the budget rather than raising it. A waiver that is
malformed, empty, or carries no reason fails the gate — an unexplained waiver
is one that has already been granted.

A scheduler walks the graph: any task whose dependencies are merged is
available, and independent tasks run in parallel in separate git worktrees.

---

## The agents

Each is a file in `.claude/agents/`. They have separate context windows, so a
noisy test run does not pollute the implementer's context.

| Agent | Job | Model |
|---|---|---|
| `planner` | Turn a spec section into a task node with explicit assertions | Opus |
| `implementer` | Write the code for one task, nothing beyond it | Opus |
| `test-author` | Write tests **from the spec**, without reading the implementation | Opus |
| `differ` | Build and run differential tests against the legacy system | Opus |
| `reviewer` | Adversarial review against the invariants; cannot be the implementer | Opus |
| `integrator` | Run gates, open the PR, merge when green | Sonnet |

**Why `test-author` must not read the implementation.** If it does, it writes
tests that describe what the code does rather than what it should do — which is
how a bug gets locked in with a passing test around it. It reads the
specification and the legacy behaviour instead.

**Why `reviewer` is separate.** An agent reviewing its own output agrees with
itself. Separate context, adversarial prompt, and it can only pass or fail — it
cannot edit.

---

## The gates

Nothing merges until every gate passes. Gates are scripts, not judgements.

| Gate | Enforces |
|---|---|
| `commit` | Printed on every run, pass or fail: the short SHA, branch and base the suite measured. A verdict with no stated subject is unreadable |
| `worktree` | Refuses when a file the gate measures is uncommitted, and refuses separately — in different words, carrying git's own error — when it cannot read the tree at all. The run stops there either way: no other gate is measured or printed (ADR-031) |
| `lint` | Style, plus the module-boundary import rules |
| `types` | `tsc --noEmit`, no `any` introduced in a diff |
| `boundaries` | No module writes another's tables; no page imports a module; only `repository.ts` touches the database |
| `guards` | `scripts/test-guards.sh`: every guard still blocks what it claims to, in both directions. Full suite only — the fixtures call `gate.sh --summary`, so a guard line reachable from `--summary` would never terminate |
| `tests` | Unit and integration pass |
| `test-count` | The suite never shrinks: the runtime test total against the `tests` floor in `tests/baseline.json` |
| `cov-report` | `vitest run --coverage` ran and exited clean. The report it must produce is `coverage/lcov.info`; a report that is absent, empty or declares no measurable line is caught by the two gates below, which read it — and is a failure there, never a pass |
| `diff-cov` | Coverage of **the lines this task changed** — 90% on money and compliance, 70% on low, 90% when the risk is unknown |
| `total-cov` | Whole-repository line coverage against the `coverage_bp` ratchet in `tests/baseline.json`. Fails on a decrease, and on a `coverage_bp` lowered below the value the PR base holds |
| `cov-waiver` | A task that legitimately lowers either number carries `coverage_waiver` and a `coverage_waiver_reason` on its node. Unexplained, or not a number, it fails |
| `differential` | Output matches the legacy system on the golden dataset, or the difference is explicitly approved |
| `security` | `claude-code-security-review` finds nothing high |
| `size-impl` | Implementation under 400 added **code** lines, or the task is split. In `.ts` and `.tsx` a comment-only line and a blank line are not implementation and are not counted; a line carrying code *and* a trailing comment counts as code, in full. The reading is the TypeScript compiler's, through `tests/kernel/kernel-source.ts`, so a `//` inside a string, a template literal or a JSX expression is code (ADR-035). Every other file is counted line for line as before. Never waivable |
| `size-total` | Whole diff under 1500 added lines, unless the node carries a `size_total` waiver Ahmed granted (ADR-029). Counts every added line of every file — comments and blanks included |

**The coverage denominator is the diff, not the repository (ADR-030).** The floor
never moved — 90 and 70 are what they always were — but it used to be handed to
vitest as a whole-repository threshold, which failed tasks on files they had
never opened and taught agents that the number was noise. `diff-cov` grades a
task on the lines it added. Only lines the report knows about count, and the
report contains only what `coverage.include` selects — `lib/**` and
`tests/differential/**` — so a change confined to `app/`, `scripts/`, `prisma/`
or documentation passes with "no coverable lines changed" rather than a bare
`pass`. Because diff coverage alone would let the total rot one uncovered file at
a time, `total-cov` ratchets the whole repository against `tests/baseline.json`;
that stored integer is read from the PR base as well as the branch, so lowering
it is treated exactly as lowering coverage and needs the same reasoned waiver.
Every one of these fails closed — a gate that measured nothing must never print
the same word as one that measured and passed.

**A check states what it measured, and refuses when it cannot (ADR-031).** The
suite reads two different subjects: `lint`, `types`, `tests` and `cov-report`
read the working tree, while `size-impl`, `size-total` and `diff-cov` read the
committed diff `origin/main...HEAD`. Run mid-edit those disagree, and the suite
reports on a state that exists nowhere — that is how `ALL GATES PASS` was printed
over a `size-total` of 2746 against a limit of 1700, the fourth time a check here
has measured the wrong subject while printing the same word a correct one prints.
So `gate.sh` names the commit on every run and refuses outright when anything it
measures is uncommitted, in `--summary` as much as in the full suite. Measured
means everything git tracks or would track, untracked files included, except
`package-lock.json` and whatever `.gitignore` covers. The price is that the gate
can no longer be run for a quick read mid-edit; commit or stash first.

The same rule closes the case where the measurement cannot be taken at all. If
the `git status` that reads the tree fails — `safe.directory` refusing a checkout
git does not own, a damaged index, a lock held by another process, no repository
— the gate refuses and prints git's message, rather than reading the empty result
as a clean tree. That failure direction is the defect itself, not a variant of
it: every later gate reads commits rather than the index, so a run over rubble
would otherwise measure normally and reach `ALL GATES PASS`. "The tree is dirty"
and "the tree could not be read" are different facts and print different words.

**The local gate runs the guard suite, so a broken guard is caught before the
PR.** Adding the refusal above broke every budget probe in
`scripts/test-guards.sh` — those fixtures were bare temp directories, not git
repositories — and `./scripts/gate.sh` still printed `ALL GATES PASS`, because
the guard suite ran only as a step of its own in `gates.yml`. A local gate that
omits a check the PR is judged on is the same defect one level up. It is now the
first line of the full suite and no longer a separate CI step: one invocation,
not two to keep in sync. The fixtures were fixed by making them real git
repositories with a clean tree — the state a real run requires — and not by
relaxing the refusal for anything shaped like a test.

Two size budgets rather than one, because a single number cannot serve both
jobs. `size-impl` forces a task to split, and an oversized task shows up in
implementation lines. `size-total` is a backstop on the whole PR. Tests count
only against the total, and the guard harness counts as tests: under one budget,
thorough tests compete with implementation for the same allowance, and the
cheapest way to pass is to write fewer of them — which would have the gate
paying an agent to skimp on exactly what CLAUDE.md calls non-negotiable.
Lockfiles are excluded from both.

**A comment is not implementation (ADR-035).** The 400 comes from the
SmartBear/Cisco study of reviewer cognitive load, and the same study found that
authors who *annotate* their changes ship materially fewer defects, because
annotating forces self-review. Charging annotations to the code budget makes
deleting them the cheapest path to green, which inverts the finding the
threshold rests on — the argument ADR-026 made for documentation and ADR-028 for
generated DDL, applied to the third artifact a reviewer reads. So `size-impl`
counts a `.ts` or `.tsx` line only when code survives on it once the compiler's
comment ranges are removed. It is a discount on the code budget and nothing
else: `size-total` still counts every line, because a comment-heavy diff is
still a large diff for a reviewer, and that is the budget which holds that line.
`scripts/size-impl.mjs` takes the measurement and fails closed — if it cannot
run, cannot reach the reader or cannot classify a file, `size-impl` FAILs rather
than reporting a count it did not take (ADR-031).

The differential gate is the one that makes autonomy defensible. A `money` task
merging without it is the failure mode that produces a wrong payslip.

---

## The loop

```
task graph → implementer ─┐
                          ├→ gates → reviewer → integrator → merge
      test-author ────────┘             │
                                        └─ fail → back to implementer (max 3)
                                        └─ business question → you
```

Three attempts, then it stops and asks. An agent that has failed the same gate
three times is not going to succeed on the fourth; it is going to start
weakening the gate.

---

## What still reaches you

By design, and it should be a handful of items per week rather than per hour:

1. **Business rule adjudication.** The differ found that the new code and the
   legacy system disagree. One of them is wrong and only you know which. This is
   the valuable one — it surfaces bugs in the current system.
2. **Approving the task graph** at the start of each phase.
3. **Anything an agent flags as ambiguous** in the specification.
4. **Cutover.**

Everything else — code, tests, review, merge — runs without you.

---

## Honest limits

**Where this runs, and what it costs.** Everything in `.claude/` — the
subagents, the commands, the guards, the gates — runs inside your local Claude
Code session on your existing subscription. No API key. The two CI workflows
that need Claude (`claude-review`, `claude-fix`) authenticate with the same
subscription via a token from `claude setup-token`, stored as the
`CLAUDE_CODE_OAUTH_TOKEN` secret; `gates.yml` needs no Anthropic credential at
all. The trade: subscription usage is capped, and a pipeline running several
Opus agents per task will feel those caps under heavy use. If you hit them,
that is the moment an API key becomes the pressure valve — pay-per-token,
uncapped — not before. `security-review.yml.disabled` is the one piece that
requires an API key; enable it when you have one.

**Autonomy compounds errors.** If the specification is wrong, the pipeline
builds the wrong thing efficiently and with full test coverage. The architecture
site is the specification — keep it accurate, and treat a spec fix as a
first-class task.

**Nobody will know the codebase.** This is the trade you are making
deliberately, and it is survivable if the documentation stays true, because the
documentation becomes the thing your team reasons about. It stops being
survivable if docs drift from code — so every task that changes behaviour
described in `docs/architecture/` must update the document in the same PR, and
the reviewer fails the review when it does not.

**The differential harness only covers what the legacy system does.** New
capability — the alert manager, work items, the rules engine — has no oracle.
For those, property-based tests plus your review of the *specification* (not the
code) is the control.
