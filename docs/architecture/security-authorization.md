# Authorization

> A separate reusable service owns roles, the grant matrix and entity scope. Enforcement is two-tier: coarse from token claims everywhere, instance-level in core modules only.

### Context

**The business problem.** An accountant on the Egypt entity must not see UAE payroll; a project manager must see their own projects and not others'; a viewer must be barred from government documents entirely.

**Why this exists as its own component.** Authorization is a separate service rather than code in the core because a second product needs the same role machinery with a different vocabulary. Instance-level rules stay in the core because they are answered from domain data a satellite does not hold.

**What it does.** It defines roles, what each may do, which legal entities they may act on, and where each check is enforced.

**How it works.** Permissions have three dimensions — section, action, entity scope — resolved at login and carried in the token, so satellites can enforce coarse rules locally without a network call. Finer questions are answered by the owning module against its own tables. Approval thresholds and segregation of duties are deliberately excluded from this model: encoding "above AED 5,000 needs the owner" as roles explodes the matrix and still cannot express "not your own expense", so those are Work Items policy instead.

**Where it sits.** A capability service. Enforcement is shared with every core module; the sequence is on [the authorisation flow](flows-authorisation.md).

> **Note** — **Authentication versus authorization.** Authentication answers *who are you* and is handled by an identity provider — Google Workspace, Okta, or a local password. Authorization answers *what may you do* and is entirely OpsMind's business. They are separated so a customer can change identity providers without anyone touching the permission model. The "two tiers" below exist because some questions are answerable from the token alone ("may accountants view payroll?") and some need the actual data ("is this manager on this project?").

*Diagram: A short-lived session token carries coarse claims enforced everywhere; instance-level checks stay in core modules.*

Coarse checks are answerable from the token alone, so a satellite verifies them locally with no network call. Instance checks need domain data only the owning module holds, which is why they cannot be delegated.

## Model details

- **Sections**: the 11 named areas. **Actions**: view, edit, approve, and named capabilities such as add-bonus — replacing none/read/write.
- **Entity scope**: which legal entities a user may act on — an accountant on the Egypt entity does not see UAE payroll. Small and stable, so it fits the token.
- **Instance rules** stay with the data: ProjectTeamMember answers "is this PM on this project"; no policy service duplicates those relationships ([ADR-007](decisions.md#adr-007)).
- **Approval thresholds and segregation of duties are not permissions** — they are Work Items policy with numeric bounds and escalation ([ADR-013](decisions.md#adr-013)).
- **Search** enforces the same section grants inside the query: index coarse, filter live — a role change is effective on the next search with no reindexing ([ADR-006](decisions.md#adr-006)).

## Revocation window

Five minutes, by token TTL. Chosen explicitly as the number defended in customer security reviews; urgent kill goes through refresh-token revocation.
