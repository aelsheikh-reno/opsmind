# The eight principles

> Every placement on this site was decided by applying these in order. When two collided, the decision record captures the argument.

> **Note** — **Why write principles down.** Architecture arguments are unwinnable without shared criteria — each side asserts a preference and the louder one wins. These eight are the criteria, agreed before the placements were made rather than reverse-engineered to justify them. The right-hand column shows what each one actually decided, which is the test of whether a principle is real: a rule that never rejected anything is decoration.

| # | Rule | Placements it decided |
|---|---|---|
| 01 | **A service owns its own data.** No shared database access, ever | FX classified as adapter; satellite stores; ownership map |
| 02 | **Extract only what a second product reuses unchanged** | The seven capability services; payroll and billing staying core |
| 03 | **Adapters fetch and return; the core persists** | All five adapters; Drive sync writing nothing itself |
| 04 | **The domain layer is framework-free**; transports are thin adapters | HTTP/MCP/scheduler as peers; logic leaving route handlers |
| 05 | **Inbound adapters contain no logic** — route, translate, compose only | The BFF decides nothing; composition ≠ decision |
| 06 | **Policy is centralised; execution lives with the data** | Authorization service + instance checks in modules; Work Items policy vs core execution; alert policies vs detection thresholds |
| 07 | **The record is the thing; the document is evidence** | Settlement vs receipt; enrolment vs certificate; position vs invoice PDF |
| 08 | **Don't rebuild the ledger or the tax engine** | Zoho boundary; billing stopping at handoff; estimates-only filings |

