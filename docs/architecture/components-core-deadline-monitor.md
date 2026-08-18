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
  { fingerprint: "…document:123:expiry", severity: "major", area: "AE" },
  { fingerprint: "…filing:44:due",      severity: "minor", area: "EG" }
], [
  { area: "AE", complete: true }, { area: "EG", complete: true }
])
An empty array is a valid, meaningful report — "I ran,
nothing is breached" — and doubles as the liveness signal.
The `area` on both is a jurisdiction here; the field does
not say so, because the engine never interprets it.
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
> A threshold is **inclusive at its bound** — exactly seven business days remaining breaches a seven-day window — and an **overdue** deadline, with negative days remaining, breaches every window its type has and reports the **highest severity configured for that type**.

> **Note** — **Overdue takes the highest band configured for its type, not the top of the scale.** A type whose Settings rows are all `minor` reports `minor` however far past due it runs. The ceiling is the type's own rows, because the severity column in Settings is how an administrator says *"this type is never urgent"* — and an overdue stationery order at the same band as a lapsed visa empties the top band of meaning.
>
> A **2026-08-16 reversal** put every overdue item at the top band the severity scale defines, regardless of type. It was made on a **false premise** and is **withdrawn**; both of its grounds fail. **Legacy is silent on this case** rather than agreeing with either reading: its digest never collects an already-expired document, invoice or schedule — every collection query is `gte: now` — so nothing but an unprocessed payroll run ever reaches its overdue bucket, and on an expired visa it has no opinion at all. It is not louder than this build there. And a minor-only type reporting `minor` is **not silence**: the alert fires, appears in the run and is reported. **Severity governs urgency, not visibility** — a low band is not the absence of an alert, and the reversal read it as one. Ahmed's decision, 2026-08-16, withdrawing the reversal made the same day and restoring the per-type ceiling.
>
> **Unconfigured is untouched by this.** A type with no `ThresholdTable` row is still **unconfigured** when overdue, never scored — it raises as a misconfiguration, per the decision above. Absence of a row is a hole, not a severity, and overdue is not a licence to score a type nobody configured.

> **Note** — **"Today" is the jurisdiction's civil date, never the UTC day.** The sweep fires at 02:00 ([scheduling](operations-scheduling.md)), which in the Gulf is 22:00 the previous UTC day, so a run scored against UTC warns a day late. A day late is not a rounding error here: every threshold window shifts by one, and on the last night before a filing the following night is after the deadline. A run therefore resolves its own "today" per jurisdiction, in that jurisdiction's zone, whatever UTC instant the process happened to fire at. Ahmed's decision, 2026-08-14.
>
> The IANA zone lives on `BusinessCalendar`, beside the weekend mask and the holidays, because **Jurisdiction is identity and BusinessCalendar is the civil-time rules**. It is **required, with no default**: a zone nobody chose is that same defect written down once and then trusted. A zone the runtime cannot resolve is rejected where it is written, and throws rather than falling back to UTC where it is read — the same principle as a missing calendar being an error naming its jurisdiction and never a silent Saturday–Sunday fallback.
>
> **A calendar may not be configured in UTC, and the refusal names the zone that jurisdiction uses.** Required-with-no-default stops the zone being *inherited*; it does not stop it being *typed*, and `UTC` is a genuine IANA name, so a validator that asks only "can `Intl` read this" accepts the one value the column exists to prevent — deliberately entered, and invisible from then on. None of the five jurisdictions keeps civil time in UTC, so this is not "UTC is not a zone" but "UTC is not a **civil** zone of a country". The **equivalent spellings go with it** — `Etc/UTC`, `Etc/GMT`, `Etc/Zulu`, `GMT`, `Zulu`, `UCT`, case-insensitively — or the rule is decoration; so do the fixed offsets `Etc/GMT±N`, which carry no civil rules and so cannot follow a country when it changes its clocks: `Etc/GMT-2` matched Cairo until Egypt reintroduced summer time in 2023 and was an hour, and at 02:00 a day, out from that morning. What is refused is UTC, its spellings, and the `Etc/GMT±N` fixed offsets — `Etc/` plus the bare links into it is exactly that set, so a tzdata alias added there needs no maintenance. It is **not** every name that denotes an offset, and an earlier wording claimed it was, on the false premise that IANA collects all placeless names under `Etc/`: `EET`, `CET`, `EST` and the `EST5EDT` family are bare offset names linking into GEOGRAPHIC zones, so they are still accepted. That is a live gap — `Intl` folds `EET` onto Europe/Athens, whose DST does not coincide with Egypt's — and whether a calendar may carry such a name is unsettled, recorded as `timezone-reject-offset-abbreviations` rather than decided here. a zone at UTC+0 that names a place, `Africa/Abidjan`, stays valid, because the refusal is about civil rules and never about arithmetic. Links and aliases the runtime resolves (`Asia/Calcutta`, `US/Eastern`) stay valid too: the validator must not be stricter than the reader. **The error names the jurisdiction's own zone** — AE `Asia/Dubai`, EG `Africa/Cairo`, SA `Asia/Riyadh`, KW `Asia/Kuwait`, BH `Asia/Bahrain` — because a refusal that does not say what to type instead gets worked around. For a jurisdiction outside those five it names the register and says the zone must be chosen for that country: inventing a sixth is the guess rule 8 forbids, and it is why the backfill migration aborts on an unmapped code. Ahmed's decision, 2026-08-16.

> **Note** — **An alert names the area it was raised in, and a failed alert never ends the sweep** ([ADR-040](decisions.md#adr-040)). The out-of-band path carried no scope at all: `raiseAlert` took a fingerprint, a severity, a policy and a free-form context bag, so an alert raised between runs sat outside every area the run declared, while absence from a completed report went on resolving. It now takes the areas it applies to as a **named argument** — opaque scope keys in the same vocabulary as the run's scopes, never dug back out of `context`, because a component built to serve several products must not learn one caller's spelling of "jurisdiction". A missing calendar names the one jurisdiction it blocks; a missing threshold row names **every** jurisdiction the type is registered in, which is why the argument is a list.
>
> **A failed alert call is survived, and paid for in completeness.** The sweep continues and still reports, because taking every jurisdiction dark for one failed call is the larger failure — the same reasoning that made completeness scoped rather than global. But an area whose alert could not be raised **was not fully checked**, so it is reported **incomplete**, with a reason naming the policy and the failure. Otherwise surviving the failure would quietly undo the scoping: absence from a "complete" report would resolve the very alert the run failed to raise. One scope entry per jurisdiction either way — an area already declared complete is **downgraded in place**, never appended a second time.
>
> **The scope field is named `area` on both halves of the contract** ([ADR-043](decisions.md#adr-043)). The report's breaches and scopes said `jurisdictionId` while `raiseAlert` said `areas` — one port speaking two vocabularies, which forces the engine's own source to carry a word it neither understands nor cares about. **Nothing about how this module stores or receives a deadline changes**: a registration still names a jurisdiction, no column was renamed and there is no migration. Only the two types that ride across to the Alert Manager are neutral.

> **Note** — Because resolution comes from **absence in a completed report**, modules never call cancel: they update their own data (renew the visa, pay the filing) and the next run observes the cleared state. The missed-cancel failure mode does not exist by construction. Full lifecycle: [alerting flow](flows-alerting.md).
