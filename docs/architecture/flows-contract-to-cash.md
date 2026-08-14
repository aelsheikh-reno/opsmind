# Contract to cash

> Three stages, three objects, no duplication — each stage converts rather than copies, in both directions of money.

### Context

**The business problem.** Money appears in OpsMind in several forms — a promised salary, an issued invoice, a due filing, a paid receipt — and treating them as unrelated is how a cash figure ends up counting the same amount twice.

**Why this exists as its own component.** One lifecycle applied to every kind of money is what makes the forecast trustworthy. Documenting it as a flow rather than inside Finance keeps the pattern visible to modules that only participate in part of it.

**What it does.** It shows the three-stage lifecycle every amount passes through, in both directions of money.

**How it works.** Each stage converts rather than copies: when a commitment becomes an open item it is marked converted and leaves the forecast, and when a settlement is recorded the open item's balance is derived rather than flagged. That derivation is why partial payments work and why no boolean anywhere needs to be kept in sync.

**Where it sits.** Spans Payroll, Billing, Expenses and Finance, with Finance owning the last two stages. The vocabulary is defined on the [vocabulary page](data-vocabulary.md); the reasoning is [ADR-014](decisions.md#adr-014).

*Diagram: Commitment converts to open item converts to settlement, in both directions of money.*

Each stage converts rather than copies, which is what keeps the same amount from being counted twice. Both directions of money — payable and receivable — pass through the same three objects.

## Why three objects

This is standard commitment accounting: the schedule is what the contract promises, the open item is what is owed now, the settlement is what was paid. A commitment marked `converted` is excluded from the forecast so the outflow is never counted twice — the one field that makes the lifecycle safe ([ADR-014](decisions.md#adr-014)).

## Both directions through one gate

OpsMind records every payment first — outbound (expense paid, payroll paid, filing paid) and inbound (client payment against an open item) — and pushes to Zoho with an idempotency key, retry on failure, and a visible list of unpushed settlements ([ADR-015](decisions.md#adr-015)). isPaid is derived from settlements, never extracted by AI, never a bare boolean.

## The forecast this feeds

`commitment_forecast` is a materialized view over all schedule tables plus billable positions: source, entityRef, dueDate, amount, currency, direction, confidence, status. Refreshed on commitment-affecting writes; shows refreshed_at; feeds the [cash flow view](architecture-presentation.md) with weekly buckets near-term, monthly beyond, three certainty tiers, and aging buckets on the receivable side ([ADR-019](decisions.md#adr-019)).
