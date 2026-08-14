# Presentation layer

> 38 routes in five zones. The zone is a rule, not a label: it determines what the gateway enforces, whether the BFF composes, and whether a screen may hold logic.

> **Note** — **Why group screens at all.** A list of 38 screens tells a new frontend developer nothing about which rules apply where. Grouping them by *access model and data ownership* does: a public screen needs its own protection, a screen with one owning module must contain no logic, and a screen spanning several owners must be assembled on the server. "BFF" below means backend-for-frontend — the layer in the core that assembles data for the browser so the browser never calls a satellite directly.

## Zone rules

| Zone | Routes | The rule |
|---|---|---|
| Public | /claim · /login · /suspended | No session by design; each carries its own protection. The claim portal is the one public write path — one-time token, single use, rate-limited |
| Onboarding gate | /onboarding | Intercepts every authenticated route until setup completes; the only screen allowed to write configuration before roles are meaningful |
| Domain screens | 11 routes | Exactly one owning module; reads and writes through its interface; zero logic in the page |
| Composition surfaces | 15 routes | Own nothing; the BFF resolves several owners server-side into one response |
| Satellite consoles | /integrations/zoho · /integrations/google-drive · /inbox/whatsapp | Subject is a satellite, but still routed through the core — satellites are never public |
| Unbuilt | /ai · /intel · /risk · /operations · /resources | Placeholders. Build or remove from navigation — a product decision |


## Route → owner map

### Domain screens

| Routes | Owner |
|---|---|
| /payroll · /payroll/costs | Payroll |
| /projects · /projects/[id] | Projects |
| /people · /people/[id] | Person kernel |
| /expenses · /finances/petty-cash | Expenses |
| /taxes · /vat · /budgets | Finance |


### Composition surfaces

| Routes | Composes |
|---|---|
| /dashboard · /executive | every module, summarised |
| /records (+6 children) | Document kernel + alert state |
| /finances | open items · settlements · forecast |
| /simulator | commitment_forecast + saved scenarios |
| /calendar | deadlines across all sources |
| /team | User kernel + Authorization |
| /settings | registry · alert policies · grants · connections |


## The two rules the current build breaks

> **Note** — **Pages import domain modules directly.** /dashboard, /finances and /simulator import lib/vat, lib/tax and lib/wallet at page level, bypassing the API — which is why the UI and the API compute the same figure differently. In the target, no page imports a domain module, ever.

> **Note** — **/taxes computes in the browser.** Liability estimates are calculated client-side in TaxesClient.tsx. That calculation moves into Finance; the screen becomes a reader like every other domain screen.

## What the frontend developer needs to know

- One origin, one session token; the BFF holds it. No tokens for satellites, no CORS to manage.
- Permission-aware rendering: composition surfaces receive already-filtered data — a viewer gets fewer panels, not a denied page.
- Scenario state (the simulator) moves from localStorage to the database — shared, audited ([data model](data-model.md)).
- Every screen's write goes to a module endpoint that enforces the same checks the UI hints at; the UI is never the enforcement point.
