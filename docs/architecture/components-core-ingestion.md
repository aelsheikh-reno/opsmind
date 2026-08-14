# Ingestion

> Owns every document entry channel and the rules that fire after extraction. The front door of the product: upload, inbound email, WhatsApp, and Drive all converge here.

### Context

**The business problem.** Documents are how information reaches Reno: a signed employment contract, a supplier invoice, a renewed trade licence, a receipt photographed by an engineer in the field. Retyping them is slow and error-prone, and anything not retyped is invisible to the system.

**Why this exists as its own component.** Four channels bring documents in — upload, email, WhatsApp, Drive — and without a single owner each would grow its own handling, its own confidence threshold and its own bugs. Concentrating them here means a rule change applies everywhere at once, and it makes one place responsible for the question that matters: what should this document *cause*?

**What it does.** It classifies an arriving document, looks up the field schema for that type, extracts the values, validates them, and then executes the rule matched to that type — creating a person, generating a payment schedule, registering a deadline.

**How it works.** Classification and extraction are delegated to the parser satellite, which is told what to look for rather than knowing. The registry supplies both the schema and the rule. A rule is **data**: a trigger, a flat list of ANDed conditions, and an ordered list of actions drawn from a fixed vocabulary. If a condition fails or confidence is too low, execution stops and the document becomes a work item — nothing is guessed. Local actions commit in one transaction; the two that cross a process boundary have explicit failure handling.

**Where it sits.** A core module, because what a contract should *cause* is specific to Reno. It calls the parser and the AI platform (satellites), reads the registry and Document kernel, and hands exceptions to Work Items. See it running end to end in the [walkthrough](walkthrough.md).

| Owns | Detail |
|---|---|
| Channels | upload · email webhook · WhatsApp webhook · Drive sync — one pipeline, four entrances |
| Rules engine | trigger + flat ANDed conditions + ordered actions; onConditionFail → review queue; onActionError → halt_and_queue. Rules are data in the registry; actions are a fixed code vocabulary (ADR-005) |
| Fan-out orchestration | Direct calls in sequence, one transaction where local (ADR-004) |
| Schedule generation | A shared function invoked per registry rule, writing into the owning module's schedule table (ADR-018) |


| Exposes | Depends on |
|---|---|
| ingest(file, channel, context) | Parser · Document Type Registry · Work Items (review) · Deadline monitor (registration) |
| runRule(ruleId, documentId) — manual actions | AI platform (template conversion action) |


> **Note** — Only **register_deadline** and **queue_review** cross out of process in the fan-out; every other action commits locally. Those two boundaries are the failure modes to handle, and both are covered by webhook-plus-sweep reconciliation.
