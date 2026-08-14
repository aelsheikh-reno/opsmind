# Retention and deletion

> Retention is a property of the document type, held in the registry and editable without code. Deletion is redaction where the law requires keeping the financial record.

### Context

**The business problem.** UAE corporate tax requires seven years of records, VAT five, real estate longer, and a pending refund extends the clock — while data protection law gives individuals a right to erasure. Both obligations apply to the same document.

**Why this exists as its own component.** Retention cannot be a constant in code, because it varies per document type and changes when statutes change. Holding it as registry data means a legal update is a configuration change rather than a release.

**What it does.** It defines how long each document type is kept, what blocks deletion, and what happens when someone requests erasure.

**How it works.** Each document type carries a retention period, the basis it counts from, and an erasure mode. A scheduled job purges records past their computed date, skipping anything under legal hold, and writes an audit entry for every purge. Erasure requests redact personal fields while the financial record survives — statutory retention overrides the right to erasure, which is the standard reconciliation and also resolves the tension with an append-only audit log.

**Where it sits.** Registry data in the kernel, enforced by a scheduled job. Reasoning and the statutory basis are in [ADR-023](decisions.md#adr-023); the periods themselves should be confirmed with the company's accountant.

#### `DocumentType`

*retention fields, held in the registry as data*

| Field | Type / values | Why |
|---|---|---|
| `retentionYears` | integer · default 7 | Corporate tax governs where the same invoice serves both regimes |
| `retentionBasis` | end_of_financial_year \| end_of_tax_period \| document_date | What the clock counts from — it differs per statute |
| `legalHold` | boolean | Blocks purge regardless of age, for disputes and investigations |
| `erasureMode` | redact_personal \| full_delete | How a data-subject erasure request is honoured for this type |


## Why 7 as the default

UAE corporate tax requires seven years from the end of the financial year; VAT requires five from the end of the tax period; because the same invoice serves both regimes, the longer period governs. Real estate records run longer, and a pending refund application extends the clock by up to two years under the 2026 procedures update. **The values are configurable per type precisely because they vary by statute and change — confirm the numbers with the accountant; the architecture only guarantees they are data, not code.**

## Mechanics

- A scheduled purge job selects records past their computed retention date, skipping legal holds; every purge writes an audit entry.
- PDPL erasure requests redact personal fields (name, identifiers, contact) while the financial record survives — statutory retention overrides erasure, the standard reconciliation.
- The audit log stays append-only; redaction inside entries resolves the deletion/immutability tension.
