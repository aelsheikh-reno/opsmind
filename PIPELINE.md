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
    - gates: [lint, types, boundaries, tests, coverage]
    - assertions:
        - "Person has managerId self-relation"
        - "PersonEnrolment supports multiple jurisdictions per person"
  risk: low          # low | money | compliance
```

`risk` drives routing. `money` and `compliance` tasks require a differential
test against the legacy system and cannot auto-merge without one.

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
| `lint` | Style, plus the module-boundary import rules |
| `types` | `tsc --noEmit`, no `any` introduced in a diff |
| `boundaries` | No module writes another's tables; no page imports a module; only `repository.ts` touches the database |
| `tests` | Unit and integration pass |
| `coverage` | 90% on anything computing money or dates; 70% elsewhere |
| `differential` | Output matches the legacy system on the golden dataset, or the difference is explicitly approved |
| `security` | `claude-code-security-review` finds nothing high |
| `size` | Diff under 400 lines, or the task is split |

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
