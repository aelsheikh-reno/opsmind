# Projects & Delivery

> Delivery structure, effort capture and project profitability. The cleanest boundary in the current codebase: ten exclusively-owned models, three external dependencies.

### Context

**The business problem.** Reno sells engineers' time on client engagements. Whether a project made money depends on hours actually worked against hours sold, and on the cost of the people who worked them — so timesheets, allocations and salary costs have to meet somewhere.

**Why this exists as its own component.** Delivery structure is the vocabulary the whole business runs on: a project is referenced by billing, by expenses, by permissions and by the cash forecast. Concentrating it in one module with one owner is what stops four different definitions of "project status" appearing in four screens.

**What it does.** It holds the delivery structure — project, services, activities, milestones — captures effort through timesheets and allocations, and answers project health and utilisation questions.

**How it works.** Milestones carry completion state plus, in the target, a confidence level and an expected invoice date — judgements only a project manager can make, which is why they are captured rather than inferred. Marking a milestone complete produces a billable position in Billing; nothing is invoiced automatically. Team membership doubles as an authorization input: the instance-level check "is this manager on this project" is answered from ProjectTeamMember rather than duplicated into a policy service.

**Where it sits.** The cleanest boundary in the current codebase — ten tables nothing else writes, three external dependencies. It feeds Billing and the cash forecast, and reads Person and Document from the kernel. ProjectInvoice leaves this module in the target: it was never an invoice, it was the thing that becomes one.

| Owns | Detail |
|---|---|
| Project · services · activities | Delivery structure per client engagement |
| Milestones | completionPercent, completedAt, plus target additions: confidence and expectedInvoiceDate — delivery judgements only a PM can make |
| Timesheets | Import, parse, reconcile against allocations |
| Team & allocations | Membership drives instance-level authorization (a PM sees their projects) |


| Exposes | Depends on |
|---|---|
| getProjectHealth(projectId) | Person · Document · LegalEntity |
| importTimesheet(projectId, file) | Asana adapter |
| getUtilisation(period) | Billing consumes completed milestones |


ProjectInvoice leaves this module and becomes **BillablePosition** in Billing — it was never an invoice, it was the thing that becomes one ([ADR-016](decisions.md#adr-016)).
