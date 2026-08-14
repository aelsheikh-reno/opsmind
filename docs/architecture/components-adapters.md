# Integration adapters

> Five clients, one external system each. They translate the external model to a neutral shape and return it; they persist nothing on the OpsMind side, which is exactly what makes each swappable.

### Context

**The business problem.** OpsMind depends on outside systems it does not control: Zoho Books for accounting, Google Drive and email for documents, Asana for tasks, a rate provider for currency. Each has its own API, its own authentication and its own release schedule.

**Why this exists as its own component.** An adapter is the one place allowed to know any of that, so a provider change stays contained. Separating them from capability services also matters: an adapter is defined by *who it talks to*, not by what it computes, which is why the FX adapter is here even though rates feel like a capability.

**What it does.** Each translates one external system's model into a neutral shape and returns it, plus the Connection Manager which holds the credentials they all use.

**How it works.** Adapters **persist nothing** — they fetch, translate, return, and the core writes. That is what keeps them swappable: replacing Zoho becomes one adapter rewritten rather than a data migration, because no OpsMind row was ever authored by the adapter. Credentials live with the Connection Manager, which vends per-service scoped tokens so one adapter cannot obtain another's. Event-driven adapters pair every webhook with a reconciliation sweep, since webhooks are fast but silently lossy.

**Where it sits.** Satellites, internal-network only. The Zoho adapter is the load-bearing one: once invoice issuance moved out of scope, it became the single road to the ledger and the accredited provider.

> **Note** — **Why adapters store nothing.** An adapter that writes to the database has quietly become a second author of your data, and swapping it then means a migration rather than a configuration change. Keeping them stateless means replacing Zoho with a different accounting system is one adapter rewritten — the modules that call it never learn the difference.

| Adapter | Exposes | Notes |
|---|---|---|
| **Connection Manager** | connect / callback / disconnect · getToken(service, connectionId) → scoped token | OAuth custody and refresh. Vends per-service scoped tokens so one adapter cannot obtain another's credentials. Not Authorization: that holds permissions for your users; this holds credentials for third parties |
| **Zoho Books** | listAccounts · listVendors · createExpense · createBill · fetchTransactions · fetchInvoiceStatus | **The compliance path.** Once issuance moved out of scope, this adapter became load-bearing — if the eventual ASP-connected system is not Zoho, one adapter is replaced, not a module. Mapping (what an OpsMind payroll cost is in Zoho) stays in the core |
| **Google Drive** | listFolders · listChanges(since) · getFile(fileId) | Push notification signals "something changed"; the adapter then queries the changes API with a stored cursor. One sync function, two triggers: webhook (latency) + daily sweep (correctness). Watch channels expire and renewal is its own scheduled job |
| **Asana** | Projects, tasks, expense-bearing tasks | Exists. Per-tenant OAuth replaces the static environment token. Webhook + reconciliation sweep, same as Drive |
| **FX rates** | getRates(base, date?) → rates | Provider client with a fallback chain. Classified as an adapter precisely because the rate store belongs to the FX kernel — a "service" writing into the application database would break Rule 01 |


> **Note** — Every inbound webhook these adapters register (Drive, Asana) and every webhook the core receives (email, WhatsApp) must verify a signature per request. The current build does not enforce this — see [defects](defects.md).
