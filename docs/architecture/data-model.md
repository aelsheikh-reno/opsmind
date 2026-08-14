# Data model

> The shapes that changed or are new in the target, at field level. Unchanged tables (most of Projects, most of Expenses) are not repeated here.

### Context

**The business problem.** Six tables carry a paid flag set by an AI extraction, invoices carry no direction, one schedule table serves both employment and leases, and two near-identical tables hold VAT and corporate tax. Each of those shapes produces a specific wrong answer.

**Why this exists as its own component.** The target schema is documented separately from the migration because they answer different questions: this page is what you write queries against, the migration page is how you get there. Keeping them apart means a developer reading field definitions is not wading through backfill steps.

**What it does.** It gives field-level shapes for every table that changes or is new, plus the two materialized views.

**How it works.** Structural fixes follow the vocabulary: schedules become per-module commitment tables, paid flags become settlement rows with an actor and an exchange-rate snapshot, terms become effective-dated rows so history stays answerable, and the two tax tables merge into one keyed by enrolment and period. Derived values — an open item's balance, whether something is paid — are computed from settlements rather than stored, which is why partial payments work and no boolean needs keeping in sync.

**Where it sits.** These are **target** shapes; today's database does not look like this. Text after `--` is explanation, not schema. Terms are defined on the [vocabulary page](data-vocabulary.md), and the path from here to there is [migration](data-migration.md).

> **Note** — **How to read this page.** These are target shapes, not current ones — the database today does not look like this. The [migration page](data-migration.md) explains how each one is reached from what exists, and no change here requires downtime. Field names in `monospace` are literal column names; comments after `--` explain intent rather than being part of the schema.

## Financial spine

#### `SalarySchedule · LeaseSchedule · LoanSchedule`

*per-module commitment tables — Payroll and Finance*

| Field | Type / values | Why |
|---|---|---|


#### `SalaryTerm`

*new · effective dating · ADR-022*

| Field | Type / values | Why |
|---|---|---|


#### `OpenItem`

*Finance · either direction*

| Field | Type / values | Why |
|---|---|---|


#### `Settlement`

*new · replaces six scattered paid flags · ADR-015*

| Field | Type / values | Why |
|---|---|---|


#### `TaxFiling`

*merged VAT + corporate tax · ADR-017*

| Field | Type / values | Why |
|---|---|---|


#### `BillablePosition`

*was ProjectInvoice · ADR-016*

| Field | Type / values | Why |
|---|---|---|


## Kernel additions

#### `Person`

*kernel · additions*

| Field | Type / values | Why |
|---|---|---|


#### `Document`

*kernel · addition*

| Field | Type / values | Why |
|---|---|---|


#### `LegalEntity`

*kernel · addition*

| Field | Type / values | Why |
|---|---|---|


#### `Jurisdiction`

*kernel · addition*

| Field | Type / values | Why |
|---|---|---|


#### `Regime`

*new · the law itself*

| Field | Type / values | Why |
|---|---|---|


#### `JurisdictionEnrolment`

*new · replaces VatConfig + TaxConfig*

| Field | Type / values | Why |
|---|---|---|


#### `DocumentType`

*registry · field schema, rules and retention*

| Field | Type / values | Why |
|---|---|---|


#### `FxRate`

*new table · replaces a JSON blob in Setting*

| Field | Type / values | Why |
|---|---|---|


#### `Scenario · ScenarioEvent`

*moved from browser localStorage into the database*

| Field | Type / values | Why |
|---|---|---|


## Views

#### `search_index`

*materialized view · ADR-006*

| Field | Type / values | Why |
|---|---|---|


#### `commitment_forecast`

*materialized view · feeds the cash flow view*

| Field | Type / values | Why |
|---|---|---|

