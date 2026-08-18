# Data model

> The shapes that changed or are new in the target, at field level. Unchanged tables (most of Projects, most of Expenses) are not repeated here.

### Context

**The business problem.** Six tables carry a paid flag set by an AI extraction, invoices carry no direction, one schedule table serves both employment and leases, and two near-identical tables hold VAT and corporate tax. Each of those shapes produces a specific wrong answer.

**Why this exists as its own component.** The target schema is documented separately from the migration because they answer different questions: this page is what you write queries against, the migration page is how you get there. Keeping them apart means a developer reading field definitions is not wading through backfill steps.

**What it does.** It gives field-level shapes for every table that changes or is new, plus the two materialized views.

**How it works.** Structural fixes follow the vocabulary: schedules become per-module commitment tables, paid flags become settlement rows with an actor and an exchange-rate snapshot, terms become effective-dated rows so history stays answerable, and the two tax tables merge into one keyed by enrolment and period. Derived values — an open item's balance, whether something is paid — are computed from settlements rather than stored, which is why partial payments work and no boolean needs keeping in sync.

**Where it sits.** These are **target** shapes; today's database does not look like this. Text after `--` is explanation, not schema. Terms are defined on the [vocabulary page](data-vocabulary.md), and the path from here to there is [migration](data-migration.md).

> **Note** — **How to read this page.** These are target shapes, not current ones — the database today does not look like this. The [migration page](data-migration.md) explains how each one is reached from what exists, and no change here requires downtime. Field names in `monospace` are literal column names; comments after `--` explain intent rather than being part of the schema.

> **Note** — **Civil dates are stored at UTC midnight and never localised.** A period end, a filing due date and a document expiry name a calendar day, not an instant, and are stored as `@db.Date` at UTC midnight. They are rendered directly from storage — never timezone-converted for display. If a UI shows a different calendar day, that is a display bug and not a reason to change storage. **Instants** are a separate thing and keep full timezone information: `settledAt`, `createdAt`, `filedAt`, `redactedAt`.
>
> This is not cosmetic. The legacy build constructs period ends with `new Date(year, month, 0)` — *local* midnight — which makes a statutory date depend on the server's timezone. Compared against the legacy oracle on a UTC+3 machine, a UAE VAT due date came out as 2024-04-27 against legacy's 2024-04-28. **Resolved in the legacy system's favour — the first difference to be so.** Ahmed's decision, 2026-08-14: 2024-04-28 is correct. UAE VAT is due on the 28th day following the end of the tax period (Federal Decree-Law No. 8 of 2017, Article 64), and 31 March + 28 days is 28 April. The oracle was right and the discrepancy was in the new build's test frame, not its arithmetic: production reads period ends from `@db.Date` at UTC midnight and always produced 28 April; the 27th appeared only where a test read legacy's *local*-midnight value in UTC and shifted the input a day. The storage convention above still stands and is what keeps the two frames from being confused again. Confirming the statutory date itself with the accountant is tracked in [open items](open-items.md); the storage convention is right regardless of that answer.

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
| `dueDate` | date | The date the filing must actually be made by. The **statutory** date is `periodEnd + Regime.deadlineDays` in plain **calendar** days — UAE VAT is the 28th day after the period ends (Federal Decree-Law No. 8 of 2017, Art. 64), so a period ending 31 March is 28 April. If that day is a weekend or a public holiday in the jurisdiction's calendar it **moves forward to the next working day**: the statute counts calendar days, but it does not require filing on a day the portal and the bank are shut. Rolling forward, never back — rolling back would file against a statutory date that has not arrived |
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
| `direction` | inbound \| outbound | **NOT NULL.** The fix for supplier bills counted as income. Cutover resolves direction before insert; an unresolvable row is held in migration tooling and never reaches this table ([ADR-027](decisions.md#adr-027)) |


#### `LegalEntity`

*kernel · addition*

| Field | Type / values | Why |
|---|---|---|
| `role` | self \| client \| vendor | Stops entities being auto-created from fuzzy name matches |


#### `Jurisdiction`

*kernel · addition*

| Field | Type / values | Why |
|---|---|---|
| `BusinessCalendar` | weekend mask + holidays[] + `timeZone` | Sunday–Thursday in the Gulf; deadline maths cannot be UTC arithmetic. Three columns, not two: the working week, the days off it, and the zone the day itself is read in |
| `BusinessCalendar.timeZone` | IANA zone | **Required, and with no default.** The zone whose **civil date** is "today" in this jurisdiction — `Asia/Dubai`, `Africa/Cairo`. It sits on the calendar rather than on `Jurisdiction` because **Jurisdiction is identity and BusinessCalendar is the civil-time rules**, beside the weekend mask and the holidays. The deadline sweep fires at 02:00, which in the Gulf is 22:00 the previous UTC day, so a run scored against UTC warns a day late — every threshold window shifts by one, and on the last night before a filing the following night is after the deadline. No default, for the same reason: a zone nobody chose is that same defect written down once and then trusted. Ahmed's decision, 2026-08-14 ([deadline monitor](components-core-deadline-monitor.md)). **And never `UTC` itself.** Required-with-no-default stops the zone being *inherited*; it does not stop it being *typed*, and `UTC` is a real IANA name that any validator asking only "can `Intl` read this" accepts. A calendar carrying it is the exact defect the column exists to prevent, chosen by hand and invisible thereafter. Refused on write, together with every equivalent spelling (`Etc/UTC`, `Etc/GMT`, `GMT`, `Zulu`, `UCT`) and the fixed offsets `Etc/GMT±N`, which have no civil rules to follow when a country moves its clocks. The test is the **name denoting a place**, not the offset: `Africa/Abidjan` is at UTC+0 and stays valid. The refusal names the zone that jurisdiction actually uses — AE `Asia/Dubai`, EG `Africa/Cairo`, SA `Asia/Riyadh`, KW `Asia/Kuwait`, BH `Asia/Bahrain` — because a refusal that does not say what to type instead gets worked around. A jurisdiction outside those five is named, not guessed at, exactly as the backfill migration aborts rather than inventing a zone. Ahmed's decision, 2026-08-16 |


#### `Regime`

*new · the law itself*

| Field | Type / values | Why |
|---|---|---|
| `jurisdictionId` | → Jurisdiction |   |
| `obligationType` | vat \| corporate_tax \| social_insurance \| … | A **closed set**, not a free string. The `…` means the set grows by migration as regimes are added; it does not mean any value is acceptable. An unvalidated type lets an extraction write `VAT`, `vat_uae` and `Vat` as three regimes no filing query reunites |
| `rate, deadlineDays` | decimal, integer | Extracted from hardcoded values in the current build |
| `thresholds, brackets` | JSON | Egyptian income tax bands, registration thresholds |


#### `JurisdictionEnrolment`

*new · replaces VatConfig + TaxConfig*

| Field | Type / values | Why |
|---|---|---|
| `legalEntityId, regimeId` | → LegalEntity, → Regime | Applies to counterparties too — a UAE invoice carries the customer's TRN |
| `identifier` | string | TRN or equivalent registration number |
| `frequency, anchor` | enum, date | monthly \| quarterly \| semiannual \| annual, and what the period aligns to. **annual is required** — UAE corporate tax is filed annually, so without it a CT registration is unrepresentable; semiannual lands with it rather than being discovered as the next gap |
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


## Deadline monitor

Both tables are new, and every field is derived rather than specified: from `registerDeadline(entityRef, type, dueDate)`, from the fingerprint format `{tenant}:{app}:{source}:{entity}:{policy}`, from thresholds and severities being per deadline type, from runs being stateless, and from the business calendar. Neither table records what a previous run warned about — that is what makes a missed night self-heal ([deadline monitor](components-core-deadline-monitor.md)).

#### `DeadlineRegistration`

*new · one watched date · deadline monitor*

| Field | Type / values | Why |
|---|---|---|
| `entityType, entityId` | reference | `entityRef`, split into the two parts the fingerprint's entity segment is built from — `…:document:123:expiry`. No foreign key: the target may be a Document, a TaxFiling or a BillablePosition, each owned elsewhere, and a cross-owner FK is what stops a module being extracted later ([ADR-021](decisions.md#adr-021)) |
| `deadlineType` | string | The `type` argument. The key thresholds are read by, and the fingerprint's policy segment |
| `dueDate` | date | The `dueDate` argument. A date, not a timestamp — distance is counted in whole days. For a filing it is `periodEnd + Regime.deadlineDays` in plain calendar days and may land on a Friday |
| `jurisdictionId` | reference | Which `BusinessCalendar` measures the distance. Business days are counted against the jurisdiction's calendar, so a registration that cannot name its jurisdiction cannot be scored; a jurisdiction with no calendar is an error, never a Saturday–Sunday fallback. An id with no relation — the Kernel owns `Jurisdiction`, and this module reads it through the kernel interface rather than joining |
| `@@unique` | (entityType, entityId, deadlineType) | One registration per fingerprint. Two rows would compute one identity and report it twice; it also makes re-registering idempotent |
| ~~lastWarnedAt~~ | timestamp | Deliberately absent — a run recomputes from today and remembers nothing about yesterday |


#### `ThresholdTable`


> **No jurisdiction column, deliberately** ([ADR-044](decisions.md#adr-044)). One row applies to all five jurisdictions, so configuring a type fixes it everywhere at once and there is no half-configured state. What that gives up is a jurisdiction needing different notice from its neighbours — read the ADR before adding the column, because the alerting behaviour above it depends on the fault being global.

*new · detection tuning · [ADR-020](decisions.md#adr-020)*

| Field | Type / values | Why |
|---|---|---|
| `deadlineType` | string | Matches `DeadlineRegistration.deadlineType`. Thresholds are per type |
| `businessDaysBefore` | integer | The window, measured in business days against the jurisdiction calendar. Several rows per type, so warnings escalate. A window is **inclusive at its bound** — exactly seven days remaining breaches a seven-day rule — and where two windows are breached the **more severe** one wins, never the tighter one ([deadline monitor](components-core-deadline-monitor.md)) |
| `severity` | minor \| major | Detection decides severity; the Alert Manager consumes it and never judges it. Only the two values the spec attests exist — adding a level is a migration rather than an invented compliance value |
| `@@unique` | (deadlineType, businessDaysBefore) | One severity per window per type, so the reported severity cannot depend on row order |
| `—` | data, not code | Rows are edited in Settings without a deployment, exactly as a SOC tunes detection rules |


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

