# Orientation

> This page assumes you know nothing about OpsMind, Reno, or the vocabulary used elsewhere on this site. Everything else here builds on what's below.

## 1 · The business this software serves

Reno Systems is a professional services and consultancy firm headquartered in Dubai, with delivery staff in Cairo and clients across GCC banking and telecom. The work is project-based: engineers are assigned to client engagements, time is billed, milestones are delivered and invoiced.

That shape creates a specific set of back-office problems, and they are the problems OpsMind exists to solve:

- **People move between projects**, so utilisation and project profitability are only knowable if timesheets, allocations and salary costs are in one place.
- **Staff work across countries**, so payroll obeys different rules per jurisdiction — Egyptian income tax brackets and social insurance, UAE gratuity — and every employee has documents that expire: visas, work permits, passports, Emirates IDs.
- **The company itself is regulated in several places at once.** A UAE entity files VAT quarterly and corporate tax annually; an Egyptian entity files under different rules on different dates. Missing a filing costs money.
- **Cash timing matters more than profit** for a services business: salaries leave monthly and reliably, client payments arrive late and unpredictably.

Everything on this site is ultimately in service of those four facts.

## 2 · What OpsMind is

OpsMind is the internal platform that runs this back office. The industry category is **PSA — Professional Services Automation**, the family that includes Kantata, Certinia and Projectworks: software that connects projects, people, time and money for firms that sell expertise rather than products.

OpsMind adds two things that generic PSA tools do not have, and they are the reason it is being built rather than bought:

| Layer | What it means |
|---|---|
| **Compliance calendar** | Every date the company must not miss — visa expiries, licence renewals, VAT and corporate tax deadlines — watched automatically, per country, with escalating warnings |
| **Document intelligence** | Documents are the primary way data enters the system. A signed employment contract arriving by email should create the person, the salary schedule and the visa deadline without anyone retyping it |


What OpsMind deliberately does **not** do: it is not an accounting ledger and not a tax engine. Zoho Books holds the books; an accredited e-invoicing provider issues legal invoices; the tax return is computed in Zoho. OpsMind owns the operational record and the forward view. That boundary is a decision, not an accident — see [ADR-016](decisions.md#adr-016) and [ADR-017](decisions.md#adr-017).

## 3 · What exists today, and why it is being changed

OpsMind today is a single Next.js application — around 73,000 lines, 170 API routes, 38 screens, 38 database tables. It works and it is in use. It is not being rewritten.

What is being changed is its **internal structure**, for three reasons:

- **Correctness faults have structural causes.** The cash-position figure counts supplier bills as income because invoices have no direction field. Payment state is set by an AI extraction rather than recorded as an event. These are not typos; they follow from missing structure. See [defects](defects.md).
- **Capabilities are trapped.** Reno is also building SmartOps, a security-operations product. It needs the same alerting engine, the same document parser, the same approvals inbox. Today that code cannot leave OpsMind because everything reaches directly into one shared database.
- **Some screens hold logic they shouldn't.** The tax screen computes liabilities in the browser, so the UI and the API disagree about the same number.

The target described on this site is therefore a **refactoring destination**: the same product, restructured so that shared capabilities can be extracted and so that correctness faults become impossible rather than merely fixed.

## 4 · The mental model — in plain language

Almost everything on this site follows from one idea: **separate what is specific to Reno from what is generic.**

| If it is… | It becomes… | Examples |
|---|---|---|
| Specific to Reno's business | Part of the one deployable **core** | How payroll is calculated, what a project is, when a filing is due |
| Generic and reusable | A separate **capability service** | Parsing a document, tracking an alert, holding a queue of approvals |
| A conversation with an outside system | An **integration adapter** | Zoho Books, Google Drive, WhatsApp, exchange rates |


The test for the middle row is deliberately strict: a capability only becomes a satellite if a second product would use it *unchanged*. Payroll would not — every company's payroll differs. An alerting engine would — an alert is an alert whether it concerns an expiring visa or an intrusion attempt.

## 5 · The vocabulary you need before reading further

| Term | Plain meaning |
|---|---|
| **Core** | The one deployable application holding Reno-specific business logic |
| **Module** | A section of the core owning one business area — payroll, projects, finance. A folder with rules about what it may touch, not a separate program |
| **Kernel** | Shared reference data every module may use: what a person is, what a country is, what a document is. Vocabulary, not process |
| **Satellite** | Anything deployable separately from the core — capability services and integration adapters. Never publicly reachable |
| **Adapter** | A satellite that talks to exactly one outside system and stores nothing itself |
| **Commitment** | Money a signed contract promises in future — next month's salary. Not owed yet |
| **Open item** | Money actually owed now, in either direction, ageing until paid |
| **Settlement** | A payment that happened — who recorded it, when, at what exchange rate |
| **Work item** | Anything waiting on a human decision: an approval, a review, an exception |
| **Composition surface** | A screen that owns no data and assembles several modules' data — a dashboard |


The full list is in the [glossary](glossary.md). Terms are explained again where they first matter, so you do not need to memorise this table.

## 6 · How this site is organised

| Section | Answers |
|---|---|
| [Walkthrough](walkthrough.md) | "Show me one real example end to end" — read this next |
| [Architecture](architecture-context.md) | What the pieces are, at three zoom levels |
| [Components](components-core.md) | What each individual piece owns and exposes |
| [Flows](flows-ingestion.md) | How the pieces interact over time, as sequence diagrams |
| [Data](data-ownership.md) | Tables, who writes them, how the schema migrates |
| [Security](security-surface.md) | Who can do what, and what is exposed to the internet |
| [Operations](operations-deployment.md) | What deploys where, what runs on a schedule, what to do when it breaks |
| [Decisions](decisions.md) | **Why** anything is the way it is — 25 numbered records |


> **Note** — The division that matters: **component pages tell you what something is; decision records tell you why it is that way.** If a page states something surprising without justifying it, the justification is in a linked ADR — that is deliberate, so specifications stay readable and arguments stay findable.
