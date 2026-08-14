# OpsMind target architecture

> A Professional Services Automation platform with a compliance and document-intelligence layer, built for GCC multi-jurisdiction operations. This site is the full specification: every component, flow, decision and its reasoning.

> **Note** — **New to OpsMind?** Read [Orientation](orientation.md) first — it assumes no prior knowledge and explains the business, the product and the vocabulary. Then the [Walkthrough](walkthrough.md) traces one real document through every component. Together they take about ten minutes and make the rest of this site readable.

## What OpsMind is

OpsMind runs the back office of a professional services company operating across UAE, Egypt, KSA, Kuwait and Bahrain: projects and delivery, payroll, expenses, billing readiness, cash forecasting, and the compliance calendar — visas, trade licences, VAT and corporate tax filings — with AI-driven document ingestion as the primary way data enters the system.

The product category is **PSA (Professional Services Automation)** — the family of Kantata, Certinia and Projectworks — plus a compliance and document-intelligence layer those tools do not have. Accounting, invoice issuance and tax computation deliberately stay in Zoho Books and the accredited e-invoicing provider; OpsMind owns the forward view and the operational record.

## Start here, by role

| You are | Read first |
|---|---|
| Solution architect | [System context](architecture-context.md) → [Containers](architecture-containers.md) → [Decision records](decisions.md) |
| Backend developer | [Core modules](components-core.md) → [Kernel](components-kernel.md) → [Flows](flows-ingestion.md) |
| Frontend developer | [Presentation zones](architecture-presentation.md) → [Authorisation flow](flows-authorisation.md) |
| DB architect | [Table ownership](data-ownership.md) → [Data model](data-model.md) → [Migration](data-migration.md) |
| DevOps | [Deployment](operations-deployment.md) → [Scheduling](operations-scheduling.md) → [Attack surface](security-surface.md) |
| Security reviewer | [Attack surface](security-surface.md) → [Authorization](security-authorization.md) → [Retention](data-retention.md) |


## The one-paragraph architecture

A single **application core** (Next.js today) holds seven framework-free domain modules over a shared kernel, fronted by three inbound adapters — the HTTP API acting as a BFF, an MCP server for agents, and a scheduler. Around it sit **seven capability services** that a second product would reuse unchanged (parser, AI platform, docgen, Alert Manager, Work Items, notifications, Authorization) and **five integration adapters** that talk to one external system each and persist nothing. Day one, only four things deploy: core, parser, AI platform, Asana adapter — everything else lives in-process behind the target interfaces, and the deployment seam moves later, per service.

> **Note** — Nothing on this site is aspirational placement: every component was classified by applying the [eight principles](principles.md) to evidence from the current codebase, and every contested call has a [decision record](decisions.md) explaining the options that lost.
