# Open items

> The honest remainder. Nothing here blocks the build; each is either deliberately deferred configuration or a scoped follow-up.

| Item | Status | Trigger to close |
|---|---|---|
| Alert tuning values — group_wait, group_interval, inhibition rule sets, escalation chains | Deferred configuration | Real alert traffic, i.e. the SOC product connecting |
| Observability backend choice | Deferred, instrumentation already in | Traffic worth looking at |
| The developer question: what docType "invoice" was meant to cover | Demoted to cleanup detail | Ask when convenient; it only sizes the direction-backfill review queue |
| Retention periods per type | Architecture done; values pending | Accountant confirmation per jurisdiction |
| Which VAT tax period each of our registrations is assigned | Architecture done; the assignment is not | Accountant confirmation — ask alongside the retention periods above. The **28-day rule itself is settled** (Federal Decree-Law No. 8 of 2017, Art. 64) and is not blocking; what we do not know is whether a given registration files monthly or quarterly, and from which anchor. That is `JurisdictionEnrolment.frequency` and `anchor` — data, not structure |
| Unbuilt routes (/ai · /intel · /risk · /operations · /resources) | Product decision | Roadmap call: build or remove from navigation |
| ProjectDetailClient split plan | Engineering task | Scheduled alongside the presentation-zone enforcement |


> **Note** — Everything else that was ever open in this design now has a numbered record in [decisions](decisions.md). If a question isn't answered anywhere on this site, that is a gap — raise it and it becomes either a page edit or ADR-026.
