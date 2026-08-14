# Attack surface

> Everything reachable without a session, everything that writes from outside, and the order of the gates. This page is the answer to a security questionnaire.

### Context

**The business problem.** Reno's clients are GCC banks and telecoms. Before onboarding a vendor system they send a security questionnaire, and it asks the same things every time: what is exposed to the internet, how quickly can a departed employee lose access, who can read salary data, does the software phone home.

**Why this exists as its own component.** This page exists to be handed over as the answer, which is why it is written as a complete inventory rather than a summary. A reviewer who finds one undisclosed public endpoint discounts everything else in the document.

**What it does.** It lists every gate applied to a request in order, every endpoint reachable without a session, and how internal components are exposed to each other.

**How it works.** The gate order is licence, authentication, coarse authorization, onboarding, then handler — all before any business code. Exactly three routes sit outside it, each with its own protection: a single-use expiring token on the claim portal, lockout on login, and a static suspended page. Inbound webhooks are not exempt from verification — each checks a provider signature per request. Sensitive fields never enter the search index at all, so a search bug cannot leak salaries rather than merely being unlikely to.

**Where it sits.** Depends on [authorization](security-authorization.md) for the model and on the licence gate in the kernel. Known gaps in the current build are marked in bold rather than omitted — a reviewer will find them anyway, and disclosure costs less than discovery.

> **Note** — **What this page is for.** GCC banking and telecom clients send security questionnaires before onboarding a vendor, and they ask the same things: what is exposed to the internet, how fast can access be revoked, what happens to data. This page is written to be handed over as the answer. The gate order below is the sequence every single request passes through before any business code runs.

## Gate order, every request

## Public endpoints — the complete list

| Endpoint | Protection |
|---|---|
| /claim + /api/claim | One-time token, single use, expiring; **rate limiting required** (absent today — [defect](defects.md)) |
| /login | Lockout on repeated failures; SSO redirect when enforced |
| /suspended | Static |
| /api/inbound-email | Postmark signature verified per request (**unverified today**) |
| /api/webhooks/whatsapp | Meta signature verified per request (**unverified today**) |
| /api/cron/* | Replaced by the internal scheduler; external trigger paths removed |


## Internal exposure

- Satellites: internal network only, never public; requests carry the shared-secret JWT verified locally.
- Connection Manager holds third-party OAuth credentials encrypted; it vends per-service scoped tokens so an adapter cannot read another's credentials.
- The parser receives file bytes in the request — it holds no storage credentials at all.
- Sensitive fields (salary, national identifiers, passport numbers) never enter the search index — a search bug cannot leak them.

## Known-good answers for review questions

| Question | Answer |
|---|---|
| Internet-facing services? | One — the application core |
| Revocation window for a terminated employee? | ≤ 5 minutes (token TTL) |
| Can the AI read salaries via search? | No — excluded from the index at write time |
| On-prem call-home? | None — licence verification is offline |

