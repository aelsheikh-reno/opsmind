# Walkthrough

> Every abstraction on this site becomes concrete if you follow one real document through the system. This page traces a signed employment contract from the moment it arrives to the moment a salary payment is recorded — naming each component as it acts.

## The scenario

Reno hires an engineer in Dubai. HR receives the countersigned employment contract as a PDF attachment and forwards it to the OpsMind intake address. Nothing else is entered by hand. Here is everything that follows.

## Step 1 · The document arrives

The email hits an inbound webhook. That endpoint is one of only three public entry points in the entire system, so it verifies a signature before doing anything — an unverified webhook would let anyone on the internet inject documents ([attack surface](security-surface.md)).

The [Ingestion module](components-core-ingestion.md) takes over. It is the front door: four channels — upload, email, WhatsApp, Google Drive — all converge on this one pipeline, so behaviour cannot drift between them.

**Why the parser is a satellite.** It receives the file and a description of what to look for, and returns values. It knows nothing about Reno — not what a salary is, not that visas expire. That is exactly why SmartOps can reuse it unchanged, which is the test any capability must pass to be extracted ([ADR-002](decisions.md#adr-002)).

## Step 2 · The rule fires

The registry holds a **rule** for this document type. A rule is data, not code — an administrator can edit it in Settings without a deployment. It says: if the document is an employment contract and confidence is high enough, perform these actions in order.

| Action | Result |
|---|---|
| create_person | The engineer exists as a Person in the kernel |
| create_enrolment | Their UAE tax and social insurance identifiers are registered |
| generate_schedule | 24 monthly salary commitments are written into Payroll |
| register_deadline | The visa expiry is watched from this moment on |


If any condition fails — confidence too low, an ambiguous name match — nothing is guessed. The document becomes a **work item**: something waiting for a human, routed to HR because that is the section it belongs to. Guessing is what produces silently wrong data; queuing is what produces a two-minute review ([ADR-005](decisions.md#adr-005)).

## Step 3 · What each action created

| Created | Where it lives | Why there |
|---|---|---|
| Person | Shared kernel | The engineer is simultaneously an HR record, a payroll subject and a project resource. One table, referenced by everything |
| Enrolment | Shared kernel | Their standing under a regime — which tax rules apply to this person in this country |
| Salary schedule | Payroll module | 24 rows of future obligation. These are **commitments**: promised, not yet owed |
| Deadline registration | Deadline monitor | "Watch this visa expiry date" — the compliance calendar in action |
| Document | Shared kernel | The PDF itself, kept as **evidence** — proof of the salary rather than the salary |


> **Note** — **The record is the thing; the document is evidence.** The salary lives in a schedule you can query and forecast against; the PDF sits alongside it as the proof. Systems that treat the document as the record cannot answer "what will payroll cost in March" without re-reading PDFs.

## Step 4 · Months pass — the deadline monitor watches

Every night, the [deadline monitor](components-core-deadline-monitor.md) recomputes days remaining for every registered date and reports the complete set of breaches to the [Alert Manager](flows-alerting.md). When the visa crosses 30 days, HR gets a warning; at 7 days it escalates.

The design detail that makes this trustworthy: the monitor sends its *whole* result each run, including an empty result meaning "I checked everything, nothing is wrong." So if the monitor dies, the Alert Manager notices the silence — it marks existing alerts unconfirmed and raises a separate alarm that the watcher itself is dark. **A dead watcher can never make problems appear resolved.**

## Step 5 · Payroll runs

This is the three-stage lifecycle that structures all money in OpsMind: **commitment** (promised) → **open item** (owed) → **settlement** (paid). Each stage converts rather than copies, which is why the cash forecast cannot double-count ([ADR-014](decisions.md#adr-014)).

Note where the boundary falls: OpsMind records the payment and pushes it to Zoho. Zoho remains the accounting ledger. OpsMind is the gate that ensures nothing is paid without being recorded — not a replacement for the books.

## Step 6 · What the screens show

| Screen | Reads | Kind of screen |
|---|---|---|
| /people/[id] | Person, documents, enrolments | **Domain screen** — one owner, no logic |
| /payroll | Runs and entries | Domain screen — Payroll owns it |
| /calendar | Deadlines from every source | **Composition surface** — owns nothing |
| /finances | Open items, settlements, forecast | Composition surface |
| /dashboard | Everything, summarised | Composition surface |


Composition surfaces assemble several modules' data. The assembly happens on the server, not in the browser — which is why the browser only ever talks to the core, and satellites never face the internet ([ADR-010](decisions.md#adr-010)).

## What this example demonstrated

- A **satellite** doing generic work (the parser) with no knowledge of the business
- A **rule** as editable data, with a human queue when confidence is low
- The **kernel** holding what everything references — person, document, country
- A **module** owning its own tables and exposing an interface (payroll)
- The **commitment → open item → settlement** lifecycle
- The **detection engine** watching dates and reporting completely, so silence is never mistaken for safety
- The **Zoho boundary**: OpsMind decides and gates, Zoho records the legal fact

Every other page on this site is a more precise account of one of these. [Start with the system context](architecture-context.md) for the full picture.
