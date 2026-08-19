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
   **`docs/architecture/lessons.md`**, which is every defect this build has
   already had. Every agent starts cold; that file is the only thing carrying
   what the last one learned. It is short on purpose.

6. **Test what the diff did, not what the node describes in the abstract.**
   Delegate to `test-author` — **but only when something asks for tests.**

   Run the gate first and read `diff-cov`. If it reports **"no coverable lines
   changed"**, the coverage floor wants nothing: the change is shell, config or
   documentation, and the implementer's own probes — construct the violation,
   observe the refusal — are the evidence. Persist those probes and skip the
   agent. Two pipeline nodes spent 58 minutes on tests **no gate required**.

   When tests ARE required, brief `test-author` on **the diff**: the node's
   assertions are the specification, the diff is the surface to cover. Anything
   in the diff no assertion reaches is either untested behaviour or an
   unrequested feature; anything in the assertions the diff does not reach is
   unimplemented. **Both are findings, and both are cheaper to report than to
   paper over with a new test nobody asked for.**

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

11. **Merge policy.** Every task merges the same way, and ONLY through the
    guard:

      ```
      ./scripts/merge-when-green.sh <pr-number> squash
      ```

      Never call `gh api .../merge` or `gh pr merge` directly. The script
      re-reads the verdict immediately before merging and refuses on anything
      that is not SUCCESS, failing closed if it cannot read one at all. This is
      not ceremony: on #30 a polling loop treated a FAILURE verdict as a reason
      to stop waiting rather than a reason to stop, and the next command merged
      a red gate into main.

      `risk: money` and `risk: compliance` NO LONGER HOLD the pull request for a
      human to merge (ADR-041, Ahmed 2026-08-18). What the tag still buys is the
      part that catches a wrong number: a differential test against the legacy
      system, and a 90% floor on the lines the task changed. A disagreement with
      the legacy system turns the gate RED, which stops the merge and reaches
      Ahmed as a business-rule adjudication — the hold was never what caught
      that.

      STOP AND ASK ANYWAY, tag or no tag, when the differ reports a
      disagreement, when the specification is ambiguous, or when finishing the
      task would mean inventing a business rule. Those reach Ahmed on their own
      merits.

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
