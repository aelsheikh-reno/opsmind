# Shared kernel

> Twelve components every module may depend on. The kernel holds vocabulary and reference data, never business process; the dependency arrow only ever points inward.

> **Note** — **Why a kernel exists.** Some concepts are referenced by everything: a person, a document, a country, a legal entity. If each module defined its own, the same engineer would exist three times with three IDs. The kernel is the shared answer to "what is a person" — vocabulary that modules build on. The constraint that keeps it from becoming a dumping ground: it holds *reference data and definitions*, never process. How payroll is calculated is Payroll's business; what a person is belongs to everyone.

| Component | What it is | Target changes vs current code |
|---|---|---|
| **Person** | Staff identity — HR record, payroll subject, claimant, project resource in one | + managerId (org chart, required to resolve approvers) · + person-level enrolments (SI and tax identifiers per jurisdiction) |
| **Document** | Files and extracted metadata. Evidence, never the record itself (Rule 07) | + direction inbound|outbound — fixes supplier bills counted as income ([ADR-025](decisions.md#adr-025)) |
| **LegalEntity** | Any organisation — yours, clients, vendors | + roles self|client|vendor; stops being auto-created from fuzzy name matches |
| **Jurisdiction** | The country, plus its business calendar (Sun–Thu, per-country holidays) | Calendar becomes first-class — deadline maths cannot be UTC arithmetic |
| **Regime** | The law: jurisdiction × obligation type — rates, brackets, thresholds, deadline days | New; extracted from hardcoded values and TaxesClient |
| **JurisdictionEnrolment** | An entity's standing under a regime: TRN/identifier, frequency, anchor, activeFrom/To, evidencing certificate | Replaces VatConfig + TaxConfig; unique per (entity, regime); needed for counterparties too — a UAE VAT invoice carries the customer's TRN |
| **Document Type Registry** | Field schemas + the ingestion rule catalogue + retention policy per type | New as data; editable in Settings; versioned with actor and timestamp |
| **FX** | Rate store, conversion, snapshot semantics — a payroll month keeps its rate forever | Own table replaces the JSON blob in Setting; adapter fetches, kernel writes |
| **User** | Account: email, credential hash, provider + providerSub, personId | Survives every IdP change; roles live in Authorization, never here |
| **Audit** | Append-only activity log, read back by in-product timelines | Stays in the DB (read-back requirement); S3 Object Lock archive is a later option; erasure = redaction, not deletion |
| **Licence gate** | RS256 offline licence verification, first in the gateway, before auth; failure → /suspended | Unchanged — offline verification is what makes on-prem viable for customers who refuse call-home |
| **Search index** | Permission-tagged materialized view: entity, title, snippet, section, tsvector | New; section filtered at query time; sensitive fields never enter the index ([ADR-006](decisions.md#adr-006)) |


> **Note** — Person is deliberately **not split** into HR-person / payroll-person / claimant: it is one of the most referenced tables, and separating roles would migrate half the schema to solve a problem that is not constraining delivery.
