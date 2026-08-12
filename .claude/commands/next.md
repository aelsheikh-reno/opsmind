---
description: Pick the next available task from the graph and build it.
---

Read `tasks/backlog.yaml` and select the highest-priority task whose
`depends_on` are all merged and whose status is not `done`.

Prefer, in order: a task unblocking the most other tasks; a lower `risk`; an
earlier `phase`.

State which task you chose and why, then run `/build-task <id>`.

If nothing is available, say what is blocking the graph rather than inventing
work.
