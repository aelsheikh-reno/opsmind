# Authorisation

> Authentication answers who; authorization answers what. They are owned by different components on purpose, so the identity provider can be swapped without touching the permission model.

### Context

**The business problem.** A user must be prevented from seeing payroll they have no business seeing, on every request, without adding a network round trip to every request.

**Why this exists as its own component.** Authentication and authorization are separated so a customer can switch identity providers without touching the permission model — and enforcement is split into two tiers because some questions are answerable from a token and some are not.

**What it does.** It shows both phases: what happens once at login, and what happens on every subsequent request.

**How it works.** At login the core asks the identity provider who this is, asks the Authorization service what they may do, and mints a short-lived signed token carrying role, entity scope and resolved permissions. Every satellite verifies that token locally with a shared secret — no introspection call. Coarse checks (may accountants view payroll?) come from the token; instance checks (is this manager on this project?) are answered by the owning module from domain data satellites never hold. The five-minute lifetime is the revocation window.

**Where it sits.** Spans the identity provider, the Authorization satellite and every core module. Model detail on [the authorization page](security-authorization.md).

## The permission model

Four dimensions: **section** (the 11 named areas) × **action** (view, edit, approve, add-bonus — replacing the old none/read/write levels) × **entity scope** (which legal entities) in the token; plus **instance** rules evaluated by the owning module. Approval thresholds and segregation of duties are deliberately **not** permissions — they are Work Items policy ([ADR-013](decisions.md#adr-013)).

## Revocation

Deactivating a user kills the refresh path; the worst case is one access-token lifetime — five minutes, chosen as defensible in a customer security review. Role changes propagate the same way with no reindexing anywhere, including search (index coarse, filter live).

## Special paths

- **Claim tokens**: one-time, single-use, issued by Authorization, independent of any IdP — external claimants never have accounts.
- **Break-glass**: one audited local administrator survives SSO enforcement for IdP outages ([ADR-008](decisions.md#adr-008)).
