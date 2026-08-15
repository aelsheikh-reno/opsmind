# Scheduling

> Each owner runs its own timers — no central scheduler service to become a hidden dependency of everything ([ADR-011](decisions.md#adr-011)). Event-driven paths always have a level-based sweep behind them: the webhook is for latency, the sweep is for correctness.

### Context

**The business problem.** A great deal of what OpsMind does happens with nobody present: deadlines recalculated overnight, exchange rates refreshed daily, documents arriving from Drive, failed pushes to Zoho retrying. When one of those silently stops, nothing obviously breaks — it just gradually becomes wrong.

**Why this exists as its own component.** There is no central scheduler service, deliberately: it would become a hidden dependency of every module and a single point of failure for work that is otherwise independent. Each owner runs its own timers, and this page exists so that decentralisation does not mean nobody has the full inventory.

**What it does.** It lists every background job — its owner, cadence, idempotency mechanism and how its failure is noticed.

**How it works.** Two invariants make the decentralisation safe. Every job is **idempotent**: running twice produces the same result as running once, through idempotency keys on external pushes, upserts on imports, and stateless recomputation on sweeps. And every job claims a row in a `job_runs` table unique on (job, scheduled time), so duplicate runners collide harmlessly rather than double-executing. Every event-driven path is additionally backed by a **sweep** — a job re-checking the same ground from scratch — because webhooks are fast but silently lossy while sweeps are slow but self-correcting.

**Where it sits.** Owned across every module and satellite. Failure detection routes through the Alert Manager: jobs that report to it are covered by source liveness, and the rest register heartbeat deadlines.

## The complete job table

| Job | Owner | Cadence | Idempotency / liveness |
|---|---|---|---|
| Deadline sweep | Deadline monitor | daily 02:00 `Asia/Dubai` — 22:00 the previous UTC day | Stateless recompute; liveness via its own reportRun. Scores against each jurisdiction's civil date, not the firing instant (see below) |
| FX refresh | FX kernel (via adapter) | daily | Upsert by (base,quote,asOf); heartbeat deadline registered |
| Drive changes sweep | Drive adapter | daily | Cursor-based listChanges; same function as the webhook path |
| Drive watch-channel renewal | Drive adapter | before expiry | Renew or recreate; failure raises through its report |
| Asana reconciliation | Asana adapter | daily | Same as Drive |
| Zoho push retry | Finance | 15 min | Idempotency key per settlement; unpushed list visible in UI |
| Work-items resolution sweep | Ingestion (core side) | hourly | Reconciles missed resolution webhooks |
| Payroll generation | Payroll | monthly | Re-run adds only missing entries |
| Forecast refresh | Finance | on writes + nightly | Matview refresh; refreshed_at exposed |
| Search index refresh | Kernel | 15 min | Matview refresh |
| Retention purge | Kernel | weekly | Skips legal holds; audit entry per purge |
| Alert escalation timers | Alert Manager | continuous | Its own policies; external dead-man's check covers the engine itself |


> **Note** — **A cadence in this table is a firing time; it is never a date.** The deadline sweep's 02:00 is 02:00 in `Asia/Dubai`, which is 22:00 the previous UTC day — an unqualified `02:00` was the ambiguity that produced a warning a day late, because for those hours the UTC day and the Gulf day are different days. What a run scores against is not the firing instant at all: it resolves **today separately for each jurisdiction, as that jurisdiction's civil date** in the zone on its `BusinessCalendar`, so the same run is correct for Dubai and for Cairo and stays correct if the schedule is later moved ([deadline monitor](components-core-deadline-monitor.md)). Ahmed's decision, 2026-08-14. Any job here that comes to compute a date rather than merely refresh a value inherits the same rule.

## Two invariants

- **Idempotency everywhere**: every job can run twice without double effects — keys on external pushes, upserts on imports, stateless recomputes on sweeps.
- **Single-runner locking**: a `job_runs` table with a unique (job, scheduled_for) claim prevents the duplicate-execution class of bug — the current build fires FX and expiry reminders from both Vercel cron and GitHub Actions ([defect](defects.md)).
