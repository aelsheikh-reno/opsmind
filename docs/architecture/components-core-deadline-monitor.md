# Deadline monitor

> OpsMind's detection engine: a daily sweep over every registered date — document expiries, filing due dates, unbilled positions, job heartbeats — that recomputes days remaining, applies per-type thresholds, and reports the full breach set.

### Context

**The business problem.** An expired visa stops an engineer working. A missed VAT filing costs a penalty. A trade licence lapse can suspend the company. These dates are known months ahead and get missed anyway, because nobody is watching all of them at once across several countries and hundreds of documents.

**Why this exists as its own component.** Each module could chase its own dates, and that is the design this replaces — it produces inconsistent warning windows, duplicate notifications, and no way to answer "what is coming up" in one place. Concentrating detection here also creates the split that makes the alerting half reusable by a second product.

**What it does.** Anything with a date registers it here. Every night the module recalculates days remaining for every registered date, applies the threshold configured for that document type, and reports every breach.

**How it works.** Each run is stateless: it recomputes distance from today rather than remembering what it warned about yesterday, so a missed night self-heals. Distance is measured in business days against the jurisdiction's calendar — Sunday to Thursday in the Gulf — because "seven days" that lands on a weekend is not seven working days. The run reports its **complete** breach set to the Alert Manager, and an empty report is meaningful: it says "I ran, nothing is wrong" and doubles as the liveness signal. Thresholds and severities are tunable per type in Settings, exactly as a SOC tunes detection rules.

**Where it sits.** This is a **detection engine** — the architectural role correlation rules play in a security operations product. Detection decides what counts as a problem and how serious it is; the generic [Alert Manager](flows-alerting.md) owns everything after: deduplicating, notifying, escalating, resolving. That split is why the alerting half ships to SmartOps while this half stays specific to Reno's compliance calendar.

| Owns | Detail |
|---|---|
| Deadline registrations | registerDeadline(entityRef, type, dueDate) · deregisterDeadline — no cancel obligation exists (see below) |
| Thresholds & severity tables | Per deadline type, tunable in Settings — domain knowledge, exactly as SOC thresholds are tuned per detection rule (ADR-020) |
| Business-day arithmetic | Sunday–Thursday weeks, per-country holidays from the Jurisdiction calendar |
| Evaluate-on-register | A document ingested already inside a threshold is scored inline, not left for the next sweep |


**Every run sends one report**

```
reportRun("deadline-monitor", r9, [
  { fingerprint: "…document:123:expiry", severity: "major" },
  { fingerprint: "…filing:44:due",      severity: "minor" }
])
An empty array is a valid, meaningful report — "I ran,
nothing is breached" — and doubles as the liveness signal.
```

> **Note** — Because resolution comes from **absence in a completed report**, modules never call cancel: they update their own data (renew the visa, pay the filing) and the next run observes the cleared state. The missed-cancel failure mode does not exist by construction. Full lifecycle: [alerting flow](flows-alerting.md).
