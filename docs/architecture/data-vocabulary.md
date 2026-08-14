# Financial vocabulary

> The language of the financial spine, fixed once so it lands consistently in table names, API routes and the registry. Each term maps to what exists in code today.

### Context

**The business problem.** The same amount of money gets called an invoice, a payment, a schedule row and a balance depending on which screen you are on — and in the current build it genuinely is stored four ways.

**Why this exists as its own component.** Fixing the words before fixing the tables is deliberate. Vocabulary decided once lands consistently in table names, API routes, UI labels and conversation; decided late, it produces a schema whose names argue with each other.

**What it does.** It defines each financial term, maps it to whatever exists in the code today, and reserves the words that would otherwise collide.

**How it works.** Terms are taken from commitment accounting rather than invented, so an accountant already knows them — "open item" is SAP's word for an outstanding amount. Where a word carries several meanings in software, one meaning is reserved and the others are renamed: "claim" means expense reimbursement here and nothing else.

**Where it sits.** Referenced by [the data model](data-model.md), Finance, Billing and Payroll. The lifecycle these terms describe is on [contract to cash](flows-contract-to-cash.md).

| Term | Meaning | Today's equivalent |
|---|---|---|
| **Commitment** | What a signed contract promises to pay or collect, as a dated schedule. Not yet owed | PaymentSchedule rows (employment + leases) |
| **Open item** | An outstanding amount, either direction, that ages until cleared — SAP's own term | Unpaid invoice Documents, unpushed payroll, due filings |
| **Settlement** | A payment applied against an open item; partials supported; carries the FX snapshot | isPaid / paidAt flags on six different models |
| **Billable position** | Delivered-but-not-yet-invoiced value with an expected date and confidence — IFRS 15's unbilled receivable | ProjectInvoice with issuedAt null |
| **Enrolment** | An entity's registration under a regime (TRN, frequency, anchor) | VatConfig + TaxConfig |
| **Regime** | The law itself: jurisdiction × obligation type, rates and deadlines | Hardcoded rates in TaxesClient and lib |
| **Filing** | One period's obligation under an enrolment; estimate for forecasting, never the return | VatPayment + TaxPayment |
| **Claim** | **Reserved** for expense reimbursement only | ClaimToken, /claim portal — unchanged |


> **Note** — "Claim" carries three senses in software (expense claim, token claims, financial claim). The third is always called an **open item** here, precisely so the word never collides.

## Confidence tiers — one vocabulary, both directions

| Tier | Outflows | Inflows |
|---|---|---|
| contracted | signed salary, filing due | issued invoice |
| expected | lease with a break clause | milestone ready to bill |
| provisional | planned hire | pipeline milestone |

