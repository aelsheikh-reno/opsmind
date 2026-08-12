# OpsMind — project instructions

You are working on OpsMind: a Professional Services Automation platform with a
compliance and document-intelligence layer, for a consultancy operating across
UAE, Egypt, KSA, Kuwait and Bahrain.

**This is a new build.** A previous version of OpsMind exists and is in use by
the team; its source is committed read-only at `reference/legacy/` because it is
the oracle for differential tests — CI needs it present. Its dependencies, env
files and data are not committed and never will be. Treat it as a
specification of business rules, not as a source of structure — its structure is
what this build exists to replace. When you need to know how Egyptian income tax
brackets work or how prorata handles a mid-month leaver, read the legacy code.
When you need to know where something belongs, read `docs/architecture/`.

## Non-negotiable rules

These come from settled architecture decisions in `docs/decisions.md`. Breaking
one is not a style disagreement — it means the change is wrong.

1. **A module owns its tables exclusively.** No module reads or writes another
   module's tables. Cross-module access goes through the owning module's public
   interface. The ownership map is in `docs/architecture/data-ownership.md`.
2. **Domain logic never lives in a route handler or a page.** Routes translate
   HTTP to a domain call and back. Pages render. Calculation lives in
   `lib/modules/<module>/`.
3. **Never import `@/lib/db` outside a module's `repository.ts`.** The lint rule
   enforces this; do not add an eslint-disable to get around it.
4. **A module's public surface is its `index.ts`.** Never deep-import
   `lib/modules/payroll/internal/...` from outside `lib/modules/payroll/`.
5. **Payment state is a recorded event, never a boolean.** There is no `isPaid`
   column anywhere. Paid state is derived from `Settlement` rows.
6. **Money has a direction.** Every invoice, open item and settlement carries
   `inbound` or `outbound`. Never infer it from context.
7. **The record is the thing; the document is evidence.** A salary lives in a
   schedule you can query. The signed PDF sits alongside it as proof.
8. **Never guess when confidence is low.** Extraction below threshold, an
   ambiguous name match, an unclassifiable document — create a work item for a
   human. Guessing produces silently wrong data.
9. **Dates are business-day aware.** The working week is Sunday–Thursday in the
   Gulf. Never do deadline arithmetic in plain UTC days.
10. **OpsMind is not the accounting ledger and not the tax engine.** It never
    issues invoices or computes a tax return. Those belong to Zoho and the
    accredited e-invoicing provider.

## Structure

```
app/                      Next.js routes and pages — thin, no domain logic
  api/                    HTTP adapter: parse, call a module, serialise
lib/
  kernel/                 shared vocabulary: person, document, entity,
                          jurisdiction, regime, enrolment, fx, audit
  modules/                one folder per business area, each with:
    <module>/
      index.ts            the ONLY public surface
      repository.ts       the ONLY file importing @/lib/db; its first line is
                          `// owns: TableA, TableB` naming every table it may
                          touch — the boundary check reads this declaration
      *.ts                domain logic, plain TypeScript, no HTTP
  services/               capability services, in-process for now but behind
                          their final interfaces (alerts, work-items, parser,
                          docgen, notifications, authz)
  adapters/               one external system each; fetch, translate, return —
                          never persist
docs/architecture/        the specification; read before structural work
prisma/                   schema and migrations
tests/                    see Testing below
reference/legacy/         READ ONLY — the previous version, for business rules
```

Modules: `payroll`, `projects`, `expenses`, `billing`, `finance`, `ingestion`,
`deadlines`.

## Stack

Next.js 16, React 19, TypeScript, Prisma 5 + PostgreSQL, NextAuth v5, Node 20.

Next.js 16 has breaking changes from earlier versions. Check
`node_modules/next/dist/docs/` before using an API you are unsure about rather
than assuming the older convention.

## Testing

Vitest for unit and integration, Playwright for end-to-end.

Anything that computes money or a date needs tests before it is considered done:
payroll calculation, statutory deductions, prorata, tax estimates, FX
conversion, deadline arithmetic, cash projection. For these, write the test
cases from the legacy behaviour first, then confirm with Ahmed whether the
legacy behaviour is correct — some of it has never been validated.

Run `npm test` before saying a task is complete.

## Working style

- **One task per branch and per PR.** If a task grows past roughly 400 changed
  lines, stop and propose splitting it.
- **Ask before inventing a business rule.** If the legacy code and the docs
  disagree, or neither answers the question, ask rather than choose.
- **Never weaken a lint rule or delete a test to make something pass.** If a
  rule seems wrong, say so and stop.
- **Never run destructive database commands** (`prisma migrate reset`, `DROP`)
  without explicit confirmation in the conversation.
- Say what you did not do. Silent partial completion is worse than an
  incomplete task that is honestly reported.

## Commits

Conventional commits, imperative mood, scoped to the module:

```
feat(payroll): add effective-dated salary terms
fix(finance): derive paid state from settlements
test(deadlines): cover Sunday-Thursday business day arithmetic
```
