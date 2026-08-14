# Tier-0 defects in the current build

> Faults, not architecture debates — each fixable inside the current monolith, and each blocking something in the target. This is the work that precedes any refactoring.

### Context

**The business problem.** The cash position on the executive dashboard counts supplier bills as income. Any logged-in user can read every salary through the search endpoint. Two schedulers fire the same jobs, so reminders send twice. These are live, today.

**Why this exists as its own component.** A defect list sits in an architecture document rather than a bug tracker because each of these follows from a missing structure — the fix and the restructuring are the same piece of work. The cash figure is wrong because invoices carry no direction field; you cannot correct the number without adding the field.

**What it does.** It lists the Tier-0 faults in the current build, each with the file or query that proves it and the structural change that retires it.

**How it works.** Each row pairs a fault with the target change that makes recurrence impossible rather than merely fixed: direction becomes a column, paid state becomes a settlement record, job execution becomes lock-protected, search filters against live grants. That pairing is the test of whether a fix is real — a correction that leaves the structure unchanged will be reintroduced by the next feature.

**Where it sits.** This is the work that precedes any refactoring, and it is the honest counterweight to the rest of the site: everything else describes a target, this describes what is true now.

> **Note** — **Why a defects page sits in an architecture document.** These are not bugs found by testing; they are faults that follow from missing structure, which is why fixing them and restructuring are the same task. The cash figure is wrong because invoices have no direction field — you cannot fix the number without adding the field. Each row therefore names both the fault and the structural change that makes it impossible to recur.

| Defect | Evidence | Impact |
|---|---|---|
| Search bypasses authorization | /api/search/route.ts queries raw tables with no session check | Any user reads salaries and government documents — privilege escalation |
| Unverified webhooks | inbound-email and WhatsApp handlers process without signature verification | Forged documents enter ingestion from the open internet |
| Duplicate cron execution | vercel.json and GitHub Actions both fire FX refresh and expiry reminders | Double sends, race conditions — fixed structurally by the job_runs lock |
| Cash position counts direction wrong | getCashPosition sums vendor invoices as income; no direction field exists | The headline executive number is wrong — fixed by [ADR-025](decisions.md#adr-025) |
| isPaid set by extraction | AI output writes payment state directly | Paid state is a guess — fixed by settlements ([ADR-015](decisions.md#adr-015)) |
| No rate limiting on /claim | Public endpoint, token check only | Abuse surface on the one public write path |
| Client-side tax computation | TaxesClient.tsx computes liabilities in the browser | UI and API disagree; moves to Finance as estimates |
| 5,411-line component | ProjectDetailClient.tsx | Unreviewable; splits along the domain-screen rules |

