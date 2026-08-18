# Open items

> The honest remainder. The table below is deferred configuration and scoped
> follow-ups, none of which blocks the build.
>
> **The spec-coverage section beneath it is different in kind and does block.**
> Twenty-one named tables have no field-level shape and are not built, so a task
> reaching those modules has nothing to build to. It is recorded here rather than
> in the backlog because the answer is a specification, not an implementation.

| Item | Status | Trigger to close |
|---|---|---|
| Alert tuning values — group_wait, group_interval, inhibition rule sets, escalation chains | Deferred configuration | Real alert traffic, i.e. the SOC product connecting |
| Observability backend choice | Deferred, instrumentation already in | Traffic worth looking at |
| The developer question: what docType "invoice" was meant to cover | Demoted to cleanup detail | Ask when convenient; it only sizes the direction-backfill review queue |
| Retention periods per type | Architecture done; values pending | Accountant confirmation per jurisdiction |
| Which VAT tax period each of our registrations is assigned | Architecture done; the assignment is not | Accountant confirmation — ask alongside the retention periods above. The **28-day rule itself is settled** (Federal Decree-Law No. 8 of 2017, Art. 64) and is not blocking; what we do not know is whether a given registration files monthly or quarterly, and from which anchor. That is `JurisdictionEnrolment.frequency` and `anchor` — data, not structure |
| Unbuilt routes (/ai · /intel · /risk · /operations · /resources) | Product decision | Roadmap call: build or remove from navigation |
| ProjectDetailClient split plan | Engineering task | Scheduled alongside the presentation-zone enforcement |


## Tables named in the ownership map with no field-level shape

> Measured 2026-08-18 by `spec-coverage-audit`, cross-referencing every table in
> [data-ownership.md](data-ownership.md) against the entity cards in
> [data-model.md](data-model.md). **26 of 48 named tables have no card.**
> Nothing here is a proposal — no shape is invented by that task, deliberately,
> so that a data model is never designed inside an implementation PR under a size
> budget.

`data-model.md` says up front that it covers "the shapes that changed or are new
in the target" and does not repeat unchanged tables. That is coherent for a
refactor of a live database, where the unrepeated tables already exist and can be
read. **This is a greenfield build**, so an unrepeated table is not an existing
shape — it is no shape at all, and the gap surfaces only when a task reaches the
module and finds nothing to build to. `module-deadlines` hit exactly that
mid-PR.

### Built already, with no written shape — the schema is the only record

These five exist in `prisma/schema.prisma` and are in service. The risk is not
that a task is blocked; it is that the schema is the sole statement of intent, so
there is nothing to check it against and nothing that says *why* a column is
shaped as it is.

| Owner | Table |
|---|---|
| Kernel | `PersonEnrolment` |
| Kernel | `BusinessCalendar` |
| Kernel | `BusinessHoliday` |
| Kernel | `User` |
| Kernel | `AuditEntry` |

### Not built, and nothing to build to

A task reaching any of these finds a name in one cell of the ownership map and
nothing else. Three modules have **no** field-level specification whatsoever.

| Owner | Tables with no card | Cards that do exist |
|---|---|---|
| **Projects** | `Project` · `ProjectService` · `ProjectActivity` · `ProjectMilestone` · `Timesheet` · `TimesheetEntry` · `ProjectTeamMember` · `ProjectMemberAllocation` · `ProjectAiSuggestion` · `ProjectDocumentLink` | none — 10 of 10 missing |
| **Expenses** | `Expense` · `ExpenseAttachment` · `PettyCashFloat` · `ClaimToken` | none — 4 of 4 missing |
| **Ingestion** | `IngestionRun` · `ReviewQueueRef` | none — 2 of 2 missing |
| Payroll | `PayrollRun` · `PayrollEntry` | `SalarySchedule`, `SalaryTerm` |
| Finance | `Budget` · `CapitalInjection` | 8 others carded |
| Kernel | `IngestionRule` | 9 others carded |

### What this does not cover

The `Satellites (own stores)` row of the ownership map is prose — "Alert Manager:
alerts, policies, source liveness" — not table names, so it cannot be
cross-referenced the same way and is not counted in the 48. Under
[ADR-039](decisions.md#adr-039) a capability service brings its own table
definitions into its host's storage, so those shapes are owed by the service
nodes rather than by `data-model.md`.

`search_index` and `commitment_forecast` are carded and unbuilt; both are
matviews, so their absence from the schema is expected rather than a gap.

> **Note** — Everything else that was ever open in this design now has a numbered record in [decisions](decisions.md). If a question isn't answered anywhere on this site, that is a gap — raise it and it becomes either a page edit or ADR-026.
