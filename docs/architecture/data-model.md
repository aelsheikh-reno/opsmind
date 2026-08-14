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
| `documentId` | → Document | The contract that created this schedule |
| `dueDate` | date |   |
| `amount, currency` | decimal, ISO-4217 |   |
| `confidence` | contracted \| expected \| provisional | How firm the obligation is; drives the forecast tier |
| `status` | pending → converted \| cancelled | **converted** leaves the forecast, so nothing is counted twice |
| ~~isPaid~~ | boolean | Removed — payment state becomes a Settlement row |
| ~~fxRateSnapshot~~ | decimal | Removed — belongs to the settlement, not the promise |


#### `SalaryTerm`

*new · effective dating · ADR-022*

| Field | Type / values | Why |
|---|---|---|
| `contractId` | → contract |   |
| `effectiveFrom` | date | When this version of the terms starts |
| `effectiveTo` | date \| null | null means current; rows are never edited in place |
| `amount, currency` | decimal, ISO-4217 |   |
| `components` | JSON | Allowances and their individual treatment |
| `reason` | hire \| uplift \| promotion \| indexation | Why the terms changed — visible in payroll history |


#### `OpenItem`

*Finance · either direction*

| Field | Type / values | Why |
|---|---|---|
| `entityRef` | reference | What is owed against |
| `direction` | inbound \| outbound | Receivable or payable — one table, both directions |
| `amount, currency` | decimal, ISO-4217 |   |
| `dueDate` | date | Drives ageing buckets and the deadline monitor |
| `balance` | derived | amount − Σ settlements. Never stored, so partials cannot drift |
| `externalRef` | string \| null | The Zoho identifier where the item was issued there |


#### `Settlement`

*new · replaces six scattered paid flags · ADR-015*

| Field | Type / values | Why |
|---|---|---|
| `entityRef` | open_item \| expense \| payroll_entry \| tax_filing | What was paid |
| `direction` | inbound \| outbound |   |
| `amount, currency` | decimal, ISO-4217 | Partial amounts are normal, not exceptional |
| `fxRateSnapshot` | decimal | The rate at settlement — a processed month never changes retroactively |
| `settledAt` | timestamp |   |
| `method` | enum | Bank transfer, card, cash, offset |
| `zohoRef` | string \| null | Set once the push succeeds; null means still queued |
| `documentId` | → Document \| null | The receipt, as evidence |
| `recordedBy` | → User | An actor, not an AI extraction |


#### `TaxFiling`

*merged VAT + corporate tax · ADR-017*

| Field | Type / values | Why |
|---|---|---|
| `enrolmentId` | → JurisdictionEnrolment | Which registration this filing belongs to |
| `periodStart, periodEnd` | date | The period being filed for |
| `dueDate` | date | Computed from the regime, business-day aware |
| `estimatedAmount` | decimal | **Forecasting only** — the authoritative return is computed in Zoho |
| `status` | pending \| filed \| paid |   |
| `filedAt` | timestamp \| null |   |
| `documentId` | → Document \| null | The submitted return, as evidence |
| `@@unique` | (enrolmentId, periodStart) | One filing per registration per period, enforced |


#### `BillablePosition`

*was ProjectInvoice · ADR-016*

| Field | Type / values | Why |
|---|---|---|
| `projectId, milestoneId, serviceId` | → Projects | What was delivered |
| `amount, currency` | decimal, ISO-4217 |   |
| `expectedDate` | date | When it should be invoiced |
| `confidence` | contracted \| expected \| provisional | Feeds the inflow forecast |
| `status` | pending → ready → handed_off → issued | Only a PM makes the first transition |
| `externalRef` | string \| null | The Zoho invoice once issued |


## Kernel additions

#### `Person`

*kernel · additions*

| Field | Type / values | Why |
|---|---|---|
| `managerId` | → Person | Org chart — required to resolve who approves what |
| `PersonEnrolment` | new relation | Social insurance and tax identifiers, per jurisdiction, with validity dates |


#### `Document`

*kernel · addition*

| Field | Type / values | Why |
|---|---|---|
| `direction` | inbound \| outbound \| null | Nullable during backfill; the fix for supplier bills counted as income (ADR-025) |


#### `LegalEntity`

*kernel · addition*

| Field | Type / values | Why |
|---|---|---|
| `role` | self \| client \| vendor | Stops entities being auto-created from fuzzy name matches |


#### `Jurisdiction`

*kernel · addition*

| Field | Type / values | Why |
|---|---|---|
| `BusinessCalendar` | weekend mask + holidays[] | Sunday–Thursday in the Gulf; deadline maths cannot be UTC arithmetic |


#### `Regime`

*new · the law itself*

| Field | Type / values | Why |
|---|---|---|
| `jurisdictionId` | → Jurisdiction |   |
| `obligationType` | vat \| corporate_tax \| social_insurance \| … |   |
| `rate, deadlineDays` | decimal, integer | Extracted from hardcoded values in the current build |
| `thresholds, brackets` | JSON | Egyptian income tax bands, registration thresholds |


#### `JurisdictionEnrolment`

*new · replaces VatConfig + TaxConfig*

| Field | Type / values | Why |
|---|---|---|
| `legalEntityId, regimeId` | → LegalEntity, → Regime | Applies to counterparties too — a UAE invoice carries the customer's TRN |
| `identifier` | string | TRN or equivalent registration number |
| `frequency, anchor` | enum, date | Monthly or quarterly, and what the period aligns to |
| `activeFrom, activeTo` | date | Registration is not permanent |
| `sourceDocumentId` | → Document | The certificate, as evidence |
| `@@unique` | (legalEntityId, regimeId) | One registration per entity per regime |


#### `DocumentType`

*registry · field schema, rules and retention*

| Field | Type / values | Why |
|---|---|---|
| `type, label, category` | string |   |
| `fields` | JSON | The extraction schema handed to the parser on every call |
| `retentionYears, retentionBasis` | integer, enum | See retention |
| `erasureMode` | redact_personal \| full_delete |   |


#### `FxRate`

*new table · replaces a JSON blob in Setting*

| Field | Type / values | Why |
|---|---|---|
| `base, quote` | ISO-4217 |   |
| `rate` | decimal |   |
| `asOf` | date | Snapshots are taken from here and never recomputed |


#### `Scenario · ScenarioEvent`

*moved from browser localStorage into the database*

| Field | Type / values | Why |
|---|---|---|
| `ownerId` | → User | Scenarios become shareable and auditable rather than per-browser |
| `events` | rows | Hypothetical hires, delays, price changes overlaid on the forecast |


## Views

#### `search_index`

*materialized view · ADR-006*

| Field | Type / values | Why |
|---|---|---|
| `entity_type, entity_id` | reference | What this row points at |
| `title, snippet` | text | What the user sees in results |
| `section` | enum | Filtered at query time against the caller's live grants |
| `legal_entity_id` | reference | Entity-scope filtering |
| `search_vector` | tsvector (GIN) |   |
| `—` |   | Sensitive fields never enter this index, so a search bug cannot leak salaries |


#### `commitment_forecast`

*materialized view · feeds the cash flow view*

| Field | Type / values | Why |
|---|---|---|
| `source_module` | enum | Which schedule table the row came from |
| `entity_ref` | reference |   |
| `due_date, amount, currency` | date, decimal, ISO-4217 |   |
| `direction` | inbound \| outbound |   |
| `confidence` | contracted \| expected \| provisional | The three certainty tiers shown in the cash view |
| `status` | pending only | Converted commitments are excluded — this is what prevents double counting |
| `refreshed_at` | timestamp | Displayed in the UI rather than pretending to be live |

