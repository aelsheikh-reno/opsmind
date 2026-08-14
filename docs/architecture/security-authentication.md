# Authentication

> Provider-pluggable from day one: local credentials now, Google Workspace next, Okta later as a configuration entry. The User record in the kernel survives every switch.

### Context

**The business problem.** Reno uses local passwords today, will move to Google Workspace, and will meet customers who mandate Okta. Each change must not disturb who can approve payroll.

**Why this exists as its own component.** Authentication is kept deliberately thin and pluggable because it is the part most likely to be dictated by someone else — a customer's IT policy. Everything opinionated lives in authorization instead.

**What it does.** It defines which providers are supported, how a user is bound to one, and what happens when the provider is unavailable.

**How it works.** The User record holds the provider and the provider's subject identifier, so a switch re-points that pair without touching roles or history. Each user authenticates through exactly one provider: allowing a local password alongside single sign-on invites account-linking takeover, where someone who pre-registers an address inherits the account later. One audited local administrator is exempt, as the way back in when the provider is down.

**Where it sits.** Delegates outward to the identity provider and hands off to [Authorization](security-authorization.md) immediately afterwards. Claim tokens for external submitters are independent of all of it.

| Provider | Mechanics | Status |
|---|---|---|
| Credentials | Email + bcrypt hash in the User table; reset flow, lockout on failures | today |
| Google Workspace | OIDC; hosted-domain (hd) claim must equal the company domain; verified email match only | next |
| Okta / any OIDC | A provider entry, not a rewrite | later |


## Rules

- **One provider per user** ([ADR-008](decisions.md#adr-008)). Enabling SSO for a domain disables credentials login for those users; migration is admin-initiated and explicit. Account linking is a known takeover surface and the convenience case is weak at this team size.
- **One break-glass local administrator** survives SSO enforcement, audited, for IdP outages.
- **User** holds provider + providerSub + personId; roles never — those are Authorization's ([ADR-007](decisions.md#adr-007)).
- **Claim tokens** are independent of all of this: one-time, single-use, for external people who never get accounts.
