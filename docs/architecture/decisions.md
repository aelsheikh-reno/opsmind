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
