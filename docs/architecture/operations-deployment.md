# Deployment

> Four deployables on day one, thirteen at full target — with the seam moving per-service, only when a second product or a separate owner justifies it.

### Context

**The business problem.** Reno runs a small engineering team. Thirteen separately deployed services would mean thirteen things to monitor, secure, version and release — real operational cost with no delivery benefit until something actually needs to be separate.

**Why this exists as its own component.** The alternative failure is worse: building without boundaries bakes the monolith in permanently, and the capability code SmartOps needs stays trapped. This topology exists to take neither loss — build as if everything were separate, run most of it together.

**What it does.** It defines what deploys on day one, what runs in-process behind its final interface, and the conditions under which a boundary moves.

**How it works.** A **seam** is a boundary where today's function call becomes tomorrow's network call without any calling code changing — `registerDeadline()` is identical whether the deadline monitor is a folder or a container. Four things deploy separately on day one, each for a concrete reason: the parser has heavy dependencies, spiky load and no state; the AI platform and Asana adapter already exist as services. A seam moves only when a second product needs the component, or a separate owner does — and only after its tables are exclusively its own and its jobs carry idempotency keys.

**Where it sits.** The physical view of the [containers](architecture-containers.md) page. Reasoning is [ADR-021](decisions.md#adr-021); the jobs that must be lock-protected before any move are listed under [scheduling](operations-scheduling.md).

> **Note** — **Why not deploy everything separately now.** The target names thirteen deployable units, but running thirteen services with one small team means thirteen things to monitor, secure and release for no delivery benefit. So everything is *built* behind its final interface while most of it still *runs* inside the core. A "seam" is the boundary where an in-process function call can later become a network call without any caller changing — which is what makes the deferral safe rather than merely postponed ([ADR-021](decisions.md#adr-021)).

## Day-one topology

*Diagram: Four deployables: the public core plus parser, AI platform and Asana adapter on an internal network, with two stores.*

Everything else runs in-process behind its final interface. A seam moves — becoming its own deployable — only when a second product needs the component or a separate owner does.

| Concern | Decision |
|---|---|
| Why these four | Parser: heavy deps + spiky load + genuinely stateless. AI platform and Asana adapter: already exist as services. Everything else: in-process behind its target interface ([ADR-021](decisions.md#adr-021)) |
| Network | One public ingress (core). Satellites on an internal network; no satellite reaches PostgreSQL |
| Secrets | Core: DB, JWT shared secret, licence public key. Connection Manager (when split): third-party OAuth creds, encrypted at rest. Parser: none |
| Cloud vs self-hosted | Both profiles supported by construction: offline licence check, no call-home, S3-compatible (not S3-only) storage, one composable stack |
| Moving a seam later | Extract module → own deploy + own store slice → repoint the in-process interface to HTTP. The interface is identical by design, so callers do not change |


## What must be true before any seam moves

- The module speaks only through its target interface (enforced in the monolith first).
- Its tables are touched by no other module (see [ownership](data-ownership.md)).
- Its jobs carry idempotency keys and single-runner locks (below).
