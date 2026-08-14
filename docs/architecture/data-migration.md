# Migration — current schema to target

> The current and target documents describe the same database evolving. Every structural change follows expand → migrate → contract: add the new shape, move data with the old still live, remove the old only when nothing reads it.

### Context

**The business problem.** The target schema differs from the live one in five structural ways, and the system is in daily use — there is no window in which to stop and convert everything.

**Why this exists as its own component.** A migration plan belongs in the architecture document because the target is only credible if there is a path to it. Each move here is also reversible partway, which is what allows them to ship independently rather than as one release.

**What it does.** It gives the ordered steps for each structural change, and the one sequencing constraint between them.

**How it works.** Every move follows **expand, migrate, contract**: add the new shape alongside the old, move data while both work, remove the old only when nothing reads it. Where data cannot be classified mechanically — invoices whose direction is genuinely ambiguous — the row is never guessed. In the new build it is also never inserted: `Document.direction` is NOT NULL there, so the import resolves direction before insert, and a row it cannot resolve is held in the migration tooling and queued for human review outside the target tables ([ADR-027](decisions.md#adr-027)). The target database therefore never holds a row whose direction is unknown.

**Where it sits.** Precedes the enforcement work. Direction backfill comes first because the cash figure is wrong until it lands; enrolments precede the filing merge; the rest are independent.

## The five structural moves

| Move | Steps |
|---|---|
| **Document.direction** ([ADR-027](decisions.md#adr-027)) | Resolve direction in the import: inbound where a vendor value exists, outbound where the project route matched clientName → a row that resolves is inserted with its direction set → a row that does not is **quarantined in the migration tooling and never inserted**, and queued as a work item. The column is NOT NULL from the first migration; there is no nullable phase and no later contract step. ADR-025's expand-migrate-contract applies to the legacy database evolving in place, not to this build. |
| **PaymentSchedule split** | Create SalarySchedule + LeaseSchedule → copy rows by parent docType → repoint payroll generation, expiry job, forecast → drop the shared table. isPaid/fxRateSnapshot become settlements during the copy |
| **TaxFiling merge** | Create TaxFiling → copy VatPayment + TaxPayment with obligationType from the enrolment → customDueDate moves to a deadline-monitor override → drop both tables |
| **Enrolments** | Create Regime rows per jurisdiction × obligation → convert VatConfig/TaxConfig to JurisdictionEnrolment → point TaxFiling at enrolmentId |
| **Settlements** | Create Settlement → synthesise one settlement per existing paid flag (full amount, settledAt from paidAt where present, method unknown) → derive isPaid everywhere → remove the six flags |


## Sequencing constraint

Direction backfill precedes any cash-figure work — the wallet is wrong until then. Enrolments precede the TaxFiling merge. Everything else is independent and can ship per-module behind the enforcement seams.

> **Note** — The developer question — what docType "invoice" was meant to cover — predicts how many rows land in the review queue rather than being inserted. Under [ADR-027](decisions.md#adr-027) that queue sits in front of the import, not inside the target database, so an unresolved row blocks its own migration until a human decides. It is a throughput question, not a correctness one.
