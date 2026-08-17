---
description: Run one task from the backlog end to end — implement, test, gate, review, PR.
argument-hint: [task-id]
---

Run task `$1` from `tasks/backlog.yaml` through the full pipeline.

1. **Read the node.** Confirm every `depends_on` is merged. If not, stop and say
   which dependency is outstanding.

2. **Branch — without touching main.** The guards forbid checking out main, so
   branch directly from the remote ref:

   ```
   git fetch origin main
   git checkout -b task/$1 origin/main
   ```

3. **Arm the gates.** Write the task's node to `.task-current.yaml` in the repo
   root. `gate.sh` reads the risk level from this file; without it, every gate
   runs on the strict path. Do not commit this file.

4. **Plan, before a line is written.** Every node, no exceptions. State:

   - the files to be created or changed, with an estimated implementation line
     count for each
   - which assertions land in which file
   - whether the total clears `size-impl` 400 and the node's `size-total` budget
   - what the node depends on that is not yet merged

   **If the estimate exceeds either budget, propose the split IN THE PLAN and
   stop for Ahmed.** A split decided before building costs one message. A split
   decided after costs a rebuild, a rebase and a re-measure —
   `module-deadlines-sweep` was re-split three times because its shape was
   discovered while building.

   **If the plan and the built result diverge by more than 25% on
   implementation lines, say so explicitly in the report and explain what was
   missed.** An estimate nobody checks against the outcome never improves.

5. **Implement.** Delegate to the `implementer` subagent with the task node and
   its `spec` document. Do not implement in this context.

6. **Test, independently.** Delegate to `test-author` with the task node and the
   spec — and instruct it explicitly not to read the implementation.

7. **Differential, if `risk` is `money` or `compliance`.** Delegate to `differ`.
   Any difference it reports stops the pipeline and is escalated to Ahmed. Never
   resolve a difference yourself.

8. **Gates.** Run `./scripts/gate.sh`. On failure, hand the output back to
   `implementer`.

   **Three attempts for the whole task, counted across every gate.** Not three
   per gate. A restructure, a split, a waiver request and a fix each count as
   one. `module-deadlines-sweep` took six passes across four gates without ever
   tripping the old per-gate rule, because each gate counted separately.

   **On the third failure, STOP and ask Ahmed.** Give him: what failed each
   time, what changed between attempts, and two or three options with the
   trade-off of each **in plain business terms — no function names, no types**.
   Then wait. Do not attempt a fourth time, do not open a node to fix the
   blocking gate, and do not restructure again to fit a number.

9. **Review.** Delegate to `reviewer`. A `fail` verdict returns to step 8 with
   the findings, and counts against the same three. `reviewer` may not edit.

10. **Ship.** Remove `.task-current.yaml`, commit with a conventional message
   scoped to the module, push the task branch, and open a PR whose body lists:
   the task id, each assertion and whether it is met, the gate results, and any
   question for Ahmed.

11. **Merge policy by risk.**
    - `risk: low` → merge once CI is green, and merge ONLY through the guard:

      ```
      ./scripts/merge-when-green.sh <pr-number> squash
      ```

      Never call `gh api .../merge` or `gh pr merge` directly. The script
      re-reads the verdict immediately before merging and refuses on anything
      that is not SUCCESS, failing closed if it cannot read one at all. This is
      not ceremony: on #30 a polling loop treated a FAILURE verdict as a reason
      to stop waiting rather than a reason to stop, and the next command merged
      a red gate into main. There is no branch protection catching that
      server-side.
    - `risk: money` or `compliance` → never merge. Instead:
      `gh pr comment --body "risk: <risk> — waiting for Ahmed's review"`
      and leave the PR open. Human adjudication is the point of the tag.

12. **Flip the status**, and only through the script:

    ```
    ./scripts/mark-task-done.sh <task-id>
    ```

    Never edit `status:` by hand or with a one-off script. It anchors on the
    node id, edits that node's status line and nothing else, and reverts itself
    if the resulting diff is anything other than one changed line in one file.
    `tasks/backlog.yaml` has two writers, and a scripted edit anchored on a
    field name destroyed `staging-deploy`'s waiver reason in #30 — twelve nodes
    away from the one it meant. Commit the result to main as a follow-up.

## Verify before claiming

No claim of **passing**, **complete**, **verified**, **all gates pass** or
**mutations killed** may be made without, in the same message: the exact command
run, the commit it ran against, and its output.

**A claim relayed from a subagent is not a claim.** Re-run it, or attribute it
as unverified. This is not scepticism about subagents — it is that a claim and
its evidence travel separately, and only the evidence is checkable.

Two failures of exactly this kind, one week:

- `ALL GATES PASS` was reported from a run made **before** the commit it
  described. The gate measures the committed diff; the tree had moved under it.
- `23 mutations, zero survivors` was scored against a **red baseline**, counted
  a mutation as killed for turning an already-failing test green, and did not
  reproduce — an independent re-run found 13 survivors in 30.

Report at the end: task id, outcome, gates, and anything needing a human. If the
pipeline stopped, say at which step and why.
