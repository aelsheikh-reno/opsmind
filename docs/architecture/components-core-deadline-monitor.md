# Deadline monitor

> OpsMind's detection engine: a daily sweep over every registered date — document expiries, filing due dates, unbilled positions, job heartbeats — that recomputes days remaining, applies per-type thresholds, and reports the full breach set.

### Context

**The business problem.** An expired visa stops an engineer working. A missed VAT filing costs a penalty. A trade licence lapse can suspend the company. These dates are known months ahead and get missed anyway, because nobody is watching all of them at once across several countries and hundreds of documents.

**Why this exists as its own component.** Each module could chase its own dates, and that is the design this replaces — it produces inconsistent warning windows, duplicate notifications, and no way to answer "what is coming up" in one place. Concentrating detection here also creates the split that makes the alerting half reusable by a second product.

**What it does.** Anything with a date registers it here. Every night the module recalculates days remaining for every registered date, applies the threshold configured for that document type, and reports every breach.

**How it works.** Each run is stateless: it recomputes distance from today — **the jurisdiction's civil date**, read in that jurisdiction's zone and never the UTC day — rather than remembering what it warned about yesterday, so a missed night self-heals. Distance is measured in business days against the jurisdiction's calendar — Sunday to Thursday in the Gulf — because "seven days" that lands on a weekend is not seven working days. The run reports its **complete** breach set to the Alert Manager, and an empty report is meaningful: it says "I ran, nothing is wrong" and doubles as the liveness signal. Thresholds and severities are tunable per type in Settings, exactly as a SOC tunes detection rules.

**Where it sits.** This is a **detection engine** — the architectural role correlation rules play in a security operations product. Detection decides what counts as a problem and how serious it is; the generic [Alert Manager](flows-alerting.md) owns everything after: deduplicating, notifying, escalating, resolving. That split is why the alerting half ships to SmartOps while this half stays specific to Reno's compliance calendar.

| Owns | Detail |
|---|---|
| Deadline registrations | registerDeadline(entityRef, type, dueDate) · deregisterDeadline — no cancel obligation exists (see below) |
| Thresholds & severity tables | Per deadline type, tunable in Settings — domain knowledge, exactly as SOC thresholds are tuned per detection rule (ADR-020) |
| Business-day arithmetic | Sunday–Thursday weeks, per-country holidays, and the IANA zone "today" is read in — all three from the jurisdiction's `BusinessCalendar`, none of them a constant |
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

> **Note** — **A statutory due date and the date you file by are two dates.** The statutory date is `periodEnd + Regime.deadlineDays` in plain **calendar** days — UAE VAT is the 28th day after the tax period ends (Federal Decree-Law No. 8 of 2017, Article 64), so a period ending 31 March is 28 April. Not business days: read that way, 28 days would land roughly twelve days late, which is a penalty.
>
> If the statutory date falls on a **weekend or a public holiday** in that jurisdiction's calendar, the date to file by **moves forward to the next working day**. The statute counts calendar days; it does not require filing on a day the portal and the bank are shut. Forward, never back — rolling back would file against a statutory date that has not arrived, and treating a closed Friday as the deadline would report a filing late that was not. Ahmed's decision, 2026-08-14, reversing an earlier reading that the date was never adjusted.
>
> The module keeps them apart: `statutoryDueDate` is what the law names and what a differential test compares against legacy; `filingDueDate` is what a human must act on. A calendar with no working day inside a fortnight is mis-entered data and raises, naming the jurisdiction, rather than looping.

> **Note** — **Severity is the maximum across breached windows, never the tightest one.** Where several threshold windows are breached at once, the reported severity is the highest of them, not the severity of the nearest window. A misordered Settings row must never downgrade an urgent deadline: rows of `{30 days → major, 7 days → minor}` report **major** at five days out. Over-warning is noisy and visible; under-warning is silent, and silence is the failure this module exists to prevent. Escalation is therefore a property of the data rather than of row ordering. Ahmed's decision, 2026-08-14.
>
> Thresholds are not validated against each other on save — an admin editing them must not be blocked, and correctness must not depend on entry order. Settings instead **flags** a threshold set where a tighter window carries a lower severity as probably misconfigured, without preventing the save.

> **Note** — **A deadline type with no configured threshold raises, rather than never reporting.** A registered deadline whose type has no `ThresholdTable` row is a misconfiguration, not a quiet no-op: an unwatched deadline is exactly the failure this module exists to prevent, and silence must never be indistinguishable from "nothing is wrong". It raises **one alert per unconfigured type per run**, not one per deadline, so a missing row produces a single actionable signal rather than a flood. Same principle as the complete report and the source-dark alert. Ahmed's decision, 2026-08-14.
>
> A threshold is **inclusive at its bound** — exactly seven business days remaining breaches a seven-day window — and an **overdue** deadline, with negative days remaining, reports the **highest severity band the severity scale defines**, not the highest band configured for its type.

> **Note** — **Overdue takes the top of the scale, not the top of the type's own rows.** A type whose Settings rows are all `minor` still reports the **highest** band once it is past due; the ceiling comes from the severity scale, not from which windows an admin happened to write for that type. This **reverses** the earlier reading of "the highest **configured** severity" as a per-type restriction, which left a minor-only type at `minor` however far past due it went. The oracle is legacy: `reference/legacy/lib/email.ts` puts every item with `daysLeft < 0` into one bucket (:174), renders it as the red "🔴 Overdue — action needed now" section ahead of critical (:238–239), and counts all of it into the "⚠️ N urgent" subject line (:260) — for every item, regardless of type, because legacy has no per-type severity at all. Read as a per-type ceiling, the new build was quieter than the product it replaces on exactly the deadlines that are already late, and under-warning is the silence this module exists to prevent. Ahmed's decision, 2026-08-16, reversing an earlier reading that a type's own rows capped its overdue severity.
>
> **Unconfigured is untouched by this.** A type with no `ThresholdTable` row is still **unconfigured** when overdue, never scored — it raises as a misconfiguration, per the decision above. Absence of a row is a hole, not a severity, and overdue is not a licence to score a type nobody configured.

> **Note** — **"Today" is the jurisdiction's civil date, never the UTC day.** The sweep fires at 02:00 ([scheduling](operations-scheduling.md)), which in the Gulf is 22:00 the previous UTC day, so a run scored against UTC warns a day late. A day late is not a rounding error here: every threshold window shifts by one, and on the last night before a filing the following night is after the deadline. A run therefore resolves its own "today" per jurisdiction, in that jurisdiction's zone, whatever UTC instant the process happened to fire at. Ahmed's decision, 2026-08-14.
>
> The IANA zone lives on `BusinessCalendar`, beside the weekend mask and the holidays, because **Jurisdiction is identity and BusinessCalendar is the civil-time rules**. It is **required, with no default**: a zone nobody chose is that same defect written down once and then trusted. A zone the runtime cannot resolve is rejected where it is written, and throws rather than falling back to UTC where it is read — the same principle as a missing calendar being an error naming its jurisdiction and never a silent Saturday–Sunday fallback.

> **Note** — Because resolution comes from **absence in a completed report**, modules never call cancel: they update their own data (renew the visa, pay the filing) and the next run observes the cleared state. The missed-cancel failure mode does not exist by construction. Full lifecycle: [alerting flow](flows-alerting.md).
