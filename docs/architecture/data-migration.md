# Migration — current schema to target

> The current and target documents describe the same database evolving. Every structural change follows expand → migrate → contract: add the new shape, move data with the old still live, remove the old only when nothing reads it.

### Context

**The business problem.** The target schema differs from the live one in five structural ways, and the system is in daily use — there is no window in which to stop and convert everything.

**Why this exists as its own component.** A migration plan belongs in the architecture document because the target is only credible if there is a path to it. Each move here is also reversible partway, which is what allows them to ship independently rather than as one release.

**What it does.** It gives the ordered steps for each structural change, and the one sequencing constraint between them.

**How it works.** Every move follows **expand, migrate, contract**: add the new shape alongside the old, move data while both work, remove the old only when nothing reads it. Where data cannot be classified mechanically — invoices whose direction is genuinely ambiguous — the row is left null and queued for human review rather than guessed, and the column becomes mandatory only when the queue empties.

**Where it sits.** Precedes the enforcement work. Direction backfill comes first because the cash figure is wrong until it lands; enrolments precede the filing merge; the rest are independent.

## The five structural moves

| Move | Steps |
|---|---|
| **Document.direction** ([ADR-025](decisions.md#adr-025)) | Add nullable → backfill inbound where a vendor value exists → backfill outbound where the project route matched clientName → leave ambiguous rows NULL, exclude from cash figures, queue as work items → NOT NULL when the queue empties |
| **PaymentSchedule split** | Create SalarySchedule + LeaseSchedule → copy rows by parent docType → repoint payroll generation, expiry job, forecast → drop the shared table. isPaid/fxRateSnapshot become settlements during the copy |
| **TaxFiling merge** | Create TaxFiling → copy VatPayment + TaxPayment with obligationType from the enrolment → customDueDate moves to a deadline-monitor override → drop both tables |
| **Enrolments** | Create Regime rows per jurisdiction × obligation → convert VatConfig/TaxConfig to JurisdictionEnrolment → point TaxFiling at enrolmentId |
| **Settlements** | Create Settlement → synthesise one settlement per existing paid flag (full amount, settledAt from paidAt where present, method unknown) → derive isPaid everywhere → remove the six flags |


## Sequencing constraint

Direction backfill precedes any cash-figure work — the wallet is wrong until then. Enrolments precede the TaxFiling merge. Everything else is independent and can ship per-module behind the enforcement seams.

> **Note** — The developer question — what docType "invoice" was meant to cover — is now a cleanup detail, not a blocker: it only predicts how many rows land in the review queue at step 4 of the direction backfill.
