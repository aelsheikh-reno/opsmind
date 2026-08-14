# Billing

> What is billable, when, and how confidently. Stops at handoff: OpsMind cannot legally issue invoices in the UAE — only structured e-invoices via an accredited provider are valid tax invoices.

### Context

**The business problem.** Work gets delivered before it gets invoiced, and the gap is where services firms silently lose money — a milestone completed three weeks ago that nobody billed. Separately, the UAE now mandates electronic invoicing, and only invoices transmitted through an accredited provider are legally valid tax invoices.

**Why this exists as its own component.** Delivery and receivables are different responsibilities with different owners: Projects knows what was completed, Finance knows what is owed, and neither should hold the judgement of what is ready to bill. This module is that judgement, and it is separate precisely so the chasing of unbilled work has somewhere to live.

**What it does.** It tracks delivered-but-uninvoiced value as billable positions, chases the ones going stale, and hands them to Zoho when a project manager confirms they are ready.

**How it works.** A position moves pending → ready → handed off → issued. Only the project manager makes the first transition, because only delivery knows whether the client accepted the milestone; that transition also moves the amount from *expected* to *contracted* in the cash forecast. Handoff pushes the position's data to Zoho, which issues through the accredited provider and returns a reference stored against the position. Positions completed but still pending are registered as deadlines, so the revenue leak is chased by the same engine that chases visas.

**Where it sits.** Deliberately thin, and it stops at handoff. Building invoice issuance would mean becoming or integrating an accredited provider — a compliance product in its own right, not a PSA feature. That boundary is [ADR-016](decisions.md#adr-016), and it shapes this module more than any other decision.

| Owns | Detail |
|---|---|
| BillablePosition | projectId · milestoneId · amount · expectedDate · confidence · status: pending → ready → handed off → issued · externalRef to the Zoho record |
| Ready-to-bill | The PM marks it; the deadline monitor chases positions completed-but-unbilled — the classic services revenue leak |
| Issued-invoice reference | The invoice itself is Finance's open item and Zoho's document |


| Does not own | Because |
|---|---|
| Numbering, VAT computation, credit notes, dunning | The ASP mandate closes issuance off legally; Zoho and the accredited provider own it (ADR-016) |


The split follows order-to-cash in every major ERP: billing determines the amount; receivables owns the open item from issuance. The unusual part here is that issuance itself is external, making this module thinner than SAP's SD by design.
