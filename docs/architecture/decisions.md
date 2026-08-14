# Architecture decision records

> Every settled decision, numbered, with the context that forced it, the choice, and what it costs. Component pages state what is; these records state why. All are accepted.

> **Note** — **What an ADR is.** An architecture decision record captures a choice at the moment it was made, together with the forces that made it necessary and what it costs. The convention exists because the reasoning behind a design evaporates within months, and the next engineer either repeats a settled argument or reverses a decision without knowing what it was protecting against. Numbers are permanent: a superseded record keeps its number and gains a pointer, so links elsewhere on this site never break. Read them in order to see what had to be settled before what.

### ADR-001 · Modular core with satellite services — not microservices

**Context.** 72,858 lines, 170 routes, one team, one product deployed once. Full decomposition would multiply operational surface with no organisational driver; staying a pure monolith would keep capability code trapped when SmartOps-family products need it.

**Decision.** A single deployable core of framework-free domain modules, surrounded by capability services and adapters extracted only where the reuse or scaling test passes. Search and configuration are demoted from modules to infrastructure and composition respectively.

**Consequences.** One deployment for company logic; genuine reuse across products; the discipline cost is enforcing module boundaries inside the monolith rather than by network.

### ADR-002 · A service owns its own data

**Context.** Everything reads the Prisma client today, so nothing can move or scale independently and every change ripples.

**Decision.** Any component deployed separately owns its store exclusively; access goes through its interface. Satellites are physically unable to reach PostgreSQL.

**Consequences.** Independent deploys become real; queries that used to be joins become calls; the ownership map (data/ownership) becomes a maintained artifact.

### ADR-003 · Framework-free domain layer, MCP as a second transport

**Context.** Domain logic in Next.js route handlers cannot be called by anything except HTTP; the product roadmap needs agents to invoke the same operations.

**Decision.** Domain modules are plain TypeScript, unaware of HTTP. Inbound adapters — HTTP/BFF, MCP server, scheduler — are thin translations over the same functions.

**Consequences.** Agents get real tools instead of scraping the API; handler bloat becomes structurally impossible; the cost is resisting the convenience of writing logic in handlers.

### ADR-004 · Ingestion fan-out is direct orchestration, not an event bus

**Context.** After extraction, one document may create a person, an enrolment, a schedule, deadlines and a review item. An event bus decouples but hides the sequence and adds infrastructure.

**Decision.** The ingestion module calls each consumer directly, in order, in one transaction where writes are local. Cross-boundary steps (deadlines, review) have explicit failure handling plus reconciliation sweeps.

**Consequences.** The flow is debuggable straight down a stack trace; the trade-off is that adding a consumer edits the orchestrator — acceptable at this team size, revisit if consumers multiply.

### ADR-005 · Registry rules are data; actions are code

**Context.** Behaviour on ingestion must be editable per customer without deploys, but a full scripting engine becomes an undebuggable inner platform.

**Decision.** Rules (trigger, flat ANDed conditions, ordered actions with params) live in the registry, versioned, edited in Settings. The action vocabulary is fixed code; new verbs are developer work.

**Consequences.** Customers and admins tune behaviour safely; the engine stays testable; occasionally a genuinely new behaviour waits for a release.

### ADR-006 · Search is a permission-tagged materialized view

**Context.** /api/search today queries raw tables with no auth — any user can read salaries through it. Per-user indexes explode; per-query joins are slow.

**Decision.** One materialized view (entity, title, snippet, section, tsvector). Coarse tagging at index time, permission filtering at query time from the caller's live grants; sensitive fields never enter the index.

**Consequences.** Role changes are effective immediately with no reindex; a search bug cannot leak salary data; freshness is bounded by the refresh cadence.

### ADR-007 · An Authorization service; no Identity service; instance rules stay with data

**Context.** Permissions will be needed by satellites and future products; identity lives with whatever IdP the customer runs; membership questions live in domain tables.

**Decision.** Authentication delegates to pluggable IdPs. A reusable Authorization service owns roles, grants and entity scope with a per-app vocabulary. Instance-level checks (my project, not my own expense) stay in core modules.

**Consequences.** IdP swaps are configuration; the permission model is product-owned; two enforcement tiers must both be understood — documented in security.

### ADR-008 · One auth provider per user, plus break-glass

**Context.** Allowing local password and SSO simultaneously invites account-linking takeover and ambiguity about which credential is authoritative.

**Decision.** Exactly one provider per user; enabling SSO for a domain disables credentials for those users; migration is admin-initiated; one audited break-glass local admin survives.

**Consequences.** Simpler and safer at this scale; the cost is a hard cutover moment per user and a predictable request to soften it — hold the line.

### ADR-009 · Internal auth: 5-minute shared-secret JWT minted by the core

**Context.** Satellites must trust callers without per-request network hops to an introspection endpoint.

**Decision.** The core mints a short-lived HMAC JWT carrying userId, role, entities and resolved permissions; every satellite verifies locally.

**Consequences.** No auth-service availability dependency on the hot path; revocation is bounded by TTL; the shared secret is a deployment secret to rotate.

### ADR-010 · BFF — the browser reaches only the core

**Context.** Composition screens need several owners' data; exposing satellites publicly would multiply auth surfaces and put an OAuth vault on the internet.

**Decision.** The core's HTTP layer is the backend-for-frontend: it routes, composes server-side, holds the session — and decides nothing.

**Consequences.** One origin, one token, no CORS; satellites stay private; the discipline is keeping business rules out of the composition layer.

### ADR-011 · Each owner runs its own timers; webhooks always have a sweep behind them

**Context.** A central scheduler service becomes a hidden dependency of everything; webhooks alone silently miss events.

**Decision.** Time-based work is owned by the component whose domain it is. Every event-driven path pairs with a level-based reconciliation sweep (edge for latency, level for correctness). Idempotency keys and a job_runs single-runner lock everywhere.

**Consequences.** No scheduler SPOF; missed webhooks self-heal within a sweep period; the job table (operations) is the maintained inventory.

### ADR-012 · One Work Items service for every human decision

**Context.** Approvals, reviews and exceptions were headed for per-module queues with inconsistent aging and escalation.

**Decision.** A generic service owns items, assignment, policy (thresholds, segregation of duties), aging and state. Items carry a section for routing. Resolution notifies the core via signed webhook plus sweep; the core executes decisions.

**Consequences.** One inbox, one escalation engine; the service never sees document content; the callback seam is the pattern's one hard edge.

### ADR-013 · Approval thresholds and segregation of duties are policy, not RBAC

**Context.** Encoding 'above AED 5,000 needs the owner' as roles explodes the role matrix and still can't express 'not your own expense'.

**Decision.** RBAC answers what a role may do; Work Items policy answers who must approve this instance, with numeric thresholds and SoD rules evaluated at item creation.

**Consequences.** The role matrix stays small; approval rules become data reviewable by finance; two systems must be read together to answer 'who can approve X'.

### ADR-014 · Financial vocabulary: commitment → open item → settlement

**Context.** Money concepts were scattered across PaymentSchedule, document flags and six isPaid booleans with no shared language.

**Decision.** Adopt commitment accounting terms end to end (see vocabulary): schedules are commitments; owed amounts are open items; payments are settlements; converted commitments leave the forecast.

**Consequences.** Consistent tables, routes and UI language; SAP-literate accountants recognise it; migration must rename with care (migration).

### ADR-015 · Settlement is a recorded event; OpsMind gates both directions

**Context.** isPaid was set by AI extraction; partial payments were unrepresentable; Zoho and OpsMind disagreed about reality.

**Decision.** Every payment is a Settlement row (actor, date, FX snapshot, method, receipt) recorded in OpsMind first and pushed to Zoho with idempotency, retry, and a visible unpushed queue. Zoho remains the ledger of record; OpsMind is the gate.

**Consequences.** Partials, aging and cash accuracy become possible; the push queue is an operational surface to watch (runbook).

### ADR-016 · Billing stops at handoff; issuance is Zoho + ASP

**Context.** UAE e-invoicing (phased from 2026, AED 50M+ appointing ASPs by 30 Oct 2026) makes only ASP-transmitted UBL/PINT-AE documents legal tax invoices. Building issuance means becoming or integrating an ASP — a compliance product, not a PSA feature.

**Decision.** BillablePosition ends at handed_off/issued with an external reference. Numbering, VAT computation, credit notes and dunning are out of scope permanently.

**Consequences.** A large liability avoided; the Zoho adapter becomes load-bearing; billing analytics read positions, not invoices.

### ADR-017 · One TaxFiling table; estimates only

**Context.** VatPayment and TaxPayment were near-identical; the app also computed tax client-side, implying OpsMind owns tax truth.

**Decision.** Merge into TaxFiling keyed by enrolment and period. estimatedAmount exists for cash forecasting; the authoritative return is computed in Zoho. Client-side computation moves to Finance and is labelled an estimate.

**Consequences.** One deadline pipeline for all filings; adding excise or a new jurisdiction is a Regime row; nobody can mistake OpsMind for the tax engine.

### ADR-018 · Per-module schedule tables with one shared generator

**Context.** One PaymentSchedule served employment and leases, forcing lease semantics questions onto payroll and vice versa.

**Decision.** SalarySchedule (Payroll), LeaseSchedule and LoanSchedule (Finance), each owned where its domain rules live; ingestion invokes a shared generation function per registry rule.

**Consequences.** Effective dating (ADR-022) lands cleanly per type; the forecast unifies them again in commitment_forecast.

### ADR-019 · Cash flow is a treasury view over the spine

**Context.** getCashPosition counted vendor invoices as income and trusted AI-set isPaid — the number was wrong in direction and in state.

**Decision.** The cash view reads open items + commitment_forecast + billable positions: weekly buckets near-term, monthly beyond; contracted/expected/provisional tiers; receivable aging; scenario overlays from DB-stored scenarios.

**Consequences.** The executive number becomes explainable line by line; correctness depends on the direction backfill (ADR-025) landing first.

### ADR-020 · Alert Manager: detection owns severity; the engine owns lifecycle

**Context.** Deadline chasing, SOC correlation and work-item nagging are one problem: conditions detected by domain engines, then deduped, routed, escalated, resolved. Mixing thresholds into the engine would make it product-specific; inferring resolution from silence would let dead watchers close alerts.

**Decision.** Detection engines own thresholds and severity. The engine owns a four-state lifecycle (firing, acknowledged, suppressed, resolved). Three verbs: reportRun for repeating sources (absence from a completed report resolves; a missing report marks STALE and raises source-dark), raiseAlert/resolveAlert for direct and fire-only sources. Deterministic namespaced fingerprints; severity monotonic while open; grouping at the notification layer; inhibition rules. Full lifecycle: alerting flow.

**Consequences.** The same binary serves OpsMind and the SOC product with different configuration; the engine needs one external dead-man's check; tuning values wait for real traffic.

### ADR-021 · Day one is four deployables

**Context.** Thirteen services on day one is operational theatre for a small team; but building without the seams bakes the monolith in forever.

**Decision.** Deploy core, parser, AI platform, Asana adapter. Build everything else in-process behind its exact target interface; move seams per-service when reuse or ownership demands.

**Consequences.** Operational simplicity now, extraction later without caller changes; the risk to police is interface bypass inside the monolith.

### ADR-022 · Mid-term changes are effective-dated terms

**Context.** Raises, promotions, indexation and rent reviews were edits-in-place, destroying history and corrupting generated schedules.

**Decision.** Terms are append-only rows with effectiveFrom/effectiveTo (the Workday pattern). A change regenerates only pending schedule rows; converted rows are immutable. Notice pay and encashment are one-off commitments, not schedule edits.

**Consequences.** Payroll history becomes auditable; 'what was the salary in March' has one answer; generators must respect the pending-only rule.

### ADR-023 · Retention is registry data; erasure is redaction

**Context.** Statutory retention (7y corporate tax governing over 5y VAT; longer for real estate; +2y pending refunds) collides with PDPL erasure and an append-only audit log.

**Decision.** retentionYears/basis/legalHold/erasureMode per document type in the registry; scheduled purge honouring holds; erasure redacts personal fields while financial records survive.

**Consequences.** Compliance changes are configuration; the audit log stays immutable; actual periods are confirmed with the accountant, not hardcoded.

### ADR-024 · Observability: instrument now, backend later

**Context.** Retrofitting correlation through every call site is the expensive half; the backend choice is the cheap, reversible half.

**Decision.** Correlation ids, structured logs, health endpoints and OTel API spans from day one; collector, storage and dashboards deferred until there is traffic.

**Consequences.** Debuggable from the first deploy; no premature vendor choice; application alerting stays with the Alert Manager, distinct from infra telemetry.

### ADR-025 · Invoice direction backfill: expand-migrate-contract, never guess

**Context.** Existing invoice documents lack direction; the wallet counts vendor bills as income. Some rows cannot be classified mechanically.

**Decision.** Add nullable direction; backfill inbound where a vendor value exists, outbound where the project route matched clientName; leave the rest NULL, excluded from cash and queued as work items; NOT NULL when the queue drains.

**Consequences.** The cash figure is correct immediately; ambiguity becomes a finite human task; the old developer question is demoted to predicting the queue's size.

### ADR-026 · Documentation is not charged to the code budget

**Context.** The size gate splits one measurement in two: size-impl at 400 lines to force an oversized task to split, size-total at 800 as a backstop. Only `tests/` and `scripts/test-guards.sh` were exempt from size-impl, so markdown counted as implementation. CLAUDE.md requires a behaviour change and its documentation in the same PR, and the reviewer fails a PR that lets the docs drift from the code — so every task that correctly updates its spec spent the allowance meant to force a split, and the cheapest way to pass became not updating the docs. The architecture specification could not be committed at all: 1,992 prose lines against a budget ADR-scale precedent had already made non-overridable.

**Decision.** size-impl excludes `docs/`, `*.md`, `tests/` and `scripts/test-guards.sh`. size-total continues to count every line including documentation, and remains raisable per task by `size_total:` with a `size_waiver_reason:` on the backlog node. The exclusion assumes markdown never carries executable content; the assumption is recorded at the exclusion so it is visible if it stops being true.

**Consequences.** Updating a spec alongside the code it describes is free, which is the behaviour the reviewer already enforces; prose volume still has to be justified once, against size-total, where a reviewer sees the waiver and its reason in the diff. The cost is that a doc-only PR is now bounded by nothing but the backstop, and that literate tests or generated code inside a fence would silently stop being measured.
