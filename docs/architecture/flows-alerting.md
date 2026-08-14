# Alerting

> Detection engines own thresholds and severity; the Alert Manager owns everything after. Three source shapes, one lifecycle, and resolution semantics in which silence is never read as clear.

### Context

**The business problem.** Three unrelated-looking problems — an expiring visa, an intrusion attempt, an unapproved expense — are the same problem: something detected a condition, and a human now needs to be told, chased, and eventually told it is over.

**Why this exists as its own component.** Splitting detection from lifecycle is what lets one engine serve OpsMind and SmartOps. Detection is domain-specific and stays with each product; deduplicating, escalating and resolving is generic and ships once.

**What it does.** It shows how any source raises alerts, how state moves, and — the part that matters most — how an alert is allowed to close.

**How it works.** Sources report by fingerprint, a deterministic identity computed from stable identifiers so no source needs to remember what it raised. Repeating sources send their complete result each run; a fingerprint absent from a **completed** report is resolved, because the run checked everything. A report that never arrives resolves nothing: the alerts freeze as unconfirmed and the engine raises a separate alarm that the source has gone dark. Grouping and inhibition act on notifications, not on state, so alerts stay individually addressable while forty visa expiries arrive as one digest.

**Where it sits.** The Alert Manager is a capability service; the [deadline monitor](components-core-deadline-monitor.md) is one of its sources. Full reasoning in [ADR-020](decisions.md#adr-020).

## Three source shapes, one engine

## The contract — three verbs

**The Alert Manager contract**

```
reportRun(sourceId, runId, alerts[])   repeating sources
  · the run's complete breach set
  · an EMPTY report is meaningful: "I ran, nothing breached"
    — it is also the liveness signal
raiseAlert(fingerprint, severity, policyId, context)
  · direct and fire-only sources
resolveAlert(fingerprint)              idempotent
acknowledge(alertId, actor) · suppress(fingerprint, until, actor, reason)
```

Fingerprints are deterministic — `{tenant}:{app}:{source}:{entity}:{policy}` — computed by the source from its own data, so no source needs memory of what it raised. Severity is not part of the fingerprint (escalation would break dedupe) and is monotonic while an alert is open: a genuine downgrade is resolve-then-reopen.

## The state machine

*Diagram: Firing moves to acknowledged, suppressed or resolved; acknowledgement pauses paging without closing the alert.*

Acknowledgement pauses paging but never closes: if the resolve window lapses while the alert is still open, it re-escalates. A missed report never resolves anything: open alerts are flagged STALE and stay open, and the engine raises one source-dark alert per silent source. Only the source, or a logged human resolve, closes an alert.

## A full cycle — sweep source

## Resolution semantics — the load-bearing rule

- **Absence from a completed report resolves.** The run evaluated everything; this fingerprint was not breached. Affirmative, not inferred.
- **Completeness is scoped, and the scope is declared.** A run may be complete for part of its domain and not the rest. The deadline monitor evaluates jurisdiction by jurisdiction: if one jurisdiction has no business calendar it cannot be scored, and the run continues without it. Absence then resolves **only within the scopes the run declares complete**. Alerts in an incomplete scope stay open, are marked STALE, and are never resolved by absence — the run did not look, and not looking is not the same as finding nothing.
- **A partial run is never presented as whole.** The alternative — aborting so the report is either total or absent — takes every jurisdiction dark for one bad calendar, which is a larger failure than the one it avoids. Reporting the healthy scopes and naming the broken one is the honest shape, and the missing calendar raises its own misconfiguration alert so the gap is visible rather than merely survivable. Ahmed's decision, 2026-08-14.
- **No report at all never resolves.** The alerts freeze open as STALE and the engine — acting as a source about its own inputs — raises one source-dark alert per dark source, escalated to engineering. A dead watcher can flag alerts unconfirmed but can never close them.
- **fire_only sources** (integrations that cannot report clean) are declared as such and get quiet-window auto-resolve as the accepted degraded mode.

## Noise control

**Grouping is a notification concern, not a lifecycle one**: alerts stay individually addressable; notifications batch by group_by / group_wait / group_interval / repeat_interval. 40 visa expiries on one sweep become one HR digest. **Inhibition** silences dependents when a higher-order alert fires — the generalisation of the source-dark rule. Full reasoning: [ADR-020](decisions.md#adr-020).

> **Note** — The engine cannot alert on its own death. One external dead-man's check on the Alert Manager is the only external monitoring dependency in the entire design.
