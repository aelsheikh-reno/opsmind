# Glossary

> Every term a new joiner meets on this site, one line each.

| Term | Meaning |
|---|---|
| ASP | Accredited Service Provider — the licensed transmitter of legal e-invoices to the FTA in the UAE mandate |
| BFF | Backend-for-frontend — the core's HTTP layer that routes and composes for the browser, and decides nothing |
| Billable position | Delivered-but-uninvoiced value with expected date and confidence; becomes an invoice at handoff |
| Commitment | A contracted future obligation on a schedule; not yet owed |
| Composition surface | A screen owning nothing, assembled by the BFF across several owners |
| Detection engine | Any component that evaluates conditions and decides severity — the deadline monitor here, correlation rules in the SOC product |
| Enrolment | An entity's registration under a regime: identifier, frequency, anchor, evidence |
| Fingerprint | Deterministic alert identity: tenant:app:source:entity:policy |
| fire_only | A declared source that can raise but never report clean; gets quiet-window auto-resolve as accepted degradation |
| Kernel | Shared vocabulary and reference data all modules may depend on; never business process |
| Open item | An outstanding amount, either direction, aging until settled |
| Regime | The law: jurisdiction × obligation type with rates, thresholds and deadlines |
| reportRun | A repeating source's complete run result — breach set, liveness signal, and implicit resolution by absence, in one call |
| Satellite | Any separately deployable service around the core (capability services + adapters) |
| Settlement | A recorded payment event with actor, date, FX snapshot and receipt |
| Source-dark | The derived alert raised when a repeating source misses its reporting cadence |
| STALE | A flag on an open alert whose source has gone dark — unconfirmed, never auto-closed |
| Work item | Anything awaiting a human decision, routed by section, aged and escalated |

