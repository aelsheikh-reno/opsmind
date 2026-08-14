# Core modules

> Seven in-process domain modules. Plain TypeScript, framework-free, each owning its tables in the application database. The membership test: company-specific logic where a change costs one commit, not a cross-team contract.

> **Note** — **What "module" means here.** A module is a section of the core application that owns one business area — a folder with enforced rules about which database tables it may write and how other code may reach it. It is not a separate program: all seven deploy together as one application. "Framework-free" means the logic is plain TypeScript that knows nothing about HTTP, which is what allows the same function to be called by a web request, by an AI agent, or by a scheduled job ([ADR-003](decisions.md#adr-003)).

Search is deliberately **not** a module — it is infrastructure (a permission-tagged materialized view, [ADR-006](decisions.md#adr-006)). Configuration is a composition surface, not a module. Both demotions are recorded in [ADR-001](decisions.md#adr-001).
