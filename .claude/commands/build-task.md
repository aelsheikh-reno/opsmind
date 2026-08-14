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

4. **Implement.** Delegate to the `implementer` subagent with the task node and
   its `spec` document. Do not implement in this context.

5. **Test, independently.** Delegate to `test-author` with the task node and the
   spec — and instruct it explicitly not to read the implementation.

6. **Differential, if `risk` is `money` or `compliance`.** Delegate to `differ`.
   Any difference it reports stops the pipeline and is escalated to Ahmed. Never
   resolve a difference yourself.

7. **Gates.** Run `./scripts/gate.sh`. On failure, hand the output back to
   `implementer`. Maximum three attempts, then stop and report — three failures
   on the same gate means the task or the spec is wrong, not the code.

8. **Review.** Delegate to `reviewer`. A `fail` verdict returns to step 7 with
   the findings. `reviewer` may not edit.

9. **Ship.** Remove `.task-current.yaml`, commit with a conventional message
   scoped to the module, push the task branch, and open a PR whose body lists:
   the task id, each assertion and whether it is met, the gate results, and any
   question for Ahmed.

10. **Merge policy by risk.**
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

11. **Flip the status**, and only through the script:

    ```
    ./scripts/mark-task-done.sh <task-id>
    ```

    Never edit `status:` by hand or with a one-off script. It anchors on the
    node id, edits that node's status line and nothing else, and reverts itself
    if the resulting diff is anything other than one changed line in one file.
    `tasks/backlog.yaml` has two writers, and a scripted edit anchored on a
    field name destroyed `staging-deploy`'s waiver reason in #30 — twelve nodes
    away from the one it meant. Commit the result to main as a follow-up.

Report at the end: task id, outcome, gates, and anything needing a human. If the
pipeline stopped, say at which step and why.
