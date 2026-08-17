# Containers

> Deployable units and the network between them. **Satellite** is the collective name for everything deployable around the core — the seven capability services and five integration adapters. The browser reaches only the core; every satellite sits on an internal network with no public exposure, and no satellite touches the stores.

*Diagram: The browser reaches only the application core; satellites and stores sit on an internal network.*

Nothing inside the internal network is publicly reachable, and no satellite touches the stores — that single constraint is what lets a satellite be deployed, scaled or replaced on its own.

> **Note** — **"Container" here does not mean Docker.** In C4 the word means a separately runnable or deployable thing — an application, a service, a database. Some of these do run in Docker containers; the terminology is unrelated. If it can be started, stopped or deployed on its own, it is a container at this level.

## The full container list

| Container | Kind | Day one | Target |
|---|---|---|---|
| Application core | Next.js app | deployed | deployed |
| Document parser | capability | **deployed** | deployed |
| AI platform | capability | **deployed** (exists) | deployed |
| Asana adapter | adapter | **deployed** (exists) | deployed |
| Docgen | capability | in-process module | **importable package** |
| Alert Manager | capability | in-process module | **importable package** |
| Work Items | capability | in-process module | **importable package** |
| Notifications | capability | in-process module | **importable package** |
| Authorization | capability | in-process module | **importable package** |
| Connection Manager | adapter | in-process module | own deploy |
| Zoho · Drive · FX adapters | adapters | in-process modules | own deploy |
| PostgreSQL | store | one schema, written only by the core |   |
| Object storage | store | documents, receipts, backups |   |


> **Note** — **Five of these are no longer aiming at a deploy at all.** Docgen, the Alert Manager, Work Items, Notifications and Authorization target an **importable package** — a component a second codebase adds to itself and calls in its own process, using its host's storage ([ADR-039](decisions.md#adr-039), Ahmed 2026-08-17). Reuse there means another codebase importing it, not another system calling it. The parser and the AI platform stay deployed, because they are separate runtimes rather than a packaging choice. The **Day one** column is unaffected.

> **Note** — Day-one topology is **four deployables**, not thirteen ([ADR-021](decisions.md#adr-021)). Everything else is built behind its target interface as an in-process module — `registerDeadline()` is the same call whether the deadline monitor is a folder or a container — and the deployment seam moves later, per service, when a second product needs it or a contractor owns it.

## What "satellite" means

| Term | Covers | Test to be one |
|---|---|---|
| **Satellite** | All 12 — capability services + integration adapters | Deployable separately from the core; reached only over the internal network |
| Capability service | 7 — parser, AI platform, docgen, Alert Manager, Work Items, notifications, Authorization | A second product would use it unchanged, and it **owns its tables exclusively** — nothing outside it reads or writes them ([ADR-039](decisions.md#adr-039)) |
| Integration adapter | 5 — Connection Manager, Zoho, Drive, Asana, FX | Talks to exactly one external system and persists nothing |
| Store | PostgreSQL, object storage | **Not a satellite** — infrastructure the core owns exclusively |


## Rules that hold at this level

- **The BFF routes and composes; it decides nothing.** Business rules in the API layer would rebuild the monolith at the edge ([ADR-010](decisions.md#adr-010)).
- **No DEPLOYED satellite connects to the application database** ([ADR-002](decisions.md#adr-002)). A satellite that ships as an importable package shares its host's connection by construction ([ADR-039](decisions.md#adr-039)); for it the boundary is exclusive table ownership, enforced by the lint rule rather than by the network.
- **Adapters persist nothing.** They fetch, translate, return; the core writes ([Rule 03](principles.md)).
- **Internal auth is a shared-secret JWT** minted by the core, 5-minute TTL, verified locally by every **deployed** satellite ([ADR-009](decisions.md#adr-009)). A package has no caller to authenticate; its caller's identity arrives as an argument.
