# Expenses & Claims

> The expense lifecycle, including submission by people who have no application account — contractors and field staff sending receipts through the claim portal.

### Context

**The business problem.** Field engineers and contractors incur costs — taxis, hotels, equipment — and many have no OpsMind account and never will. A contractor in Riyadh needs to submit a receipt without being onboarded as a user.

**Why this exists as its own component.** The unauthenticated submission path is the reason this is its own module rather than a corner of Finance. It is the only place in the product where an untrusted stranger writes data, so its handling, its rate limiting and its token lifecycle need one owner who is accountable for them.

**What it does.** It owns the expense lifecycle from submission through approval to reimbursement, including petty cash floats and the public claim portal.

**How it works.** A claim link carries a one-time token: single-use, expiring, issued by the Authorization service and independent of any identity provider, so revoking a claimant's access never touches the user model. Submitted receipts go through the parser like any other document. Approval is not decided here — the expense creates a work item, and Work Items applies the threshold and segregation-of-duties policy before returning a decision the module then executes.

**Where it sits.** A core module with one foot outside the security perimeter. That portal is one of only three routes reachable without a session, making it the surface most worth hardening — see [attack surface](security-surface.md).

| Owns | Detail |
|---|---|
| Expense records | With attachments and extraction results |
| Petty cash floats | Balance per holder |
| Claim portal | One-time token, single-use, unauthenticated by design — the only public write path |


| Exposes | Depends on |
|---|---|
| submitClaim(token, receipt) | Parser (receipt extraction) · Work Items (approval with thresholds and segregation of duties) |
| getExpenseRunRate(period) | Zoho adapter (settlement push) · Authorization (token issue/verify) |


> **Note** — Rate limiting on the claim endpoint is absent in the current build — listed in [defects](defects.md). It is the surface most worth hardening precisely because it must stay public.
