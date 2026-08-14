# Components

> Inside the application core and around it: four bands, each with its own membership test. Every component page records what it owns, what it exposes, what it depends on, and the evidence from the current code.

> **Note** — **What a "band" is and why it matters.** A band is a category of component with a rule for belonging to it. The rule is the point: it decides arguments. When someone proposes that payroll should become a shared service, the answer is not opinion — payroll fails the capability-service test, because no second product would use Reno's payroll rules unchanged. Every placement on this site was settled by applying one of these four tests, and where two tests pulled in different directions the argument is preserved in a [decision record](decisions.md).

## The four bands

| Band | Membership test | Count |
|---|---|---|
| [Core modules](components-core.md) | Company-specific domain logic; changing it costs one commit | 7 |
| [Shared kernel](components-kernel.md) | Vocabulary and reference data every module legitimately depends on | 12 |
| [Capability services](components-services.md) | A second product would use it unchanged; owns its own store | 7 |
| [Integration adapters](components-adapters.md) | Talks to exactly one external system; persists nothing | 5 |


## Inbound adapters — three transports, one implementation

| Transport | Serves | Note |
|---|---|---|
| HTTP API (BFF) | The web application | Composes across satellites server-side; holds the session |
| MCP server | Internal agents | Domain functions as named tools — possible only because the domain layer is framework-free ([ADR-003](decisions.md#adr-003)) |
| Scheduler | Core-owned jobs | Satellites run their own timers ([ADR-011](decisions.md#adr-011)) |


## How a placement was decided

Every component was placed by applying the [eight principles](principles.md) in order, with the current code as evidence. Where two principles pulled apart — payroll deductions, the deadline monitor's thresholds, the billing/finance boundary — the argument and the losing option are preserved in the [decision records](decisions.md) rather than on the component page. Component pages state what *is*; ADRs state *why*.
