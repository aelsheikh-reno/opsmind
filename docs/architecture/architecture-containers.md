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
| Docgen | capability | in-process module | own deploy |
| Alert Manager | capability | in-process module | own deploy |
| Work Items | capability | in-process module | own deploy |
| Notifications | capability | in-process module | own deploy |
| Authorization | capability | in-process module | own deploy |
| Connection Manager | adapter | in-process module | own deploy |
| Zoho · Drive · FX adapters | adapters | in-process modules | own deploy |
| PostgreSQL | store | one schema, written only by the core |   |
| Object storage | store | documents, receipts, backups |   |


> **Note** — Day-one topology is **four deployables**, not thirteen ([ADR-021](decisions.md#adr-021)). Everything else is built behind its target interface as an in-process module — `registerDeadline()` is the same call whether the deadline monitor is a folder or a container — and the deployment seam moves later, per service, when a second product needs it or a contractor owns it.

## What "satellite" means

| Term | Covers | Test to be one |
|---|---|---|
| **Satellite** | All 12 — capability services + integration adapters | Deployable separately from the core; reached only over the internal network |
| Capability service | 7 — parser, AI platform, docgen, Alert Manager, Work Items, notifications, Authorization | A second product would use it unchanged, and it owns its own store |
| Integration adapter | 5 — Connection Manager, Zoho, Drive, Asana, FX | Talks to exactly one external system and persists nothing |
| Store | PostgreSQL, object storage | **Not a satellite** — infrastructure the core owns exclusively |


## Rules that hold at this level

- **The BFF routes and composes; it decides nothing.** Business rules in the API layer would rebuild the monolith at the edge ([ADR-010](decisions.md#adr-010)).
- **No satellite connects to the application database.** That single constraint is what makes them independently deployable ([ADR-002](decisions.md#adr-002)).
- **Adapters persist nothing.** They fetch, translate, return; the core writes ([Rule 03](principles.md)).
- **Internal auth is a shared-secret JWT** minted by the core, 5-minute TTL, verified locally by every satellite ([ADR-009](decisions.md#adr-009)).
