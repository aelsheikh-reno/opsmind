# Payroll

> Payroll runs and the statutory obligations they generate, per jurisdiction. Reads contract terms, applies prorata and exits, produces entries, emits open items to Finance.

### Context

**The business problem.** Reno employs people in several countries, and each deducts differently — Egyptian income tax brackets and social insurance ceilings, UAE gratuity accrual. People join and leave mid-month, take unpaid leave, get raises. Salary is also the largest and most predictable cash outflow, so payroll is where cash forecasting begins.

**Why this exists as its own component.** Payroll is the clearest case of company-specific logic: no second product would use Reno's rules unchanged, so it fails the test for extraction as a shared service. It is separate from Finance because calculating what someone is owed and tracking what the company owes are different responsibilities — Payroll produces the number, Finance ages and settles it.

**What it does.** It converts employment contracts into schedules of future obligations, calculates each month's actual payment including statutory deductions and prorata, and hands the resulting amounts owed to Finance.

**How it works.** Contract terms are stored as **effective-dated rows** rather than edited in place, so a raise inserts a new term and regenerates only unconverted future schedule rows — already-paid periods are immutable. Monthly generation is idempotent: re-running adds only missing people. Statutory deduction rates come from the Regime kernel rather than being hardcoded, so a bracket change is data. Exchange rates are snapshotted per processed month, so a historical payslip never changes retroactively.

**Where it sits.** A core module owning four tables. It reads Person, LegalEntity and Regime from the kernel, calls Docgen for payslips, and emits open items into Finance. Statutory deductions live here rather than in a separate tax component because they change net pay — splitting them would divide one payslip across a boundary.

| Owns | Detail |
|---|---|
| PayrollRun · PayrollEntry | Monthly generation is idempotent — re-running adds only missing people |
| SalarySchedule | Commitments from employment contracts, generated at ingestion; effective-dated terms handle uplifts (ADR-022) |
| Prorata & exits | Leavers pro-rated from contractEnd; exit truncates forward schedule rows |
| Statutory deductions | Egypt income tax brackets, social insurance caps — computed here because they alter net pay; splitting them would divide one payslip across a boundary |


| Exposes | Depends on |
|---|---|
| calculatePayrollRun(period, entityId) | Person · LegalEntity · Regime (rates, brackets) |
| previewExit(personId, exitDate) | FX (month-locked snapshots — a processed month keeps its rate forever) |
| getScheduledOutflows(horizon) | Docgen (payslip PDF + email from one template) · Finance (open items, settlements) |


> **Note** — The three-stage flow — schedule (commitment) → run (calculation) → settlement — matches how the current code already behaves; the target names it and moves the leaked settlement fields (isPaid, fxRateSnapshot) off the schedule. See [contract to cash](flows-contract-to-cash.md).
