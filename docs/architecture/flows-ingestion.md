# Document ingestion

> **Note** — **What a "flow" page is.** The component pages describe pieces in isolation. A flow — C4 calls it a dynamic view — shows those pieces interacting over time to accomplish one thing. Read the sequence diagrams left to right as participants and top to bottom as time: a solid arrow is a call, a dashed grey arrow is what came back, an amber arrow is a person acting on a system.

> The front door. Four channels converge on one pipeline: classify, look up the type, extract against its schema, validate, then execute the matched rule — with a review queue for everything that fails a gate.

### Context

**The business problem.** A document arriving by email should produce the same result as the same document uploaded through the browser. Without one pipeline, each channel drifts.

**Why this exists as its own component.** This flow is documented separately from the Ingestion module page because the interesting part is not what the module owns but the *order* in which four components interact, and where that sequence is allowed to stop.

**What it does.** It shows one document travelling from arrival to consequences: classification, schema lookup, extraction, validation, rule execution, and the two failure paths.

**How it works.** Read the sequence diagram left to right as participants, top to bottom as time. Solid arrows are calls, dashed grey arrows are what came back. Phase bands mark alternate paths — conditions passing, conditions failing, an action erroring.

**Where it sits.** The dynamic counterpart to [the Ingestion module](components-core-ingestion.md). For a narrative version with a real document, see the [walkthrough](walkthrough.md).

## The rule shape

**Rule shape — stored as data in the registry**

```
{
  trigger:    { event, documentType, channels[] }
  conditions: [ { field, op, value } ]        // flat, ANDed
  actions:    [ { do, params } ]              // ordered, fixed vocabulary
  onConditionFail: [ { do: "queue_review" } ]
  onActionError:   "halt_and_queue"
}
```

Rules are data, edited in Settings, versioned with actor and timestamp. Actions are code: `extract · create_person · create_enrolment · generate_schedule · register_deadline · create_open_item · convert_to_template · queue_review`. Adding a rule is configuration; inventing an action is a developer task — that boundary keeps this from becoming a scripting language nobody can debug ([ADR-005](decisions.md#adr-005)).

## Channel-conditioned behaviour

Confidence thresholds differ per channel — stricter for unattended ones (Drive, email, WhatsApp) where nobody can correct a bad extraction inline. The AI contract-to-template conversion is a declared but **manually triggered** action: available for employment contracts, never automatic.

## Transactionality — precisely

Local writes commit together. register_deadline and queue_review cross a boundary; each failure path halts, queues, and is reconciled by sweep. The person-match step is fuzzy and can itself route to review rather than guess.
