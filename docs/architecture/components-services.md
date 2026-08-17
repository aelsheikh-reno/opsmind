# Capability services

> Seven reusable capability services. Each passes both tests: a second product would use it unchanged, and it **owns its tables exclusively** — nothing outside it reads or writes them. Five of the seven reach that second product as an **importable package** rather than as a deployment, and so share their host's storage; the parser and the AI platform are separate runtimes and stay deployed ([ADR-039](decisions.md#adr-039)).

### Context

**The business problem.** Reno is building a second product, SmartOps, for security operations. It needs to read documents, track alerts from raised to resolved, and hold a queue of things awaiting human approval — all of which OpsMind already does, and none of which is specific to professional services.

**Why this exists as its own component.** In the current build that code cannot leave, because everything reaches directly into one shared database. These seven are the components that pass a deliberately strict test: a second product would use them *unchanged*. Anything needing modification stays in the core, where changing it costs one commit rather than a cross-team contract.

**What it does.** Each owns a generic capability end to end — parsing, model routing, document rendering, alert lifecycle, human decisions, delivery, permissions — along with its own storage.

**How it works.** Reuse is enforced by what each service is denied. The parser is handed a field schema on every call rather than knowing any; a parser that knew what a filing deadline is would no longer be reusable. Work Items never sees document content — the core supplies context and executes decisions the service records. Authorization holds a per-application permission vocabulary rather than OpsMind's. The "must never know" column below is the working form of that constraint.

**Where it sits.** Satellites: deployed separately, reached only over the internal network, never touching the application database. Two seams need care — the Work Items resolution callback and local token verification — both documented below.

> **Note** — **Why these seven and not others.** Reno is building a second product, SmartOps, for security operations. Ask of each capability: would SmartOps use this exact code without modification? An alerting engine, yes — an alert is an alert whether the condition is an expiring visa or an intrusion attempt. A document parser, yes. Payroll, no. That question is the entire extraction criterion, and it is why the "must never know" column below matters: the moment a service learns something Reno-specific, it stops being reusable and belongs back in the core.

| Service | Contract | Must never know |
|---|---|---|
| **Document parser** stateless | classify(file) → type + confidence extract(file, schema) → values + confidence. The schema is supplied by the caller from the registry on every call | Any OpsMind entity or field default. A parser that knows filingDeadlineDays is not reusable |
| **AI platform** exists | Model routing, prompt versions, RAG, tools. Replaces 19 hardcoded model literals across route handlers. Also serves semantic document search | — |
| **Docgen** | render(template, data, format) → file — DOCX, PDF, and email HTML from one template (payslip PDF + payslip email). detectPlaceholders(template) → keys. Callers pin a template version per render so a payslip re-renders identically years later | What a salary is. AI conversion of a signed contract into a template stays in the core — deciding "AED 18,000 is {{salary}}" is domain knowledge |
| **Alert Manager** | reportRun(sourceId, runId, alerts[]) · raiseAlert · resolveAlert · acknowledge · suppress. Four states, grouping, inhibition, escalation. Full spec: [alerting flow](flows-alerting.md) and [ADR-020](decisions.md#adr-020) | What a visa, a filing or a correlation rule is. It consumes severity; it never judges it |
| **Work Items** | create(type, entityRef, context, policyId) · resolve(itemId, decision, actor) · listFor(userId). State machine, assignment, aging, escalation, approval policy (thresholds, segregation of duties). Items carry a section so a visa review reaches HR and an invoice review reaches Finance | Your documents or extractions — content is supplied by the core; the service records decisions, the core executes them |
| **Notifications** | send(rendered content, recipient, channel) with delivery status and retry | Recipients (caller supplies), templates (Docgen renders), OTP codes (an authentication concern) |
| **Authorization** | getPermissions(userId) → role, entities[], permissions[] · check(userId, action, resource). Owns role definitions, the grant matrix, entity scope, per-app vocabulary. One-time claim tokens | Passwords or sessions — authentication is the IdP's job; and the IdP must never know payroll:approve exists ([ADR-007](decisions.md#adr-007)) |


## The two hard integration seams

**Work Items → core callback.** Resolving an item means the core must act — re-run a rule, push an expense. The contract: a signed webhook to `/internal/work-items/resolved` plus a periodic reconciliation sweep, the same pattern as Drive ([ADR-012](decisions.md#adr-012)). While in-process it is a function call; the contract is what matters.

**Token verification in satellites.** The core mints a 5-minute shared-secret JWT carrying userId, role, entities and resolved permissions; satellites verify locally with no network call ([ADR-009](decisions.md#adr-009)).
