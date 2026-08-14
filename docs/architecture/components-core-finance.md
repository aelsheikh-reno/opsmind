# Finance

> Open items, settlements, budgets, filings, schedules and the forward projection behind the cash flow view. The financial spine — but never the ledger.

### Context

**The business problem.** A services business fails on cash timing rather than on profit: salaries leave monthly and reliably, client payments arrive late and unpredictably, and tax filings fall due on fixed dates in several countries at once. The question that matters is "what will the bank balance be in eleven weeks", and answering it needs every future inflow and outflow in one place.

**Why this exists as its own component.** Every module generates money events, but nobody except Finance can see them together — and a forecast assembled per-screen is a forecast that disagrees with itself. This module exists to be the single place where amounts owed, amounts paid and amounts promised are reconciled into one forward view.

**What it does.** It owns open items, settlements, tax filings, lease and loan schedules, budgets, and the projection behind the cash flow view.

**How it works.** Money moves through three objects that convert rather than copy: a **commitment** (promised by contract) becomes an **open item** (owed now) becomes a **settlement** (paid). A commitment marked converted leaves the forecast, which is what prevents double counting. Settlements are recorded here first and pushed to Zoho with an idempotency key, retry, and a visible list of anything unpushed — so a Zoho outage delays synchronisation without losing the record. The forecast itself is a materialized view refreshed on commitment-affecting writes, and it displays its own refresh time rather than pretending to be live.

**Where it sits.** The largest core module, and the one most needing its boundary stated: **Finance is not the accounting ledger.** Zoho Books holds the books and computes the tax return; OpsMind owns the operational record, gates payments, and produces the forward view Zoho cannot. Vocabulary is defined on the [vocabulary page](data-vocabulary.md).

| Owns | Detail |
|---|---|
| Open items | Outstanding amounts, either direction, aged in standard buckets |
| Settlements | Payments applied — partial supported, both directions, pushed to Zoho with idempotency key, retry, and a visible unpushed list (ADR-015) |
| TaxFiling | One merged table (VAT + corporate tax), per enrolment per period; estimatedAmount is for forecasting only — the return is computed in Zoho (ADR-017) |
| Lease & loan schedules | Commitment tables for non-employment contracts |
| Cash projection | Reads commitment_forecast + open items + Billing's expected inflows; buckets, confidence tiers, refreshed_at shown (ADR-019) |


| Exposes | Depends on |
|---|---|
| recordSettlement(entityRef, amount, direction, …) | Regime · JurisdictionEnrolment · FX |
| getOpenItems(filters) · projectCash(scenario, horizon) | Payroll · Billing · Expenses streams · Zoho adapter |


> **Note** — isPaid stops being an AI-extracted guess anywhere in the system: settlement is a recorded event with an actor, a date and an FX snapshot. The six scattered paid flags in the current schema all become settlement records ([migration](data-migration.md)).
