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

> **Amended 2026-08-17 by [ADR-039](#adr-039).** "Satellites are physically unable to reach PostgreSQL" holds for the satellites that are still **deployed**. Five capability services now target an importable package, which shares its host's connection by construction. What survives for them is the half of this record that was always the point — **a component owns its tables exclusively, and access goes through its interface** — enforced by the boundary lint rule instead of by the network.

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

> **Scoped 2026-08-17 by [ADR-039](#adr-039).** This applies to the **deployed** satellites — the parser, the AI platform and the Asana adapter. A capability service that ships as an importable package has no caller to authenticate: it runs in its host's process and receives the caller's identity as an argument.

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

> **Scope — superseded for this build.** This record applies to the **legacy database evolving in place**, where the system is in daily use and there is no window to stop and convert. The new build does not follow that path: it starts from its own schema, so there is no live table to expand and contract around. For the new schema, direction nullability is settled by [ADR-027](#adr-027), which keeps this record's "never guess" principle and drops its nullable phase. ADR-025 keeps its number and remains accurate for the track it describes.

**Context.** Existing invoice documents lack direction; the wallet counts vendor bills as income. Some rows cannot be classified mechanically.

**Decision.** Add nullable direction; backfill inbound where a vendor value exists, outbound where the project route matched clientName; leave the rest NULL, excluded from cash and queued as work items; NOT NULL when the queue drains.

**Consequences.** The cash figure is correct immediately; ambiguity becomes a finite human task; the old developer question is demoted to predicting the queue's size.

### ADR-026 · Documentation is not charged to the code budget

**Context.** The size gate splits one measurement in two: size-impl at 400 lines to force an oversized task to split, size-total at 800 as a backstop. Only `tests/` and `scripts/test-guards.sh` were exempt from size-impl, so markdown counted as implementation. CLAUDE.md requires a behaviour change and its documentation in the same PR, and the reviewer fails a PR that lets the docs drift from the code — so every task that correctly updates its spec spent the allowance meant to force a split, and the cheapest way to pass became not updating the docs. The architecture specification could not be committed at all: 1,992 prose lines against a budget ADR-scale precedent had already made non-overridable.

**Decision.** size-impl excludes `docs/`, `*.md`, `tests/` and `scripts/test-guards.sh`. size-total continues to count every line including documentation, and remains raisable per task by `size_total:` with a `size_waiver_reason:` on the backlog node. The exclusion assumes markdown never carries executable content; the assumption is recorded at the exclusion so it is visible if it stops being true.

**Consequences.** Updating a spec alongside the code it describes is free, which is the behaviour the reviewer already enforces; prose volume still has to be justified once, against size-total, where a reviewer sees the waiver and its reason in the diff. The cost is that a doc-only PR is now bounded by nothing but the backstop, and that literate tests or generated code inside a fence would silently stop being measured.

### ADR-027 · Direction is NOT NULL in the new schema; cutover resolves or quarantines

**Context.** [ADR-025](#adr-025) makes `Document.direction` nullable so the legacy database can be backfilled in place while the system stays in use, and mandatory only once the review queue drains. That reasoning does not carry to this build, which starts from its own schema with no live table to expand and contract around — there is nothing here to backfill. Carrying the nullable phase across anyway would import a workaround for a problem this database does not have, and it contradicted the target shape twice over: CLAUDE.md's rule that money always carries a direction and is never inferred from context, and the kernel schema task's own approved assertion that the column is not nullable. A nullable column also has to be defended forever by every reader — each query, forecast and cash figure has to decide what a NULL means — long after the queue that justified it is empty.

**Decision.** `Document.direction` is NOT NULL from the first migration of the new schema. There is no nullable phase and no later contract step. The cutover migration resolves direction before insert — inbound where a vendor value exists, outbound where the project route matched clientName — and a row it cannot resolve is **quarantined in the migration tooling and never inserted**, queued as a work item for a human. No enum member may stand in for the missing value: an `unknown` or `pending` direction is the nullable design wearing a different hat and is equally forbidden. ADR-025 keeps its number and stays authoritative for the legacy database evolving in place.

**Consequences.** The target database can never hold a document whose direction is unknown, so no consumer downstream has to handle that case and the cash figure cannot be quietly wrong. The cost is real and falls on the import: it is harder to write, it needs a quarantine store and a review queue of its own outside the target tables, and **an unclassifiable row blocks its own migration until a human decides** — that row does not arrive late, it does not arrive at all until someone rules on it. That is the trade accepted deliberately: a slower, more manual cutover in exchange for a schema that cannot represent the ambiguity. If the quarantine queue turns out to be large enough to stall cutover, the answer is better resolution rules or more reviewers, not a nullable column.

### ADR-028 · Generated migration DDL is not implementation

**Context.** [ADR-026](#adr-026) took documentation out of the 400-line implementation budget because charging prose to the code budget penalised the one artifact the reviewer is instructed to check. Generated migration SQL is the same shape of mistake with a different artifact. `prisma/migrations/*/migration.sql` is the byte-for-byte output of `prisma migrate diff` over `schema.prisma`: nobody writes it, nobody may hand-edit it without the next generate silently disagreeing, and it cannot be split across pull requests because a migration is atomic. Reviewing it means reviewing the schema it came from, which is counted. Charged to the code budget it roughly doubled the apparent cost of every schema line — `kernel-schema-base` measured 450 against 400 from 224 lines of authored schema and 164 lines of DDL it had no choice about, after it had already been split once. The only ways left to pass were to split a schema below the entities its own assertions need, or to delete the comments carrying the decisions behind it. Both make the repository worse to buy a number.

**Decision.** `size-impl` excludes `prisma/migrations/**/*.sql`. The exclusion is narrow by design: a `.sql` file anywhere else — a view definition, a seed, a hand-written backfill — is authored work and stays measured, including one sitting directly under `prisma/`. Unlike the lockfile rule this applies to `size-impl` only. `size-total` still counts every line, so a migration that rewrites half the database remains visible as volume and still needs a reasoned waiver on its node.

**Consequences.** A schema task is now budgeted on the schema a human actually reads and writes, which is what the 400 was always meant to measure, and the split that produced `kernel-schema-base` can stop at the seam its assertions require rather than one dictated by generator output. The claim is that generated DDL is not implementation, not that it is free — the backstop still sees it. The risk accepted is that the exclusion is a path prefix: anyone who hand-edits a file under `prisma/migrations/` puts unreviewed SQL outside the budget. That is already forbidden — an edited migration diverges from the schema at the next generate — but the gate no longer counts it, so the guard against it is convention rather than measurement.

### ADR-029 · The whole-PR backstop is 1500, and the implementation budget is still 400

**Context.** The size gate has two budgets: `size-impl` at 400 lines, whose job is to force an oversized task to split, and `size-total` as a backstop on everything else. `size-total` was set at 800 before any of the exclusions existed — before documentation left `size-impl` (ADR-026) and before generated migration DDL did (ADR-028), and before the testing policy CLAUDE.md calls non-negotiable had produced a single suite. By the time fifteen substantive tasks had merged, five had waived it: `staging-deploy` at 1800, `kernel-schema-base` at 1700, `docs-architecture-spec` at 2100, `kernel-schema-people-registry` at 1300 and `module-deadlines` at 1200. Every one of those waivers was tests, generated DDL or prose. Not one was implementation. Meanwhile `size-impl` has never been waived once, and cannot be — the mechanism refuses.

A budget waived a third of the time stops being read. The waiver reasons had grown longer than several of the diffs they excused, and a reviewer skimming a routine number learns nothing from it; worse, a genuinely oversized task would arrive wearing the same clothes as the four routine ones before it. The signal was being spent on the wrong cases.

**Decision.** `size-total` defaults to **1500**. `size-impl` stays at **400** and stays non-overridable — nothing in this record touches it, and the exclusions it already carries are unchanged. The per-task `size_total` waiver stays for genuine outliers, with its existing requirement of a written reason resolved from the committed backlog. A node may still set `size_total` *below* the default to hold itself tighter.

**Consequences.** A waiver becomes rare enough to mean something again: the four tasks that would have needed one at 800 now pass on the default, and a task that still needs 1500 raised is genuinely unusual and worth the reviewer's attention. The number is calibrated to what this repository actually produces — a compliance task's tests routinely run three to four times its implementation, which is the ratio the testing policy asks for rather than a symptom. The risk accepted is that 1500 is roomier and a bloated PR could hide inside it; that is what `size-impl` is for, and it is the budget that has never had to move. If `size-total` starts being waived routinely again, the answer is to look at what is being counted, not to raise it a second time.

> **Raised a second time anyway, 2026-08-18 ([ADR-042](#adr-042)).** The sentence above was tested and did not hold: the counting was examined first, and what it counts is tests, generated DDL and specification prose — every category CLAUDE.md requires. There was nothing to trim that was not the policy working.

### ADR-030 · Coverage is measured on the lines the task changed, plus a total-coverage ratchet

**Context.** The coverage gate handed its floor straight to vitest as a whole-repository threshold — `npx vitest run --coverage --coverage.thresholds.lines=$cov`, with `$cov` 90 for money and compliance, 70 for low, and 90 when the risk is unknown. The 90 was calibrated against a repository that was almost entirely domain logic. It is now also six `lib/kernel/*/repository.ts` files of Prisma plumbing sitting between 0% and 15% — document 14, enrolment 0, jurisdiction 8, legal-entity 11, person 11, regime 15 — because no PostgreSQL is reachable outside CI and a unit test structurally cannot enter a query body. They pin the repository total at 79.20%.

Under a whole-repository denominator that number is every task's number. `module-deadlines-civil-date` covered 100% of every line it wrote and failed anyway, on files it had never opened. A branch that is not `task/<id>` resolves no risk, takes the strict path and is asked for 90 on the same total, so two chore branches had to be given a backlog node purely to get through (#32, #37) — a workaround wearing a node's clothes. The failure mode is not that tasks got through; it is the opposite. A gate that fails a task for somebody else's untested file teaches an agent that the coverage number is noise, and the next thing an agent that has failed the same gate three times does is start weakening it. That is the incentive [ADR-026](#adr-026) and [ADR-028](#adr-028) each removed from the size budget, arriving at the one gate whose job is to protect the code CLAUDE.md calls non-negotiable.

The cheap fix was one line in `vitest.config.ts`: exclude `lib/kernel/*/repository.ts` from coverage and the total goes green immediately. It is the wrong line. Repositories are what payroll and the money spine read through, and an excluded file is one nobody looks at again.

**Decision.** **The denominator was wrong, not the floor.** Coverage is measured on the lines the task changed. 90 for money and compliance, 70 for low, and unknown risk keeps the strict path at 90 — no number moves. `scripts/coverage-gate.sh` parses the added line numbers out of `git diff --unified=0 $base...` and asks `coverage/lcov.info` about each one; an added line counts only if the report has a `DA:` record for it, so comments, blank lines and type declarations are neither covered nor uncovered, they are simply not executable.

A second and independent check ratchets **total** repository coverage against a baseline stored in `tests/baseline.json` beside the test-count floor, in basis points so the comparison is between integers. It fails on a decrease only. A task that legitimately lowers coverage records `coverage_waiver` with a `coverage_waiver_reason` on its backlog node, resolved from the committed backlog and from nowhere else, exactly as `size_total` and `test_count_waiver` already work.

**The stored integer is itself part of the ratchet.** `coverage_bp` is read from the base as well as from the working tree, because a ratchet resolved only from the tree grades itself: edit the number down and the percentage no longer has to clear anything, the waiver never runs, no reason is recorded, and the gate reports the decrease as a pass. A waiver that can be skipped by editing one integer is decorative. So a `coverage_bp` lower on the branch than on the base is treated exactly as an actual decrease — the same `coverage_waiver` with the same reason, or a failure naming both numbers. Raising it, or leaving it alone, is free. A base whose `tests/baseline.json` cannot be read fails closed; a base file that carries no `coverage_bp` at all is the commit introducing the key, where there is no earlier value to lower, and a working tree missing it already fails. That exemption is what makes this record's own PR passable, and it means the defeat it closes is still open for exactly one PR — this one, whose base is a `main` with no such key. It closes for every branch cut afterwards, and it cannot be re-entered: a branch deleting the key fails on the working tree before the base is consulted, so `main` cannot lose it through the gate.

**The identical hole is still open on the `"tests"` key** of the test-count ratchet in `scripts/gate.sh`, which reads its floor from the working tree only — a task can lower `"tests"` and skip `test_count_waiver` exactly as it could lower `coverage_bp` before this record. It is **not fixed here**: `size-impl` stood at 399 of an unwaivable 400 and a backlog node costs implementation lines. It is recorded as `gate-test-count-base-ratchet`, and the `SF:` gap below as `gate-coverage-lcov-reconciliation` — both added in the PR immediately after this record, before `gate-coverage-strict-path` was marked done. Whoever reads this next: if either node is gone without its fix having landed, the corresponding hole is live again.

Both fail closed. An unreadable or absent report, a report with no measurable line, an unresolvable diff base, a missing or unparseable baseline, a waiver that is not a number, and a waiver with no reason are all failures — a coverage gate that measured nothing must never print the same word as one that measured and passed. A diff with no coverable lines passes and says which, rather than printing a bare `pass` that looks like it measured something.

**No path is excluded, and `coverage.exclude` in `vitest.config.ts` is untouched.** Raising the repositories is `kernel-repository-integration-tests`, a separate node that exercises them against a real PostgreSQL in CI and bumps the baseline; this record deliberately does not do it.

**Consequences.** A task cannot be failed by somebody else's untested file, which is the only version of this gate an agent can act on: the remedy for a red `diff-cov` is always to write a test for a line the task itself added. Diff coverage alone would let the total rot one uncovered file at a time with every task green on its own lines, which is why the ratchet exists and why the two checks are reported separately. The repositories stay visible in the number rather than being defined out of it.

**What `diff-cov` actually measures is narrower than "its own work".** The denominator is the added lines that carry a `DA:` record in `coverage/lcov.info`, and the report only ever contains what `coverage.include` in `vitest.config.ts` selects: `lib/**/*.ts` and `tests/differential/**/*.ts`. Everything else in the repository is outside the measurement, not merely uncovered — a task writing only `app/`, `scripts/`, `prisma/` or a workflow passes `diff-cov` outright, with "no coverable lines changed", however much executable code it adds. That is deliberate for route handlers and pages, which CLAUDE.md keeps free of domain logic and which end-to-end tests cover instead, but it is a real gap for `scripts/`: the gate scripts themselves are graded by nothing but their own suite. Within `lib/`, non-executable additions — comments, blank lines, type-only declarations — are likewise neither covered nor uncovered, and a task that adds forty lines of explanation to a covered file is not failed for documenting itself. Widening `coverage.include` is a separate decision with its own consequences for the total, and it is not taken here.

**One limitation is worse than the others, because under it the gate stops measuring without saying so.** `SF:` records in `coverage/lcov.info` are reconciled against the diff by stripping a `$PWD/` prefix, which handles exactly the repo-relative form the v8 provider writes today and the absolute-under-`$PWD` form. Any third spelling — `SF:./lib/a.ts` is the one demonstrated — matches no changed file, and the gate then reports "no coverable lines changed" and passes a diff of uncovered lines. It is latent rather than live, since the current provider writes the plain form, but it is the one failure mode where `diff-cov` degrades from measuring to passing rather than to failing, which is the opposite of every other path here. The fix is a reconciliation check — if the diff changes files under the `coverage.include` roots and not one of them appears in the report, that is an unreconciled report and not an empty diff — and it is deferred only for the 400-line budget, not because it is acceptable.

The costs are real and accepted. The gate now depends on `coverage/lcov.info` being present and on the diff base resolving, so there are two more ways for it to fail for infrastructure reasons rather than code reasons — deliberately, since every one of them fails rather than passes. The percentage is computed from a report of the working tree against a diff of `HEAD`, so it is only exact on a committed tree; `gate.sh` already fails when nothing is committed. A task that adds no executable line is now unmeasured by `diff-cov` and rests entirely on the ratchet. And the backlog reader in `scripts/coverage-gate.sh` is a copy of the one in `scripts/gate.sh` rather than a shared function, so that the script can be driven standalone against a fixture repository — the two must be kept in step, and `tests/gates/coverage-gate.test.ts` pins the behaviour of the copy.

### ADR-031 · A check states what it measured, and refuses when it cannot measure it

**Context.** `scripts/gate.sh` measures two different subjects. `lint`, `types`, `tests` and `cov-report` read the **working tree**; `size-impl`, `size-total` and `diff-cov` read the **committed diff**, `origin/main...HEAD`. While those two agree the distinction is invisible, and it agreed for every run anyone had looked at. It stopped agreeing on `module-deadlines-sweep`: the gate was run mid-edit, printed `ALL GATES PASS` including `size-total`, the work was then committed, and the true figure was 2,746 added lines against a waived limit of 1,700 — a FAIL. The gate had weighed the previous commit and printed the word a correct run prints. A green was reported that meant nothing.

That is the **fourth instance of one pattern** in this repository, and the pattern is not "the size gate is wrong". Each time, a check measured the wrong subject and printed the same word a correct check prints:

1. **The stale baseline read.** Every ratchet resolved its floor from the working tree, so the run graded itself against a number the same commit could edit ([ADR-030](#adr-030) closed this for `coverage_bp`; `gate-test-count-base-ratchet` records that it is still open for `"tests"`).
2. **`gates=FAILURE` treated as a terminal state to stop waiting on.** The waiter saw a settled-looking value, stopped, and a **red gate was merged** (#30). It measured "the run finished" and reported "the run passed".
3. **The empty diff reading as green.** A branch with nothing committed measures zero added lines, and every budget reported pass having weighed nothing — a 450-line task reported `size-impl` pass against 400.
4. **This one.** A gate run before the commit it claimed to measure.

**Decision.** **A check must state what it measured, and must refuse when it cannot measure the thing it claims to.** Concretely, in `scripts/gate.sh`:

`gate.sh` prints a `commit` line on **every** run, pass or fail, in the same `%-14s` label column as every other gate line, naming the short SHA, the branch and the base it measures against. A verdict without a stated subject is unreadable, and the subject is not free to infer — the same branch name covers as many trees as it has edits.

If any file the gate measures is uncommitted, `gate.sh` **refuses**: it prints the `commit` line, a `worktree` FAIL naming every offending path, and exits 1 **before any other gate runs**. Nothing else is measured and nothing else is printed, because a verdict that could be about either of two trees is worse than no verdict at all. The refusal applies identically to `--summary`, which the Stop hook calls after every turn — a summary that silently measures a different tree is this same defect at higher frequency, not a lesser version of it.

**A measurement that could not be taken refuses too, and says so in different words.** The first implementation of this record discarded the exit status of the `git status` that measures the tree, so any failure of that command produced an empty result, `-n` read the empty result as "clean", and the refusal failed **open** — the one direction it exists to close. It did not self-rescue: `rev-parse`, `diff --quiet` and `diff --numstat` all read commits rather than the index, so a damaged index left every later gate measuring normally and the run reached `ALL GATES PASS`. The triggers are ordinary — `safe.directory` refusing a checkout git does not own, an unreadable object store, a concurrent git holding a lock, a git too old for `:(top)` pathspec magic, no repository at all. So `gate.sh` fails closed on a non-zero status with a message distinct from the dirty-tree one, and prints git's own stderr rather than swallowing it: "the tree is dirty" and "the tree could not be read" are different facts, and by this record's own thesis two different facts must not print the same word. The operator needs to read `fatal: detected dubious ownership` to act on it.

**The `commit` line names the ref from `symbolic-ref`.** `git rev-parse --abbrev-ref HEAD` prints the literal `HEAD` on a detached HEAD and exits 0, so it labelled a detached checkout with a branch name no branch has, while its `|| echo detached` fallback could only fire where git answered nothing at all — asserting detachment about a repository the script could not read. `symbolic-ref` fails on a detached HEAD and only there, which separates the three cases the line must distinguish: on a branch, off a branch, and no readable HEAD.

**"Files the gate measures" is everything git tracks or would track, minus two sets.** `package-lock.json`, which the `nolock` pathspec already excludes from both size budgets and which `coverage.include` never selects, so committing it moves no printed number. And anything `.gitignore` covers, stated as a rule rather than as a list: an ignored path can never appear in `$base...HEAD`, so it can move no number this suite prints, and that argument holds for whatever `.gitignore` says on the day it is read. The set is deliberately not enumerated here, because an enumeration drifts from the file it paraphrases and then describes a set that is not the set — the first draft of this record named five paths and the file already covered nine, including `out/`, `playwright-report/`, `test-results/`, `.env*` and a blanket `*.sql`. `git status` omits ignored files unless asked, so the rule needs no pathspec. Where ignoring and measuring meet is a path `.gitignore` covers that a commit carries anyway — `git add -f`, or a re-include such as `!prisma/migrations/**/*.sql`: that is in the committed diff, so it is measured like any other committed file, and the `size-impl` exclusions decide separately what counts as implementation. Everything else is measured, because `size-total` counts every added line of it: a dirty `docs/` page, a dirty `.claude/` prompt and a dirty backlog node each move a number the suite prints. The narrower rule considered and rejected was "refuse only for `lib/` and `tests/`", which would have passed the exact defect that prompted this record, `scripts/gate.sh` being neither. Untracked files count and are listed individually (`-uall`), since an untracked file in a measured path is precisely a file the committed diff lacks and the next commit will carry.

**The local gate runs the guard suite, because the refusal's own first casualty was a check nobody local ran.** Adding the refusal above broke every budget probe in `scripts/test-guards.sh`: those fixtures were bare temp directories rather than git repositories, so `git status` exited 128 inside all ten of them and the refusal — correctly — fired. `./scripts/gate.sh` reported `ALL GATES PASS` on that tree, and CI was what caught it, because `gates.yml` ran the guard suite as a step of its own and `gate.sh` did not. That is this record's thesis one level up: the local gate claims to be the pre-PR verdict while omitting a check the PR is judged on, so `pass` in the two places answered different questions. `scripts/test-guards.sh` is therefore the **first line of `gate.sh`'s full suite**, and the separate CI step is gone — one invocation, not two to keep in sync.

It is in the full suite and deliberately not in `--summary`, for a structural reason rather than a cost one (about three seconds): the guard suite probes `gate.sh` by running `--summary` inside fixture repositories, so a guard line reachable from `--summary` would re-enter the suite on every probe and never terminate. The fixtures were fixed by making them **real git repositories with a clean tree** — the state a real run requires — rather than by loosening the refusal for anything that looks like a test; and they stub their own temporary copy of `test-guards.sh` exactly as they already stub `npx` and `npm`, because a sandbox built to observe one measurement proves nothing by re-running the whole suite inside itself. No flag, environment variable or shape test disables the refusal or the guard line in a real checkout.

**Consequences.** The word `pass` regains a subject: every run says which commit earned it, and no run can earn it for a commit the caller does not have.

**The cost is a real workflow loss and is accepted deliberately.** The gate can no longer be run mid-edit for a quick read. That was a genuinely useful habit — run the suite, see roughly where lint and the tests stand, keep editing — and it is gone, because that habit is exactly how the defect happened. The Stop hook now fails on every turn that leaves an edit uncommitted, which is most turns during a task; its output becomes a two-line refusal rather than a summary, and an agent wanting the summary must commit first. `git stash` and a scratch commit are the workarounds, and both are more friction than typing `./scripts/gate.sh` was.

The narrower risk accepted is that the exclusion list is a judgement about what moves a number, and it is checked by nothing. If a later change starts measuring `package-lock.json` — a lockfile-drift gate, say — that file silently stops being a reason to refuse, and this record has to be revisited rather than trusted. Refusal is also all-or-nothing: a dirty README blocks a run whose lint and type verdicts would have been perfectly valid. That is the deliberate direction to err in. Under-refusing reproduces the defect; over-refusing costs a commit.

### ADR-033 · A timeout bounds the work, not the machine; and an ignore is a softening

Numbered 033 rather than 032, and 032 is deliberately left free. The unmerged `task/gate-reviewer-context-authority` still numbers its record **031**, which now collides with the one that landed as #45; Ahmed assigned it 032 on 2026-08-16, so it renumbers to 032 when it merges. Taking 032 here would have forced that collision a second time. An earlier draft of this line said that branch "already claims 032", which was wrong — nothing in the repository carries the string ADR-032 today.

**Context.** `tests/scaffold/eslint-boundaries.test.ts` loads `eslint.config.mjs` and `templates/eslint.config.mjs` as modules in a `beforeAll`, so that the boundary rules are compared as resolved rule objects. That import evaluates `eslint-config-next` and with it the whole typescript-eslint graph. The hook carried no bound of its own, so it ran under vitest's default `hookTimeout` of 10 s — a number nobody chose for this work.

Measured on a 14-core machine, the hook's wall clock is **1.11–1.17 s** for the file alone on an idle machine, **6.34–7.21 s** inside the 23-file suite on an idle machine, and **11.6–16.8 s** inside the suite with twelve background CPU hogs. The work itself is ~1.2 s and constant — the *second* config load costs 8–44 ms because Node has the graph cached by then — so everything above 1.2 s is contention with sibling vitest workers. The default bound therefore sat 1.4x above the idle full-suite cost. Measured over ten full-suite runs per condition, the suite passed **1 of 10** under twelve hogs and **9 of 10** under six.

That is a **false red**, and a false red is the same class of defect as a false green: in both the verdict has stopped describing the subject. It is worse than the lost minutes suggest, because the remedy it teaches is to re-run. `gates=FAILURE` treated as terminal merged a red gate (#30) and the stale baseline went unread for twelve merges — both are what a retry habit costs. The blast radius was also not the file that failed: any test file added anywhere raises the total work the suite spreads over the same cores, so the next node to add tests inherits a red suite it did not cause. `gate-stale-input-refusal` took the count from 22 files to 23 and was the last one that fitted.

**Decision, part one: a timeout is for a hang, never for contention.** The bound on this hook is `CONFIG_LOAD_BUDGET_MS = 120_000`, set in the test file with the three measurements above written beside it and the reason the number is where it is. 120 s is ~100x what the work costs alone and ~7x the worst figure measured under deliberate saturation. A stuck or broken import still fails, and fails within two minutes; a busy machine does not. **Where a bound is set, the measured cost of the work is written next to it**, so that the next reader sees a measurement rather than a budget the test overran and is not tempted to tune it back down toward the observed figure.

The bound is deliberately **per hook and not global**. `vitest.config.ts` keeps the default `hookTimeout`, because widening it repository-wide would relax every other hook — including ones with no comment saying what their work costs — and hide a real hang.

**Decision, part two: the hook names what it was doing.** `Hook timed out in 10000ms` states a duration and no subject, which is this repository's oldest defect in miniature. The load now runs under a labelled deadline that fails with `loading the eslint flat config templates/eslint.config.mjs — this import evaluates eslint-config-next and the whole typescript-eslint graph, about 1.2s of work on an idle machine … did not finish within 120000ms`. The same label wraps an error the load itself throws, with the original kept as `cause`, because the module-resolution message underneath is the one an operator acts on. Vitest's own hook timeout is held 30 s above the deadline so the labelled message is the one a red run shows.

**A concurrency setting was considered for "adding a test file does not change whether an unrelated file passes", and rejected.** Capping `maxWorkers` reduces contention but does not decouple the two: file N+1 still competes, through the queue instead of alongside. It would slow every run, including the great majority never at risk. And it hard-codes a parallelism guess that is wrong on a CI runner with a different core count and wrong again whenever a second agent is working — which is the condition that produced the failures. **No wall-clock bound is truly independent of machine load**; what a bound two orders of magnitude above the work buys is that the coupling can no longer reach the threshold. That is the honest claim, and it is the one the pass-rate measurement supports.

**Decision, part three: eslint's ignores are stated in the config, and compared.** ESLint flat config **does not read `.gitignore`**. An agent worktree under `.claude/worktrees/` is a full second checkout including `reference/legacy/`, and eslint walked into one and reported **935 errors against the outer repository** — files no PR had touched. Adding it to `.gitignore` fixed the diff and left the lint gate reading two checkouts as one. `.claude/worktrees/**` is therefore in `globalIgnores` in **both** `eslint.config.mjs` and `templates/eslint.config.mjs`: every project this template scaffolds is built by the same agent harness and grows the same directory on its first parallel task, exactly as `reference/**` is already in both for being a second tree of code the project does not own.

**An ignore switches a rule off for a path, so an ignore list is the cheapest way to soften a boundary rule.** `tests/scaffold/eslint-boundaries.test.ts` compares boundary *blocks*, and a block is invisible to it if the path never reaches the block. `globalIgnores(["lib/**"])` in `eslint.config.mjs` was verified to pass that file 7/7 and to leave `scripts/check-boundaries.sh` exiting 0, with the entire enforcement layer disabled for the code it exists to enforce. That hole predates this record; adding to the list is what surfaced it. The global ignore list is now compared too: every pattern the template ignores must still be ignored by the project, and every pattern the project adds beyond the template must be named in `ALLOWED_EXTRA_IGNORES` with its reason — today only `generated/**`. An ignore added to hide a rule fails the suite; a legitimate one costs a line and an argument a reviewer can read.

**There are two ignore lists, and closing one left the other open.** Review of this record found the sibling: a boundary block may carry its own `ignores`, which removes that block's rule from the path just as a global ignore removes every rule. The global-ignore comparison could not see it — it collects only entries with no `files` key, because that is what makes an ignore global — and the block comparison read `files` and `rules` and never `ignores`. One line, `ignores: ["lib/**"]`, on the first boundary block was verified to pass the file **9/9**, leave `check-boundaries.sh` exiting **0**, and take a planted `lib/_probe/probe.ts` carrying both a deep module import and `@/lib/db` from **2 errors to 0**: the same outcome as the global hole, at the same price, and equally invisible. **Block-level `ignores` are now compared the way `files` and `rules` are**, in both directions — an ignore the project adds to a boundary block fails unless it is named in `ALLOWED_BLOCK_IGNORES` (keyed by the block's `files`, and empty today), and an ignore the template's block carries and the project's has lost fails too. The general form of the rule is that **every key that can narrow where a boundary rule applies has to be compared, not only the keys that state the rule**.

**Consequences.** The suite passes under load, and the reproducing command and both pass rates are in the PR rather than in someone's memory. The boundary comparison is harder to defeat than before, and the claim is bounded by what was measured: **ten mutants were each killed against a clean baseline of 10/10 on the file** — `lib/**` into the global ignores; dropping `.claude/worktrees/**` or `reference/**` from the project; an unlisted `coverage/**` in the project; a weakened `group` pattern on block 1; `ignores: ["lib/**"]` on block 1; a new `{files: ["lib/**/*.ts"], "no-restricted-imports": "off"}` block; a template-only `vendor/**`; deleting boundary block 3; and widening the `off` block's `files` to `lib/**`. The two eslint configs are now held in step on their ignores — global and per-block — so a divergence has to be argued rather than merely typed, including a template-only divergence, which the suite fails on.

The costs are narrow and accepted. A genuinely hung config import now takes two minutes to report instead of ten seconds; that is the price of not reporting contention as a hang, and it is paid only on a failure that has never yet occurred. The measured figures in the test file are specific to a 14-core machine and will drift — they are dated by the record they sit in, and the instruction beside them is to re-measure rather than to trust. `ALLOWED_EXTRA_IGNORES` and `ALLOWED_BLOCK_IGNORES` are lists a task can append to, so each is a softening surface in the same way `size_total` is: they are defensible because the addition lands in the diff with its reason attached, not because they are impossible.

**What this record does not fix.**

`coverage/` is gitignored and not in either eslint config, so `npx eslint .` still lints the generated HTML report and reports a warning from it. It is the same hole as `.claude/worktrees/` — a gitignored path eslint scans anyway — and it is left alone here because it produces warnings rather than errors, so it does not change a verdict today, and because the node's assertion names worktrees. It is `gate-eslint-ignores-generated-output`. It should be closed rather than trusted.

The comparison is still **structural, not behavioural**: it reads two flat-config arrays and compares blocks, rather than asking eslint what it would report for a given file. Every mutant above was found by naming a way to soften the config and writing the comparison that sees it, so what the file catches is the softenings someone thought of. A key of flat config that narrows where a rule applies and is not compared here — `basePath`, or an ignore reintroduced through some future config-resolution feature — would be the same hole a third time. The durable answer is a planted probe: a file under `lib/` carrying a known violation, asserted to produce a known error count. That is not in this record, and until it is, "the config still says the right thing" is what is checked, not "the boundary is still enforced".

### ADR-035 · A comment is not implementation, in any language, and a backlog node is not code

Numbered 035: 031, 033 and 034 are taken, and **032 stays reserved** for the unmerged `task/gate-reviewer-context-authority`, which Ahmed assigned that number on 2026-08-16 and which renumbers to it when it merges — exactly as [ADR-033](#adr-033) records. Nothing in the repository carries the string ADR-032 today, and taking it here would force the collision that record already stepped around once.

**Context.** `size-impl` counted every added line of every file it measured — comment-only lines, blank lines and `tasks/backlog.yaml` included. **The evidence the 400 rests on argues against that.** The figure comes from the SmartBear/Cisco study of reviewer cognitive load — how much diff a human can read before defect detection collapses — and the same study found that authors who **annotate** their changes ship materially fewer defects, because annotating forces the author to re-read their own work. Charging annotations to the code budget makes deleting them the cheapest path to green. That inverts the finding the threshold rests on: the gate ends up paying an agent to remove the practice the study says prevents defects, in order to satisfy a number the same study produced.

This repository has now reached that conclusion three times about three artifacts. [ADR-026](#adr-026) took documentation out of the budget because CLAUDE.md requires a spec update in the same PR and charging it made *not* updating the spec the cheapest way to pass. [ADR-028](#adr-028) took generated migration DDL out because nobody writes it and it cannot be split. A comment is the third artifact a reviewer reads, and it is the one CLAUDE.md leans on hardest: this codebase deliberately carries the reasoning beside the code, because "nobody will know the codebase" is a stated and accepted limit of the whole pipeline and the documentation is what the team reasons about instead.

**The case that forced it.** `module-deadlines-sweep` measured **exactly 400** against a limit of 400, and went to **403** solely by correcting a comment that had become false: `MissingBusinessCalendarError`'s doc said a missing calendar aborts the run, which that node makes untrue. The correction *is* the work — a stale comment asserting the opposite of the behaviour is worse than no comment — and the gate charged it as if it were new implementation. The three ways past it were to split a task whose implementation was already at the seam its assertions require, to leave a comment in the tree saying something false, or to delete explanation elsewhere to pay for it. All three make the repository worse to buy a number, which is the same sentence ADR-028 had to write.

**Decision.** **`size-impl` counts a line of source only when it carries code, in every source language this repository parses.** Today that set is `.ts`, `.tsx`, `.mjs`, `.cjs`, `.js` and `.sh` — listed as the extensions which currently satisfy the rule, not as the rule itself, so adding one later is a matter of teaching the classifier rather than another adjudication. Charging comments in one extension while discounting its twin is the arbitrary line this record removes.** A comment-only line and a blank line are not implementation. **A line carrying code AND a trailing comment counts as code, in full** — no partial credit, because the alternative rewards moving an explanation onto the line it explains, which is the one place a reviewer is least likely to read it. **`tasks/backlog.yaml` is excluded from `size-impl` entirely.** `size-impl` stays at **400** and stays **never-waivable**. `size-total` is unchanged and still counts every added line of every file, backlog included.

**Every language, because the argument never was about TypeScript** (Ahmed, 2026-08-17). The first version of this rule discounted `.ts` and `.tsx` only, for no better reason than that the case which forced it happened to arise in TypeScript. Nothing in the SmartBear/Cisco finding is about a file extension: it is about a human reading a diff. Under the narrow rule the gate went on charging an agent for explaining a change to `scripts/gate.sh` — a 560-line shell file carrying more reasoning than code, and the file that *runs* this very budget — and for the two eslint configs, which are `.mjs`. That is the same perverse incentive, surviving in the languages the first pass did not look at.

**A backlog node is planning, not implementation.** `tasks/backlog.yaml` is a title, a dependency edge, a `produces` list, a set of assertions and the reasoning behind them; the pipeline reads it before every task it runs, and CLAUDE.md's working style requires it to stay current. Charged to a budget for reviewer cognitive load *on code*, recording why a task exists competes with the code that task writes, and the cheapest way to pass becomes a thinner node — a rule this repository has already rejected twice, for specification prose ([ADR-026](#adr-026)) and for generated DDL ([ADR-028](#adr-028)). It is one named file and not `tasks/` or `*.yaml`: a workflow, a config or a fixture graph in YAML is authored behaviour and stays measured.

**The classification is the compiler's for TypeScript and JavaScript, never a regex.** `//` inside a string literal, inside a template literal and inside a JSX expression is code, and only a parser can tell it from a comment. This repository has already been bitten by a line scanner reading declarations out of string literals, which is why `tests/kernel/kernel-source.ts` exists and parses with `ts.createSourceFile`; the classification is that reader's `classifyLines`, built on the comment ranges the parser reports. `scripts/size-impl.mjs` calls it rather than reimplementing it — **one implementation, used by both**, because two would drift and the suite would only ever grade one. `.mjs`, `.cjs` and `.js` go through that same reader under `ts.ScriptKind.JS` rather than through a second scanner, for exactly that reason. There is no `tsx` or `ts-node` here, so the script transpiles the reader with `ts.transpileModule` and imports the JavaScript from `node_modules/.cache`, which is gitignored and sits exactly two levels below the repository root so that the copy resolves both its `typescript` import and the reader's own `REPO_ROOT`. A `.tsx` file is parsed as TSX: under the TS kind `<div>{x}</div>` is a type assertion, JSX text is not JSX text, and the comment ranges come back describing a file nobody wrote.

**Shell has no compiler here, so its reader states its limits.** `shellKinds` in `scripts/size-impl.mjs` classifies `.sh` against the POSIX rules for where a comment can begin, not against a pattern. A `#` opens a comment only at a word boundary — start of line, or after a blank or one of `; & | ( )` — so `foo#bar` and `${x#prefix}` are code. A `#` inside `'…'`, `"…"` or `$'…'` is a literal, and quotes are tracked across newlines because a shell string may span them. A `#` inside a heredoc body is a character of the payload: `<<WORD`, `<<-WORD` (tab-stripped terminator), `<<'WORD'`, `<<"WORD"` and several heredocs opened by one line are all followed to their terminator, and `<<<` opens nothing. The shebang is an interpreter directive the kernel reads, not an annotation anyone may delete, so line 1 is code. A backslash escapes the next character, so `\#` is a literal. **What it does not do is written above it in the file**: arithmetic `<<` is read as a heredoc and a delimiter built by expansion is taken literally, both of which end in a refusal at end of file rather than a wrong count; a whitespace-only line inside a heredoc is reported blank, which under-counts it by one, because knowing better would mean knowing what language the payload is in. Every ambiguity resolves towards **code**, which over-counts a budget and can never let an oversized task through, and where the reader has lost the thread it refuses — [ADR-031](#adr-031)'s rule that a classifier which cannot classify must not guess.

**It fails closed.** If the script cannot run, cannot reach the reader, or cannot classify a file, `size-impl` FAILs and prints why. Under-counting is the direction that matters — a budget that silently classified nothing would pass every oversized implementation ever written — and [ADR-031](#adr-031) is the standing rule that a check refuses when it cannot measure what it claims to.

**Consequences.** Explaining a change costs nothing, in any language; correcting a comment that has become false costs nothing; and writing down why a task exists costs nothing. That is what the annotation finding says the gate should want. The budget now measures the thing the 400 was calibrated on: code a reviewer has to hold in their head.

**The cost is real and it is charged to `size-total`, which is now the only thing holding that line.** A comment-heavy diff is still a large diff to read, and 450 lines of which 100 are prose still takes a reviewer longer than 350. `size-impl` no longer sees any of it — not the comments, in any of six extensions, and not a backlog node however long. `size-total` does, unchanged at 1500 and counting every added line of every file, and it is the *only* budget that does. The risks accepted, in order of how likely they are to be paid: a task can grow its explanation and its node without limit until the backstop notices, four hundred lines of implementation can now arrive in a diff of nearly fifteen hundred, and a *wrong* comment is free — the gate has never been able to judge whether an annotation is true, and it can no longer even charge for its volume. The one honest mitigation is that `size-total` is waivable and `size-impl` is not, so the backstop being reached is a conversation with Ahmed rather than a number an agent can move.

**The measurement is no longer a one-liner.** `size-impl` was `git diff --numstat | awk`. It now needs node, the `typescript` package, the reader and — for shell — a scanner this repository maintains itself, so there are several more ways for it to fail for infrastructure reasons, deliberately, since every one of them FAILs rather than passes. The shell reader is the part with no compiler behind it and therefore the part most likely to be wrong; the four cases it exists for (`#` in a single-quoted string, `#` in a heredoc, the shebang, a trailing `#`) are each demonstrated failing under a broken classifier and passing under this one, and its limits are listed in the file rather than left to be found.

**The fixtures that probe the size gate need what a real run needs.** `scripts/test-guards.sh` built its budget probes as a copy of `scripts/` in a temp directory with no `node_modules` and no `tests/`, so the six probes whose fixture carries a `.ts` file could not classify and refused — correctly, and the `guards` line was red until it was fixed. The fix is the one [ADR-031](#adr-031) already recorded for the same file: make the fixture the state a real run requires, by symlinking `node_modules` and copying the reader in, rather than softening the script for an environment missing its toolchain. `tests/gates/size-impl-comments.test.ts` builds its gate fixtures the same way. Anything that later builds a fixture to measure a diff inherits that requirement.
### ADR-036 · Four disciplines for the build loop: plan, verify, annotate briefly, and stop at three

Numbered 036: 032 is still reserved for the unmerged reviewer-context work, 034 belonged to a node that was abandoned, and 035 is taken by `gate-size-impl-exclude-comments`, also unmerged.

**Context.** Four failures inside one week, none caused by a missing gate. Every one was a loop the agents ran badly, and a gate cannot catch any of them.

`module-deadlines-sweep` was re-split three times — 532 lines, then 457, then 403 — because its shape was discovered while building rather than decided before. Each discovery cost a rebuild, a rebase and a re-measure.

`ALL GATES PASS` was reported from a run made before the commit it described. The gate measures the committed diff; the tree moved under it. Separately, `23 mutations, zero survivors` was scored against a red baseline, counted a mutation as killed for turning an already-failing test green, and did not reproduce — an independent re-run found 13 survivors in 30. Both claims were relayed rather than re-run.

Comment blocks reached fifteen and twenty lines, several restating what the code plainly does, several carrying decision history and dated attributions that belong in an ADR. That prose is also what `size-impl` charged against the code budget until ADR-035.

And `module-deadlines-sweep` took six passes across four gates without ever tripping the three-strike rule, because the rule counted per gate and each gate counted separately.

**Decision.** Four changes to the agent instructions. No new gate and no new script — every one of these is a judgement, and a script that could check it would be a script that could be argued with.

**Plan before build.** `/build-task` gains a planning step before any implementation, for every node: the files to be touched with an estimated implementation line count each, which assertions land where, whether the total clears `size-impl` and the node's `size-total`, and what it depends on that is not yet merged. An estimate over budget proposes the split in the plan and stops. A built result diverging from the plan by more than 25% on implementation lines is reported as such, with what was missed — an estimate nobody checks against the outcome never improves.

**Verify before claiming.** No claim of passing, complete, verified, all gates pass or mutations killed, without the exact command, the commit it ran against, and its output in the same message. A claim relayed from a subagent is not a claim: re-run it or attribute it as unverified. A mutation claim carries its reproducing command and literal mutation list, states its baseline first, and counts a kill only as failures strictly above that baseline.

**Comment limits, checkable rather than advisory**, in identical words in `implementer.md` and `reviewer.md`: three lines above a function, eight for a file header, one inline, and never a block longer than the code it annotates. Anything longer goes in the ADR or the commit message and is cited, never copied. A comment says why this is not the obvious thing — never what the code does, never decision history, never dated attributions. New and modified code only.

**One iteration limit for the task, not per gate.** Three attempts total across every gate; a restructure, a split, a waiver request and a fix each count as one. On the third failure the run stops and asks Ahmed what failed each time, what changed between attempts, and two or three options with the trade-off of each in plain business terms — no function names, no types — and then waits.

**Consequences.** The planning step costs a message on every node, including the small ones that never needed it, and an estimate is a guess that will sometimes be wrong; the 25% reconciliation is what stops it becoming ceremony. Verification costs a re-run of work a subagent already did, which is the price of a claim that is checkable rather than merely confident.

The comment limits are the sharpest edge here, and they cut both ways: a limit on explanation, written in a repository whose gates and scripts are deliberately heavily commented and where ADR-035 has just established that annotation is worth protecting. The reconciliation is that annotation belongs somewhere, and a 3-line pointer to an ADR is better than a 20-line copy of it that drifts. The risk is real — the next author with something genuinely subtle to say may cite an ADR nobody writes.

The iteration limit will sometimes stop a task that a fourth attempt would have finished. That is the point. Six passes across four gates is not persistence, it is an agent optimising against a number, and the cost of asking one message earlier is far below the cost of the fourth restructure.


### ADR-037 · A module repository lands with its integration tests, not with the module logic it serves

**Context.** `repository.ts` is the one file in a module allowed to reach the database (CLAUDE.md rules 1 and 3). Its body is Prisma calls, and Prisma calls cannot be executed without PostgreSQL — which is reachable in CI and nowhere else. So a module repository is, by construction, not unit-coverable.

That collides with `diff-cov`, which grades a task on the lines it changed ([ADR-030](#adr-030)). `module-deadlines-sweep` measured **89.09% of 55 changed executable lines against a 90 floor** — six lines short, and all six were `repository.ts`'s four Prisma calls. The sweep neither caused that nor could fix it: the file has been uncoverable since it was written, and its own test is deliberately a source reader, pinning that the file declares `// owns:` and imports the shared client rather than executing a query.

It is not one module's problem. The six kernel repositories sit between 0% and 15% for exactly this reason, and every one of the remaining modules — payroll, projects, expenses, billing, finance, ingestion — will reach the same wall the first time it writes one.

**Decision.** **A module's `repository.ts` lands in the node that carries its integration tests, not in the node that carries the module logic it serves.** The domain node keeps the store behind its port — `DeadlineStore` on `DeadlineDeps` — which is what already lets its tests run without a database. The Prisma implementation follows separately, with tests that exercise it against a real PostgreSQL.

Two alternatives were refused, and the refusals are the load-bearing half of this record.

**No waiver on `diff-cov`.** That gate has no waiver mechanism by design. It measures what a task is answerable for, and the honest answer for uncoverable plumbing is not "waive the measurement" but "measure it somewhere it can be covered". Creating a waiver surface on `diff-cov` to pass the node that needed one is how a gate stops meaning anything — the same reasoning that keeps `size-impl` unwaivable under [ADR-029](#adr-029).

**No CI-only integration test inside the domain node.** A test that runs in CI and skips locally makes the gate green in one place and red in the other. A verdict that disagrees with itself by environment teaches a developer to ignore the local run, and an ignored local run is the stale-baseline failure that [ADR-031](#adr-031) exists to prevent, arriving through a different door.

**Consequences.** A module's domain logic and its persistence land in two pull requests rather than one, and for a period the module has a port with no production implementation behind it. That is less costly than it sounds — the port is what the domain tests already use, and a module that cannot be exercised without its repository was too coupled to it anyway.

The cost that is real: this pattern only pays off once `kernel-repository-integration-tests` exists. Until then a repository node is blocked, and a module needing persistence in production is blocked with it. That node moves ahead of the money spine for exactly this reason.

And a repository landing separately is a repository that can be forgotten. The domain node's port is the reminder — an interface with no implementation is visible in a way an untested file is not.

### ADR-038 · A repository test obtains an engine; it never skips

Numbered 038: 032 is still reserved for the unmerged reviewer-context work, and 034 belonged to an abandoned node.

**Context.** [ADR-037](#adr-037) settled that a `repository.ts` lands with its integration tests. This is the harness those tests — and every module repository after them — obtain a database from. The six kernel repositories sat between 0% and 15% line coverage (document 14, enrolment 0, jurisdiction 34, legal-entity 11, person 11, regime 15) because a Prisma call cannot be executed without PostgreSQL.

The obvious harness runs when `DATABASE_URL` is set and skips otherwise. [ADR-037](#adr-037) already refused that: a gate green in one place and red in the other teaches a developer to ignore the local run, which is the stale-baseline failure [ADR-031](#adr-031) exists to prevent. The node predated that record and was amended for it (Ahmed, 2026-08-17).

**Decision. A test never skips. It obtains an engine.**

`DATABASE_URL` present, it is used. Absent, the harness boots **PGlite in-process behind a TCP socket** (`@electric-sql/pglite` + `@electric-sql/pglite-socket`), so Prisma connects through an ordinary `postgresql://` URL — no driver adapter, no preview feature, no schema change. Neither obtainable, the run **FAILS naming which of the two is missing and why**. Never a skip, never a pass.

**An unreachable `DATABASE_URL` is a failure, not a reason to fall back.** Falling back would let a broken CI database read as green against an engine production never runs — the divergence this record exists to surface, arriving silently.

**CI keeps the engine production uses, deliberately.** Migrations are the highest-risk thing these tests exercise and the likeliest place two engines diverge: constraint enforcement, NOT NULL backfills, the append-only trigger. PGlite everywhere would buy exactness where it matters least and give it up where it matters most.

**The same `prisma migrate deploy` runs on both**, so an engine that disagrees surfaces as a migration failure rather than as a silent behaviour difference.

**A test that passes locally and fails in CI, or the reverse, is a FINDING about engine divergence.** It is reported as one, with both engines named. It is never retried, and it is never called flakiness — that habit is what merged a red gate (#30) and left a stale baseline unread for twelve merges.

**Isolation is a truncate between tests, in a schema of each file's own.** Not a transaction rolled back: repositories call the shared client directly (CLAUDE.md rule 3), so there is no transaction handle to route them through without changing `lib/` to suit its tests. Files run in parallel and a truncate is not scoped to anything, so a shared schema would have them wiping each other's rows — which reads afterwards as flakiness. The per-file schema also keeps the suite off the tables of whatever `DATABASE_URL` names.

**Consequences.** Total repository line coverage went from 84.59% (335/396) to 99.24% (393/396), and all six repositories are at 100% of lines. Every module repository now has a harness to land against, so [ADR-037](#adr-037)'s split is payable.

**Two engines cost two engines, and three divergences were measured rather than assumed.** All three are in the PGlite path and none is present on PostgreSQL:

1. **The socket server drops the connection on any error response.** The query after an expected constraint violation fails with `Server has closed the connection`. `refusalFrom` in the harness absorbs it, and is the only way a test asserts a refusal.
2. **Prepared statement names collide across that reconnect**, because the socket multiplexes every connection onto one backend: the fresh session re-prepares `s15` while the dead session's is still held. It appeared once in a full-suite run and would otherwise have been read as flakiness. `DEALLOCATE ALL` on the reconnected session — only when a reconnect actually happened, so PostgreSQL never sees it — closes it. `pgbouncer=true` closes it too and was rejected: it degrades a foreign-key violation to `unexpected message from server`, which is the behaviour under test.
3. **Prisma's migrate advisory lock is per database**, so six files migrating six disjoint schemas at once would queue behind each other. `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK` is set for the harness's own deploy; the schemas share nothing, so there is nothing for it to protect.

The other costs are plainly real. About 8.5 s per test file goes on booting an engine and migrating it, and six in-process engines make the machine busier for everything else: a unit property test that cost 2.6–3.4 s reached 7.3 s and overran vitest's 5 s default, which is why `testTimeout` is 60 s with those figures beside it ([ADR-033](#adr-033)). Two engines also mean a bug can hide in the gap between them — the honest mitigation is that the migrations are identical and that any disagreement is a reportable finding rather than a re-run.

**What is not verified here.** The `DATABASE_URL` path was exercised against a PGlite socket, not against `postgres:16`: no PostgreSQL is reachable from the machine this was built on, which is the condition that made this node necessary in the first place. Its first real run is CI.


**A fourth divergence, found by CI rather than by reasoning — collation.** PGlite runs the `C` collation (`datcollate = C`, byte order); a server typically runs a linguistic one. They disagree whenever an `ORDER BY` on text ties on a prefix and the tie is broken by case: byte order puts `UAE VAT` before `UAE corporate tax` because `V` (0x56) precedes `c` (0x63), while `en_US` puts it after because the primary weight of `c` precedes `v`. `regime.test.ts` asserted the byte order, passed locally on PGlite, and failed in CI on `postgres:16` — the first real run against the engine production uses, and exactly the finding this record says to report rather than retry.

It is not fixed by forcing a collation on the test database: that would make CI diverge from production, which is the thing this record exists to prevent. It is fixed in the test, because a query whose result depends on collation is not portable and should not be asserted as though it were. **An ordering case seeds keys whose relative order is identical under both collations** — differing at the first character, or matching in case. The three sibling files already did this by luck (`A`/`M`/`Z`, `AE`/`BH`/`EG`); `regime` did not, and now says so in a comment where a copier will meet it.

This is the strongest evidence for keeping real PostgreSQL in CI. No amount of local running would have surfaced it.


### ADR-039 · A capability service's reuse target is an importable package, not a deployment

**Context.** Every capability service was specified with the same target — its own deploy, reached over the internal network ([containers](architecture-containers.md)). That assumed reuse means another *system calling* it. The reuse actually wanted is another *codebase importing* it: an alert engine, a work-items engine, a docgen engine dropped into a different application rather than rebuilt there. A deployed service does not give that. It gives the second product a network dependency it must operate, monitor and authenticate to — which is more work than rewriting the thing, so it never gets reused, which was the whole point.

**Decision.** For **docgen, the Alert Manager, Work Items, Notifications and Authorization**, the target is an **importable package**: a component another application adds to its own codebase, whose public surface is a function call in that application's process. It brings its own table definitions and owns those tables exclusively, and it uses the **host application's storage** rather than a store of its own. The **document parser and the AI platform stay deployed**, for a reason that is not packaging — they are separate runtimes with their own dependencies, and importing them into a Next.js codebase is not available. Ahmed's decision, 2026-08-17.

**Consequences.** The membership test for a capability service loses "**owns its own store**" and keeps **exclusive table ownership**: nothing outside the component reads or writes its tables. CLAUDE.md rule 1 is unchanged by this and now carries the whole of the boundary, so the boundary lint rule — not the network — is what enforces it. [ADR-002](#adr-002)'s "satellites are physically unable to reach PostgreSQL" holds only for the satellites still deployed; a package shares the host's connection by construction. [ADR-009](#adr-009)'s internal token likewise applies only to those — a package has no caller to authenticate, and its caller's identity arrives as an argument. [ADR-021](#adr-021) is untouched: day one is still four deployables; this changes the **Target** column for five rows, never the **Day one** column.

**Not settled here.** What a package may assume about its host — how its migrations run, how it is handed a connection, which framework it may expect — is the next question this raises and is deliberately left open. The five integration adapters are also not settled here: an adapter persists nothing, so the reasoning above does not transfer to it unexamined.


### ADR-040 · An alert names the area it was raised in, and a failed alert never ends the run

**Context.** Resolution by absence closes an alert that does not reappear in a report ([flows-alerting](flows-alerting.md)). That is only sound inside an area the run actually checked. The deadline sweep already carries this for its own findings — `ReportedAlert.jurisdictionId` is the scope and `RunScope.complete` says whether it was finished — but the out-of-band path, `raiseAlert`, carries no area at all: the jurisdiction or deadline type sits inside a free-form `context` bag. Separately, no call in `runDeadlineSweep` is guarded, so an Alert Manager that fails on one misconfiguration alert ends the run before it reports anything at all.

**Decision.** Three things, all Ahmed's decision, 2026-08-17.

1. **An alert closes only within an area the run declared checked.** Alerts in areas that were not checked stay open.
2. **The area is a named argument on `raiseAlert`**, not something read back out of `context`. The Alert Manager must never parse a caller's context bag: that bakes one caller's vocabulary into a component built to serve several ([ADR-039](#adr-039)), and a caller that spells the key differently silently loses its scoping.
3. **A failed alert call does not abort the run.** The sweep carries on and still reports — a partial run reported honestly beats every jurisdiction going dark for one failure, which is the same reasoning that made completeness scoped rather than global (2026-08-14).

**Consequences.** `AlertManager.raiseAlert` gains an area parameter, and the merged deadline monitor changes with it rather than around it. **An area whose alert could not be raised was not fully checked, so the run reports that area incomplete** — otherwise (3) silently undoes (1), by letting absence close an alert the run failed to raise. That is a derived constraint, not a separate decision: it is what (1) means once (3) exists.

**The argument is a LIST, and that is derived rather than decided.** The decision above says "the area", singular, and the reviewer of the implementing change was right to ask. It follows necessarily from a rule that was already settled: one misconfiguration alert is raised per unconfigured deadline TYPE per run, not one per deadline — and a deadline type spans every jurisdiction holding a registration of it. A singular parameter would force either one alert per jurisdiction, contradicting the per-type rule, or an alert that names one scope while silently affecting several, which is the exact unsoundness this record exists to remove. So `areas: readonly string[]`, and an alert that belongs to one scope passes a list of one. **Ahmed has not ruled on this**; it is recorded here so the Alert Manager is not written against an ambiguity, and it is the shape to confirm or reject before `service-alerts-surface-and-lifecycle` compiles a client against it.

**Not settled here.** Whether a run in which every alert call failed should still count as a run — reported, with every area incomplete — or as no run at all.


### ADR-041 · A money or compliance task merges itself; the differential is what makes that safe

**Context.** `risk: money` and `risk: compliance` did three separate things: require a differential test against the legacy system, raise the diff-coverage floor from 70 to 90 on the lines the task changed, and **hold the pull request open for Ahmed to merge by hand**. 29 of 78 nodes carry one of the two tags, so the hold was the pipeline's main stopping condition — it ran out of *permitted* work long before it ran out of work.

**Decision.** The **hold is removed. The other two stay.** A money or compliance task merges itself through `merge-when-green.sh` exactly as a low-risk one does. Ahmed's decision, 2026-08-18, choosing this over also dropping the differential or collapsing the risk tiers entirely.

**Consequences.** What the tag buys is unchanged where it matters: **nothing merges a payroll or tax calculation without a differential test against the system currently paying people**, and without 90% coverage of its own changed lines. A disagreement with the legacy oracle turns the gate RED, which stops the merge on its own — so the case the hold existed for still reaches Ahmed, through a failing gate rather than through a queue of open pull requests. That is a better channel, not a worse one: a red gate names what disagreed, where a waiting PR only says someone should look.

**What is genuinely given up, and it is real.** The second pair of eyes on a *green* compliance PR. A task whose differential passes because the legacy behaviour is **also wrong** now merges unread. Legacy is evidence, not authority (2026-08-16), and some of it has never been validated — so this is not a theoretical cost. The mitigation is that the differ reports agreement as well as disagreement, and an agreement on an unvalidated rule is still a claim Ahmed can audit after the fact rather than before it.

**Not settled here.** Whether the phase boundary — Ahmed approving the next phase's task graph — should also go. With the hold removed it is the only remaining stopping condition in the pipeline.


### ADR-042 · size-total is 2600; the roles are delegated again; admin bypass stays

Three pipeline decisions, Ahmed 2026-08-18, recorded together because they were taken together after the pipeline's own numbers were measured.

**One — `size-total` rises from 1500 to 2600.** 8 of 39 completed nodes carried a waiver and **every one was granted**: 1200, 1300, 1700, 1800, 1800, 2100, 2500, 2600. A budget that fires on one task in five and is then always granted is not a limit, it is a confirmation dialog — it has never once caused work to be split or reconsidered, only a round trip to Ahmed.

[ADR-029](#adr-029) anticipated this and advised against it: *look at what is being counted, not raise it a second time.* **That was done first, and it is why the raise stands.** What `size-total` counts, on the tasks that waived it, is tests, generated migration SQL and specification prose — the three categories `size-impl` already excludes precisely because CLAUDE.md mandates them. A compliance task's tests routinely run three to four times its implementation because the testing policy asks for that. There was nothing to trim that was not the policy working correctly, so the count was right and the number was wrong.

**`size-impl` is untouched at 400 and stays non-waivable.** It is the budget that works: never waived in the repository's history, and the one time it bit, the task was split — which produced [ADR-037](#adr-037), [ADR-038](#adr-038), the integration harness, and six kernel repositories going from 11% to 100% line coverage. The distinction being preserved is that **implementation is bounded hard and everything the policy requires around it is bounded softly.**

**Two — the subagent roles are delegated again.** `implementer`, `test-author` and `reviewer` return to their own context windows. They had collapsed into one agent doing all three, which silently removes the two separations the pipeline is built on: tests written blind to the implementation, and a reviewer that cannot agree with itself. On the PR before this one the same agent wrote the code and then its tests — tests that photograph the implementation rather than check the specification, which is the exact failure `test-author` exists to prevent.

**Three — `enforce_admins` stays off, and the bypass is now deliberate rather than accidental.** `main` carries branch protection with `strict: true` and a required `gates` check, but admins are not enforced. That is knowingly kept: `build-task.md` step 12 commits the `mark-task-done.sh` result straight to `main`, which prints `Bypassed rule violations`, and enforcing admins would block the status flip that keeps the graph honest.

**What that costs, stated plainly.** The merge button can still push past a red `gates` check — the #30 failure mode, which is the reason `merge-when-green.sh` exists. The compensating control is that every automated merge goes through that script, which re-reads the verdict immediately before merging and fails closed. The hole is now open by decision, and a human clicking merge on a red PR is the one path nothing in this pipeline can stop.


### ADR-043 · The alert contract carries no OpsMind noun, including in its field names

**Context.** [ADR-039](#adr-039) makes the Alert Manager an importable package: a second codebase adds it and calls it in its own process. [ADR-040](#adr-040) gave `raiseAlert` a vocabulary-free `areas` argument for exactly that reason. But `reportRun`'s side of the same port was left alone, and it carries `ReportedAlert.jurisdictionId` and `RunScope.jurisdictionId`.

**That is not cosmetic, and the collision is concrete.** `service-alerts-surface-and-lifecycle` carries two assertions that cannot both hold: its client must satisfy this port *exactly*, and *no file in the service may name a jurisdiction*. TypeScript is structural, so reading a scope means spelling the field's name — the engine's own source would contain `jurisdictionId` in order to find a value it neither understands nor cares about. Found by the reviewer of `deadlines-alert-contract-scope-and-failure`, before a client had been written against it.

**Decision.** **The scope field on the alert contract is named `area`**, matching the `areas` argument [ADR-040](#adr-040) already introduced — one vocabulary across the port rather than two. `ReportedAlert.area` and `RunScope.area`. Ahmed's decision, 2026-08-18, choosing this over dropping the no-vocabulary rule or interposing a translator.

**What is deliberately NOT renamed.** OpsMind's own storage and its own inputs. `DeadlineRegistration.jurisdictionId` stays a column, `DeadlineInput.jurisdictionId` and `Registration.jurisdictionId` stay fields, and the module's internal variables stay as they are. **OpsMind is entitled to know what a jurisdiction is** — it is a compliance system for five Gulf jurisdictions. The rule was only ever about the component being lent to other applications. Of 177 mentions in the repository, two field declarations change; the rest are OpsMind addressing itself. There is **no migration** and nothing about how anything is stored changes.

**Consequences.** Both of `service-alerts-surface-and-lifecycle`'s assertions become satisfiable, and its client can be written without the port forcing a word into it. The cost is a second edit to a merged compliance module within a day of the first — paid now, deliberately, because the alternative is paying it *after* a client compiles against the old names, when it stops being one edit and becomes two.

**A translator was rejected.** It would need writing, testing and keeping in step with both sides, and it has to live somewhere — whichever side owns it is the side that knows both vocabularies, which is the problem moved rather than solved.
