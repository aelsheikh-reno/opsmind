# Observability

> Instrument now, choose the backend later ([ADR-024](decisions.md#adr-024)). The API is vendor-neutral and cheap to add during the build; retrofitting propagation through every call site later is not.

### Context

**The business problem.** When a document fails to ingest, the evidence is spread across the core, the parser, the registry and Work Items — four places, four log files, no way to connect them.

**Why this exists as its own component.** Instrumentation and the tooling that consumes it are separated because they have very different costs. Threading identifiers through every call site is expensive to retrofit; choosing a backend is cheap and reversible.

**What it does.** It defines what is instrumented from day one and what is deliberately deferred.

**How it works.** A correlation identifier is generated at the inbound adapter and propagated across every boundary, so one failed ingestion is one searchable trace. Logs are structured JSON carrying that identifier plus actor and entity. Spans use the vendor-neutral OpenTelemetry API and are currently exported nowhere — the instrumentation exists, the destination is a later decision.

**Where it sits.** Applies to all four deployables. Note the separation from alerting: application-level problems (deadlines, dark sources, failed jobs) are the Alert Manager's job, and conflating the two into one system is the mistake this distinction avoids.

| Built from day one | Detail |
|---|---|
| Correlation id | Generated at the inbound adapter, propagated across every boundary — core → parser → registry → work items. A failed ingestion is one trace, not four log files |
| Structured logs | JSON: correlationId, actor, entityRef, module, outcome |
| Health endpoints | Liveness + readiness on all four deployables; readiness checks the DB (core) and model reachability (AI platform) |
| OTel spans | OpenTelemetry API around service calls and rule executions; exported nowhere yet |


| Deferred | Why |
|---|---|
| Collector, storage backend, dashboards, metric alerting | Four deployables don't need a tracing stack to be debuggable; the choice is reversible and better made when there is traffic to look at |


> **Note** — Application-level alerting (deadlines, source-dark, job heartbeats) is already the Alert Manager's job — the observability backend is for infrastructure telemetry, and the two must not be conflated into one system.
