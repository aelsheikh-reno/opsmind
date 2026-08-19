# Table ownership

> Every table has exactly one writing owner. Cross-module access goes through the owning module's interface, never through a join into someone else's tables. This single rule is what keeps the modular core honest.

### Context

**The business problem.** All seven core modules share one PostgreSQL database and deploy together, so nothing physically prevents Payroll code from writing a Projects table. In the current build that has started happening, and the consequence is that no part can be changed confidently.

**Why this exists as its own component.** This is the cheapest possible version of a service boundary — no network, no new deployment, just a rule about who writes what. It exists because module boundaries that are not enforced somewhere are not boundaries, and because a module nobody else writes to is one that can later move without anyone noticing.

**What it does.** It assigns every table exactly one writing owner, and states how other modules reach that data.

**How it works.** Reads may cross a boundary through the owning module's interface; writes never do, and no module joins into another's tables. Enforcement is a per-module data access wrapper rather than a shared client reaching everywhere, plus network isolation for satellites, which physically cannot reach the database at all. Where a screen needs several owners' data, the composition happens in the BFF rather than in a query.

**Where it sits.** The precondition for the day-one topology: extracting a service later is only safe if its tables were already exclusively its own. The three page-level imports listed under [presentation](architecture-presentation.md) are the current violations.

> **Note** — **Repositories import the client; they never construct one.** `lib/db.ts` holds the single `PrismaClient`, and every module's `repository.ts` imports `db` from it. A repository that calls `new PrismaClient()` gets a connection pool of its own, and seven modules each doing that is seven pools against a database sized for one application — a failure that appears only under load, long after the code that caused it was reviewed. `lib/db.ts` is consequently the one file outside a `repository.ts` permitted to name the client package, and `scripts/guard-write.sh` exempts it by that exact filename.

> **Note** — **Why ownership is the load-bearing rule.** All seven modules share one PostgreSQL database, so nothing physically stops Payroll from writing a Projects table. Without a rule, that is exactly what happens over time, and then no module can be changed or moved without breaking others — which is the state the current build is drifting into. Declaring one writing owner per table is what makes the boundaries real while everything still deploys together, and it is the precondition for ever extracting a module later ([ADR-021](decisions.md#adr-021)).

| Owner | Tables |
|---|---|
| Kernel | Person · PersonEnrolment · Document · LegalEntity · Jurisdiction · BusinessCalendar · BusinessHoliday · Regime · JurisdictionEnrolment · DocumentType · IngestionRule · FxRate · User · AuditEntry · search_index (matview) |
| Payroll | PayrollRun · PayrollEntry · SalarySchedule · SalaryTerm |
| Projects | Project · ProjectService · ProjectActivity · ProjectMilestone · Timesheet · TimesheetEntry · ProjectTeamMember · ProjectMemberAllocation · ProjectAiSuggestion · ProjectDocumentLink |
| Expenses | Expense · ExpenseAttachment · PettyCashFloat · ClaimToken |
| Billing | BillablePosition |
| Finance | OpenItem · Settlement · TaxFiling · LeaseSchedule · LoanSchedule · Budget · CapitalInjection · Scenario · ScenarioEvent · commitment_forecast (matview) |
| Ingestion | IngestionRun · ReviewQueueRef (thin — content lives with Work Items) |
| Deadline monitor | DeadlineRegistration · ThresholdTable |
| Alert Manager | Alert · AlertArea · AlertEvent · AlertSource |
| *Capability services, not yet specified as tables* | Work Items: items, policies, assignments · Authorization: roles, grants, scopes · Connection Manager: connections, credentials · Docgen: template versions |

> **Note** — **A packaged capability service is an owner in this table, not a satellite beside it.** [ADR-039](decisions.md#adr-039) made the reuse target of docgen, the Alert Manager, Work Items, Notifications and Authorization an **importable package** rather than a deployment: each brings its own table definitions and runs on the **host application's storage**. So the Alert Manager's four tables are ordinary rows of the map above, owned exclusively and reached only through `lib/services/alerts/index.ts`. The remaining entries stay prose because no one has specified their tables yet — that is a gap in the specification, not a different kind of ownership. `Alert.sourceId` and `AlertEvent.actor` are ids held with no foreign key, for the reason `DeadlineRegistration.jurisdictionId` is: a cross-owner FK is what stops a component being lifted into another codebase.


## Enforcement

Per-module data access wrappers in the core (repository per module, no shared Prisma client reaching across), and network isolation for the satellites that are still deployed — they physically cannot reach PostgreSQL. **A packaged capability service shares the host's connection by construction, so the boundary lint and `scripts/check-boundaries.sh` are the whole of its enforcement** ([ADR-039](decisions.md#adr-039)): its `repository.ts` declares `// owns:` and is read by the same two checks a module's is. The three current page-level imports of lib/vat, lib/tax and lib/wallet are the violations that motivated the rule; see [presentation](architecture-presentation.md).
