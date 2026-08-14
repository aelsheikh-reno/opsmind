# System context

> Who and what touches OpsMind. One system boundary, seven human roles plus one external person, and nine external systems — each with exactly one owned integration point inside.

> **Note** — **What "C4 Level 1" means.** C4 is a convention for describing software at four zoom levels, each aimed at a different audience. Level 1 (this page) shows the system as a single box and everything around it — useful for anyone who needs to know what OpsMind touches without caring how it is built. [Level 2](architecture-containers.md) opens that box into deployable units. [Level 3](architecture-components.md) opens those into components. Level 4 is source code, which lives in the repository rather than here.

## People

| Actor | Relationship to the system |
|---|---|
| Owner / executive | Dashboards, cash flow view, simulator; full section access |
| Admin | Settings, registry rules, roles, connections |
| HR | People, contracts, visa and licence deadlines, payroll |
| Accountant | Finance, expenses, filings, settlements; scoped per legal entity |
| Project manager | Projects, milestones, timesheets, marking positions ready to bill |
| Staff member | Own expenses, own records; narrowest grants |
| Viewer | Read-only, explicitly barred from payroll and government sections |
| **External claimant** | A person with no account, ever — submits an expense receipt through the one-time-token claim portal. The only public write path in the product |


## External systems

| System | Direction | Why it exists in the picture |
|---|---|---|
| Zoho Books + ASP | both | The ledger and the legal invoice issuer. OpsMind pushes settlements and billing handoffs; reads status back. See [ADR-016](decisions.md#adr-016) |
| Identity provider | in | Local credentials today; Google Workspace next; Okta later as configuration |
| Google Drive | in | Document source — webhook plus daily reconciliation sweep |
| Asana | in | Projects and expense-bearing tasks |
| Postmark inbound email | in | Documents arrive by email; webhook into ingestion |
| Meta WhatsApp | both | Documents in; reminders out |
| Resend | out | Email delivery |
| FX rate provider | in | Daily rates with a fallback chain; the kernel owns the store |
| S3-compatible storage | both | Files and backups |


*Diagram: OpsMind sits between internal roles and external claimants above, and nine external systems below.*

## The boundary in one sentence

Everything that **decides** — permissions, deadlines, what is billable, what is owed — is inside; everything that **records the legal fact** — ledger entries, issued invoices, tax returns — is outside, and the Zoho adapter is the single road between the two.
